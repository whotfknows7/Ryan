// src/commands/admin/SkipCycleCommand.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ResetService } = require('../../services/ResetService');
const logger = require('../../lib/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip-cycle')
    .setDescription('Force skip the current day/cycle and reset the timer to NOW.')
    .addStringOption((option) =>
      option
        .setName('time_utc')
        .setDescription('Optional: Overwrite next cycle time (e.g., "in 2h", "tomorrow 5pm UTC")')
        .setRequired(false)
    ),

  async execute(interaction) {
    const { hasPermission } = require('../../utils/GuildIdsHelper');
    const chrono = require('chrono-node');

    if (!hasPermission(interaction.member, 'Administrator')) {
      return interaction.reply({
        content: '❌ This command is restricted to server administrators.',
        ephemeral: true,
      });
    }

    if (!interaction.guildId) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const timeUtcStr = interaction.options.getString('time_utc');
    let customTargetDate = null;

    if (timeUtcStr) {
      // Intelligent parsing: interprets natural language dates nicely (forward looking)
      // Handles everything from "in 2 days" to "2026-05-01 12:00 UTC"
      customTargetDate = chrono.parseDate(timeUtcStr, new Date(), { forwardDate: true });
      if (!customTargetDate || isNaN(customTargetDate.getTime())) {
        return interaction.reply({
          content:
            '❌ **Could not understand the date/time.** Please use relative language like `"in 2 hours"`, `"tomorrow 5pm UTC"`, or an explicit format.',
          ephemeral: true,
        });
      }
    }

    await interaction.deferReply();

    try {
      const result = await ResetService.forceSkipCycle(interaction.client, interaction.guildId, customTargetDate);

      const embed = new EmbedBuilder()
        .setTitle('⏩ Cycle Skipped & Timer Reset')
        .setColor(0x00ff00)
        .setDescription(
          `**Action Successful!**\n` +
            `The current cycle has been finalized manually.\n\n` +
            `**Details:**\n` +
            `• **Type:** ${result.isWeekly ? '🏆 WEEKLY RESET (Leaderboard Sent)' : '📅 DAILY RESET'}\n` +
            `• **New Cycle Day:** ${result.newCycle} / 7\n` +
            `• **New Reset Time:** Set to **${timeUtcStr ? customTargetDate.toLocaleTimeString() + ' (UTC custom)' : new Date().toLocaleTimeString()}**\n` +
            `• **Next Reset:** <t:${Math.floor(result.nextReset.getTime() / 1000)}:R>`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('Error executing /skip-cycle:', error);
      await interaction.editReply({
        content: `❌ **Failed to skip cycle.**\nError: ${error.message}`,
      });
    }
  },
};
