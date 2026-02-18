// src/index.js
require('dotenv').config();
const QueueService = require('./services/QueueService');

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { MessageFlags } = require('discord.js');
const { CustomClient } = require('./structures/CustomClient');
const { DatabaseService } = require('./services/DatabaseService');
const { PunishmentService } = require('./services/PunishmentService');

const { XpService } = require('./services/XpService');
const ImageService = require('./services/ImageService');

const { ReactionHandler } = require('./handlers/ReactionHandler');
const { loadCommands } = require('./handlers/CommandHandler');
const { handleInteraction } = require('./handlers/InteractionHandler');

const { MessageIntentHandler } = require('./handlers/MessageIntentHandler');
const { LeaderboardCleanupService } = require('./services/LeaderboardCleanupService');
const logger = require('./lib/logger');

const client = new CustomClient();

// =================================================================
// STARTUP CLEANUP — Kill zombies from previous sessions
// =================================================================
function cleanupStaleProcesses() {
  logger.info('🧹 Running startup cleanup...');

  // 1. Kill any stale renderer processes
  try {
    execSync("pkill -f 'target/release/renderer' 2>/dev/null || true", { stdio: 'ignore' });
  } catch {
    /* best-effort */
  }

  // 2. Kill any stale chrome/chromium processes
  try {
    execSync("pkill -f 'chrome.*--headless' 2>/dev/null || true", { stdio: 'ignore' });
  } catch {
    /* best-effort */
  }

  // 3. Free port 3000
  try {
    execSync('lsof -t -i:3000 | xargs -r kill -9 2>/dev/null || true', { stdio: 'ignore' });
  } catch {
    /* best-effort */
  }

  // 4. Remove Chrome lock files
  const lockFile = '/tmp/chromiumoxide-runner/SingletonLock';
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
    logger.info('🧹 Cleared stale Chrome SingletonLock.');
  }

  // 5. Clean ChromiumOxide temp directory
  const chromiumDir = '/tmp/chromiumoxide-runner';
  if (fs.existsSync(chromiumDir)) {
    try {
      fs.rmSync(chromiumDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    logger.info('🧹 Cleared Chrome temp directory.');
  }

  logger.info('✅ Startup cleanup complete.');
}

// =================================================================
// GRACEFUL SHUTDOWN — Clean exit on Ctrl+C / kill signal
// =================================================================
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return; // Prevent double-shutdown
  isShuttingDown = true;
  logger.info(`\n🛑 Received ${signal}. Shutting down gracefully...`);

  // 1. Kill renderer process tree
  if (startRenderer._currentProcess && !startRenderer._currentProcess.killed) {
    try {
      // Kill the entire process group (renderer + chrome children)
      process.kill(-startRenderer._currentProcess.pid, 'SIGTERM');
    } catch {
      try {
        startRenderer._currentProcess.kill('SIGKILL');
      } catch {
        /* best-effort */
      }
    }
    logger.info('🦀 Renderer process terminated.');
  }

  // 2. Kill any remaining chrome processes
  try {
    execSync("pkill -f 'chrome.*--headless' 2>/dev/null || true", { stdio: 'ignore' });
  } catch {
    /* best-effort */
  }

  // 3. Free port 3000
  try {
    execSync('lsof -t -i:3000 | xargs -r kill -9 2>/dev/null || true', { stdio: 'ignore' });
  } catch {
    /* best-effort */
  }

  // 4. Clean lock files
  const lockFile = '/tmp/chromiumoxide-runner/SingletonLock';
  if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
  const chromiumDir = '/tmp/chromiumoxide-runner';
  if (fs.existsSync(chromiumDir)) {
    try {
      fs.rmSync(chromiumDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  // 5. Destroy Discord client
  // 5. Destroy Discord client
  try {
    client.destroy();
    logger.info('🤖 Discord client destroyed.');
  } catch {
    /* best-effort */
  }

  // 6. Shutdown QueueService
  try {
    await QueueService.shutdown();
  } catch (e) {
    logger.error('Error shutting down queues:', e);
  }

  logger.info('👋 Goodbye!');
  process.exit(0);
}

// Register signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Ctrl+C
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // kill command

// =================================================================
// RUST RENDERER MANAGER
// =================================================================
function startRenderer() {
  const rootDir = path.resolve(__dirname, '../'); // Go up to Ryan root
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
    } catch {
      logger.error('❌ FAILED TO BUILD RENDERER. Do you have Rust/Cargo installed?');
      logger.error(
        'If you are on a shared host, you may need to compile "Renderer" on your PC and upload the "target" folder.'
      );
      return; // Stop here if build fails
    }
  }

  // 2. Clean up stale Chrome lock files and port 3000 before spawning
  const lockFile = '/tmp/chromiumoxide-runner/SingletonLock';
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
    logger.info('🧹 Cleared stale Chrome SingletonLock.');
  }
  try {
    execSync('lsof -t -i:3000 | xargs -r kill -9', { stdio: 'ignore' });
  } catch {
    /* best-effort */
  }

  // 3. Spawn the process (detached so we can kill the process group)
  logger.info('🚀 Launching Renderer Service...');
  startRenderer._currentProcess?.kill(); // Kill previous if still alive
  const rendererProcess = spawn(binaryPath, [], {
    cwd: rendererDir,
    detached: true,
    stdio: 'inherit', // Pipe logs to console so you can see "Listening on..."
  });
  startRenderer._currentProcess = rendererProcess;

  rendererProcess.on('error', (err) => {
    logger.error('❌ Renderer failed to start:', err);
  });

  // Track consecutive failures to prevent infinite restart loops
  startRenderer._failures = (startRenderer._failures || 0) + 1;
  const MAX_RESTARTS = 10;

  rendererProcess.on('exit', (code, _signal) => {
    if (isShuttingDown) return; // Don't restart during shutdown
    if (code === 0 || code === null) {
      startRenderer._failures = 0; // Reset on clean exit
      return;
    }
    if (startRenderer._failures >= MAX_RESTARTS) {
      logger.error(`❌ Renderer failed ${MAX_RESTARTS} times in a row. Giving up. Use /reconnect or restart the bot.`);
      return;
    }
    logger.warn(
      `⚠️ Renderer exited with code ${code}. Restarting in 5s... (${startRenderer._failures}/${MAX_RESTARTS})`
    );
    setTimeout(startRenderer, 5000);
  });
}
// =================================================================

async function main() {
  // 0. Cleanup stale processes from previous sessions
  cleanupStaleProcesses();

  // 1. Force DB Sync
  try {
    logger.info('🔄 Force-Syncing Database Schema...');
    execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
    logger.info('✅ Database Synced Successfully.');
  } catch (error) {
    logger.error('❌ Failed to sync database (Prisma error):', error);
  }

  // 2. START THE RENDERER
  startRenderer();

  // 3. Database Health Check
  logger.info('Checking database connection...');
  const dbHealth = await DatabaseService.checkDatabaseIntegrity();
  if (!dbHealth) {
    logger.error('CRITICAL: Database connection failed. Exiting.');
    process.exit(1);
  }
  logger.info('Database connection established.');

  // 4a. Preload Assets (Optimization for first interaction speed)
  logger.info('Preloading assets...');
  await ImageService.preloadAssets();

  // 4. Load Commands
  logger.info('Loading commands...');
  await loadCommands(client);
  logger.info(`Loaded ${client.commands.size} commands.`);

  // 5. Start Bot
  try {
    await client.start();
    logger.info('Bot started successfully.');

    // 6. Interaction Handler
    client.on('interactionCreate', async (interaction) => {
      try {
        await handleInteraction(interaction);
      } catch (error) {
        logger.error('Critical error in interaction handler:', error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction
            .reply({
              content: '💥 An unexpected error occurred. Our engineers have been notified!',
              flags: MessageFlags.Ephemeral,
            })
            .catch(logger.error);
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
        await MessageIntentHandler.handleMessage(message);
      } catch (error) {
        logger.error('XP/Keyword Error:', error);
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
          if (!wasJailed) {
            // Role skip logic removed
          }
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

    // Background Tasks (BullMQ-scheduled)
    QueueService.initialize(client);

    // Leaderboard Cleanup (Startup + Interval)
    await LeaderboardCleanupService.cleanupExpiredLeaderboards(client);
    setInterval(() => LeaderboardCleanupService.cleanupExpiredLeaderboards(client), 60 * 1000);

    // =================================================================
    // CONFIG SYNC (Redis Pub/Sub)
    // =================================================================
    const { subRedis } = require('./config/redis');
    const GuildIdsHelper = require('./utils/GuildIdsHelper');

    // Subscribe to config updates
    subRedis.subscribe('config_update', (err, count) => {
      if (err) {
        logger.error('❌ Failed to subscribe to config_update channel:', err);
      } else {
        logger.info(`✅ Subscribed to config_update channel. count=${count}`);
      }
    });

    // Handle messages
    subRedis.on('message', (channel, message) => {
      if (channel === 'config_update') {
        const guildId = message; // Message is just the guildId
        // logger.debug(`🔄 Received config_update for ${guildId}, invalidating cache.`); 
        // ^ Debug log optional, keep it clean
        GuildIdsHelper.invalidate(guildId);
      }
    });

    logger.info('✅ All background services started.');
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Global Error Handlers
process.on('unhandledRejection', (reason, _promise) => {
  logger.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

main();
