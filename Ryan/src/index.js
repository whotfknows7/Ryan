// src/index.js
require('dotenv').config();

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { MessageFlags } = require('discord.js');
const { CustomClient } = require('./structures/CustomClient');
const { DatabaseService } = require('./services/DatabaseService');
const { PunishmentService } = require('./services/PunishmentService');
const { ResetService } = require('./services/ResetService');
const { XpService } = require('./services/XpService');
const { LeaderboardUpdateService } = require('./services/LeaderboardUpdateService');
const { ReactionHandler } = require('./handlers/ReactionHandler');
const { loadCommands } = require('./handlers/CommandHandler');
const { handleInteraction } = require('./handlers/InteractionHandler');
const { LeaderboardCleanupService } = require('./services/LeaderboardCleanupService');
const { cleanExpiredResetRoles } = require('./commands/admin/ResetRoleCommands');
const { setRoleSkip } = require('./lib/cooldowns');
const logger = require('./lib/logger');

const client = new CustomClient();

// =================================================================
// RUST RENDERER MANAGER
// =================================================================
function startRenderer() {
  const rootDir = path.resolve(__dirname, '../../'); // Go up to Ryan v7 root
  const rendererDir = path.join(rootDir, 'Renderer');
  const binaryPath = path.join(rendererDir, 'target/release/renderer');

  logger.info('🦀 Checking Rust Renderer status...');

  // 1. Check if binary exists
  if (!fs.existsSync(binaryPath)) {
    logger.warn('⚠️ Renderer binary not found. Attempting to build... (This may take minutes)');
    try {
      // Attempt to build using cargo
      execSync('cargo build --release', { cwd: rendererDir, stdio: 'inherit' });
      logger.info('✅ Rust Renderer built successfully.');
    } catch (e) {
      logger.error('❌ FAILED TO BUILD RENDERER. Do you have Rust/Cargo installed?');
      logger.error('If you are on a shared host, you may need to compile "Ryan v7/Renderer" on your PC and upload the "target" folder.');
      return; // Stop here if build fails
    }
  }

  // 2. Spawn the process
  logger.info('🚀 Launching Renderer Service...');
  const rendererProcess = spawn(binaryPath, [], {
    cwd: rendererDir,
    detached: false,
    stdio: 'inherit' // Pipe logs to console so you can see "Listening on..."
  });

  rendererProcess.on('error', (err) => {
    logger.error('❌ Renderer failed to start:', err);
  });

  rendererProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      logger.warn(`⚠️ Renderer exited with code ${code}. Restarting in 5s...`);
      setTimeout(startRenderer, 5000); // Auto-restart if it crashes
    }
  });

  // Ensure renderer dies when bot dies
  process.on('exit', () => rendererProcess.kill());
}
// =================================================================

/**
 * Recursive task scheduler
 */
const scheduleTask = (name, task, intervalMs, initialDelay = 0) => {
  const run = async () => {
    try {
      await task();
    } catch (e) {
      logger.error(`Background task '${name}' error:`, e);
    } finally {
      setTimeout(run, intervalMs);
    }
  };
  const startDelay = initialDelay > 0 ? initialDelay : intervalMs;
  setTimeout(run, startDelay);
  logger.info(`Scheduled task '${name}' with ${intervalMs}ms interval (Start delay: ${startDelay}ms)`);
};

/**
 * Per-guild task scheduler
 */
const schedulePerGuildTask = (name, taskFn, intervalMs, initialDelay = 0) => {
  scheduleTask(name, async () => {
    if (!client.guilds.cache.size) return;
    const guilds = Array.from(client.guilds.cache.keys());
    const results = await Promise.allSettled(guilds.map((guildId) => taskFn(guildId)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.error(`${name} failed for guild ${guilds[index]}:`, result.reason);
      }
    });
  }, intervalMs, initialDelay);
};

async function main() {
  // 0. Force DB Sync (REMOVED FOR GCP - RUN MANUALLY)
  /*
  try {
    logger.info('🔄 Force-Syncing Database Schema...');
    execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
    logger.info('✅ Database Synced Successfully.');
  } catch (error) {
    logger.error('❌ Failed to sync database (Prisma error):', error);
  }
  */

  // 1. START THE RENDERER
  startRenderer();

  // 2. Database Health Check
  logger.info('Checking database connection...');
  const dbHealth = await DatabaseService.checkDatabaseIntegrity();
  if (!dbHealth) {
    logger.error('CRITICAL: Database connection failed. Exiting.');
    process.exit(1);
  }
  logger.info('Database connection established.');

  // 3. Load Commands
  logger.info('Loading commands...');
  await loadCommands(client);
  logger.info(`Loaded ${client.commands.size} commands.`);

  // 4. Start Bot
  try {
    await client.start();
    logger.info('Bot started successfully.');

    // 5. Interaction Handler
    client.on('interactionCreate', async (interaction) => {
      try {
        await handleInteraction(interaction);
      } catch (error) {
        logger.error('Critical error in interaction handler:', error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '💥 An unexpected error occurred. Our engineers have been notified!',
            flags: MessageFlags.Ephemeral
          }).catch(logger.error);
        }
      }
    });

    // =================================================================
    // EVENTS & TASKS
    // =================================================================

    client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      try {
        await XpService.handleMessageXp(message);
        await XpService.handleKeywords(message);
      } catch (error) {
        logger.error('XP/Keyword Error:', error);
      }
    });

    client.on('guildMemberUpdate', async (oldMember, newMember) => {
      try {
        await XpService.checkRoleAnnouncements(oldMember, newMember);
      } catch (error) {
        logger.error('Role Announcement Error:', error);
      }
    });

    client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;
      try {
        await ReactionHandler.handleReactionAdd(reaction, user);
      } catch (error) {
        logger.error('Reaction Add Error:', error);
      }
    });

    client.on('messageReactionRemove', async (reaction, user) => {
      if (user.bot) return;
      try {
        await ReactionHandler.handleReactionRemove(reaction, user);
      } catch (error) {
        logger.error('Reaction Remove Error:', error);
      }
    });

    client.on('guildMemberAdd', async (member) => {
      try {
        const wasJailed = await PunishmentService.handleMemberJoin(member);
        if (!wasJailed) {
          const skipTimestamp = setRoleSkip(member.id);
          logger.info(`Set role skip for ${member.user.tag} at ${skipTimestamp}`);
        }
      } catch (error) {
        logger.error('Member Join Error:', error);
      }
    });

    client.on('guildMemberRemove', async (member) => {
      try {
        await PunishmentService.handleMemberLeave(member);
        await DatabaseService.deleteUserData(member.guild.id, member.id);
        logger.info(`Cleaned up XP data for departed member ${member.user.tag}`);
      } catch (error) {
        logger.error('Member Remove Error:', error);
      }
    });

    // Background Tasks
    scheduleTask('DB Heartbeat', async () => {
      try { await DatabaseService.checkDatabaseIntegrity(); }
      catch (e) { logger.error('❤️ DB Heartbeat failed:', e); }
    }, 290 * 1000);

    scheduleTask('Punishment Checker', async () => {
      await PunishmentService.checkExpiredPunishments(client);
    }, 60 * 1000, 5 * 1000);

    schedulePerGuildTask('Reset Cycle Checker', async (guildId) => {
      await ResetService.checkResetCycle(client, guildId);
    }, 60 * 1000, 10 * 1000);

    schedulePerGuildTask('Reset Role Expiry', async (guildId) => {
      await cleanExpiredResetRoles(guildId);
    }, 60 * 1000, 15 * 1000);

    scheduleTask('Leaderboard Updater', async () => {
      await LeaderboardUpdateService.updateLiveLeaderboard(client);
    }, 20 * 1000, 20 * 1000);

    scheduleTask('Leaderboard Cleanup', async () => {
      await LeaderboardCleanupService.cleanupExpiredLeaderboards(client);
    }, 60 * 1000, 30 * 1000); // Check every minute

    logger.info('✅ All background services started.');

  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Global Error Handlers
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

main();
