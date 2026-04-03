// src/commands/admin/SkipCycleCommand.js

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { ResetService } = require('../../services/ResetService');
const logger = require('../../lib/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip-cycle')
    .setDescription('Force skip the current day/cycle and reset the timer to the current local midnight.'),

  async execute(interaction) {
    const { hasPermission } = require('../../utils/GuildIdsHelper');

    if (!hasPermission(interaction.member, 'Administrator')) {
      return interaction.reply({
        content: '❌ This command is restricted to server administrators.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!interaction.guildId) {
      return interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      const result = await ResetService.forceSkipCycle(interaction.client, interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle('⏩ Cycle Skipped & Timer Reset')
        .setColor(0x00ff00)
        .setDescription(
          `**Action Successful!**\n` +
            `The current cycle has been finalized manually.\n\n` +
            `**Details:**\n` +
            `• **Type:** ${result.isWeekly ? '🏆 WEEKLY RESET (Leaderboard Sent)' : '📅 DAILY RESET'}\n` +
            `• **New Cycle Day:** ${result.newCycle} / 7\n` +
            `• **Timezone:** \`${result.timezone}\`\n` +
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
