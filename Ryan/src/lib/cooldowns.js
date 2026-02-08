// src/lib/cooldowns.js

const { Collection } = require('discord.js');

// Role announcement skip tracking
const roleAnnouncementSkips = new Map();

// Command cooldown tracking
const cooldowns = new Collection();

// =========================================
// ROLE ANNOUNCEMENT SKIP FUNCTIONS
// =========================================

function setRoleSkip(memberId) {
  const timestamp = Date.now();
  roleAnnouncementSkips.set(memberId, timestamp);
  return timestamp;
}

function checkRoleSkip(memberId, windowMs = 20000) {
  const skipTime = roleAnnouncementSkips.get(memberId);
  
  if (!skipTime) return null;
  
  const elapsed = Date.now() - skipTime;
  
  if (elapsed < windowMs) {
    return windowMs - elapsed; // Time remaining
  }
  
  // Skip window expired, cleanup
  roleAnnouncementSkips.delete(memberId);
  return null;
}

function clearRoleSkip(memberId) {
  roleAnnouncementSkips.delete(memberId);
}

function getActiveSkips() {
  const now = Date.now();
  return Array.from(roleAnnouncementSkips.entries()).map(([memberId, timestamp]) => ({
    memberId,
    timestamp,
    age: now - timestamp
  }));
}

// =========================================
// COMMAND COOLDOWN FUNCTIONS
// =========================================

/**
 * Check if a user is on cooldown for a specific command
 * @param {string} userId - The user's ID
 * @param {object} command - The command object with data.name and optional cooldown property
 * @returns {object} - { onCooldown: boolean, timeLeft: number }
 */
function checkCooldown(userId, command) {
  const defaultCooldown = 3; // Default cooldown in seconds
  const cooldownAmount = (command.cooldown ?? defaultCooldown) * 1000;
  
  if (!cooldowns.has(command.data.name)) {
    cooldowns.set(command.data.name, new Collection());
  }
  
  const now = Date.now();
  const timestamps = cooldowns.get(command.data.name);
  
  if (timestamps.has(userId)) {
    const expirationTime = timestamps.get(userId) + cooldownAmount;
    
    if (now < expirationTime) {
      const timeLeft = (expirationTime - now) / 1000;
      return { onCooldown: true, timeLeft };
    }
  }
  
  // Set the cooldown timestamp
  timestamps.set(userId, now);
  
  // Auto-cleanup after cooldown expires
  setTimeout(() => timestamps.delete(userId), cooldownAmount);
  
  return { onCooldown: false, timeLeft: 0 };
}

/**
 * Clear a user's cooldown for a specific command (for admin override)
 * @param {string} userId - The user's ID
 * @param {string} commandName - The command name
 */
function clearCooldown(userId, commandName) {s.has(commandName)) {
    const timestamps = cooldowns.get(commandName);
    timestamps.delete(userId);
  }
}

/**
 * Clear all cooldowns for a user (for admin override)
 * @param {string} userId - The user's ID
 */
function clearAllCooldowns(userId) {
  for (const timestamps of cooldowns.values()) {
    timestamps.delete(userId);
  }
}

module.exports = {
  // Role announcement skip exports
  roleAnnouncementSkips,
  setRoleSkip,
  checkRoleSkip,
  clearRoleSkip,
  getActiveSkips,
  
  // Command cooldown exports
  checkCooldown,
  clearCooldown,
  clearAllCooldowns
};