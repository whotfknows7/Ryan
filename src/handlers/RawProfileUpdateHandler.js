// src/handlers/RawProfileUpdateHandler.js
const { defaultRedis } = require('../config/redis');
const logger = require('../lib/logger');
const { LeaderboardUpdateService, invalidateGuildLeaderboardCache } = require('../services/LeaderboardUpdateService');

class RawProfileUpdateHandler {
    /**
     * Handles raw websocket packets to bypass discord.js caching limitations on member updates
     * @param {import('discord.js').Client} client 
     * @param {Object} packet 
     */
    static async handle(client, packet) {
        // We only care about GUILD_MEMBER_UPDATE
        if (packet.t !== 'GUILD_MEMBER_UPDATE') return;

        const data = packet.d;
        if (!data || !data.user || !data.user.id || !data.guild_id) return;

        try {
            const guildId = data.guild_id;
            const userId = data.user.id;
            const cacheKey = `member_cache:${guildId}`;

            // Check if user is in our top 10 radar mapping
            const rawCachedProfile = await defaultRedis.hget(cacheKey, userId);
            if (!rawCachedProfile) return; // Ignore updates for users not on the leaderboard cache

            const cachedProfile = JSON.parse(rawCachedProfile);

            // Determine incoming display name (Nick > Global Name > Username)
            let newDisplayName = data.nick;
            if (!newDisplayName) {
                newDisplayName = data.user.global_name || data.user.username;
            }

            // Determine incoming avatar (Guild Avatar > Global Avatar > Fallback null)
            let newAvatarUrl = null;
            if (data.avatar) {
                // Guild-specific avatar
                newAvatarUrl = `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${data.avatar}.png?size=256`;
            } else if (data.user.avatar) {
                // Global avatar
                newAvatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${data.user.avatar}.png?size=256`;
            }

            // Skip if no changes detected
            if (cachedProfile.displayName === newDisplayName && cachedProfile.avatarUrl === newAvatarUrl) {
                return;
            }

            logger.info(`[RawProfileUpdate] Detected change for ${userId} in ${guildId}. Nick: ${cachedProfile.displayName}->${newDisplayName}`);

            // Update the profile in Redis
            const updatedProfile = {
                displayName: newDisplayName,
                avatarUrl: newAvatarUrl
            };
            await defaultRedis.hset(cacheKey, userId, JSON.stringify(updatedProfile));

            // Force a leaderboard re-render for this guild using the fresh cache
            invalidateGuildLeaderboardCache(guildId);

            // Trigger the live visual update asynchronously
            LeaderboardUpdateService.updateLiveLeaderboard(client).catch(err => {
                logger.error(`[RawProfileUpdate] Failed to trigger live update for ${guildId}: ${err.message}`);
            });

        } catch (error) {
            logger.error(`[RawProfileUpdate] Error processing raw member update: ${error.message}`);
        }
    }
}

module.exports = RawProfileUpdateHandler;
