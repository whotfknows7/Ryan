// src/services/XpService.js

const { DatabaseService } = require('./DatabaseService');
const { AssetService } = require('./AssetService');
const { ImageService } = require('./ImageService');
const { ConfigService } = require('./ConfigService');
const { createGuildHelper, getIds } = require('../utils/GuildIdsHelper');
const { checkRoleSkip } = require('../lib/cooldowns');
const logger = require('../lib/logger');
const emojiRegex = require('emoji-regex');
const { EmbedBuilder } = require('discord.js');

// ============================================================================
// Constants
// ============================================================================

const URL_REGEX = /http[s]?:\/\/(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+/g;
const EMOJI_REACTION_DELAY = 500;
const ROLE_SKIP_CHECK_LOG_LEVEL = 'debug';

// CACHE: Map<GuildId, SortedArray<Rewards>>
const RoleRewardCache = new Map();

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
// Role Reward Cache Management
// ============================================================================

class RoleRewardCacheManager {
  /**
   * Loads role rewards from database and caches them sorted by XP (descending)
   * This allows for O(n) reward checking instead of database queries
   */
  static async loadRoleRewards(guildId) {
    const config = await DatabaseService.getFullGuildConfig(guildId);
    const rewardsMap = config?.config?.announcement_roles || {};

    // Sort Descending by XP for efficient checking
    const rewards = Object.values(rewardsMap)
      .map((r) => ({
        roleId: r.roleId || r.id,
        xp: parseInt(r.xp || 0),
        message: r.message,
        assetMessageLink: r.assetMessageLink,
      }))
      .filter((r) => r.xp > 0)
      .sort((a, b) => b.xp - a.xp);

    RoleRewardCache.set(guildId, rewards);
    logger.debug(`Loaded ${rewards.length} role rewards for guild ${guildId}`);
    return rewards;
  }

  /**
   * Manually refreshes the cache for a specific guild
   */
  static async refreshRoleRewardCache(guildId) {
    await this.loadRoleRewards(guildId);
  }

  /**
   * Gets cached rewards or loads them if not cached
   */
  static async getCachedRewards(guildId) {
    if (!RoleRewardCache.has(guildId)) {
      await this.loadRoleRewards(guildId);
    }
    return RoleRewardCache.get(guildId) || [];
  }

  /**
   * Clears cache for a specific guild or all guilds
   */
  static clearCache(guildId = null) {
    if (guildId) {
      RoleRewardCache.delete(guildId);
      logger.debug(`Cleared role reward cache for guild ${guildId}`);
    } else {
      RoleRewardCache.clear();
      logger.debug('Cleared all role reward caches');
    }
  }
}

// ============================================================================
// Role Reward Handler (3-Phase System)
// ============================================================================

class RoleRewardHandler {
  /**
   * 3-PHASE REWARD CHECK SYSTEM
   * Phase 1: RAM Check (nanoseconds) - Check cache against member's roles
   * Phase 2: Verification (milliseconds) - Fetch fresh member data from API
   * Phase 3: Execution (seconds) - Grant roles and send announcements
   *
   * @param {Guild} guild - Discord guild object
   * @param {GuildMember} member - Guild member (may be stale)
   * @param {number} currentXp - Current total XP of user
   */
  static async checkRoleRewards(guild, member, currentXp) {
    if (!member) return;

    // Phase 0: Ensure Cache exists
    const rewards = await RoleRewardCacheManager.getCachedRewards(guild.id);
    if (rewards.length === 0) return;

    // Phase 1: The RAM Check (Nanoseconds)
    // Filter for rewards they qualify for BUT don't have in cache
    const potentialRewards = rewards.filter(
      (reward) => currentXp >= reward.xp && !member.roles.cache.has(reward.roleId)
    );

    if (potentialRewards.length === 0) return;

    // Phase 2: The Double-Check (Verification)
    // We only fetch the API if we strongly suspect a reward is needed
    let freshMember;
    try {
      freshMember = await guild.members.fetch(member.id);
    } catch (e) {
      logger.warn(`Failed to fetch member ${member.id} for reward check:`, e);
      return; // User left server
    }

    // Phase 3: Execution
    for (const reward of potentialRewards) {
      // Verify against fresh API data
      if (freshMember.roles.cache.has(reward.roleId)) {
        logger.debug(`User ${freshMember.user.tag} already has role ${reward.roleId}`);
        continue;
      }

      try {
        await freshMember.roles.add(reward.roleId);
        logger.info(`Awarded Role ${reward.roleId} to ${freshMember.user.tag} at ${currentXp} XP`);

        // Send announcement if configured
        if (reward.message) {
          await this.sendAnnouncement(guild, freshMember, reward, currentXp);
        }
      } catch (err) {
        logger.error(`Failed to grant reward ${reward.roleId} to ${freshMember.user.tag}:`, err);
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
      if (!channelId) {
        logger.debug(`No announcement channel configured for guild ${guild.id}`);
        return;
      }

      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        logger.warn(`Could not fetch announcement channel ${channelId}`);
        return;
      }

      // Get role information
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
// Manual Role Announcement Handler
// ============================================================================

class ManualRoleAnnouncementHandler {
  /**
   * Handles announcements for roles manually added by admins
   * Triggered by guildMemberUpdate event
   */
  static async handle(oldMember, newMember) {
    try {
      if (this.shouldSkipAnnouncement(newMember)) return;

      // Don't announce for jailed users
      const jailLog = await ConfigService.getJailLog(newMember.guild.id, newMember.id);
      if (jailLog && jailLog.status === 'jailed') return;

      const channel = await this.getAnnouncementChannel(newMember.guild);
      if (!channel) return;

      const addedRoles = this.getAddedRoles(oldMember, newMember);
      if (addedRoles.size === 0) return;

      // Fetch announcement config
      const guildConfig = await DatabaseService.getFullGuildConfig(newMember.guild.id);
      const announcementRoles = guildConfig?.config?.announcement_roles || {};

      await this.announceRoles(newMember, addedRoles, channel, announcementRoles);
    } catch (error) {
      logger.error('Error in ManualRoleAnnouncementHandler:', error);
    }
  }

  /**
   * Checks if announcement should be skipped due to cooldown
   */
  static shouldSkipAnnouncement(member) {
    const remainingSkipTime = checkRoleSkip(member.id);
    if (remainingSkipTime !== null) {
      logger[ROLE_SKIP_CHECK_LOG_LEVEL](`Skipping role announcement for ${member.user.tag} (cooldown active)`);
      return true;
    }
    return false;
  }

  /**
   * Gets the configured announcement channel
   */
  static async getAnnouncementChannel(guild) {
    const ids = await getIds(guild.id);
    const channelId = ids.leaderboardChannelId;
    if (!channelId) return null;
    return guild.channels.cache.get(channelId);
  }

  /**
   * Determines which roles were added (difference between old and new)
   */
  static getAddedRoles(oldMember, newMember) {
    const newRoles = newMember.roles.cache;
    const oldRoles = oldMember.roles.cache;
    return newRoles.filter((role) => !oldRoles.has(role.id));
  }

  /**
   * Announces each added role that has a configured announcement
   */
  static async announceRoles(member, roles, channel, announcementConfig) {
    for (const role of roles.values()) {
      const reward = announcementConfig[role.id];

      if (reward && reward.message) {
        try {
          const msgContent = reward.message.replace(/{user}/g, member.toString()).replace(/{role}/g, role.name);

          const payload = { content: msgContent };

          // Attach image if configured
          if (reward.image) {
            payload.files = [reward.image];
          }

          await channel.send(payload);
          logger.info(`Manual role announcement sent for ${member.user.tag} - ${role.name}`);
        } catch (error) {
          logger.error(`Failed to announce role ${role.name}:`, error);
        }
      }
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
      const helper = await createGuildHelper(member.guild);
      return helper.isAdmin(member.id) || member.permissions.has('Administrator');
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

      // Database Update - returns updated user record
      const updatedUser = await DatabaseService.updateUserXp(message.guild.id, message.author.id, xpToAdd);

      if (!updatedUser) return;

      // Check for role rewards using the new total XP
      await RoleRewardHandler.checkRoleRewards(message.guild, message.member, updatedUser.xp);
    } catch (error) {
      logger.error('Error in handleMessageXp:', error);
    }
  }

  // --- Manual Role Announcements ---

  /**
   * Handles announcements when roles are manually added by admins
   */
  static async checkRoleAnnouncements(oldMember, newMember) {
    await ManualRoleAnnouncementHandler.handle(oldMember, newMember);
  }

  // --- Cache Management (Admin/Utility) ---

  /**
   * Loads role rewards into cache for a guild
   */
  static async loadRoleRewards(guildId) {
    return RoleRewardCacheManager.loadRoleRewards(guildId);
  }

  /**
   * Refreshes the role reward cache for a guild
   */
  static async refreshRoleRewardCache(guildId) {
    await RoleRewardCacheManager.refreshRoleRewardCache(guildId);
  }

  /**
   * Clears role reward cache
   */
  static clearRoleRewardCache(guildId = null) {
    RoleRewardCacheManager.clearCache(guildId);
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
