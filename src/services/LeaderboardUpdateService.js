// src/services/LeaderboardUpdateService.js

const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes } = require('discord.js');
const { getIds, invalidate } = require('../utils/GuildIdsHelper');
const { DatabaseService } = require('./DatabaseService');
const ImageService = require('./ImageService');
const logger = require('../lib/logger');
const { defaultRedis } = require('../config/redis');

// =================================================================
// CRITICAL: This variable must be defined HERE (Top Level Scope)
// =================================================================
const previousTopUsersJSON = new Map();
const updatingGuilds = new Set();
const lastUpdateTimes = new Map();
const tempLeaderboards = new Map(); // guildId -> { weekly: msgId, lifetime: msgId }

// =================================================================
// TEMP LEADERBOARD PERSISTENCE — Synced to Postgres Database
// =================================================================

/**
 * Save a temp leaderboard entry (updates map + DB).
 */
function saveTempLeaderboard(guildId, type, messageId, channelId) {
  const existing = tempLeaderboards.get(guildId) || {};
  existing[messageId] = {
    type,
    channelId,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes expiry
  };
  tempLeaderboards.set(guildId, existing);
  DatabaseService.updateTempLeaderboards(guildId, existing).catch((e) => {
    logger.warn(`[TempLB] Failed to persist to DB: ${e.message}`);
  });
  logger.info(`[TempLB] Saved ${type} LB for ${guildId} (msg: ${messageId}, expires in 5m)`);
}

/**
 * Remove a temp leaderboard entry (updates map + DB).
 */
function removeTempLeaderboard(guildId, messageId) {
  const existing = tempLeaderboards.get(guildId);
  if (!existing) return;
  delete existing[messageId];
  if (Object.keys(existing).length === 0) {
    tempLeaderboards.delete(guildId);
    DatabaseService.updateTempLeaderboards(guildId, {}).catch((e) => {
      logger.warn(`[TempLB] Failed to delete from DB: ${e.message}`);
    });
  } else {
    tempLeaderboards.set(guildId, existing);
    DatabaseService.updateTempLeaderboards(guildId, existing).catch((e) => {
      logger.warn(`[TempLB] Failed to persist to DB: ${e.message}`);
    });
  }
}

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
      if (Date.now() - lastUpdate < 20000) {
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

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) {
          logger.debug(`[${guildId}] Leaderboard channel not found or not text-based.`);
          continue;
        }

        // 1. Fetch Top 10 for display (Fast - uses Redis ZSETs)
        const topUsers = await DatabaseService.getLiveTopUsers(guildId, 10, 'daily');

        // Optimization: Skip if the data hasn't changed
        const currentJSON = JSON.stringify(topUsers);

        // Check map existence safely
        if (previousTopUsersJSON.has(guildId) && currentJSON === previousTopUsersJSON.get(guildId)) {
          // Even if content didn't change, we might want to ensure the message exists?
          // But strict optimization says skip.
          logger.debug(`[${guildId}] Leaderboard data unchanged. Skipping.`);
          continue;
        }

        // logger.info(`Updating leaderboard for guild ${guildId}... (Data changed)`);

        // 2. Generate Payload
        // logger.info(`[${guildId}] Generating payload...`);
        // Pass topUsers as prefetchedData
        const payload = await this.generateLeaderboardPayload(guild, 'daily', 1, null, true, topUsers);
        // logger.info(`[${guildId}] Payload generated.`);

        // 3. Double-Check DB ID (In case it wasn't in the last 50 messages)
        if (ids.dailyLeaderboardMessageId) {
          try {
            logger.debug(`[${guildId}] Deleting tracked old message (DB ID)...`);
            await channel.messages.delete(ids.dailyLeaderboardMessageId);
          } catch {
            // Ignore valid errors like "Unknown Message"
          }
        }

        // logger.info(`[${guildId}] Sending new leaderboard message...`);

        // Retry logic for unstable connections
        let newMessage;
        const maxRetries = 3;
        for (let i = 0; i < maxRetries; i++) {
          try {
            newMessage = await guild.client.rest.post(Routes.channelMessages(channelId), {
              body: {
                embeds: payload.embeds?.map((e) => e.toJSON()),
                components: payload.components?.map((c) => c.toJSON()),
              },
              files: payload.files?.map((f) => ({
                name: f.name,
                data: f.attachment,
                description: f.description,
              })),
            });
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
        invalidate(guildId);
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
   * @param {Array|null} prefetchedData - Optional: Array of user objects to avoid re-fetching
   */
  static async generateLeaderboardPayload(
    guild,
    type,
    page,
    highlightUserId = null,
    showSwitchers = false,
    prefetchedData = null
  ) {
    const limit = 10;
    const skip = (page - 1) * limit;

    // 1. Fetch Data (or use prefetched)
    let topUsers;
    if (prefetchedData && page === 1 && type === 'daily') {
      // Only use prefetched data if it matches the current request context (page 1, daily)
      // The caller (updateLiveLeaderboard) provides 'daily' top 10.
      topUsers = prefetchedData;
    } else {
      topUsers = await DatabaseService.getLiveTopUsers(guild.id, limit, type, skip);
    }
    const totalCount = await DatabaseService.getUserCount(guild.id, type);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    // 2. Fetch Members (Using Redis JSON Cache for Top 10)
    let usersForImage = [];
    try {
      if (page === 1) {
        // --- TOP 10 CACHE LOGIC (REDIS HASH) ---
        const cacheKey = `member_cache:${guild.id}`;
        const dbUserIds = topUsers.map((u) => u.userId);

        let profiles = [];
        let missingUserIds = [];
        let missingIndices = [];

        if (dbUserIds.length > 0) {
          try {
            // Fetch multiple users from the Redis hash
            const cachedData = await defaultRedis.hmget(cacheKey, ...dbUserIds);

            for (let i = 0; i < dbUserIds.length; i++) {
              if (cachedData[i]) {
                const parsed = JSON.parse(cachedData[i]);
                profiles.push({
                  userId: dbUserIds[i],
                  displayName: parsed.displayName,
                  avatarUrl: parsed.avatarUrl,
                });
              } else {
                // Cache miss
                profiles.push(null); // Placeholder
                missingUserIds.push(dbUserIds[i]);
                missingIndices.push(i);
              }
            }
          } catch (err) {
            logger.warn(`[LeaderboardCache] Failed to fetch hash cache for ${guild.id}: ${err.message}`);
            // Fallback: treat all as missing
            missingUserIds = dbUserIds;
            missingIndices = dbUserIds.map((_, i) => i);
          }

          if (missingUserIds.length > 0) {
            // Fetch ONLY the missing members from Discord
            let fetchedMembers = new Map();
            try {
              fetchedMembers = await guild.members.fetch({ user: missingUserIds }).catch(() => new Map());
            } catch (err) {
              logger.warn(`[LeaderboardCache] Failed to fetch missing members for ${guild.id}: ${err.message}`);
            }

            const pipeline = defaultRedis.pipeline();
            let updates = 0;

            for (let j = 0; j < missingUserIds.length; j++) {
              const uId = missingUserIds[j];
              const pIndex = missingIndices[j];
              const member = fetchedMembers.get(uId);

              const profileBase = {
                displayName: member ? member.displayName : ' (Left)Unknown',
                avatarUrl: member?.displayAvatarURL({ extension: 'png', size: 128 }) || null,
              };

              profiles[pIndex] = {
                userId: uId,
                ...profileBase,
              };

              // Pipeline HSET
              pipeline.hset(cacheKey, uId, JSON.stringify(profileBase));
              updates++;
            }

            if (updates > 0) {
              pipeline
                .exec()
                .catch((e) =>
                  logger.error(`[LeaderboardCache] Failed to save hash pipeline for ${guild.id}: ${e.message}`)
                );
            }
          }
        }

        // Map the profiles to the final image format
        usersForImage = topUsers.map((u, index) => {
          const profile = profiles[index];
          const xpVal = type === 'weekly' ? u.weeklyXp : type === 'lifetime' ? u.xp : u.dailyXp;
          return {
            rank: skip + index + 1,
            userId: profile.userId,
            username: profile.displayName,
            avatarUrl: profile.avatarUrl,
            xp: xpVal,
          };
        });
      } else {
        // --- PAGE 2+ LOGIC (No Cache) ---
        let members = new Map();
        const userIds = topUsers.map((u) => u.userId);
        if (userIds.length > 0) {
          members = await guild.members.fetch({ user: userIds }).catch(() => new Map());
        }

        usersForImage = topUsers.map((u, index) => {
          const member = members.get(u.userId);
          const xpVal = type === 'weekly' ? u.weeklyXp : type === 'lifetime' ? u.xp : u.dailyXp;
          return {
            rank: skip + index + 1,
            userId: u.userId,
            username: member ? member.displayName : 'Unknown (Left)',
            avatarUrl: member?.displayAvatarURL({ extension: 'png', size: 128 }) || null,
            xp: xpVal,
          };
        });
      }
    } catch (e) {
      logger.error(`Failed to generate member data for leaderboard:`, e);
      // Fallback empty array to prevent complete failure
      if (usersForImage.length === 0)
        usersForImage = topUsers.map((u, index) => ({
          rank: skip + index + 1,
          userId: u.userId,
          username: 'Unknown (Left)',
          avatarUrl: null,
          xp: type === 'weekly' ? u.weeklyXp : type === 'lifetime' ? u.xp : u.dailyXp,
        }));
    }

    // 3. Generate Image (with highlight support)
    const imageBuffer = await ImageService.generateLeaderboard(usersForImage, highlightUserId);
    // logger.info(`[${guild.id}] Generated leaderboard image size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
    const filename = `leaderboard_${type}_${page}_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(imageBuffer, { name: filename });

    // 4. Build Embed
    const titles = {
      daily: 'Yappers of the day!',
      weekly: 'Yappers of the week!',
      lifetime: 'Yappers of All-time',
    };

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(titles[type] || 'Leaderboard')
      .setDescription(`${titles[type] || 'Leaderboard'} • Page ${page}/${totalPages}`)
      .setImage(`attachment://${filename}`)
      .setTimestamp();

    // Add Legend to Footer (Only for Daily View where switchers are present)
    if (showSwitchers) {
      embed.setFooter({ text: `Page ${page} of ${totalPages} • 📅 Weekly • 📈 All-time` });
    } else {
      embed.setFooter({ text: `Page ${page} of ${totalPages}` });
    }

    // 5. Build Buttons
    const row = new ActionRowBuilder();

    // PREV
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`leaderboard_page:prev:${page - 1}:${type}`)
        .setLabel('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 1)
    );

    // VIEW SWITCHER (Context-aware)
    if (showSwitchers) {
      row.addComponents(
        new ButtonBuilder().setCustomId('leaderboard_view:weekly').setLabel('📅').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`leaderboard_show_rank:${type}`).setLabel('Me').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('leaderboard_view:lifetime').setLabel('📈').setStyle(ButtonStyle.Primary)
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

  static async loadTempLeaderboards() {
    try {
      const records = await DatabaseService.getAllTempLeaderboards();
      let count = 0;
      for (const row of records) {
        if (!row.lastRanks || typeof row.lastRanks !== 'object' || Object.keys(row.lastRanks).length === 0) continue;

        // Handle migration from legacy format if necessary
        // previous CurrentLbs.json might have been Array format if pushed differently
        // But our getAllTempLeaderboards returns directly what we saved.
        tempLeaderboards.set(row.guildId, row.lastRanks);
        count += Object.keys(row.lastRanks).length;
      }
      logger.info(`[TempLB] Loaded ${count} temp leaderboard(s) from Postgres.`);
    } catch (e) {
      logger.warn(`[TempLB] Failed to load from DB: ${e.message}`);
    }
  }

  static async cleanupExpiredTempLeaderboards(client) {
    logger.debug('[TempLB] Checking for expired leaderboards...');
    const now = Date.now();
    let changed = false;

    const toDelete = [];

    for (const [guildId, msgs] of tempLeaderboards) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;

      for (const [messageId, data] of Object.entries(msgs)) {
        // data = { type, channelId, expiresAt }
        if (!data.expiresAt || now >= data.expiresAt) {
          logger.info(`[TempLB] Expired: ${data.type} LB in ${guildId}. Deleting...`);

          // Delete from Discord
          if (data.channelId) {
            const channel = await guild.channels.fetch(data.channelId).catch(() => null);
            if (channel) {
              try {
                await channel.messages.delete(messageId);
              } catch (e) {
                logger.warn(`[TempLB] Failed to delete message: ${e.message}`);
              }
            }
          }

          // Delete from Memory
          delete msgs[messageId];
          changed = true;
        }
      }

      // If guild has no more temp LBs, mark for removal
      if (Object.keys(msgs).length === 0) {
        toDelete.push(guildId);
      }
    }

    // Safely remove empty guilds after iteration
    for (const guildId of toDelete) {
      tempLeaderboards.delete(guildId);
    }

    if (changed) {
      // Fire and forget db updates for the changed guilds
      for (const guildId of toDelete) {
        DatabaseService.updateTempLeaderboards(guildId, {}).catch((e) => {
          logger.warn(`[TempLB] Failed to update DB on cleanup: ${e.message}`);
        });
      }

      // Also update any guilds that still have temp LBs
      for (const [guildId, msgs] of tempLeaderboards) {
        DatabaseService.updateTempLeaderboards(guildId, msgs).catch((e) => {
          logger.warn(`[TempLB] Failed to update DB on cleanup: ${e.message}`);
        });
      }
    }
  }
}

function invalidateGuildLeaderboardCache(guildId) {
  previousTopUsersJSON.delete(guildId);
}

module.exports = {
  LeaderboardUpdateService,
  tempLeaderboards,
  saveTempLeaderboard,
  removeTempLeaderboard,
  invalidateGuildLeaderboardCache,
};
