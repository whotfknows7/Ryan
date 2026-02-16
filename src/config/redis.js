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

// Use this connection for standard bot operations (cache, rate limits)
const defaultRedis = new Redis(redisConfig);

defaultRedis.on('connect', () => {
  logger.info(`✅ Redis connected to ${REDIS_HOST}:${REDIS_PORT}`);
});

defaultRedis.on('error', (err) => {
  logger.error('❌ Redis Connection Error:', err);
});

module.exports = {
  defaultRedis,
  redisConfig,
};
