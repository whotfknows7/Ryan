// ============================================================================
// GuildIdsHelper.js - Convenient helper to access guild IDs
// ============================================================================

const { DatabaseService } = require('../services/DatabaseService');

/**
 * Cache for guild IDs to reduce database queries
 * Cache expires after 5 minutes
 */
const idsCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get guild IDs with caching
 */
async function getIds(guildId) {
  // Check cache first
  const cached = idsCache.get(guildId);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.ids;
  }

  // Fetch from database
  const ids = await DatabaseService.getGuildIds(guildId);

  // Update cache
  idsCache.set(guildId, {
    ids,
    timestamp: Date.now(),
  });

  return ids;
}

/**
 * Clear cache for a specific guild (call this after updating config)
 */
function clearCache(guildId) {
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
    // Optimization: Check DB instead of fetching member?
    // User instruction: "replace the cache check role calls with API calls"
    // Fetching member IS an API call. Identifying clan via DB is safer/faster for stateless.
    // "In resetservice... we will simply check in the database".
    // Let's use DB here too if possible?
    // But `GuildHelper` is often used for logic that *might* differ from DB (e.g. permission checks).
    // For 'isInClan', checking roles or DB is similar if sync is working.
    // Let's stick to checking roles via member fetch for consistency with other methods here.
    const member = await this.guild.members.fetch(userId).catch(() => null);
    if (!member) return false;

    const ids = [this.ids.clanRole1Id, this.ids.clanRole2Id, this.ids.clanRole3Id, this.ids.clanRole4Id];
    return ids.some((id) => id && member.roles.cache.has(id));
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
  clearCache,
  clearAllCache,
  GuildHelper,
  createGuildHelper,
  getGuildConfigValue,
};
