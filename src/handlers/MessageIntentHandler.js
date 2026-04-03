const { EmergencyService } = require('../services/EmergencyService');
const { ChatRevivalService } = require('../services/ChatRevivalService');
const logger = require('../lib/logger');

class MessageIntentHandler {
  /**
   * Checks if a message triggers an intent and executes it.
   * @param {Message} message
   * @param {Client} client  – needed to resolve the bot's own user for mention checks
   */
  static async handleMessage(message, client) {
    if (message.author.bot || !message.guild) return;

    // Emergency Trigger: @Ryan call 911
    // The bot must be explicitly @mentioned – bare "ryan" in text no longer fires this.
    if (message.mentions.has(client.user)) {
      // Strip all mention tokens and normalise before pattern matching.
      const stripped = message.content
        .replace(/<@!?\d+>/g, '')
        .toLowerCase()
        .trim();

      if (stripped === 'call 911') {
        logger.info(`Emergency intent triggered by ${message.author.tag} in ${message.guild.name}`);
        try {
          await EmergencyService.handleEmergency(message);
        } catch (error) {
          logger.error('Failed to handle emergency intent:', error);
        }
      } else if (stripped === 'revive') {
        logger.info(`Revive intent triggered by ${message.author.tag} in ${message.guild.name}`);
        try {
          await ChatRevivalService.handleRevival(message);
        } catch (error) {
          logger.error('Failed to handle revive intent:', error);
        }
      }
    }
  }
}

module.exports = { MessageIntentHandler };
