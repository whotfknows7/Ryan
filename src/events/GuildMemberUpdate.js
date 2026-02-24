// src/events/GuildMemberUpdate.js

const { defaultRedis } = require('../config/redis');
const logger = require('../lib/logger');
const { invalidateGuildLeaderboardCache, LeaderboardUpdateService } = require('../services/LeaderboardUpdateService');

module.exports = {
  name: 'guildMemberUpdate',
  once: false,
  async execute(oldMember, newMember) {
    const userId = newMember?.user?.id || newMember?.id;
    const guildId = newMember?.guild?.id;
    logger.info(`[MemberUpdate] Event received for ${userId} in ${guildId} | partial: ${newMember.partial}`);

    try {
      // Fetch full objects if partial (required when Partials.GuildMember is set)
      if (newMember.partial) {
        logger.debug(`[MemberUpdate] Fetching partial member for ${userId}...`);
        newMember = await newMember.fetch().catch((e) => {
          logger.error(`[MemberUpdate] Failed to fetch partial member ${userId}: ${e.message}`);
          return null;
        });
        if (!newMember) return;
      }

      if (oldMember.partial) {
        oldMember = await oldMember.fetch().catch(() => oldMember);
      }

      // Compare avatar hash (not full URL) and displayName to avoid false-positives
      const avatarChanged = oldMember.avatar !== newMember.avatar;
      const displayNameChanged = oldMember.displayName !== newMember.displayName;

      logger.debug(`[MemberUpdate] Changes for ${userId}: avatarChanged=${avatarChanged} displayNameChanged=${displayNameChanged}`);

      if (!avatarChanged && !displayNameChanged) {
        logger.debug(`[MemberUpdate] No relevant changes for ${userId}. skipping.`);
        return;
      }

      const cacheKey = `member_cache:${guildId}`;

      // Only update if this user is currently in the top-10 cache
      const exists = await defaultRedis.hexists(cacheKey, userId);
      if (!exists) {
        logger.debug(`[MemberUpdate] User ${userId} not in top-10 cache for ${guildId}. skipping cache update.`);
        return;
      }

      const updatedProfile = {
        displayName: newMember.displayName,
        avatarUrl: newMember.displayAvatarURL({ extension: 'png', size: 128 }) || null,
      };

      await defaultRedis.hset(cacheKey, userId, JSON.stringify(updatedProfile));
      logger.info(`[MemberUpdate] Updated cache for ${userId} in ${guildId} | avatar=${avatarChanged} name=${displayNameChanged}`);

      // Force leaderboard to regenerate with fresh data
      invalidateGuildLeaderboardCache(guildId);
      logger.debug(`[MemberUpdate] Invalidated leaderboard cache for ${guildId}. Triggering live update...`);
      LeaderboardUpdateService.updateLiveLeaderboard(newMember.client).catch((err) => {
        logger.error(`[MemberUpdate] Failed to trigger live update: ${err.message}`);
      });
    } catch (e) {
      logger.error(`[GuildMemberUpdate] Error: ${e.message}`, e);
    }
  },
};
