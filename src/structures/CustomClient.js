// src/structures/CustomClient.js

const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { config } = require('../config');
const logger = require('../lib/logger');

class CustomClient extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // Crucial for XP/Chatbot
        GatewayIntentBits.GuildMembers, // Crucial for Roles/Jail
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction, // Required for fetching reactions on old messages
      ],
      rest: {
        timeout: 30000,
      },
    });

    this.commands = new Collection();
  }

  async start() {
    try {
      await this.login(config.TOKEN);
      logger.info(`Logged in as ${this.user?.tag}`);
    } catch (error) {
      logger.error(`Failed to login: ${error}`);
      process.exit(1);
    }
  }
}

module.exports = { CustomClient };
