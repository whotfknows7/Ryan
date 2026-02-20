// src/structures/CustomClient.js

const { Client, Collection, GatewayIntentBits, Partials, Options } = require('discord.js');
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
      // RAM OPTIMIZATION: Strict Cache Limits for Stateless Architecture
      makeCache: Options.cacheWithLimits({
        ...Options.DefaultMakeCacheSettings,
        MessageManager: 20,
        ReactionManager: 0,
        UserManager: 0,
        GuildMemberManager: 0,
        PresenceManager: 0,
        ThreadManager: 0,
        VoiceStateManager: 0,
        ChannelManager: 0,
        RoleManager: 0,
      }),
      // Sweepers to clean up messages every hour
      sweepers: {
        ...Options.DefaultSweeperSettings,
        messages: {
          interval: 3600, // 1 hour
          lifetime: 3600, // 1 hour
        },
      },
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
