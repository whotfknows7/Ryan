// ============================================================================
// GuildIdsHelper.js - Convenient helper to access guild IDs
// ============================================================================

const { DatabaseService } = require('../services/DatabaseService');
const MetricsService = require('../services/MetricsService');

const { LRUCache } = require('lru-cache');

/**
 * Smart RAM Cache with LRU eviction
 * TTL: 20 minutes (safety net)
 * Max: 1000 guilds (prevent RAM overflow)
 */
const idsCache = new LRUCache({
  max: 1000,
  ttl: 20 * 60 * 1000,
});

/**
 * BATCHING ENGINE STATE
 */
const pendingRequests = new Map(); // guildId -> Promise
let batchQueue = []; // Array of guildIds waiting for fetch
let batchTimer = null; // Timer reference

/**
 * Execute the batch fetch
 */
async function processBatch() {
  const localQueue = [...new Set(batchQueue)]; // Dedup just in case
  batchQueue = [];
  batchTimer = null;

  if (localQueue.length === 0) return;

  try {
    // 1. Bulk Fetch from DB
    const results = await DatabaseService.getManyGuildConfigs(localQueue);

    // 2. Map results by ID for O(1) lookup
    const resultMap = new Map();
    results.forEach((row) => {
      // Store in LRU Cache immediately
      idsCache.set(row.guildId, row);
      resultMap.set(row.guildId, row);
    });

    // 3. Resolve all pending promises
    localQueue.forEach((guildId) => {
      const promiseCallbacks = pendingRequests.get(guildId);
      if (promiseCallbacks) {
        // Did we find it? If not, return empty object (DB miss)
        const data = resultMap.get(guildId) || { ids: {} };
        // If miss, we should still cache the default object
        if (!process.env.DISABLE_EMPTY_CACHE && !resultMap.has(guildId)) {
          idsCache.set(guildId, { ids: {}, config: {}, keywords: {}, reactionRoles: {} });
        }

        promiseCallbacks.resolve(data);
        pendingRequests.delete(guildId);
      }
    });
  } catch (error) {
    console.error('❌ Batch Fetch Failed:', error);
    // Reject all waiting promises so they don't hang forever
    localQueue.forEach((guildId) => {
      const promiseCallbacks = pendingRequests.get(guildId);
      if (promiseCallbacks) {
        promiseCallbacks.reject(error);
        pendingRequests.delete(guildId);
      }
    });
  }
}

/**
 * Get generic config object (internal helper)
 */
async function getCachedConfig(guildId) {
  if (!guildId) return {};

  // 1. Check LRU Cache (Instant RAM hit)
  if (idsCache.has(guildId)) {
    MetricsService.cacheHits.inc();
    return idsCache.get(guildId);
  }

  MetricsService.cacheMisses.inc();

  // 2. Request Collapsing (Join existing promise)
  if (pendingRequests.has(guildId)) {
    return pendingRequests.get(guildId).promise;
  }

  // 3. Queue for Batching
  batchQueue.push(guildId);

  // Create a new promise for this request
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  pendingRequests.set(guildId, { promise, resolve, reject });

  // 4. Schedule Batch (Debounce 50ms)
  if (!batchTimer) {
    batchTimer = setTimeout(processBatch, 50);
  }

  return promise;
}

/**
 * Get guild IDs with Caching
 */
async function getIds(guildId) {
  const data = await getCachedConfig(guildId);
  return data.ids || {};
}

/**
 * Get Full Guild Config with Caching
 */
async function getFullConfig(guildId) {
  return await getCachedConfig(guildId);
}

/**
 * Invalidate cache for a specific guild (called via Redis Pub/Sub)
 */
function invalidate(guildId) {
  idsCache.delete(guildId);
}

/**
 * Clear all cache
 */
function clearAllCache() {
  idsCache.clear();
}

/**
 * Type-safe helper to get specific role/channel from guild
 */
class GuildHelper {
  constructor(guild, ids) {
    this.guild = guild;
    this.ids = ids;
  }

  // --- ROLE GETTERS (Async) ---

  async getAdminRole() {
    return this.ids.adminRoleId ? await this.guild.roles.fetch(this.ids.adminRoleId).catch(() => undefined) : undefined;
  }

  async getModRole() {
    return this.ids.modRoleId ? await this.guild.roles.fetch(this.ids.modRoleId).catch(() => undefined) : undefined;
  }

  async getClanRole1() {
    return this.ids.clanRole1Id ? await this.guild.roles.fetch(this.ids.clanRole1Id).catch(() => undefined) : undefined;
  }

  async getClanRole2() {
    return this.ids.clanRole2Id ? await this.guild.roles.fetch(this.ids.clanRole2Id).catch(() => undefined) : undefined;
  }

  async getClanRole3() {
    return this.ids.clanRole3Id ? await this.guild.roles.fetch(this.ids.clanRole3Id).catch(() => undefined) : undefined;
  }

  async getClanRole4() {
    return this.ids.clanRole4Id ? await this.guild.roles.fetch(this.ids.clanRole4Id).catch(() => undefined) : undefined;
  }

  async getLegendaryRole() {
    return this.ids.legendaryRoleId
      ? await this.guild.roles.fetch(this.ids.legendaryRoleId).catch(() => undefined)
      : undefined;
  }

  async getGroundRole() {
    return this.ids.groundRoleId
      ? await this.guild.roles.fetch(this.ids.groundRoleId).catch(() => undefined)
      : undefined;
  }

  // --- CHANNEL GETTERS (Async) ---
  // Channels might be cached if fetched recently, but safer to fetch if stateless.
  // Actually ChannelManager wasn't strictly limited to 0 in my CustomClient update (I only did Message, Reaction, User, GuildMember, Presence, Thread).
  // But typically getting from cache is fine if it's there. if not, `fetch`.
  // `guild.channels.fetch(id)` is safe.

  async getAdminChannel() {
    return this.ids.adminChannelId
      ? await this.guild.channels.fetch(this.ids.adminChannelId).catch(() => undefined)
      : undefined;
  }

  async getAdminsOnlyChannel() {
    return this.ids.adminsOnlyId
      ? await this.guild.channels.fetch(this.ids.adminsOnlyId).catch(() => undefined)
      : undefined;
  }

  async getModChannel() {
    return this.ids.modChannelId
      ? await this.guild.channels.fetch(this.ids.modChannelId).catch(() => undefined)
      : undefined;
  }

  async getLogsChannel() {
    return this.ids.logsChannelId
      ? await this.guild.channels.fetch(this.ids.logsChannelId).catch(() => undefined)
      : undefined;
  }

  async getTrueLogsChannel() {
    return this.ids.trueLogsChannelId
      ? await this.guild.channels.fetch(this.ids.trueLogsChannelId).catch(() => undefined)
      : undefined;
  }

  async getRoleLogChannel() {
    return this.ids.roleLogChannelId
      ? await this.guild.channels.fetch(this.ids.roleLogChannelId).catch(() => undefined)
      : undefined;
  }

  async getLeaderboardChannel() {
    return this.ids.leaderboardChannelId
      ? await this.guild.channels.fetch(this.ids.leaderboardChannelId).catch(() => undefined)
      : undefined;
  }

  async getClanChannel() {
    return this.ids.clanChannelId
      ? await this.guild.channels.fetch(this.ids.clanChannelId).catch(() => undefined)
      : undefined;
  }

  async getClansChannel() {
    return this.ids.clansChannelId
      ? await this.guild.channels.fetch(this.ids.clansChannelId).catch(() => undefined)
      : undefined;
  }

  async getJailChannel() {
    return this.ids.jailChannelId
      ? await this.guild.channels.fetch(this.ids.jailChannelId).catch(() => undefined)
      : undefined;
  }

  async getMessageSearchChannel() {
    return this.ids.messageSearchChannelId
      ? await this.guild.channels.fetch(this.ids.messageSearchChannelId).catch(() => undefined)
      : undefined;
  }

  // --- PERMISSION HELPERS (Async) ---

  /**
   * Check if user has admin role (Synchronous, Stateless)
   * @param {GuildMember} member
   */
  isAdmin(member) {
    if (!member || !this.ids.adminRoleId) return false;
    return member.roles.cache.has(this.ids.adminRoleId);
  }

  /**
   * Check if user has moderator role (Synchronous, Stateless)
   * @param {GuildMember} member
   */
  isModerator(member) {
    if (!member || !this.ids.modRoleId) return false;
    return member.roles.cache.has(this.ids.modRoleId);
  }

  /**
   * Check if user has admin or mod role (Synchronous, Stateless)
   * @param {GuildMember} member
   */
  isStaff(member) {
    return this.isAdmin(member) || this.isModerator(member);
  }

  /**
   * Check if user is in a clan
   */
  async isInClan(userId) {
    // Optimization: Check DB instead of fetching member (Stateless & Fast)
    const stats = await DatabaseService.getUserStats(this.guild.id, userId);
    return stats && stats.clanId > 0;
  }

  /**
   * Get clan ID for user (1, 2, 3, 4 or null)
   */
  async getClanId(userId) {
    const member = await this.guild.members.fetch(userId).catch(() => null);
    if (!member) return null;

    if (this.ids.clanRole1Id && member.roles.cache.has(this.ids.clanRole1Id)) return 1;
    if (this.ids.clanRole2Id && member.roles.cache.has(this.ids.clanRole2Id)) return 2;
    if (this.ids.clanRole3Id && member.roles.cache.has(this.ids.clanRole3Id)) return 3;
    if (this.ids.clanRole4Id && member.roles.cache.has(this.ids.clanRole4Id)) return 4;

    return null;
  }
}

/**
 * Factory function to create GuildHelper
 */
async function createGuildHelper(guild) {
  const ids = await getIds(guild.id);
  return new GuildHelper(guild, ids);
}

/**
 * Quick access function for common use cases
 */
async function getGuildConfigValue(guildId, key) {
  const ids = await getIds(guildId);
  return ids[key];
}

module.exports = {
  getIds,
  getFullConfig,
  invalidate,
  clearAllCache,
  GuildHelper,
  createGuildHelper,
  getGuildConfigValue,
};
