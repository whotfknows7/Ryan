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

    try {
      // Get all fields and values, then delete the key (atomic-ish enough for this use case if we accept a tiny race,
      // but strictly we should use a pipeline or Lua. For simplicity/performance balance:
      // We will rename the key to a temp key, process that, then delete it.
      // If new writes come in, they go to the original key (which is now empty/new).

      const tempKey = `xp_buffer_processing:${guildId}:${Date.now()}`;

      // Rename is atomic. If key missing (already processed), it throws, which we catch.
      try {
        await defaultRedis.rename(key, tempKey);
      } catch {
        // Key likely didn't exist or was just processed
        return;
      }

      // Now fetch from tempKey
      const data = await defaultRedis.hgetall(tempKey);

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
      }

      // Cleanup temp key
      await defaultRedis.del(tempKey);
    } catch (error) {
      logger.error(`Failed to process XP buffer for ${guildId}:`, error);
      // Failsafe: If processing failed, we might want to restore the data or leave it in tempKey?
      // For now, logging effectively. In a rigid system, we'd move it back or retry.
    }
  }
}

module.exports = { XpSyncService };
