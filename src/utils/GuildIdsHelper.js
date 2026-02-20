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
 * Utility to check roles safely (handles both Discord.js managers and raw API arrays)
 */
function hasRole(member, roleId) {
  if (!member || !roleId) return false;
  const roles = member.roles;
  if (Array.isArray(roles)) return roles.includes(roleId);
  return roles.cache?.has(roleId) || false;
}

/**
 * Utility to check permissions safely (handles both Discord.js managers and raw API bitfields)
 */
function hasPermission(member, permission) {
  if (!member) return false;
  const permissions = member.permissions;

  // Discord.js PermissionsManager
  if (permissions && typeof permissions.has === 'function') {
    return permissions.has(permission);
  }

  // Raw API Bitfield String
  if (typeof permissions === 'string' || typeof permissions === 'bigint') {
    const bitfield = BigInt(permissions);
    const ADMINISTRATOR = 8n;
    if (permission === 'Administrator') return (bitfield & ADMINISTRATOR) === ADMINISTRATOR;

    // Add other permissions if needed, for now focusing on Administrator as requested
  }

  return false;
}

/**
 * Type-safe helper to get specific role/channel from guild
 */
class GuildHelper {
  constructor(guild, ids) {
    this.guild = guild;
    this.ids = ids;
    this._channelMemo = new Map();
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

  async _getChannel(channelId) {
    if (!channelId) return undefined;

    if (this._channelMemo.has(channelId)) {
      return this._channelMemo.get(channelId);
    }

    let channel = this.guild.channels.cache.get(channelId);
    if (!channel) {
      channel = await this.guild.channels.fetch(channelId).catch(() => undefined);
    }

    this._channelMemo.set(channelId, channel);
    return channel;
  }

  async getAdminChannel() {
    return this._getChannel(this.ids.adminChannelId);
  }
  async getAdminsOnlyChannel() {
    return this._getChannel(this.ids.adminsOnlyId);
  }
  async getModChannel() {
    return this._getChannel(this.ids.modChannelId);
  }
  async getLogsChannel() {
    return this._getChannel(this.ids.logsChannelId);
  }
  async getTrueLogsChannel() {
    return this._getChannel(this.ids.trueLogsChannelId);
  }
  async getRoleLogChannel() {
    return this._getChannel(this.ids.roleLogChannelId);
  }
  async getLeaderboardChannel() {
    return this._getChannel(this.ids.leaderboardChannelId);
  }
  async getClanChannel() {
    return this._getChannel(this.ids.clanChannelId);
  }
  async getClansChannel() {
    return this._getChannel(this.ids.clansChannelId);
  }
  async getJailChannel() {
    return this._getChannel(this.ids.jailChannelId);
  }
  async getMessageSearchChannel() {
    return this._getChannel(this.ids.messageSearchChannelId);
  }

  // --- PERMISSION HELPERS (Async) ---

  isAdmin(member) {
    if (!member || !this.ids.adminRoleId) return false;
    return hasRole(member, this.ids.adminRoleId);
  }

  isModerator(member) {
    if (!member || !this.ids.modRoleId) return false;
    return hasRole(member, this.ids.modRoleId);
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

    if (this.ids.clanRole1Id && hasRole(member, this.ids.clanRole1Id)) return 1;
    if (this.ids.clanRole2Id && hasRole(member, this.ids.clanRole2Id)) return 2;
    if (this.ids.clanRole3Id && hasRole(member, this.ids.clanRole3Id)) return 3;
    if (this.ids.clanRole4Id && hasRole(member, this.ids.clanRole4Id)) return 4;

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
  hasRole,
  hasPermission,
};
