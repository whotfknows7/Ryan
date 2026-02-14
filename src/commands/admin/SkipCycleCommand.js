// src/commands/admin/SkipCycleCommand.js

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { ResetService } = require('../../services/ResetService');
const logger = require('../../lib/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip-cycle')
    .setDescription('Force skip the current day/cycle and reset the timer to NOW.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const result = await ResetService.forceSkipCycle(interaction.client, interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle('⏩ Cycle Skipped & Timer Reset')
        .setColor(0x00FF00)
        .setDescription(
          `**Action Successful!**\n` +
          `The current cycle has been finalized manually.\n\n` +
          `**Details:**\n` +
          `• **Type:** ${result.isWeekly ? '🏆 WEEKLY RESET (Leaderboard Sent)' : '📅 DAILY RESET'}\n` +
          `• **New Cycle Day:** ${result.newCycle} / 7\n` +
          `• **New Reset Time:** Set to **${new Date().toLocaleTimeString()}**\n` +
          `• **Next Reset:** <t:${Math.floor(result.nextReset.getTime() / 1000)}:R>`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.error('Error executing /skip-cycle:', error);
      await interaction.editReply({
        content: `❌ **Failed to skip cycle.**\nError: ${error.message}`
      });
    }
  }
};
