// src/services/XpService.js

const { defaultRedis } = require('../config/redis');

const { DatabaseService } = require('./DatabaseService');
const { AssetService } = require('./AssetService');
const { ImageService } = require('./ImageService');
const { ConfigService } = require('./ConfigService');
const { ConfigService } = require('./ConfigService');
const { getIds, getFullConfig } = require('../utils/GuildIdsHelper');
const logger = require('../lib/logger');
const emojiRegex = require('emoji-regex');
const { EmbedBuilder } = require('discord.js');

// ============================================================================
// Constants
// ============================================================================

const URL_REGEX = /http[s]?:\/\/(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+/g;
const EMOJI_REACTION_DELAY = 500;

// ============================================================================
// XP Calculation Utilities
// ============================================================================

class XpCalculator {
  /**
   * Calculates XP from message content
   * - 1 XP per alphabetic character
   * - 2 XP per emoji (custom or unicode)
   * - URLs are excluded from calculation
   */
  static calculateMessageXp(content) {
    const cleanContent = content.replace(URL_REGEX, '');
    const alphaChars = cleanContent.replace(/[^a-zA-Z]/g, '').length;

    const customEmojiCount = (cleanContent.match(/<a?:\w+:\d+>/g) || []).length;
    const unicodeEmojiCount = (cleanContent.match(emojiRegex()) || []).length;
    const emojiXp = (customEmojiCount + unicodeEmojiCount) * 2;

    return alphaChars + emojiXp;
  }
}

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
        if (!member.roles.cache.has(reward.roleId)) {
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

      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel) return;

      // Get role information (Use Cache - Roles are always in RAM)
      const role = guild.roles.cache.get(reward.roleId);
      const roleName = role ? role.name : 'Level Up';
      const roleColor = role ? role.color : 0xffffff;

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

      await channel.send({ embeds: [embed], files });
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

      // Check roles from the member object (passed from message event)
      const hasAdminRole = adminRoleId && member.roles.cache.has(adminRoleId);

      return hasAdminRole || member.permissions.has('Administrator');
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
      // Don't award XP to jailed users
      const jailLog = await ConfigService.getJailLog(message.guild.id, message.author.id);
      if (jailLog && jailLog.status === 'jailed') return;

      // Calculate XP
      const xpToAdd = XpCalculator.calculateMessageXp(message.content);
      if (xpToAdd <= 0) return;

      // 1. Write to Redis (Write-Behind)
      await defaultRedis.hincrby(`xp_buffer:${message.guild.id}`, message.author.id, xpToAdd);

      // 2. Fetch Live Stats for Role Rewards
      // We need the *new* total to check if they leveled up.
      // Optimally, we could just get `db + old_delta + xpToAdd`, but `getLiveUserStats` does `db + curr_delta`
      // Since we just incremented, `curr_delta` includes `xpToAdd`.
      const liveStats = await DatabaseService.getLiveUserStats(message.guild.id, message.author.id);

      // 3. Check for role rewards using Live XP
      await RoleRewardHandler.checkRoleRewards(message.guild, message.member, liveStats.xp);
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
