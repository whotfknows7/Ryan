// src/lib/cooldowns.js

const { RateLimiterMemory } = require('rate-limiter-flexible');



// =========================================
// COMMAND COOLDOWNS — rate-limiter-flexible
// =========================================

// Cache of RateLimiterMemory instances per command name
const commandLimiters = new Map();

/**
 * Gets or creates a rate limiter for a specific command
 * @param {string} commandName - The command name
 * @param {number} cooldownSeconds - Cooldown duration in seconds
 * @returns {RateLimiterMemory}
 */
function getLimiter(commandName, cooldownSeconds) {
  if (!commandLimiters.has(commandName)) {
    commandLimiters.set(
      commandName,
      new RateLimiterMemory({
        points: 1, // 1 use allowed
        duration: cooldownSeconds, // per this many seconds
        keyPrefix: commandName,
      })
    );
  }
  return commandLimiters.get(commandName);
}

/**
 * Check if a user is on cooldown for a specific command
 * @param {string} userId - The user's ID
 * @param {object} command - The command object with data.name and optional cooldown property
 * @returns {Promise<object>} - { onCooldown: boolean, timeLeft: number }
 */
async function checkCooldown(userId, command) {
  const defaultCooldown = 3; // Default cooldown in seconds
  const cooldownSeconds = command.cooldown ?? defaultCooldown;
  const limiter = getLimiter(command.data.name, cooldownSeconds);

  try {
    await limiter.consume(userId);
    return { onCooldown: false, timeLeft: 0 };
  } catch (rateLimiterRes) {
    // rateLimiterRes is a RateLimiterRes object when rejected
    const timeLeft = rateLimiterRes.msBeforeNext / 1000;
    return { onCooldown: true, timeLeft };
  }
}

/**
 * Clear a user's cooldown for a specific command (for admin override)
 * @param {string} userId - The user's ID
 * @param {string} commandName - The command name
 */
async function clearCooldown(userId, commandName) {
  if (commandLimiters.has(commandName)) {
    const limiter = commandLimiters.get(commandName);
    await limiter.delete(userId);
  }
}

/**
 * Clear all cooldowns for a user (for admin override)
 * @param {string} userId - The user's ID
 */
async function clearAllCooldowns(userId) {
  for (const limiter of commandLimiters.values()) {
    await limiter.delete(userId);
  }
}

module.exports = {


  // Command cooldown exports
  checkCooldown,
  clearCooldown,
  clearAllCooldowns,
};
