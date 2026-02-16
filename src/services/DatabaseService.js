// src/services/DatabaseService.js

const { prisma } = require('../lib/prisma');
const { Prisma } = require('@prisma/client');
const logger = require('../lib/logger');

class DatabaseService {
  // =================================================================
  // 1. ATOMIC XP OPERATIONS (UPDATED FOR DAILY/WEEKLY)
  // =================================================================

  /**
   * [UPDATED] Increment all 3 counters simultaneously (lifetime, daily, weekly)
   */
  static async addUserXp(guildId, userId, amount) {
    return await prisma.userXp.upsert({
      where: { guildId_userId: { guildId, userId } },
      create: {
        guildId,
        userId,
        xp: amount,
        dailyXp: amount,
        weeklyXp: amount,
      },
      update: {
        xp: { increment: amount },
        dailyXp: { increment: amount },
        weeklyXp: { increment: amount },
      },
    });
  }

  static async subtractUserXp(guildId, userId, amount) {
    // Note: This only affects lifetime XP, not daily/weekly
    // Daily/weekly should not be decremented as they track period activity
    const result = await prisma.$queryRaw`
      UPDATE "UserXp"
      SET xp = GREATEST(0, xp - ${amount}), "updatedAt" = NOW()
      WHERE "guildId" = ${guildId} AND "userId" = ${userId}
      RETURNING xp, "dailyXp", "weeklyXp"
    `;

    // Handle deletion if 0, but return the state first
    if (result.length > 0) {
      const currentXp = result[0].xp;
      if (currentXp === 0) {
        await prisma.userXp.deleteMany({
          where: { guildId, userId, xp: 0 },
        });
      }
      return { xp: currentXp, dailyXp: result[0].dailyXp, weeklyXp: result[0].weeklyXp };
    }
    return null;
  }

  static async updateUserXp(guildId, userId, xpDelta) {
    if (xpDelta > 0) {
      return await this.addUserXp(guildId, userId, xpDelta);
    } else if (xpDelta < 0) {
      return await this.subtractUserXp(guildId, userId, Math.abs(xpDelta));
    }
    return null;
  }

  static async setUserXp(guildId, userId, newXp) {
    // Note: This only sets lifetime XP, preserves daily/weekly
    if (newXp <= 0) {
      await prisma.userXp.deleteMany({ where: { guildId, userId } });
      return null;
    } else {
      return await prisma.userXp.upsert({
        where: { guildId_userId: { guildId, userId } },
        create: { guildId, userId, xp: newXp, dailyXp: 0, weeklyXp: 0 },
        update: { xp: newXp },
      });
    }
  }

  /**
   * [NEW] Fetch all stats for the Rank Command
   */
  static async getUserStats(guildId, userId) {
    const stats = await prisma.userXp.findUnique({
      where: { guildId_userId: { guildId, userId } },
      select: { dailyXp: true, weeklyXp: true, xp: true },
    });
    return stats || { dailyXp: 0, weeklyXp: 0, xp: 0 };
  }

  /**
   * [UPDATED] Fetch top users based on the leaderboard type
   * type: 'daily' | 'weekly' | 'lifetime'
   */
  static async fetchTopUsers(guildId, limit = 10, type = 'daily', skip = 0) {
    const orderBy =
      type === 'weekly' ? { weeklyXp: 'desc' } : type === 'lifetime' ? { xp: 'desc' } : { dailyXp: 'desc' }; // Default daily

    // We filter for XP > 0 to avoid listing inactive users
    const orderByField = Object.keys(orderBy)[0];
    const whereClause = {
      guildId,
      [orderByField]: { gt: 0 },
    };

    return prisma.userXp.findMany({
      where: whereClause,
      orderBy,
      take: limit,
      skip: skip,
      select: {
        userId: true,
        dailyXp: true,
        weeklyXp: true,
        xp: true,
      },
    });
  }

  /**
   * [UPDATED] Count users with XP > 0 for pagination
   */
  static async getUserCount(guildId, type = 'daily') {
    const column = type === 'weekly' ? 'weeklyXp' : type === 'lifetime' ? 'xp' : 'dailyXp';
    return prisma.userXp.count({
      where: {
        guildId,
        [column]: { gt: 0 },
      },
    });
  }

  /**
   * [UPDATED] Calculate rank via DB index (supports lifetime, daily, weekly)
   * Type: 'lifetime' | 'daily' | 'weekly'
   */
  static async getUserRank(guildId, userId, type = 'lifetime') {
    // 1. Get user's score
    const user = await prisma.userXp.findUnique({
      where: { guildId_userId: { guildId, userId } },
    });

    if (!user) return null;

    // 2. Map type to column name
    const column = type === 'weekly' ? 'weeklyXp' : type === 'daily' ? 'dailyXp' : 'xp';

    // 3. Count how many people have MORE score than them
    const count = await prisma.userXp.count({
      where: {
        guildId,
        [column]: { gt: user[column] },
      },
    });

    return count + 1;
  }

  /**
   * Keep getAllUserXp for specific bulk operations if strictly needed,
   * but avoid using it in frequent loops.
   */
  static async getAllUserXp(guildId) {
    return prisma.userXp.findMany({
      where: { guildId },
      select: {
        userId: true,
        xp: true,
        dailyXp: true,
        weeklyXp: true,
      },
    });
  }

  static async deleteUserData(guildId, userId) {
    await prisma.$transaction([
      prisma.userXp.deleteMany({ where: { guildId, userId } }),
      prisma.clanXp.deleteMany({ where: { guildId, userId } }),
    ]);
  }

  static async resetUserXp(guildId) {
    await prisma.userXp.deleteMany({ where: { guildId } });
  }

  /**
   * [NEW] Reset daily XP for all users in a guild (Non-Destructive)
   */
  static async resetDailyXp(guildId) {
    const result = await prisma.userXp.updateMany({
      where: { guildId },
      data: { dailyXp: 0 },
    });
    logger.info(`Reset daily XP for ${result.count} users in guild ${guildId}`);
    return result.count;
  }

  /**
   * [NEW] Reset weekly XP for all users in a guild (Non-Destructive)
   */
  static async resetWeeklyXp(guildId) {
    const result = await prisma.userXp.updateMany({
      where: { guildId },
      data: { weeklyXp: 0 },
    });
    logger.info(`Reset weekly XP for ${result.count} users in guild ${guildId}`);
    return result.count;
  }

  /**
   * [NEW] Reset daily XP for all guilds
   */
  static async resetDailyXpAllGuilds() {
    const result = await prisma.userXp.updateMany({
      data: { dailyXp: 0 },
    });
    logger.info(`Reset daily XP for ${result.count} total users across all guilds`);
    return result.count;
  }

  /**
   * [NEW] Reset weekly XP for all guilds
   */
  static async resetWeeklyXpAllGuilds() {
    const result = await prisma.userXp.updateMany({
      data: { weeklyXp: 0 },
    });
    logger.info(`Reset weekly XP for ${result.count} total users across all guilds`);
    return result.count;
  }

  /**
   * [NEW] Syncs UserXP to ClanXP without deleting UserXP.
   * This ensures ClanXP reflects the current UserXP state (replacing old values).
   * This is used for all reset modules where UserXP accumulates.
   */
  static async syncUserXpToClanXp(guildId, clanUpdates) {
    if (clanUpdates.length === 0) return;
    const userIds = clanUpdates.map((u) => u.userId);

    // 1. Delete existing ClanXp entries for these users to prevent "Clan Hopping" exploits
    //    or stale data from previous clans.
    await prisma.clanXp.deleteMany({
      where: {
        guildId,
        userId: { in: userIds },
      },
    });

    // 2. Create fresh entries matching current UserXp
    await prisma.clanXp.createMany({
      data: clanUpdates.map((u) => ({
        guildId,
        clanId: u.clanId,
        userId: u.userId,
        xp: u.xp,
      })),
    });
  }

  // =================================================================
  // 2. ATOMIC JSON CONFIGURATION OPERATIONS
  // =================================================================

  static async atomicJsonMerge(guildId, columnName, mergeData) {
    await this.ensureGuildConfig(guildId);

    const allowedColumns = ['ids', 'config', 'keywords', 'reactionRoles', 'clans', 'resetRoleData'];
    if (!allowedColumns.includes(columnName)) {
      throw new Error(`Invalid configuration column: ${columnName}`);
    }

    const query = Prisma.sql`
      UPDATE "GuildConfig" 
      SET "${Prisma.raw(columnName)}" = COALESCE("${Prisma.raw(columnName)}", '{}'::jsonb) || ${mergeData}::jsonb,
          "updatedAt" = NOW()
      WHERE "guildId" = ${guildId}
    `;

    await prisma.$executeRaw(query);
  }

  static async atomicJsonSetPath(guildId, columnName, path, value) {
    await this.ensureGuildConfig(guildId);

    const allowedColumns = ['ids', 'config', 'keywords', 'reactionRoles', 'clans'];
    if (!allowedColumns.includes(columnName)) throw new Error(`Invalid column: ${columnName}`);

    const formattedPath = Array.isArray(path) ? path : [path];

    const query = Prisma.sql`
      UPDATE "GuildConfig"
      SET "${Prisma.raw(columnName)}" = jsonb_set(
        COALESCE("${Prisma.raw(columnName)}", '{}'::jsonb), 
        ${formattedPath}, 
        ${JSON.stringify(value)}::jsonb, 
        true
      ),
      "updatedAt" = NOW()
      WHERE "guildId" = ${guildId}
    `;

    await prisma.$executeRaw(query);
  }

  static async atomicJsonDeleteKey(guildId, columnName, key) {
    await this.ensureGuildConfig(guildId);

    const allowedColumns = ['ids', 'config', 'keywords', 'reactionRoles', 'clans', 'resetRoleData'];
    if (!allowedColumns.includes(columnName)) throw new Error(`Invalid column: ${columnName}`);

    const query = Prisma.sql`
      UPDATE "GuildConfig"
      SET "${Prisma.raw(columnName)}" = "${Prisma.raw(columnName)}" - ${key},
          "updatedAt" = NOW()
      WHERE "guildId" = ${guildId}
    `;

    await prisma.$executeRaw(query);
  }

  static async atomicArrayPush(guildId, columnName, item) {
    await this.ensureGuildConfig(guildId);

    const allowedColumns = ['roleRequests'];
    if (!allowedColumns.includes(columnName)) throw new Error(`Invalid array column: ${columnName}`);

    const query = Prisma.sql`
      UPDATE "GuildConfig"
      SET "${Prisma.raw(columnName)}" = COALESCE("${Prisma.raw(columnName)}", '[]'::jsonb) || jsonb_build_array(${JSON.stringify(item)}::jsonb),
          "updatedAt" = NOW()
      WHERE "guildId" = ${guildId}
    `;

    await prisma.$executeRaw(query);
  }

  static async atomicArrayRemoveById(guildId, columnName, targetId) {
    await this.ensureGuildConfig(guildId);

    const allowedColumns = ['roleRequests'];
    if (!allowedColumns.includes(columnName)) throw new Error(`Invalid array column: ${columnName}`);

    const query = Prisma.sql`
      UPDATE "GuildConfig"
      SET "${Prisma.raw(columnName)}" = (
        SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
        FROM jsonb_array_elements("${Prisma.raw(columnName)}") elem
        WHERE elem->>'id' != ${targetId}
      ),
      "updatedAt" = NOW()
      WHERE "guildId" = ${guildId}
    `;

    await prisma.$executeRaw(query);
  }

  // =================================================================
  // 3. CLAN & UTILITY OPERATIONS
  // =================================================================

  static async getClanXp(guildId, clanId) {
    const result = await prisma.clanXp.aggregate({
      where: { guildId, clanId },
      _sum: { xp: true },
    });
    return result._sum.xp ?? 0;
  }

  static async getClanTotalXp(guildId) {
    const results = await prisma.clanXp.groupBy({
      by: ['clanId'],
      where: { guildId },
      _sum: { xp: true },
    });
    const clanTotals = {};
    results.forEach((r) => {
      if (r.clanId) clanTotals[r.clanId] = r._sum.xp || 0;
    });
    return clanTotals;
  }

  static async addClanXp(guildId, clanId, userId, xp) {
    await prisma.clanXp.upsert({
      where: { guildId_clanId_userId: { guildId, clanId, userId } },
      create: { guildId, clanId, userId, xp },
      update: { xp: { increment: xp } },
    });
  }

  static async clearClanXp(guildId) {
    await prisma.clanXp.deleteMany({ where: { guildId } });
  }

  // =================================================================
  // 4. GUILD CONFIG & IDS
  // =================================================================

  static async ensureGuildConfig(guildId) {
    const exists = await prisma.$queryRaw`SELECT 1 FROM "GuildConfig" WHERE "guildId" = ${guildId}`;
    if (exists.length === 0) {
      await prisma.guildConfig.upsert({
        where: { guildId },
        create: { guildId },
        update: {},
      });
    }
  }

  static async getGuildConfig(guildId) {
    await this.ensureGuildConfig(guildId);
    return prisma.guildConfig.findUniqueOrThrow({ where: { guildId } });
  }

  static async getFullGuildConfig(guildId) {
    return prisma.guildConfig.findUnique({ where: { guildId } });
  }

  static async updateGuildConfig(guildId, data) {
    await this.ensureGuildConfig(guildId);
    return prisma.guildConfig.update({
      where: { guildId },
      data,
    });
  }

  static async getGuildIds(guildId) {
    const res = await prisma.guildConfig.findUnique({
      where: { guildId },
      select: { ids: true },
    });
    return res?.ids || {};
  }

  static async updateGuildIds(guildId, updates) {
    const toSet = {};
    const toRemove = [];

    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        toRemove.push(key);
      } else {
        toSet[key] = value;
      }
    }

    if (Object.keys(toSet).length > 0) {
      await this.atomicJsonMerge(guildId, 'ids', toSet);
    }

    for (const key of toRemove) {
      await this.atomicJsonDeleteKey(guildId, 'ids', key);
    }
  }

  static async clearGuildIds(guildId) {
    await prisma.guildConfig.update({
      where: { guildId },
      data: { ids: {} },
    });
  }

  // =================================================================
  // 5. SYSTEM UTILS
  // =================================================================

  static async getResetCycle(guildId) {
    return prisma.resetCycle.findUnique({ where: { guildId } });
  }

  static async initResetCycle(guildId) {
    return prisma.resetCycle.create({
      data: {
        guildId,
        lastResetUtc: new Date(),
        cycleCount: 0,
      },
    });
  }

  static async updateResetCycle(guildId, cycleCount, lastReset) {
    await prisma.resetCycle.update({
      where: { guildId },
      data: { cycleCount, lastResetUtc: lastReset },
    });
  }

  static async checkDatabaseIntegrity() {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      logger.error('Database integrity check failed:', error);
      return false;
    }
  }

  // =================================================================
  // 6. CLAN ASSETS & GIF TEMPLATES
  // =================================================================

  static async createGifTemplate(name, clanCount, folderPath) {
    return prisma.gifTemplate.create({
      data: { name, clanCount, folderPath },
    });
  }

  static async getGifTemplate(clanCount) {
    const count = await prisma.gifTemplate.count({ where: { clanCount } });
    if (count === 0) return null;

    const skip = Math.floor(Math.random() * count);
    const templates = await prisma.gifTemplate.findMany({
      where: { clanCount },
      take: 1,
      skip: skip,
    });

    return templates[0] || null;
  }

  static async setClanAsset(guildId, roleId, messageLink) {
    return prisma.clanAsset.upsert({
      where: { roleId },
      create: { guildId, roleId, messageLink },
      update: { messageLink, guildId },
    });
  }

  static async getClanAsset(roleId) {
    return prisma.clanAsset.findUnique({
      where: { roleId },
    });
  }

  // =================================================================
  // 7. LEADERBOARD STATE & CACHING
  // =================================================================

  static async getLeaderboardState(guildId) {
    return prisma.leaderboardState.findUnique({
      where: { guildId },
    });
  }

  static async updateLeaderboardState(guildId, messageId, ranksArray) {
    return prisma.leaderboardState.upsert({
      where: { guildId },
      create: {
        guildId,
        lastMessageId: messageId,
        lastRanks: ranksArray,
      },
      update: {
        lastMessageId: messageId,
        lastRanks: ranksArray,
      },
    });
  }

  static async getGifCache(rankHash) {
    return prisma.gifCache.findUnique({
      where: { rankHash },
    });
  }

  static async setGifCache(rankHash, messageLink) {
    return prisma.gifCache.upsert({
      where: { rankHash },
      create: { rankHash, messageLink },
      update: { messageLink },
    });
  }
}

module.exports = { DatabaseService };
