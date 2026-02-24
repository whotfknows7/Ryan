// src/events/UserUpdate.js
// Handles global username / global avatar changes (not server-specific).
// guildMemberUpdate only fires for SERVER avatar / nickname changes.
// Global profile changes (e.g. user changes their Discord username) fire userUpdate.

const { defaultRedis } = require('../config/redis');
const logger = require('../lib/logger');
const { invalidateGuildLeaderboardCache, LeaderboardUpdateService } = require('../services/LeaderboardUpdateService');

module.exports = {
    name: 'userUpdate',
    once: false,
    async execute(oldUser, newUser) {
        const userId = newUser.id;
        logger.info(`[UserUpdate] Event received for ${userId} | avatarChanged=${oldUser.avatar !== newUser.avatar} usernameChanged=${oldUser.username !== newUser.username}`);

        try {
            // Detect meaningful changes
            const avatarChanged = oldUser.avatar !== newUser.avatar;
            const usernameChanged = oldUser.username !== newUser.username;
            const globalNameChanged = oldUser.globalName !== newUser.globalName;

            if (!avatarChanged && !usernameChanged && !globalNameChanged) {
                logger.debug(`[UserUpdate] No relevant profile changes for ${userId}. skipping.`);
                return;
            }

            // Scan all guilds' member caches for this user
            // We use SCAN so we don't block on a large keyspace
            let cursor = '0';
            const affectedGuilds = [];

            do {
                const [nextCursor, keys] = await defaultRedis.scan(cursor, 'MATCH', 'member_cache:*', 'COUNT', 100);
                cursor = nextCursor;
                for (const key of keys) {
                    const exists = await defaultRedis.hexists(key, userId);
                    if (exists) {
                        affectedGuilds.push(key);
                    }
                }
            } while (cursor !== '0');

            if (affectedGuilds.length === 0) {
                logger.debug(`[UserUpdate] User ${userId} not found in any member_cache hashes. skipping.`);
                return;
            }

            logger.info(`[UserUpdate] User ${userId} changed profile. Updating ${affectedGuilds.length} guild caches.`);

            for (const cacheKey of affectedGuilds) {
                const guildId = cacheKey.replace('member_cache:', '');
                const cached = await defaultRedis.hget(cacheKey, userId);
                if (!cached) continue;

                const profile = JSON.parse(cached);

                // Only update fields that changed
                if (avatarChanged) {
                    // Global avatar URL — fall back to default Discord avatar
                    profile.avatarUrl = newUser.displayAvatarURL({ extension: 'png', size: 128 }) || null;
                }
                if (usernameChanged || globalNameChanged) {
                    // globalName is the "display name" for the new username system
                    profile.displayName = newUser.globalName || newUser.username;
                }

                await defaultRedis.hset(cacheKey, userId, JSON.stringify(profile));
                logger.debug(`[UserUpdate] Updated cache for ${userId} in ${cacheKey}`);

                // Force next leaderboard render to pick up new data
                invalidateGuildLeaderboardCache(guildId);
            }

            // Trigger live leaderboard updates for all affected guilds
            // We need the client — grab it from the newUser's client ref
            if (newUser.client && affectedGuilds.length > 0) {
                logger.debug(`[UserUpdate] Triggering live updates for ${affectedGuilds.length} guilds...`);
                LeaderboardUpdateService.updateLiveLeaderboard(newUser.client).catch((err) => {
                    logger.error(`[UserUpdate] Failed to trigger live update: ${err.message}`);
                });
            }
        } catch (e) {
            logger.error(`[UserUpdate] Error: ${e.message}`, e);
        }
    },
};
