const { EmergencyService } = require('../services/EmergencyService');
const logger = require('../lib/logger');

class MessageIntentHandler {
  /**
   * Checks if a message triggers an intent and executes it.
   * @param {Message} message
   */
  static async handleMessage(message) {
    if (message.author.bot || !message.guild) return;

    const content = message.content.toLowerCase().trim();

    // Emergency Trigger: "ryan call 911"
    if (content === 'ryan call 911') {
      logger.info(`Emergency intent triggered by ${message.author.tag} in ${message.guild.name}`);
      try {
        await EmergencyService.handleEmergency(message);
      } catch (error) {
        logger.error('Failed to handle emergency intent:', error);
      }
    }
  }
}

module.exports = { MessageIntentHandler };
