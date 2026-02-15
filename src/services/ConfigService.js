// src/services/ConfigService.js

const { prisma } = require('../lib/prisma');
const { DatabaseService } = require('./DatabaseService');

class ConfigService {
  /**
   * Generic helper to update a specific JSON column in GuildConfig
   */
  static async updateKey(guildId, key, value) {
    await DatabaseService.ensureGuildConfig(guildId);
    await prisma.guildConfig.update({
      where: { guildId },
      data: {
        [key]: value
      },
    });
  }

  // ---------------------------------------------------------
  // 1. Reaction Roles
  // ---------------------------------------------------------

  static normalizeReactionRole(raw) {
    return {
      messageId: raw.messageId || raw.message_id,
      emoji: raw.emoji,
      roleId: raw.roleId || raw.role_id,
      channelId: raw.channelId || raw.channel_id,
      isClanRole: raw.isClanRole ?? raw.is_clan_role ?? false,
      uniqueRoles: raw.uniqueRoles ?? raw.unique_roles ?? false,
      linkedMessageIds: raw.linkedMessageIds || raw.linked_message_ids
    };
  }

  static async getReactionRoles(guildId) {
    const config = await DatabaseService.getFullGuildConfig(guildId);
    const rawRoles = config?.reactionRoles || {};

    const normalizedRoles = {};
    for (const [key, role] of Object.entries(rawRoles)) {
      normalizedRoles[key] = ConfigService.normalizeReactionRole(role);
    }

    return normalizedRoles;
  }

  static async saveReactionRoles(guildId, roles) {
    await DatabaseService.updateGuildConfig(guildId, { reactionRoles: roles });
  }

  // ---------------------------------------------------------
  // 2. Jail Logs
  // ---------------------------------------------------------

  static async getJailLog(guildId, userId) {
    return await prisma.jailLog.findUnique({
      where: { guildId_userId: { guildId, userId } }
    });
  }

  static async getJailLogs(guildId) {
    const logs = await prisma.jailLog.findMany({ where: { guildId } });
    const logsDict = {};

    for (const log of logs) {
      // Validate and cast the status field
      let status = 'jailed';
      if (log.status === 'released' || log.status === 'forgiven') {
        status = log.status;
      }

      logsDict[log.userId] = {
        username: log.username,
        offences: log.offences,
        status: status,
        // Removed hasLegendaryRole
        punishmentEnd: log.punishmentEnd ? log.punishmentEnd.toISOString() : null,
        messageId: log.messageId || undefined,
        caseId: log.caseId || undefined,
        votes: log.votes
      };
    }
    return logsDict;
  }

  static async saveJailLogs(guildId, logs) {
    for (const [userId, data] of Object.entries(logs)) {
      await ConfigService.createOrUpdateJailLog({
        guildId,
        userId,
        username: data.username,
        offences: data.offences,
        status: data.status,
        // Removed hasLegendaryRole
        punishmentEnd: data.punishmentEnd ? new Date(data.punishmentEnd) : null,
        messageId: data.messageId,
        caseId: data.caseId,
        votes: data.votes
      });
    }
  }

  static async createOrUpdateJailLog(data) {
    // FIX: Removed hasLegendaryRole to prevent Prisma Validation Error
    return await prisma.jailLog.upsert({
      where: { guildId_userId: { guildId: data.guildId, userId: data.userId } },
      create: {
        guildId: data.guildId,
        userId: data.userId,
        username: data.username,
        offences: data.offences ?? 0,
        status: data.status ?? 'jailed',
        punishmentEnd: data.punishmentEnd,
        messageId: data.messageId,
        caseId: data.caseId,
        votes: data.votes ?? []
      },
      update: {
        username: data.username,
        offences: data.offences,
        status: data.status,
        punishmentEnd: data.punishmentEnd,
        messageId: data.messageId,
        caseId: data.caseId,
        votes: data.votes
      }
    });
  }

  /**
   * Add a vote to release a jailed member
   */
  static async addVote(guildId, userId, voterId) {
    const log = await ConfigService.getJailLog(guildId, userId);

    if (!log) {
      return null;
    }

    const currentVotes = log.votes;

    if (currentVotes.includes(voterId)) {
      return 'ALREADY_VOTED';
    }

    return await prisma.jailLog.update({
      where: { guildId_userId: { guildId, userId } },
      data: {
        votes: [...currentVotes, voterId]
      }
    });
  }

  /**
   * Get the current vote count for a jailed member
   */
  static async getVoteCount(guildId, userId) {
    const log = await ConfigService.getJailLog(guildId, userId);
    if (!log) return 0;
    return log.votes.length;
  }

  /**
   * Check if a user has already voted
   */
  static async hasVoted(guildId, userId, voterId) {
    const log = await ConfigService.getJailLog(guildId, userId);
    if (!log) return false;
    return log.votes.includes(voterId);
  }

  /**
   * Clear all votes for a jailed member
   */
  static async clearVotes(guildId, userId) {
    await prisma.jailLog.update({
      where: { guildId_userId: { guildId, userId } },
      data: { votes: [] }
    });
  }

  /**
   * Get all voters for a jailed member
   */
  static async getVoters(guildId, userId) {
    const log = await ConfigService.getJailLog(guildId, userId);
    if (!log) return [];
    return log.votes;
  }

  // ---------------------------------------------------------
  // 3. Keywords
  // ---------------------------------------------------------

  static async getKeywords(guildId) {
    const config = await DatabaseService.getFullGuildConfig(guildId);
    return config?.keywords || {};
  }

  static async saveKeywords(guildId, keywords) {
    await ConfigService.updateKey(guildId, 'keywords', keywords);
  }

  /**
   * Atomically adds or updates a keyword mapping
   */
  static async addKeyword(guildId, keyword, emojis) {
    const mergeData = {};
    mergeData[keyword] = emojis;
    await DatabaseService.atomicJsonMerge(guildId, 'keywords', JSON.stringify(mergeData));
  }

  /**
   * Atomically removes a keyword mapping
   */
  static async removeKeyword(guildId, keyword) {
    await DatabaseService.atomicJsonDeleteKey(guildId, 'keywords', keyword);
  }

  // ---------------------------------------------------------
  // 4. Punishment IDs
  // ---------------------------------------------------------

  /**
   * Increments and returns the next punishment counter for the guild.
   * @param {string} guildId
   * @returns {Promise<number>} The new counter value
   */
  static async getNextPunishmentId(guildId) {
    // We'll store the counter in the generic 'config' JSON under 'punishmentCount'
    // Since we need atomic increments, and our current Atomic tools are limited to specific keys or basic JSON merges,
    // we might need a raw query or a transaction if we want strict safety.
    // However, given the current usage, a read-modify-write on the JSON is acceptable if low concurrency.
    // Better yet, let's use a specific field if we could, but 'config' is a catch-all.

    // Let's use Prisma's atomic update features on JSON if possible, but JSON path updates are Postgres specific and raw.
    // For simplicity and safety in this codebase's style:

    return await prisma.$transaction(async (tx) => {
      const guildConfig = await tx.guildConfig.findUnique({
        where: { guildId },
        select: { config: true }
      });

      let currentConfig = guildConfig?.config || {};
      if (typeof currentConfig !== 'object') currentConfig = {};

      const currentCount = Number(currentConfig.punishmentCount) || 0;
      const nextCount = currentCount + 1;

      currentConfig.punishmentCount = nextCount;

      await tx.guildConfig.update({
        where: { guildId },
        data: { config: currentConfig }
      });

      return nextCount;
    });
  }
}

module.exports = { ConfigService };
