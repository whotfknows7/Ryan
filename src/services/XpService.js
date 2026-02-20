// src/services/XpService.js

const { defaultRedis } = require('../config/redis');

const { DatabaseService } = require('./DatabaseService');
const { AssetService } = require('./AssetService');
const { ImageService } = require('./ImageService');
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

      const pipeline = defaultRedis.pipeline();
      const currentBatch = this.buffer;
      this.buffer = new Map(); // Clear instantly to accept new incoming XP

      const timer = MetricsService.redisPipelineLatency.startTimer();

      for (const [key, xpToAdd] of currentBatch.entries()) {
        const [guildId, userId] = key.split(':');

        // 1. Buffer for the Postgres sync
        pipeline.hincrby(`xp_buffer:${guildId}`, userId, xpToAdd);

        // 2. Instantly update the 3 Live Leaderboards
        pipeline.zincrby(`lb:${guildId}:lifetime`, xpToAdd, userId);
        pipeline.zincrby(`lb:${guildId}:daily`, xpToAdd, userId);
        pipeline.zincrby(`lb:${guildId}:weekly`, xpToAdd, userId);
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
  /**
   * Checks and grants role rewards based on XP
   * Stateless: Fetches config from DB (or simple service cache) each time
   */
  static async checkRoleRewards(guild, member, currentXp) {
    if (!member) return;

    // 1. Fetch Rewards Config directly (Stateless)
    // We expect ConfigService or DatabaseService to handle any necessary low-level caching
    // purely for performance, but logically we treat it as "fetch from source".
    const guildConfig = await getFullConfig(guild.id);
    const rewardsMap = guildConfig?.config?.announcement_roles || {};

    // Convert to array and sort by XP descending
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

    if (rewards.length === 0) return;

    // 2. Check & Grant
    // We trust message.member.roles.cache as the snapshot of user's roles
    for (const reward of rewards) {
      // If user qualifies for this role
      if (currentXp >= reward.xp) {
        // Check if they already have it
        if (!hasRole(member, reward.roleId)) {
          try {
            await member.roles.add(reward.roleId, 'XP Role Reward');
            logger.info(`Awarded Role ${reward.roleId} to ${member.user.tag} at ${currentXp} XP`);

            // Send announcement
            if (reward.message) {
              await this.sendAnnouncement(guild, member, reward, currentXp);
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
      // Fetch announcement channel
      const ids = await getIds(guild.id);
      const channelId = ids.leaderboardChannelId;
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
        .setDescription(description)
        .setColor(roleColor)
        .setThumbnail(member.user.displayAvatarURL({ extension: 'png', size: 256 }))
        .setTimestamp();

      let files = [];

      // Hybrid Image Generation: Fetch Base -> Generate Final
      if (reward.assetMessageLink) {
        try {
          const baseBuffer = await AssetService.fetchAssetFromLink(guild.client, reward.assetMessageLink);
          if (baseBuffer) {
            const finalBuffer = await ImageService.generateFinalReward(baseBuffer, member.user.username);
            files = [{ attachment: finalBuffer, name: 'reward.png' }];
            embed.setImage('attachment://reward.png');
          }
        } catch (e) {
          logger.warn(`Failed to attach reward image for role ${reward.roleId}:`, e);
        }
      }

      await guild.client.rest.post(Routes.channelMessages(channelId), {
        body: { embeds: [embed.toJSON()] },
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

      // 1. O(N) Phantom Calculation
      const xpToAdd = XpCalculator.calculateMessageXp(message.content);
      if (xpToAdd <= 0) return;

      // 2. Push to Micro-Batch (Zero Network Latency)
      XpPipeline.push(message.guild.id, message.author.id, xpToAdd);

      // 3. Check for role rewards using Live XP
      const liveStats = await DatabaseService.getLiveUserStats(message.guild.id, message.author.id);

      // Because we just added the XP to the local buffer, not Redis directly,
      // we must ensure the role checker knows about the un-flushed XP.
      const trueLiveXp = liveStats.xp + (XpPipeline.buffer.get(`${message.guild.id}:${message.author.id}`) || 0);

      await RoleRewardHandler.checkRoleRewards(message.guild, message.member, trueLiveXp);
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
