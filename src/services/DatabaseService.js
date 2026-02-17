// src/services/DatabaseService.js

const { prisma } = require('../lib/prisma');
const { Prisma } = require('@prisma/client');
const logger = require('../lib/logger');
const { defaultRedis } = require('../config/redis');

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

  /**
   * [NEW] Process a batch of XP updates from Redis
   * Uses a transaction to ensure all updates are applied
   */
  static async processXpBatch(guildId, updates) {
    // Optimization: We could use `prisma.$executeRaw` for a massive single query if needed,
    // but a transaction of upserts is safer and reasonably fast for batches of ~100-500.

    // Updates is array of { userId, xp }
    // These are *increments* to the existing values.

    return await prisma.$transaction(
      updates.map(u =>
        prisma.userXp.upsert({
          where: { guildId_userId: { guildId, userId: u.userId } },
          create: {
            guildId,
            userId: u.userId,
            xp: u.xp,
            dailyXp: u.xp,
            weeklyXp: u.xp,
          },
          update: {
            xp: { increment: u.xp },
            dailyXp: { increment: u.xp },
            weeklyXp: { increment: u.xp },
          },
        })
      )
    );
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
      select: { dailyXp: true, weeklyXp: true, xp: true, clanId: true },
    });
    return stats || { dailyXp: 0, weeklyXp: 0, xp: 0, clanId: 0 };
  }

  /**
   * [NEW] Fetch Live User Stats (DB + Redis Delta)
   */
  static async getLiveUserStats(guildId, userId) {
    const [dbStats, redisDelta] = await Promise.all([
      this.getUserStats(guildId, userId),
      defaultRedis.hget(`xp_buffer:${guildId}`, userId)
    ]);

    const delta = redisDelta ? parseInt(redisDelta, 10) : 0;

    return {
      ...dbStats,
      xp: (dbStats.xp || 0) + delta,
      dailyXp: (dbStats.dailyXp || 0) + delta,
      weeklyXp: (dbStats.weeklyXp || 0) + delta
    };
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
   * [NEW] Fetch Live Top Users (DB + Redis Merge)
   * This ensures the leaderboard reflects the absolute latest data from the 30s buffer.
   */
  static async getLiveTopUsers(guildId, limit = 10, type = 'daily') {
    // 1. Fetch DB Top (fetch a bit more to allow for re-ordering)
    const dbTop = await this.fetchTopUsers(guildId, limit + 20, type);

    // 2. Fetch Redis Buffer
    const buffer = await defaultRedis.hgetall(`xp_buffer:${guildId}`);

    if (!buffer || Object.keys(buffer).length === 0) {
      return dbTop.slice(0, limit);
    }

    // 3. Merge Strategies
    const mergedMap = new Map();

    // Initialize with DB data
    for (const user of dbTop) {
      mergedMap.set(user.userId, { ...user });
    }

    // Apply Redis updates
    for (const [userId, xpStr] of Object.entries(buffer)) {
      const delta = parseInt(xpStr, 10);

      if (mergedMap.has(userId)) {
        const user = mergedMap.get(userId);
        user.xp = (user.xp || 0) + delta;
        user.dailyXp = (user.dailyXp || 0) + delta;
        user.weeklyXp = (user.weeklyXp || 0) + delta;
      } else {
        // User not in top DB list, might have jumped up.
        // We'd strictly need to fetch them from DB to know their base.
        // For performance, we can skip or try to fetch them if needed.
        // OR, we just assume they are not in top 10 unless they were already close.
        // Correct approach: We should technically fetch the user from DB to get Base.
        // But doing N fetches is bad.
        // Compromise: We only merge delta for users ALREADY in top list.
        // Users climbing from rank 100 to 1 won't show until 30s flush, but users in top 10 shuffling positions will show.
        // This is a good trade-off.
      }
    }

    // 4. Sort and Slice
    const field = type === 'weekly' ? 'weeklyXp' : type === 'lifetime' ? 'xp' : 'dailyXp';
    const sorted = Array.from(mergedMap.values()).sort((a, b) => b[field] - a[field]);

    return sorted.slice(0, limit);
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
    await prisma.userXp.deleteMany({ where: { guildId, userId } });
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
   * [NEW] Syncs User Roles to UserXp.clanId
   * This ensures UserXp reflects the current Clan Roles.
   */
  static async syncUserClanRoles(guildId, clanUpdates) {
    if (clanUpdates.length === 0) return;

    // 1. Reset clanId for all users in the guild first (optional, but safer to ensure no stale clans)
    // Or efficiently, just update the ones we know about. 
    // Ideally, we want to set clanId = null for everyone, and then set it for the active ones.
    // But since this runs frequently or on reset, let's just update the ones found.
    // Actually, if a user leaves a clan, they won't be in clanUpdates.
    // So we should probably set all clanId to 0 (or null) for the guild first? 
    // Or we can just update the ones we have.
    // "make sure that a user can have 1+ guilds and different clans in different guilds" -> schema handles this via composite key/guildId.

    // Efficient approach:
    // 1. Set clanId = 0 for all users in this guild (assuming 0 means no clan)
    await prisma.userXp.updateMany({
      where: { guildId },
      data: { clanId: 0 }
    });

    // 2. Bulk update is tricky in Prisma without raw query for different values.
    // We can do it in a loop or transaction.
    // Since clanUpdates might be large, we should batch it or usage Promise.all
    // But since this is a background job usually, loop is fine for now or we can use a raw query case statement.

    // Let's use a loop with parallel promises for now, or transaction.
    const updates = clanUpdates.map(u =>
      prisma.userXp.updateMany({
        where: { guildId, userId: u.userId },
        data: { clanId: u.clanId }
      })
    );

    await prisma.$transaction(updates);
    await prisma.$transaction(updates);
  }

  /**
   * [NEW] Sets a specific user's clan ID in the database.
   * Used for stateless reaction role switching.
   */
  static async setUserClan(guildId, userId, clanId) {
    return await prisma.userXp.updateMany({
      where: { guildId, userId },
      data: { clanId }
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
    const result = await prisma.userXp.aggregate({
      where: { guildId, clanId },
      _sum: { xp: true },
    });
    return result._sum.xp ?? 0;
  }

  static async getClanTotalXp(guildId) {
    const results = await prisma.userXp.groupBy({
      by: ['clanId'],
      where: {
        guildId,
        clanId: { gt: 0 } // exclude no clan
      },
      _sum: { xp: true },
    });
    const clanTotals = {};
    results.forEach((r) => {
      if (r.clanId) clanTotals[r.clanId] = r._sum.xp || 0;
    });
    return clanTotals;
  }

  // addClanXp is no longer needed as we update UserXp directly.
  // clearClanXp is no longer needed as we perform soft resets or clanId updates.



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
