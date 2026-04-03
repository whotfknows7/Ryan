// src/services/XpService.js

const { defaultRedis } = require('../config/redis');

const { DatabaseService } = require('./DatabaseService');
const { AssetService } = require('./AssetService');
const { ConfigService } = require('./ConfigService');
const { getIds, getFullConfig, hasRole, hasPermission } = require('../utils/GuildIdsHelper');
const MetricsService = require('./MetricsService');
const logger = require('../lib/logger');
const { EmbedBuilder, Routes } = require('discord.js');

const EMOJI_REACTION_DELAY = 500;

// ============================================================================
// XP Calculation Utilities
// ============================================================================

class XpCalculator {
  static calculateMessageXp(content) {
    let alphaChars = 0;
    let emojiXp = 0;
    let i = 0;
    const len = content.length;

    while (i < len) {
      const charCode = content.charCodeAt(i);

      // Skip URLs (http:// or https://) instantly
      if (charCode === 104 && content.startsWith('http', i)) {
        // 'h'
        const spaceIdx = content.indexOf(' ', i);
        i = spaceIdx === -1 ? len : spaceIdx + 1;
        continue;
      }

      // Check for Custom Discord Emojis <:name:id> or <a:name:id>
      if (charCode === 60) {
        // '<'
        const nextChar = content.charCodeAt(i + 1);
        if (nextChar === 58 || (nextChar === 97 && content.charCodeAt(i + 2) === 58)) {
          const closeIdx = content.indexOf('>', i);
          if (closeIdx !== -1) {
            emojiXp += 2;
            i = closeIdx + 1;
            continue;
          }
        }
      }

      // Count Alphabetic Characters (A-Z, a-z)
      if ((charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122)) {
        alphaChars += 1;
        i++;
        continue;
      }

      // Unicode Emoji Detection (Surrogate Pairs & BMP Symbols)
      // Detects ranges like ⚡, ⚽, or complex surrogate pair emojis
      if ((charCode >= 0x2600 && charCode <= 0x27bf) || (charCode >= 0xd800 && charCode <= 0xdbff)) {
        emojiXp += 2;
        i += charCode >= 0xd800 ? 2 : 1; // Skip low surrogate if it's a pair
        continue;
      }

      i++;
    }

    return alphaChars + emojiXp;
  }
}

// ============================================================================
// #6: MICRO-BATCHING THE EVENT LOOP
// ============================================================================
class XpPipeline {
  static buffer = new Map();

  static init() {
    // Flush the pipeline every 1,000 milliseconds (1 second)
    setInterval(async () => {
      if (this.buffer.size === 0) return;

      const batchSize = this.buffer.size;
      MetricsService.redisPipelineSize.observe(batchSize);

      const currentBatch = this.buffer;
      this.buffer = new Map(); // Clear instantly to accept new incoming XP

      const timer = MetricsService.redisPipelineLatency.startTimer();
      const pipeline = defaultRedis.pipeline();

      for (const [key, xpToAdd] of currentBatch.entries()) {
        const [guildId, userId] = key.split(':');

        // 1. Buffer for the Postgres sync (Hot Buffer)
        pipeline.hincrby(`xp_buffer:${guildId}`, userId, xpToAdd);

        // 2. Mark guild as dirty for leaderboard update
        pipeline.sadd('lb_dirty_guilds', guildId);
      }

      await pipeline.exec().catch((err) => logger.error('Redis Pipeline Error:', err));
      timer();
    }, 1000);
  }

  static push(guildId, userId, xp) {
    const key = `${guildId}:${userId}`;
    const currentXp = this.buffer.get(key) || 0;
    this.buffer.set(key, currentXp + xp);
  }
}
// Initialize the 1-second batch loop
XpPipeline.init();

// ============================================================================
// Keyword Reaction Handler
// ============================================================================

class KeywordReactionHandler {
  /**
   * Handles automatic emoji reactions based on keyword matching
   * Checks guild-specific keyword configuration and reacts accordingly
   */
  static async handle(message) {
    if (message.author.bot || !message.guild) return;

    try {
      const keywords = await ConfigService.getKeywords(message.guild.id);
      if (!keywords || Object.keys(keywords).length === 0) return;

      const content = message.content;

      for (const [keyword, emojis] of Object.entries(keywords)) {
        if (this.shouldReact(content, keyword)) {
          await this.reactWithEmojis(message, emojis);
        }
      }
    } catch (error) {
      logger.error('Error in KeywordReactionHandler:', error);
    }
  }

  /**
   * Checks if content matches keyword (case-insensitive, word boundary aware)
   * Supports possessive forms (e.g., "bot's" matches "bot")
   */
  static shouldReact(content, keyword) {
    const regex = new RegExp(`\\b${this.escapeRegex(keyword)}(?:'s)?\\b`, 'i');
    return regex.test(content);
  }

  /**
   * Reacts to message with multiple emojis, with delay between each
   */
  static async reactWithEmojis(message, emojis) {
    for (const emoji of emojis) {
      try {
        await message.react(emoji);
        await new Promise((resolve) => setTimeout(resolve, EMOJI_REACTION_DELAY));
      } catch (error) {
        logger.error(`Failed to react with ${emoji}:`, error);
      }
    }
  }

  /**
   * Escapes special regex characters in keyword string
   */
  static escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ============================================================================
// Role Reward Handler (Stateless)
// ============================================================================

class RoleRewardHandler {
  static recentAwards = new Set();

  /**
   * Checks and grants role rewards based on XP
   * Stateless: Fetches config from DB (or simple service cache) each time
   */
  static async checkRoleRewards(guild, member, currentXp, previousXp = 0) {
    if (!member) {
      return;
    }

    const guildConfig = await getFullConfig(guild.id);
    const rewardsMap = guildConfig?.config?.announcement_roles || {};

    const rewards = Object.values(rewardsMap)
      .map((r) => ({
        roleId: r.roleId || r.id,
        xp: parseInt(r.xp || 0),
        message: r.message,
        assetMessageLink: r.assetMessageLink,
        roleName: r.roleName,
        roleColor: r.roleColor,
      }))
      .filter((r) => r.xp > 0)
      .sort((a, b) => b.xp - a.xp);

    if (rewards.length === 0) {
      return;
    }

    let highestMissingRoleAnnounced = false;
    // foundHighestOwnedRole removed (obsolete with milestone gating)

    for (const reward of rewards) {
      if (currentXp >= reward.xp) {
        // [GOLDEN FIX] Milestone Boundary Gate
        // If the user was already at or above this threshold BEFORE this message,
        // we skip checking their roles entirely for this reward.
        // This makes the system immune to "Flat Payload" cache misses for veterans.
        if (previousXp >= reward.xp) continue;

        const userHasRole = hasRole(member, reward.roleId);

        if (!userHasRole) {
          const cacheKey = `${guild.id}:${member.id}:${reward.roleId}`;
          if (RoleRewardHandler.recentAwards.has(cacheKey)) continue;

          RoleRewardHandler.recentAwards.add(cacheKey);
          // Cooldown of 60 seconds to prevent race condition duplicates
          setTimeout(() => RoleRewardHandler.recentAwards.delete(cacheKey), 60000);

          try {
            await member.roles.add(reward.roleId, 'XP Role Reward');
            logger.info(`Awarded Role ${reward.roleId} to ${member.user.tag} at ${currentXp} XP`);

            // Announcement is now safe inside this boundary check
            if (reward.message && !highestMissingRoleAnnounced) {
              await this.sendAnnouncement(guild, member, reward, currentXp);
              highestMissingRoleAnnounced = true;
            }
          } catch (err) {
            logger.error(`Failed to grant reward ${reward.roleId} to ${member.user.tag}:`, err);
          }
        }
      }
    }
  }

  /**
   * Sends role reward announcement with optional image attachment
   * Uses hybrid approach: fetches base image from message link, generates final with username
   */
  static async sendAnnouncement(guild, member, reward, currentXp) {
    try {
      // Fetch announcement channel (prioritize role rewards channel, fallback to leaderboard)
      const ids = await getIds(guild.id);
      const channelId = ids.roleRewardsChannelId || ids.leaderboardChannelId;
      if (!channelId) return;

      // Stateless Fetch: Use cached data or fallback to API for older configs
      let roleName = reward.roleName;
      let roleColor = reward.roleColor;

      if (!roleName || roleColor == null) {
        const role = await guild.roles.fetch(reward.roleId).catch(() => null);
        roleName = role ? role.name : 'Level Up';
        roleColor = role ? role.color : 0xffffff;
      }

      // Parse message template
      const description = reward.message
        .replace(/{user}/g, member.toString())
        .replace(/{role}/g, roleName)
        .replace(/{xp}/g, currentXp.toLocaleString());

      // Build embed
      const embed = new EmbedBuilder()
        .setDescription(`## ${description}`)
        .setColor(roleColor)
        .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .setTimestamp();

      let files = [];

      // Direct Image Fetch: Fetch pre-rendered Base Image and send it directly
      if (reward.assetMessageLink) {
        try {
          const baseBuffer = await AssetService.fetchAssetFromLink(guild.client, reward.assetMessageLink);
          if (baseBuffer) {
            files = [{ data: baseBuffer, name: 'reward.png' }];
            embed.setImage('attachment://reward.png');
          }
        } catch (e) {
          logger.warn(`Failed to attach reward image for role ${reward.roleId}:`, e);
        }
      }

      await guild.client.rest.post(Routes.channelMessages(channelId), {
        body: {
          content: `# ${member} You have achieved a New Milestone`,
          embeds: [embed.toJSON()],
        },
        files,
      });
      logger.info(`Sent reward announcement for ${member.user.tag} - ${roleName}`);
    } catch (error) {
      logger.error('Error sending role announcement:', error);
    }
  }
}

// ============================================================================
// Permission Checker
// ============================================================================

class PermissionChecker {
  /**
   * Checks if a member can use admin commands
   * Uses GuildHelper or falls back to Discord permissions
   */
  static async canUseAdminCommand(member) {
    try {
      if (!member || !member.guild) return false;

      const ids = await getIds(member.guild.id);
      const adminRoleId = ids.adminRoleId;

      const hasAdminRole = adminRoleId && hasRole(member, adminRoleId);

      return hasAdminRole || hasPermission(member, 'Administrator');
    } catch (error) {
      logger.error('Error checking admin permission:', error);
      return false;
    }
  }
}

// ============================================================================
// Main XP Service (Public API)
// ============================================================================

class XpService {
  // --- Keyword Reactions ---

  /**
   * Handles automatic keyword-based emoji reactions
   */
  static async handleKeywords(message) {
    await KeywordReactionHandler.handle(message);
  }

  // --- XP Processing ---

  /**
   * Handles XP gain from messages
   * OPTIMIZED: Returns updated user record to avoid extra DB fetch
   */
  static async handleMessageXp(message) {
    if (message.author.bot || !message.guild) return;

    try {
      const jailLog = await ConfigService.getJailLog(message.guild.id, message.author.id);
      if (jailLog && jailLog.status === 'jailed') return;

      // 1. Calculate XP to add
      let xpToAdd = 0;
      if (message.content) {
        xpToAdd += XpCalculator.calculateMessageXp(message.content);
      }

      const hasStickers =
        message.stickers?.size > 0 || message.stickers?.length > 0 || message.sticker_items?.length > 0;
      if (hasStickers) {
        xpToAdd += 2;
      }

      if (xpToAdd <= 0) return;

      // 2. Fetch ground-truth stats
      const key = `${message.guild.id}:${message.author.id}`;
      const pendingXp = XpPipeline.buffer.get(key) || 0;
      const liveStats = await DatabaseService.getLiveUserStats(message.guild.id, message.author.id);

      // 3. Boundary Math
      const trueLiveXp = liveStats.xp + pendingXp + xpToAdd;
      const previousXp = liveStats.xp + pendingXp;

      // 4. Role check (Stateless Bridge)
      await RoleRewardHandler.checkRoleRewards(message.guild, message.member, trueLiveXp, previousXp);

      // 5. Submit to Pipeline
      XpPipeline.push(message.guild.id, message.author.id, xpToAdd);
    } catch (error) {
      logger.error('Error in handleMessageXp:', error);
    }
  }

  // --- Permissions & Utilities ---

  /**
   * Checks if member has admin command permissions
   */
  static async canUseAdminCommand(member) {
    return PermissionChecker.canUseAdminCommand(member);
  }

  /**
   * Gets the announcement channel ID for a guild
   */
  static async getAnnouncementChannel(guildId) {
    try {
      const ids = await getIds(guildId);
      return ids.leaderboardChannelId;
    } catch (error) {
      logger.error('Error getting announcement channel:', error);
      return undefined;
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = { XpService };
