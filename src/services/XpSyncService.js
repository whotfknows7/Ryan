const { defaultRedis } = require('../config/redis');
const { DatabaseService } = require('./DatabaseService');
const logger = require('../lib/logger');

/**
 * Service to synchronize XP from Redis buffers to PostgreSQL
 * Implements the "Write-Behind" strategy
 */
class XpSyncService {
  /**
   * Scans all guild XP buffers and flushes them to the database
   */
  static async syncXpBuffers() {
    // 1. Scan for all xp_buffer keys
    let cursor = '0';
    const pattern = 'xp_buffer:*';
    const keys = [];

    try {
      do {
        const result = await defaultRedis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        keys.push(...result[1]);
      } while (cursor !== '0');

      if (keys.length === 0) return;

      // logger.debug(`Found ${keys.length} XP buffers to sync.`);

      // 2. Process each guild's buffer
      for (const key of keys) {
        await this.processGuildBuffer(key);
      }
    } catch (error) {
      logger.error('Error in XpSyncService.syncXpBuffers:', error);
    }
  }

  /**
   * Processes a single guild's XP buffer
   * ATOMICITY: We use a Lua script or a transaction to get-and-delete
   * to ensure we don't lose XP gained during the sync.
   */
  static async processGuildBuffer(key) {
    const guildId = key.split(':')[1];
    if (!guildId) return;

    const tempKey = `xp_buffer_processing:${guildId}:${Date.now()}`;
    let data = null;

    try {
      // Rename is atomic. If key missing (already processed), it throws, which we catch.
      try {
        await defaultRedis.rename(key, tempKey);
      } catch {
        // Key likely didn't exist or was just processed
        return;
      }

      // Now fetch from tempKey
      data = await defaultRedis.hgetall(tempKey);

      if (!data || Object.keys(data).length === 0) {
        await defaultRedis.del(tempKey);
        return;
      }

      // Transform to array of { userId, xp }
      const updates = Object.entries(data).map(([userId, xpStr]) => ({
        userId,
        xp: parseInt(xpStr, 10),
      }));

      // Bulk update DB
      if (updates.length > 0) {
        await DatabaseService.processXpBatch(guildId, updates);
        // logger.info(`Synced ${updates.length} users' XP for guild ${guildId}`);

        // Mark guild as dirty so the 20s checker refreshes the leaderboard to match DB state
        await defaultRedis.sadd('lb_dirty_guilds', guildId);
      }

      // Cleanup temp key
      await defaultRedis.del(tempKey);
    } catch (error) {
      logger.error(`Failed to process XP buffer for ${guildId}. Attempting rollback:`, error);

      try {
        // Rollback mechanism: Merge failed data back into the active buffer
        // If data wasn't fetched yet, try to fetch it now
        if (!data) {
          data = await defaultRedis.hgetall(tempKey);
        }

        if (data && Object.keys(data).length > 0) {
          const pipeline = defaultRedis.pipeline();
          for (const [userId, xpStr] of Object.entries(data)) {
            const xp = parseInt(xpStr, 10);
            if (!isNaN(xp)) {
              pipeline.hincrby(key, userId, xp);
            }
          }
          await pipeline.exec();
          logger.info(`Successfully rolled back ${Object.keys(data).length} XP entries for guild ${guildId}`);
        }

        // Always attempt to delete the temp key to prevent stale processing keys
        await defaultRedis.del(tempKey);
      } catch (rollbackError) {
        logger.error(`CRITICAL: Rollback failed for guild ${guildId}:`, rollbackError);
      }
    }
  }
}

module.exports = { XpSyncService };
