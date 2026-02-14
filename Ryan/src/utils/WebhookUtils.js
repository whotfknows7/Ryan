const { EmbedBuilder, WebhookClient } = require('discord.js');
const logger = require('../lib/logger');

class WebhookUtils {
    /**
     * Get or create a webhook for the given channel.
     * @param {import('discord.js').TextChannel} channel
     * @returns {Promise<import('discord.js').Webhook>}
     */
    static async getOrCreateWebhook(channel) {
        try {
            const webhooks = await channel.fetchWebhooks();
            const existing = webhooks.find(wh => wh.owner.id === channel.client.user.id);

            if (existing) {
                return existing;
            }

            // Create new one if none exists
            return await channel.createWebhook({
                name: channel.client.user.username,
                avatar: channel.client.user.avatarURL({ extension: 'png' }),
            });
        } catch (error) {
            logger.error(`[WebhookUtils] Failed to get/create webhook in ${channel.id}:`, error);
            throw error;
        }
    }

    /**
     * Send a leaderboard message using a webhook.
     * @param {import('discord.js').TextChannel} channel
     * @param {import('discord.js').EmbedBuilder} embed
     * @param {string} [content]
     * @returns {Promise<import('discord.js').Message>}
     */
    static async sendLeaderboard(channel, embed, content) {
        try {
            const webhook = await this.getOrCreateWebhook(channel);

            const payload = {
                embeds: [embed],
                content: content,
                username: channel.client.user.username,
                avatarURL: channel.client.user.avatarURL({ extension: 'png' }),
            };

            // Webhook send returns the message object (APIMessage) which has an id
            const message = await webhook.send(payload);
            return message;
        } catch (error) {
            logger.error(`[WebhookUtils] Failed to send leaderboard:`, error);
            throw error;
        }
    }
}

module.exports = WebhookUtils;
