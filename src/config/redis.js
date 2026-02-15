const Redis = require('ioredis');
const logger = require('../lib/logger');

// Retrieve Redis config from environment or defaults
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || null;

const redisConfig = {
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
};

// Create a singleton connection
const redis = new Redis(redisConfig);

redis.on('connect', () => {
    logger.info(`✅ Redis connected to ${REDIS_HOST}:${REDIS_PORT}`);
});

redis.on('error', (err) => {
    logger.error('❌ Redis Connection Error:', err);
});

module.exports = {
    redis,
    redisConfig,
};
