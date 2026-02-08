const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../../lib/logger');

const ReconnectCommand = {
  data: new SlashCommandBuilder()
    .setName('reconnect')
    .setDescription('Gracefully restart the bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  
  execute: async (interaction) => {
    logger.info(`Reconnect command invoked by ${interaction.user.tag}`);
    
    await interaction.reply({
      content: '🔄 Reconnecting... The bot will be back in a few seconds.',
      flags: MessageFlags.Ephemeral
    });
    
    await interaction.client.destroy();
    process.exit(0);
  }
};

module.exports = ReconnectCommand;
