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
    timestamp: Date.now()
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
  
  // --- ROLE GETTERS ---
  
  get adminRole() {
    return this.ids.adminRoleId ?
      this.guild.roles.cache.get(this.ids.adminRoleId) :
      undefined;
  }
  
  get modRole() {
    return this.ids.modRoleId ?
      this.guild.roles.cache.get(this.ids.modRoleId) :
      undefined;
  }
  
  get clanRole1() {
    return this.ids.clanRole1Id ?
      this.guild.roles.cache.get(this.ids.clanRole1Id) :
      undefined;
  }
  
  get clanRole2() {
    return this.ids.clanRole2Id ?
      this.guild.roles.cache.get(this.ids.clanRole2Id) :
      undefined;
  }
  
  get clanRole3() {
    return this.ids.clanRole3Id ?
      this.guild.roles.cache.get(this.ids.clanRole3Id) :
      undefined;
  }
  
  get clanRole4() {
    return this.ids.clanRole4Id ?
      this.guild.roles.cache.get(this.ids.clanRole4Id) :
      undefined;
  }
  
  get legendaryRole() {
    return this.ids.legendaryRoleId ?
      this.guild.roles.cache.get(this.ids.legendaryRoleId) :
      undefined;
  }
  
  get groundRole() {
    return this.ids.groundRoleId ?
      this.guild.roles.cache.get(this.ids.groundRoleId) :
      undefined;
  }
  
  // --- CHANNEL GETTERS ---
  
  get adminChannel() {
    return this.ids.adminChannelId ?
      this.guild.channels.cache.get(this.ids.adminChannelId) :
      undefined;
  }
  
  get adminsOnlyChannel() {
    return this.ids.adminsOnlyId ?
      this.guild.channels.cache.get(this.ids.adminsOnlyId) :
      undefined;
  }
  
  get modChannel() {
    return this.ids.modChannelId ?
      this.guild.channels.cache.get(this.ids.modChannelId) :
      undefined;
  }
  
  get logsChannel() {
    return this.ids.logsChannelId ?
      this.guild.channels.cache.get(this.ids.logsChannelId) :
      undefined;
  }
  
  get trueLogsChannel() {
    return this.ids.trueLogsChannelId ?
      this.guild.channels.cache.get(this.ids.trueLogsChannelId) :
      undefined;
  }
  
  get roleLogChannel() {
    return this.ids.roleLogChannelId ?
      this.guild.channels.cache.get(this.ids.roleLogChannelId) :
      undefined;
  }
  
  get leaderboardChannel() {
    return this.ids.leaderboardChannelId ?
      this.guild.channels.cache.get(this.ids.leaderboardChannelId) :
      undefined;
  }
  
  get clanChannel() {
    return this.ids.clanChannelId ?
      this.guild.channels.cache.get(this.ids.clanChannelId) :
      undefined;
  }
  
  get clansChannel() {
    return this.ids.clansChannelId ?
      this.guild.channels.cache.get(this.ids.clansChannelId) :
      undefined;
  }
  
  get jailChannel() {
    return this.ids.jailChannelId ?
      this.guild.channels.cache.get(this.ids.jailChannelId) :
      undefined;
  }
  
  get messageSearchChannel() {
    return this.ids.messageSearchChannelId ?
      this.guild.channels.cache.get(this.ids.messageSearchChannelId) :
      undefined;
  }
  
  // --- PERMISSION HELPERS ---
  
  /**
   * Check if user has admin role
   */
  isAdmin(userId) {
    const member = this.guild.members.cache.get(userId);
    if (!member || !this.ids.adminRoleId) return false;
    return member.roles.cache.has(this.ids.adminRoleId);
  }
  
  /**
   * Check if user has moderator role
   */
  isModerator(userId) {
    const member = this.guild.members.cache.get(userId);
    if (!member || !this.ids.modRoleId) return false;
    return member.roles.cache.has(this.ids.modRoleId);
  }
  
  /**
   * Check if user has admin or mod role
   */
  isStaff(userId) {
    return this.isAdmin(userId) || this.isModerator(userId);
  }
  
  /**
   * Check if user is in a clan
   */
  isInClan(userId) {
    const member = this.guild.members.cache.get(userId);
    if (!member) return false;
    
    const ids = [
      this.ids.clanRole1Id,
      this.ids.clanRole2Id,
      this.ids.clanRole3Id,
      this.ids.clanRole4Id
    ];
    return ids.some(id => id && member.roles.cache.has(id));
  }
  
  /**
   * Get clan ID for user (1, 2, 3, 4 or null)
   */
  getClanId(userId) {
    const member = this.guild.members.cache.get(userId);
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
  getGuildConfigValue
};