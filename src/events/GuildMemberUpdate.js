// src/events/GuildMemberUpdate.js

const { defaultRedis } = require('../config/redis');
const logger = require('../lib/logger');
const { LeaderboardUpdateService, invalidateGuildLeaderboardCache } = require('../services/LeaderboardUpdateService');

module.exports = {
  name: 'guildMemberUpdate',
  once: false,
  async execute(oldMember, newMember) {
    // Only care if display name or avatar changed
    if (oldMember.displayName === newMember.displayName && oldMember.avatar === newMember.avatar) {
      return;
    }

    try {
      const guildId = newMember.guild.id;
      const userId = newMember.user.id;
      const cacheKey = `member_cache:${guildId}`;

      // Check if the user exists in the hash cache
      const exists = await defaultRedis.hexists(cacheKey, userId);

      if (exists) {
        // User is in the cache, update their profile
        const updatedProfile = {
          displayName: newMember.displayName,
          avatarUrl: newMember.displayAvatarURL({ extension: 'png' }) || null,
        };

        // Save the updated profile back to the Redis hash
        await defaultRedis.hset(cacheKey, userId, JSON.stringify(updatedProfile));
        logger.debug(`[LeaderboardCache] Updated profile for ${userId} in ${guildId} hash cache.`);

        // Force a leaderboard update for this guild
        invalidateGuildLeaderboardCache(guildId);

        // Trigger leaderboard live update
        LeaderboardUpdateService.updateLiveLeaderboard(newMember.client).catch(err => {
          logger.error(`[GuildMemberUpdate] Failed to trigger live update: ${err.message}`);
        });
      }
    } catch (e) {
      logger.error(`[GuildMemberUpdate] Failed to update leaderboard cache: ${e.message}`);
    }
  },
};
