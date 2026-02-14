const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

const STORAGE_PATH = path.join(__dirname, '../events/CurrentLbs.json');
const DELETE_AFTER_MS = 5 * 60 * 1000; // 5 minutes

class LeaderboardCleanupService {

    static loadData() {
        try {
            if (!fs.existsSync(STORAGE_PATH)) {
                fs.writeFileSync(STORAGE_PATH, '[]');
                return [];
            }
            const data = fs.readFileSync(STORAGE_PATH, 'utf8');
            return JSON.parse(data || '[]');
        } catch (error) {
            logger.error('Error loading LeaderboardCleanupService data:', error);
            return [];
        }
    }

    static saveData(data) {
        try {
            fs.writeFileSync(STORAGE_PATH, JSON.stringify(data, null, 2));
        } catch (error) {
            logger.error('Error saving LeaderboardCleanupService data:', error);
        }
    }

    /**
     * Tracks a leaderboard message for later deletion.
     * @param {string} guildId 
     * @param {string} channelId 
     * @param {string} messageId 
     * @param {string} messageUrl 
     */
    static async addLeaderboard(guildId, channelId, messageId, messageUrl) {
        const data = this.loadData();

        data.push({
            guildId,
            channelId,
            messageId,
            messageUrl,
            expiresAt: Date.now() + DELETE_AFTER_MS
        });

        this.saveData(data);
        logger.info(`Tracking leaderboard message ${messageId} for deletion in 5 mins.`);
    }

    /**
     * Checks for expired leaderboards and deletes them.
     * @param {Client} client 
     */
    static async cleanupExpiredLeaderboards(client) {
        const data = this.loadData();
        if (data.length === 0) return;

        const now = Date.now();
        const activeLeaderboards = [];
        let changed = false;

        for (const lb of data) {
            if (now >= lb.expiresAt) {
                // Expired - Delete Message
                try {
                    const guild = client.guilds.cache.get(lb.guildId);
                    if (guild) {
                        const channel = guild.channels.cache.get(lb.channelId);
                        if (channel) {
                            const msg = await channel.messages.fetch(lb.messageId).catch(() => null);
                            if (msg) {
                                await msg.delete();
                                logger.info(`Deleted expired leaderboard message ${lb.messageId}`);
                            } else {
                                logger.debug(`Expired leaderboard message ${lb.messageId} already gone.`);
                            }
                        }
                    }
                } catch (error) {
                    logger.error(`Failed to delete expired leaderboard ${lb.messageId}:`, error);
                }
                changed = true; // Mark as changed since we are removing this entry (not adding to activeLeaderboards)
            } else {
                // Not expired yet - Keep it
                activeLeaderboards.push(lb);
            }
        }

        if (changed) {
            this.saveData(activeLeaderboards);
        }
    }
}

module.exports = { LeaderboardCleanupService };
