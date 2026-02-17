// src/lib/cooldowns.js

const { defaultRedis } = require('../config/redis');

// =========================================
// COMMAND COOLDOWNS — Redis (SET NX)
// =========================================

/**
 * Check if a user is on cooldown for a specific command
 * @param {string} userId - The user's ID
 * @param {object} command - The command object with data.name and optional cooldown property
 * @returns {Promise<object>} - { onCooldown: boolean, timeLeft: number }
 */
async function checkCooldown(userId, command) {
  const defaultCooldown = 3; // Default cooldown in seconds
  const cooldownSeconds = command.cooldown ?? defaultCooldown;
  const commandName = command.data.name;

  // Redis Key: cmd_cd:userId:commandName
  const key = `cmd_cd:${userId}:${commandName}`;

  try {
    // Attempt to set key only if it doesn't exist (NX) with expiry (EX)
    const result = await defaultRedis.set(key, '1', 'EX', cooldownSeconds, 'NX');

    if (result === 'OK') {
      // Key set successfully -> Not on cooldown
      return { onCooldown: false, timeLeft: 0 };
    } else {
      // Key already exists -> On cooldown
      const ttl = await defaultRedis.ttl(key);
      return { onCooldown: true, timeLeft: ttl > 0 ? ttl : 0.1 };
    }
  } catch (error) {
    console.error(`Redis error in checkCooldown for ${commandName}:`, error);
    // Fail open (allow command) if Redis is down, or fail closed?
    // User requested "100% synchronized", implying strictness.
    // But blocking all commands if Redis blips is bad.
    // Let's Log and Allow for now to prevent total bot outage.
    return { onCooldown: false, timeLeft: 0 };
  }
}

/**
 * Clear a user's cooldown for a specific command (for admin override)
 * @param {string} userId - The user's ID
 * @param {string} commandName - The command name
 */
async function clearCooldown(userId, commandName) {
  try {
    const key = `cmd_cd:${userId}:${commandName}`;
    await defaultRedis.del(key);
  } catch (error) {
    console.error('Error clearing cooldown:', error);
  }
}

/**
 * Clear all cooldowns for a user (for admin override)
 * Uses SCAN to find all keys for this user
 */
async function clearAllCooldowns(userId) {
  const matchPattern = `cmd_cd:${userId}:*`;
  let cursor = '0';

  try {
    do {
      const [newCursor, keys] = await defaultRedis.scan(cursor, 'MATCH', matchPattern, 'COUNT', 100);
      cursor = newCursor;

      if (keys.length > 0) {
        await defaultRedis.del(...keys);
      }
    } while (cursor !== '0');
  } catch (error) {
    console.error('Error clearing all cooldowns:', error);
  }
}

module.exports = {
  checkCooldown,
  clearCooldown,
  clearAllCooldowns,
};
