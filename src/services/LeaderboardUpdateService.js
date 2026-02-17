// src/services/LeaderboardUpdateService.js

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getIds, clearCache } = require('../utils/GuildIdsHelper');
const { DatabaseService } = require('./DatabaseService');
const ImageService = require('./ImageService');
const logger = require('../lib/logger');

// =================================================================
// CRITICAL: This variable must be defined HERE (Top Level Scope)
// =================================================================
const previousTopUsersJSON = new Map();
const updatingGuilds = new Set();
const lastUpdateTimes = new Map();
const tempLeaderboards = new Map(); // guildId -> { weekly: msgId, lifetime: msgId }

const TEMP_LB_PATH = path.join(__dirname, '../events/CurrentLbs.json');

// =================================================================
// TEMP LEADERBOARD PERSISTENCE — Synced to CurrentLbs.json
// =================================================================

/**
 * Load saved temp leaderboard IDs from JSON into the in-memory map.
 * Called once on bot startup.
 */
function loadTempLeaderboards() {
  try {
    if (!fs.existsSync(TEMP_LB_PATH)) return;
    const raw = fs.readFileSync(TEMP_LB_PATH, 'utf8');
    const data = JSON.parse(raw || '[]');
    for (const entry of data) {
      const validTypes = ['weekly', 'lifetime'];
      if (!entry.guildId || !entry.messageId || !validTypes.includes(entry.type)) continue;
      const existing = tempLeaderboards.get(entry.guildId) || {};
      existing[entry.type] = entry.messageId;
      tempLeaderboards.set(entry.guildId, existing);
    }
    logger.info(`[TempLB] Loaded ${data.length} temp leaderboard(s) from disk.`);
  } catch (e) {
    logger.warn(`[TempLB] Failed to load from disk: ${e.message}`);
  }
}

/**
 * Persist the entire tempLeaderboards map to JSON.
 */
function persistTempLeaderboards() {
  try {
    const entries = [];
    for (const [guildId, types] of tempLeaderboards) {
      for (const [type, messageId] of Object.entries(types)) {
        entries.push({ guildId, type, messageId });
      }
    }
    fs.writeFileSync(TEMP_LB_PATH, JSON.stringify(entries, null, 2));
  } catch (e) {
    logger.warn(`[TempLB] Failed to persist to disk: ${e.message}`);
  }
}

/**
 * Save a temp leaderboard entry (updates map + JSON).
 */
function saveTempLeaderboard(guildId, type, messageId) {
  const existing = tempLeaderboards.get(guildId) || {};
  existing[type] = messageId;
  tempLeaderboards.set(guildId, existing);
  persistTempLeaderboards();
}

/**
 * Remove a temp leaderboard entry (updates map + JSON).
 */
function removeTempLeaderboard(guildId, type) {
  const existing = tempLeaderboards.get(guildId);
  if (!existing) return;
  delete existing[type];
  if (Object.keys(existing).length === 0) {
    tempLeaderboards.delete(guildId);
  } else {
    tempLeaderboards.set(guildId, existing);
  }
  persistTempLeaderboards();
}

// Load on module import (cold start)
loadTempLeaderboards();

class LeaderboardUpdateService {
  static async updateLiveLeaderboard(client) {
    logger.debug('Starting updateLiveLeaderboard...');
    for (const [guildId, guild] of client.guilds.cache) {
      // 0. Concurrency Lock & Rate Limit
      if (updatingGuilds.has(guildId)) {
        logger.warn(`[${guildId}] Leaderboard update skipped: Already in progress.`);
        continue;
      }

      // THROTTLE: Don't update more than once every 15 seconds per guild
      const lastUpdate = lastUpdateTimes.get(guildId) || 0;
      if (Date.now() - lastUpdate < 15000) {
        // logger.debug(`[${guildId}] Throttled.`);
        continue;
      }

      updatingGuilds.add(guildId);

      try {
        const ids = await getIds(guildId);
        const channelId = ids.leaderboardChannelId;

        if (!channelId) {
          logger.debug(`[${guildId}] No leaderboard channel configured.`);
          continue;
        }

        const channel = guild.channels.cache.get(channelId);
        if (!channel?.isTextBased()) {
          logger.debug(`[${guildId}] Leaderboard channel not found or not text-based.`);
          continue;
        }

        // 1. Fetch Top 10 for display (Fast)
        const topUsers = await DatabaseService.fetchTopUsers(guildId, 10, 'daily');

        // Optimization: Skip if the data hasn't changed
        const currentJSON = JSON.stringify(topUsers);

        // Check map existence safely
        if (previousTopUsersJSON.has(guildId) && currentJSON === previousTopUsersJSON.get(guildId)) {
          // Even if content didn't change, we might want to ensure the message exists?
          // But strict optimization says skip.
          logger.debug(`[${guildId}] Leaderboard data unchanged. Skipping.`);
          continue;
        }

        logger.info(`Updating leaderboard for guild ${guildId}... (Data changed)`);

        // 2. Generate Payload
        // logger.info(`[${guildId}] Generating payload...`);
        const payload = await this.generateLeaderboardPayload(guild, 'daily', 1, null, true);
        // logger.info(`[${guildId}] Payload generated.`);

        // 3. Scan & Clean Old Leaderboards (Fix for Glitch/Restarts)
        try {
          // Fetch last 5 messages to find any previous leaderboards sent by me
          const messages = await channel.messages.fetch({ limit: 5 });
          const leaderboardTitles = ['Yappers of the day!', 'Yappers of the week!', 'All-time Yappers!'];

          const guildTemps = tempLeaderboards.get(guildId) || {};
          const protectedTempIds = Object.values(guildTemps);
          const currentMainId = ids.dailyLeaderboardMessageId;

          const messagesToDelete = messages.filter((msg) => {
            // Must be sent by me
            if (msg.author.id !== client.user.id) return false;

            // PROTECT: Do not delete ANY active Temporary Leaderboards (Weekly/Lifetime)
            if (protectedTempIds.includes(msg.id)) return false;

            // PROTECT: Do not delete the active Main Leaderboard (Daily) - We handle this explicitly below
            if (currentMainId && msg.id === currentMainId) return false;

            // Must have an embed with a matching title
            if (msg.embeds.length > 0 && leaderboardTitles.includes(msg.embeds[0].title)) return true;
            return false;
          });

          if (messagesToDelete.size > 0) {
            logger.info(`[${guildId}] Found ${messagesToDelete.size} old leaderboard messages. Cleaning up...`);
            await channel.bulkDelete(messagesToDelete).catch((err) => {
              // Fallback if bulk delete fails (e.g. messages older than 14 days)
              logger.warn(`[${guildId}] Bulk delete failed: ${err.message}. Trying individual delete...`);
              messagesToDelete.forEach((msg) => msg.delete().catch(() => { }));
            });
          } else {
            logger.debug(`[${guildId}] No old leaderboard messages found to clean.`);
          }
        } catch (e) {
          logger.warn(`[${guildId}] Failed to cleanup old leaderboards: ${e.message}`);
        }

        // 4. Double-Check DB ID (In case it wasn't in the last 50 messages)
        if (ids.dailyLeaderboardMessageId) {
          try {
            const oldMsg = await channel.messages.fetch(ids.dailyLeaderboardMessageId).catch(() => null);
            if (oldMsg) {
              logger.debug(`[${guildId}] Deleting tracked old message (DB ID)...`);
              await oldMsg.delete();
            }
          } catch {
            // Ignore valid errors like "Unknown Message"
          }
        }

        logger.info(`[${guildId}] Sending new leaderboard message...`);

        // Retry logic for unstable connections
        let newMessage;
        const maxRetries = 3;
        for (let i = 0; i < maxRetries; i++) {
          try {
            newMessage = await channel.send(payload);
            break; // Success!
          } catch (sendError) {
            if (i === maxRetries - 1) throw sendError; // Rethrow if last attempt
            logger.warn(
              `[${guildId}] Failed to send message (Attempt ${i + 1}/${maxRetries}): ${sendError.message}. Retrying...`
            );
            await new Promise((r) => setTimeout(r, 1000)); // Wait 1s
          }
        }

        // logger.info(`[${guildId}] Leaderboard updated. Message ID: ${newMessage.id}`);

        // Update State
        previousTopUsersJSON.set(guildId, currentJSON);
        lastUpdateTimes.set(guildId, Date.now());
        await DatabaseService.updateGuildIds(guildId, { dailyLeaderboardMessageId: newMessage.id });
        clearCache(guildId);
      } catch (e) {
        logger.error(`Failed to update leaderboard for guild ${guildId}: ${e.message}`, e);
        if (e.name === 'AbortError' || e.code === 'UND_ERR_SOCKET') {
          logger.error(`[${guildId}] Network/Socket Error detected. Request failed.`);
        }
      } finally {
        updatingGuilds.delete(guildId);
      }
    }
  }

  /**
   * Generates the embed, image, and buttons for any leaderboard page
   * @param {Guild} guild
   * @param {string} type - 'daily', 'weekly', or 'lifetime'
   * @param {number} page - Page number (1-based)
   * @param {string|null} highlightUserId - ID of user to highlight (for "Me" button)
   * @param {boolean} showSwitchers - Whether to include Weekly/All-time buttons
   */
  static async generateLeaderboardPayload(guild, type, page, highlightUserId = null, showSwitchers = false) {
    const limit = 10;
    const skip = (page - 1) * limit;

    // 1. Fetch Data
    const topUsers = await DatabaseService.fetchTopUsers(guild.id, limit, type, skip);
    const totalCount = await DatabaseService.getUserCount(guild.id, type);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    // 2. Map Data for Image
    let members = new Map();
    try {
      const userIds = topUsers.map((u) => u.userId);
      if (userIds.length > 0) {
        members = await guild.members.fetch({ user: userIds });
      }
    } catch (e) {
      logger.error(`Failed to bulk fetch members for leaderboard:`, e);
    }

    const usersForImage = topUsers.map((u, index) => {
      const member = members.get(u.userId);

      // Determine which XP value to display
      const xpVal = type === 'weekly' ? u.weeklyXp : type === 'lifetime' ? u.xp : u.dailyXp;

      return {
        rank: skip + index + 1,
        userId: u.userId,
        username: member ? member.displayName : 'Unknown',
        avatarUrl: member?.displayAvatarURL({ extension: 'png' }) || null,
        xp: xpVal,
      };
    });

    // 3. Generate Image (with highlight support)
    const imageBuffer = await ImageService.generateLeaderboard(usersForImage, highlightUserId);
    // logger.info(`[${guild.id}] Generated leaderboard image size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'leaderboard.png' });

    // 4. Build Embed
    const titles = {
      daily: 'Yappers of the day!',
      weekly: 'Yappers of the week!',
      lifetime: 'All-time Yappers!',
    };

    const embed = new EmbedBuilder()
      .setTitle(titles[type] || titles.daily)
      .setDescription(`Leaderboard • Page ${page}/${totalPages}`)
      .setColor('Gold')
      .setThumbnail('https://media.discordapp.net/attachments/1301183910838796460/1333160889419038812/tenor.gif')
      .setImage('attachment://leaderboard.png')
      .setFooter({ text: `Page ${page} of ${totalPages} • Updates Live` });

    // Show legend only if switchers are active (Main LB)
    if (showSwitchers) {
      embed.setDescription(`Leaderboard • Page ${page}/${totalPages}\n` + `📅 **Weekly** | 🌎 **All-time**`);
    }

    // 5. Build Buttons
    const row = new ActionRowBuilder();

    // PREV
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`leaderboard_page:prev:${page - 1}:${type}`)
        .setLabel('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1)
    );

    if (showSwitchers) {
      // FULL BUTTON SET (Main LB)
      row.addComponents(
        new ButtonBuilder().setCustomId('leaderboard_view:weekly').setLabel('📅').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`leaderboard_show_rank:${type}`).setLabel('Me').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('leaderboard_view:lifetime').setLabel('🌎').setStyle(ButtonStyle.Secondary)
      );
    } else {
      // COMPACT BUTTON SET (Popup LBs / Pagination)
      row.addComponents(
        new ButtonBuilder().setCustomId(`leaderboard_show_rank:${type}`).setLabel('Me').setStyle(ButtonStyle.Primary)
      );
    }

    // NEXT
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`leaderboard_page:next:${page + 1}:${type}`)
        .setLabel('▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages)
    );

    return { embeds: [embed], files: [attachment], components: [row], fetchReply: true };
  }
}

module.exports = { LeaderboardUpdateService, tempLeaderboards, saveTempLeaderboard, removeTempLeaderboard };
