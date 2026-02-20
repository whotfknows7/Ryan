// src/events/GuildCreate.js

const { registerCommandsForGuild } = require('../handlers/CommandHandler');
const { config } = require('../config');
const logger = require('../lib/logger');
const { Routes } = require('discord.js');

/**
 * Event handler for when the bot joins a new guild
 * Automatically registers slash commands to the new guild
 */
module.exports = {
  name: 'guildCreate',
  once: false,
  async execute(guild) {
    const client = guild.client;

    logger.info(`Bot joined new guild: ${guild.name} (${guild.id}) with ${guild.memberCount} members`);

    // If using global command registration, commands will automatically be available
    if (config.REGISTER_COMMANDS_GLOBALLY) {
      logger.info('Using global command registration - commands will be available within 1 hour');
      return;
    }

    // If using dev guild IDs, only register if this guild is in the dev list
    if (config.DEV_GUILD_IDS.length > 0) {
      if (!config.DEV_GUILD_IDS.includes(guild.id)) {
        logger.info(`Guild ${guild.id} not in DEV_GUILD_IDS list - skipping command registration`);
        return;
      }
    }

    // Register commands for this specific guild
    try {
      // Collect all commands from the client
      const slashCommands = Array.from(client.commands.values()).map((cmd) => cmd.data.toJSON());

      if (slashCommands.length === 0) {
        logger.warn('No commands loaded to register for new guild');
        return;
      }

      await registerCommandsForGuild(guild.id, slashCommands);

      // Optionally: Send a welcome message
      try {
        const welcomeMessage =
          `👋 Thanks for adding me to **${guild.name}**!\n\n` +
          `To get started, an administrator should run \`/setup wizard\` to configure roles and channels.\n\n` +
          `Need help? Check out the documentation or contact support.`;

        // Check permissions safely
        if (guild.systemChannel && guild.systemChannel.permissionsFor(client.user)?.has('SendMessages')) {
          await client.rest.post(Routes.channelMessages(guild.systemChannel.id), { body: { content: welcomeMessage } });
        }
      } catch (error) {
        logger.error(`Failed to send welcome message to guild ${guild.id}:`, error);
      }
    } catch (error) {
      logger.error(`Failed to register commands for new guild ${guild.name} (${guild.id}):`, error);
    }
  },
};
