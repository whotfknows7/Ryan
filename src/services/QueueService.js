const { Queue, Worker } = require('bullmq');
const { redisConfig } = require('../config/redis');
const logger = require('../lib/logger');

// Services needed for jobs
const { DatabaseService } = require('./DatabaseService');
const { PunishmentService } = require('./PunishmentService');
const { ResetService } = require('./ResetService');
const { LeaderboardUpdateService } = require('./LeaderboardUpdateService');
const { LeaderboardCleanupService } = require('./LeaderboardCleanupService');
const { WeeklyRoleService } = require('./WeeklyRoleService');
const { cleanExpiredResetRoles } = require('../commands/admin/ResetRoleCommands');

class QueueService {
    constructor() {
        this.queues = {};
        this.workers = {};
    }

    initialize(client) {
        this.client = client;

        // 1. Create Queues
        this.queues.cron = new Queue('cron-jobs', { connection: redisConfig });

        // 2. Define Workers
        this.workers.cron = new Worker('cron-jobs', async (job) => {
            logger.info(`⚙️ Processing job: ${job.name}`);
            try {
                switch (job.name) {
                    case 'db-heartbeat':
                        await DatabaseService.checkDatabaseIntegrity();
                        break;
                    case 'punishment-check':
                        await PunishmentService.checkExpiredPunishments(this.client);
                        break;
                    case 'reset-cycle-check':
                        await this.runPerGuild((guildId) => ResetService.checkResetCycle(this.client, guildId));
                        break;
                    case 'reset-role-expiry':
                        await this.runPerGuild((guildId) => cleanExpiredResetRoles(guildId));
                        break;
                    case 'leaderboard-update':
                        await LeaderboardUpdateService.updateLiveLeaderboard(this.client);
                        break;
                    case 'leaderboard-cleanup':
                        await LeaderboardCleanupService.cleanupExpiredLeaderboards(this.client);
                        break;
                    case 'weekly-role-check':
                        await this.runPerGuild((guildId) => WeeklyRoleService.checkWeeklyRole(this.client, guildId));
                        break;
                    default:
                        logger.warn(`⚠️ Unknown job name: ${job.name}`);
                }
            } catch (error) {
                logger.error(`❌ Job '${job.name}' failed:`, error);
                throw error;
            }
        }, { connection: redisConfig });

        this.workers.cron.on('error', (err) => logger.error('❌ Cron Worker Error:', err));

        logger.info('✅ QueueService initialized. Workers started.');

        // 3. Schedule Recurring Jobs
        this.scheduleJobs();
    }

    async runPerGuild(taskFn) {
        if (!this.client.guilds.cache.size) return;
        const guilds = Array.from(this.client.guilds.cache.keys());
        const results = await Promise.allSettled(guilds.map((guildId) => taskFn(guildId)));
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                logger.error(`Task failed for guild ${guilds[index]}:`, result.reason);
            }
        });
    }

    async scheduleJobs() {
        // Helper to add repeatable job
        const addJob = async (name, pattern, everyMs = null) => {
            const options = { repeat: {} };
            if (everyMs) options.repeat.every = everyMs;
            else options.repeat.pattern = pattern;

            // Remove old repeatable jobs with same name to avoid duplicates on restart/change
            // (This is a simplified approach; standard BullMQ pattern is to just add)
            await this.queues.cron.add(name, {}, options);
            logger.info(`📅 Scheduled job '${name}'`);
        };

        // --- Schedule Definition ---

        // DB Heartbeat - every 5 mins
        await addJob('db-heartbeat', '*/5 * * * *');

        // Punishment Checker - every 1 min
        await addJob('punishment-check', '* * * * *');

        // Reset Cycle Checker - every 1 min
        await addJob('reset-cycle-check', '* * * * *');

        // Reset Role Expiry - every 1 min
        await addJob('reset-role-expiry', '* * * * *');

        // Leaderboard Updater - every 20 seconds
        await addJob('leaderboard-update', null, 20000); // 20000ms = 20s

        // Leaderboard Cleanup - every 1 min
        await addJob('leaderboard-cleanup', '* * * * *');

        // Weekly Role Check - every 5 mins
        await addJob('weekly-role-check', '*/5 * * * *');
    }

    async shutdown() {
        logger.info('🛑 Shutting down QueueService...');
        await Promise.all(Object.values(this.queues).map(q => q.close()));
        await Promise.all(Object.values(this.workers).map(w => w.close()));
        logger.info('✅ QueueService shutdown complete.');
    }
}

module.exports = new QueueService();
