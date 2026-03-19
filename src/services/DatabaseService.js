// src/services/DatabaseService.js

const { prisma } = require('../lib/prisma');
const { Prisma } = require('@prisma/client');
const logger = require('../lib/logger');
const { defaultRedis } = require('../config/redis');

class DatabaseService {
  // =================================================================
  // 1. ATOMIC XP OPERATIONS (UPDATED FOR DAILY/WEEKLY)
  // =================================================================

  // =================================================================
  // HYBRID-MERGE LEADERBOARDS (TIER A & TIER B)
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
    const result = await prisma.$queryRaw`
      UPDATE "UserXp"
      SET 
        xp = GREATEST(0, xp - ${amount}),
        "dailyXp" = GREATEST(0, "dailyXp" - ${amount}),
        "weeklyXp" = GREATEST(0, "weeklyXp" - ${amount}),
        "updatedAt" = NOW()
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
      updates.map((u) =>
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
    // 1. Fetch DB Baseline and all potential Redis buffers (active + processing)
    const [dbStats, activeDelta, processingKeys] = await Promise.all([
      this.getUserStats(guildId, userId),
      defaultRedis.hget(`xp_buffer:${guildId}`, userId),
      defaultRedis.keys(`xp_buffer_processing:${guildId}:*`),
    ]);

    let totalDelta = activeDelta ? parseInt(activeDelta, 10) : 0;

    // 2. Sum any processing buffers (covers the sync window flicker)
    if (processingKeys.length > 0) {
      const processingValues = await Promise.all(processingKeys.map((key) => defaultRedis.hget(key, userId)));
      for (const val of processingValues) {
        if (val) totalDelta += parseInt(val, 10);
      }
    }

    return {
      ...dbStats,
      xp: (dbStats.xp || 0) + totalDelta,
      dailyXp: (dbStats.dailyXp || 0) + totalDelta,
      weeklyXp: (dbStats.weeklyXp || 0) + totalDelta,
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
   * Tier B: Page 1 Live Leaderboards (The Top-K Search)
   * Merges DB Baseline with Redis Hot Buffer in-memory.
   */
  /**
   * Stateless Live Leaderboard Fetching
   */
  static async getLiveTopUsers(guildId, limit = 10, type = 'daily', skip = 0) {
    const column = type === 'weekly' ? 'weeklyXp' : type === 'lifetime' ? 'xp' : 'dailyXp';

    // 1. Fetch DB Baseline
    // We fetch a larger window from the DB to increase the chance of catching users who moved rankings
    const fetchLimit = limit + 20;
    const dbTop = await prisma.userXp.findMany({
      where: { guildId, [column]: { gt: 0 } },
      orderBy: { [column]: 'desc' },
      take: fetchLimit,
      skip: skip,
      select: { userId: true, [column]: true },
    });

    // Fetch the Redis Buffer(s)
    const [bufferRaw, processingKeys] = await Promise.all([
      defaultRedis.hgetall(`xp_buffer:${guildId}`),
      defaultRedis.keys(`xp_buffer_processing:${guildId}:*`),
    ]);

    // Merge all processing buffers into bufferRaw
    if (processingKeys.length > 0) {
      for (const pKey of processingKeys) {
        const pData = await defaultRedis.hgetall(pKey);
        for (const [uId, xpStr] of Object.entries(pData)) {
          const current = parseInt(bufferRaw[uId] || '0', 10);
          bufferRaw[uId] = (current + parseInt(xpStr, 10)).toString();
        }
      }
    }

    // If all buffers are empty, rely on DB (but still apply skip/limit correctly)
    if (Object.keys(bufferRaw).length === 0) {
      return dbTop.slice(0, limit).map((u) => ({ userId: u.userId, [column]: u[column] }));
    }

    // 2. Merge Phase
    const mergedMap = new Map();
    for (const u of dbTop) {
      mergedMap.set(u.userId, u[column]);
    }

    // We need the DB baselines for buffer users NOT in the current dbTop slice.
    // However, if we are deep paginating (skip > 0), many buffer users might be on Page 1.
    // We should fetch baselines for ALL buffer users to be safe, regardless of whether they
    // were in the current dbTop slice, because their LIVE rank might put them on this page.
    const bufferUserIds = Object.keys(bufferRaw);
    const missingFromSlice = bufferUserIds.filter((id) => !mergedMap.has(id));

    if (missingFromSlice.length > 0) {
      const missingBaselines = await prisma.userXp.findMany({
        where: { guildId, userId: { in: missingFromSlice } },
        select: { userId: true, [column]: true },
      });

      const foundIds = new Set();
      for (const b of missingBaselines) {
        foundIds.add(b.userId);
        const redisXp = parseInt(bufferRaw[b.userId] || '0', 10);
        mergedMap.set(b.userId, b[column] + redisXp);
      }

      // Brand new users only in buffer
      for (const bUserId of missingFromSlice) {
        if (!foundIds.has(bUserId)) {
          mergedMap.set(bUserId, parseInt(bufferRaw[bUserId] || '0', 10));
        }
      }
    }

    // Update those who WERE in the slice with their buffer delta
    for (const bUserId of bufferUserIds) {
      if (!missingFromSlice.includes(bUserId)) {
        const redisXp = parseInt(bufferRaw[bUserId] || '0', 10);
        mergedMap.set(bUserId, mergedMap.get(bUserId) + redisXp);
      }
    }

    // 3. Sort and Slice in Javascript
    // IMPORTANT: Since we only have a slice of the DB + the buffer,
    // we return the top `limit` items of the merged set.
    // If skip > 0, we still only return the items that fall into this page's range.

    const finalUsers = Array.from(mergedMap.entries())
      .map(([uId, total]) => ({ userId: uId, [column]: total }))
      .sort((a, b) => b[column] - a[column])
      .slice(0, limit);

    return finalUsers;
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
   * Tier A: Exact Rank Fetching (The Live Merge)
   * Calculates rank on the fly using DB + Buffer.
   */
  /**
   * O(1) Indexed Exact Rank Fetching (Stateless Hybrid)
   */
  static async getUserRank(guildId, userId, type = 'lifetime') {
    // 1. Get their true live XP (DB + Redis Buffer)
    const liveStats = await this.getLiveUserStats(guildId, userId);
    const column = type === 'weekly' ? 'weeklyXp' : type === 'lifetime' ? 'xp' : 'dailyXp';
    const targetXp = liveStats[column];

    if (targetXp <= 0) return 0; // Unranked

    // 2. Ask Postgres for the baseline rank using the index
    // This counts users whose DB XP is strictly greater than the target's Live XP
    const higherRankedCount = await prisma.userXp.count({
      where: {
        guildId,
        [column]: { gt: targetXp },
      },
    });

    // 3. Buffer Overtake Delta
    // We must find active chatters in Redis whose un-synced XP pushes their true Live XP
    // past our target user, but who were missed by the DB query because their Cold DB XP <= targetXp.
    let bufferOvertakes = 0;
    const bufferRaw = await defaultRedis.hgetall(`xp_buffer:${guildId}`);

    // Filter out the target user themselves
    const bufferUserIds = Object.keys(bufferRaw).filter((id) => id !== userId);

    if (bufferUserIds.length > 0) {
      // Fetch DB baselines only for the active chatters in the buffer
      const bufferUsersDb = await prisma.userXp.findMany({
        where: { guildId, userId: { in: bufferUserIds } },
        select: { userId: true, [column]: true },
      });

      // Map their DB XP for O(1) lookup
      const dbXpMap = new Map();
      for (const u of bufferUsersDb) {
        dbXpMap.set(u.userId, u[column] || 0);
      }

      // Calculate the true Live XP of each buffer user
      for (const bUserId of bufferUserIds) {
        const dbXp = dbXpMap.get(bUserId) || 0; // Default to 0 if they aren't in the DB yet
        const redisXp = parseInt(bufferRaw[bUserId] || '0', 10);
        const liveXp = dbXp + redisXp;

        // The exact mathematical condition for an overtake:
        if (dbXp <= targetXp && liveXp > targetXp) {
          bufferOvertakes++;
        }
      }
    }

    return higherRankedCount + bufferOvertakes + 1; // 0-indexed count to 1-indexed rank
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

    // Clear the Redis cache for this guild's daily leaderboard
    try {
      await defaultRedis.del(`lb:${guildId}:daily`);
    } catch (err) {
      logger.error(`Failed to clear daily Redis LB for ${guildId}: ${err.message}`);
    }

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

    // Clear the Redis cache for this guild's weekly leaderboard
    try {
      await defaultRedis.del(`lb:${guildId}:weekly`);
    } catch (err) {
      logger.error(`Failed to clear weekly Redis LB for ${guildId}: ${err.message}`);
    }

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
      data: { clanId: 0 },
    });

    // 2. Bulk update is tricky in Prisma without raw query for different values.
    // We can do it in a loop or transaction.
    // Since clanUpdates might be large, we should batch it or usage Promise.all
    // But since this is a background job usually, loop is fine for now or we can use a raw query case statement.

    // Group updates by clanId to execute fewer updateMany queries and avoid N+1 lock
    const clanGroups = {};
    for (const u of clanUpdates) {
      if (!clanGroups[u.clanId]) {
        clanGroups[u.clanId] = [];
      }
      clanGroups[u.clanId].push(u.userId);
    }

    const updates = Object.entries(clanGroups).map(([clanId, userIds]) =>
      prisma.userXp.updateMany({
        where: {
          guildId,
          userId: { in: userIds },
        },
        data: { clanId: Number(clanId) },
      })
    );

    await prisma.$transaction(updates);
  }

  /**
   * [NEW] Sets a specific user's clan ID in the database.
   * Used for stateless reaction role switching.
   */
  static async setUserClan(guildId, userId, clanId) {
    return await prisma.userXp.updateMany({
      where: { guildId, userId },
      data: { clanId },
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
      SET "${Prisma.raw(columnName)}" = COALESCE("${Prisma.raw(columnName)}", '{}'::jsonb) || ${JSON.stringify(mergeData)}::jsonb,
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
      _sum: { weeklyXp: true },
    });
    return result._sum.weeklyXp ?? 0;
  }

  static async getClanTotalXp(guildId) {
    const results = await prisma.userXp.groupBy({
      by: ['clanId'],
      where: {
        guildId,
        clanId: { gt: 0 }, // exclude no clan
      },
      _sum: { weeklyXp: true },
    });
    const clanTotals = {};
    results.forEach((r) => {
      if (r.clanId) clanTotals[r.clanId] = r._sum.weeklyXp || 0;
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

  static async cleanDeletedRole(guildId, roleId) {
    const config = await this.getFullGuildConfig(guildId);
    if (!config || !config.ids) return;

    let updated = false;
    const currentIds = config.ids;
    for (const [key, value] of Object.entries(currentIds)) {
      if (value === roleId) {
        delete currentIds[key];
        updated = true;
      }
    }

    if (updated) {
      await this.updateGuildConfig(guildId, { ids: currentIds });
      const { invalidate } = require('../utils/GuildIdsHelper');
      invalidate(guildId);
      logger.info(`Cleaned up deleted role ${roleId} from guild config ${guildId}.`);
    }
  }

  static async cleanDeletedChannel(guildId, channelId) {
    const config = await this.getFullGuildConfig(guildId);
    if (!config || !config.ids) return;

    let updated = false;
    const currentIds = config.ids;
    for (const [key, value] of Object.entries(currentIds)) {
      if (value === channelId) {
        delete currentIds[key];
        updated = true;
      }
    }

    if (updated) {
      await this.updateGuildConfig(guildId, { ids: currentIds });
      const { invalidate } = require('../utils/GuildIdsHelper');
      invalidate(guildId);
      logger.info(`Cleaned up deleted channel ${channelId} from guild config ${guildId}.`);
    }
  }

  /**
   * [NEW] Fetch multiple guild configs in one query
   */
  static async getManyGuildConfigs(guildIds) {
    return prisma.guildConfig.findMany({
      where: {
        guildId: { in: guildIds },
      },
      select: {
        guildId: true,
        ids: true,
        config: true,
        keywords: true,
        reactionRoles: true,
      },
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

  static async getAllTempLeaderboards() {
    return prisma.leaderboardState.findMany();
  }

  static async updateTempLeaderboards(guildId, msgs) {
    return prisma.leaderboardState.upsert({
      where: { guildId },
      create: { guildId, lastRanks: msgs },
      update: { lastRanks: msgs },
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
