const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const EmergencyCommand = {
  data: new SlashCommandBuilder()
    .setName('911')
    .setDescription('Emergency ping for admins (10m cooldown)'),

  execute: async (interaction) => {
    try {
      const { EmergencyService } = require('../../services/EmergencyService');
      await EmergencyService.handleEmergency(interaction, true);
    } catch (error) {
      console.error('Emergency Command Error:', error);
      await interaction.reply({
        content: 'Failed to execute emergency command.',
        flags: MessageFlags.Ephemeral
      }).catch(() => { });
    }
  }
};

module.exports = EmergencyCommand;
