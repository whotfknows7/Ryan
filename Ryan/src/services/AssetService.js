// src/services/AssetService.js

const { request } = require('undici');
const logger = require('../lib/logger');
const CONSTANTS = require('../lib/constants');

// Regex to parse: https://discord.com/channels/{guildId}/{channelId}/{messageId}
const MESSAGE_LINK_REGEX = /channels\/(\d+)\/(\d+)\/(\d+)/;

class AssetService {
  
  /**
   * Uploads a file (Buffer or Stream) to the Dev Channel.
   * Uses direct channel fetch for speed.
   */
  static async storeToDevChannel(client, fileData, filename, contextText = "") {
    try {
        const channelId = CONSTANTS.ASSET_CHANNEL_ID;
        if (!channelId) throw new Error("ASSET_CHANNEL_ID not set in constants.");

        // Direct Channel Fetch (Cached if possible)
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) throw new Error(`Asset Channel ${channelId} not found/accessible.`);

        const message = await channel.send({
            content: `**[Asset Storage]** ${contextText} (${filename})`,
            files: [{ attachment: fileData, name: filename }]
        });

        return message.url; 
    } catch (error) {
        logger.error(`[AssetService] Failed to store asset: ${error.message}`);
        // Don't throw, return null so the bot can fallback gracefully
        return null;
    }
  }

  /**
   * Fetches an asset Buffer from a Discord Message Link.
   */
  static async fetchAssetFromLink(client, messageLink) {
    try {
        const match = messageLink.match(MESSAGE_LINK_REGEX);
        if (!match) throw new Error("Invalid Discord Message Link format");

        const [, guildId, channelId, messageId] = match;

        const channel = await client.channels.fetch(channelId);
        const message = await channel.messages.fetch(messageId);

        if (!message || message.attachments.size === 0) {
            throw new Error("Message or Attachment not found");
        }

        const attachment = message.attachments.first();
        const url = attachment.url; 

        // Download with a stricter timeout (15s) to fail fast if stuck
        const { body } = await request(url, { headersTimeout: 15000, bodyTimeout: 15000 });
        return Buffer.from(await body.arrayBuffer());

    } catch (error) {
        logger.error(`[AssetService] Failed to fetch asset: ${error.message}`);
        return null;
    }
  }
}

module.exports = { AssetService };
