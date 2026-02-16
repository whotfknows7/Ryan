const Redis = require('ioredis');
const logger = require('../lib/logger');

// Unix Domain Socket path (set REDIS_SOCKET="none" to force TCP fallback)
const REDIS_SOCKET = process.env.REDIS_SOCKET || '/run/redis/redis-server.sock';
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || null;

// Prefer UDS for lower latency; fall back to TCP if explicitly disabled
const useSocket = REDIS_SOCKET && REDIS_SOCKET !== 'none';

const redisConfig = useSocket
  ? {
    path: REDIS_SOCKET,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
  }
  : {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: REDIS_PASSWORD,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };

// Use this connection for standard bot operations (cache, rate limits)
const defaultRedis = new Redis(redisConfig);

const connLabel = useSocket ? `socket ${REDIS_SOCKET}` : `${redisConfig.host}:${redisConfig.port}`;

defaultRedis.on('connect', () => {
  logger.info(`✅ Redis connected via ${connLabel}`);
});

defaultRedis.on('error', (err) => {
  logger.error('❌ Redis Connection Error:', err);
});

module.exports = {
  defaultRedis,
  redisConfig,
};

