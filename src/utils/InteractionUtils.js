// src/utils/InteractionUtils.js

const logger = require('../lib/logger');

/**
 * Utility functions for safely encoding and decoding Discord customId values
 */

/**
 * Encodes data into a Discord-safe customId string
 * Format: prefix:base64EncodedJSON
 */
function encodeCustomId(prefix, data) {
  const json = JSON.stringify(data);
  const encoded = Buffer.from(json).toString('base64');
  const customId = `${prefix}:${encoded}`;

  // Discord limit is 100 chars - warn if we're close
  if (customId.length > 95) {
    logger.warn(`CustomId length (${customId.length}) approaching Discord limit (100)`);
  }

  // Hard limit at 100 characters
  return customId.substring(0, 100);
}

/**
 * Decodes a customId string back into prefix and data
 */
function decodeCustomId(customId) {
  try {
    const [prefix, encoded] = customId.split(':', 2);
    if (!encoded) {
      logger.warn(`CustomId missing encoded data: ${customId}`);
      return null;
    }

    const json = Buffer.from(encoded, 'base64').toString('utf-8');
    const data = JSON.parse(json);

    return { prefix, data };
  } catch (error) {
    logger.error('Failed to decode customId:', error);
    return null;
  }
}

/**
 * Creates a simple customId with colon-separated values
 */
function createSimpleCustomId(...parts) {
  const customId = parts.join(':');

  if (customId.length > 100) {
    logger.error(`Simple customId exceeds 100 character limit: ${customId.length} chars`);
    return customId.substring(0, 100);
  }

  return customId;
}

/**
 * Parses a simple colon-separated customId
 */
function parseSimpleCustomId(customId) {
  if (!customId) return [];
  return customId.split(':');
}

module.exports = {
  encodeCustomId,
  decodeCustomId,
  createSimpleCustomId,
  parseSimpleCustomId,
};
