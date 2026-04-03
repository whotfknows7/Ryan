const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags, Routes } = require('discord.js');
const { DatabaseService } = require('../../services/DatabaseService');
const { getIds } = require('../../utils/GuildIdsHelper');
const { prisma } = require('../../lib/prisma');
const { XpHelper } = require('../../utils/XpHelper');

const SetXpCommand = {
  data: new SlashCommandBuilder()
    .setName('set_xp')
    .setDescription("Set or adjust a user's XP or Level")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((opt) => opt.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption((opt) => opt.setName('xp').setDescription('XP amount (e.g. 1.5k, 2000, -500)').setRequired(false))
    .addIntegerOption((opt) => opt.setName('level').setDescription('Calculate XP amount from level').setRequired(false))
    .addBooleanOption((opt) => opt.setName('override').setDescription('Override current XP instead of adding')),

  execute: async (interaction) => {
    const targetUser = interaction.options.getUser('user', true);
    const xpInput = interaction.options.getString('xp');
    const levelInput = interaction.options.getInteger('level');
    const overrideInput = interaction.options.getBoolean('override');

    if ((xpInput !== null && levelInput !== null) || (xpInput === null && levelInput === null)) {
      return interaction.reply({
        content: '❌ Please provide exactly **one**: either XP or Level.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Default to adding for XP, but defaulting to overriding for Level
    const override = overrideInput !== null ? overrideInput : levelInput !== null;

    const parseXpInput = (input) => {
      const cleaned = input.replace(/\s+/g, '').toLowerCase();
      if (cleaned.endsWith('k')) return parseFloat(cleaned.replace('k', '')) * 1000;
      if (cleaned.endsWith('m')) return parseFloat(cleaned.replace('m', '')) * 1000000;
      const num = parseInt(cleaned);
      if (isNaN(num)) throw new Error('Invalid XP format. Example: 1.5k, 2000');
      return num;
    };

    try {
      let amount;
      if (xpInput !== null) {
        amount = parseXpInput(xpInput);
      } else {
        amount = XpHelper.getXpFromLevel(levelInput);
      }
      const guildId = interaction.guildId;

      const currentData = await prisma.userXp.findUnique({
        where: { guildId_userId: { guildId, userId: targetUser.id } },
      });
      const oldXp = currentData ? currentData.xp : 0;

      if (override) {
        await DatabaseService.setUserXp(guildId, targetUser.id, amount);
      } else {
        await DatabaseService.updateUserXp(guildId, targetUser.id, amount);
      }

      const newData = await prisma.userXp.findUnique({
        where: { guildId_userId: { guildId, userId: targetUser.id } },
      });
      const actualNewXp = newData ? newData.xp : 0;

      const verb = override ? 'set' : 'adjusted';
      await interaction.reply({
        content: `✅ XP for ${targetUser} has been **${verb}** from \`${oldXp}\` to \`${actualNewXp}\`.`,
        flags: MessageFlags.Ephemeral,
      });

      const ids = await getIds(guildId);
      const logChannelId = ids.trueLogsChannelId || ids.logsChannelId;

      if (logChannelId) {
        const logChannel = await interaction.guild?.channels.fetch(logChannelId).catch(() => null);
        if (logChannel?.isTextBased()) {
          const embed = new EmbedBuilder()
            .setTitle('⚙️ XP Change Log')
            .setDescription(`${interaction.user} ${verb} XP for ${targetUser}`)
            .addFields(
              { name: 'Old XP', value: oldXp.toString(), inline: true },
              { name: 'New XP', value: actualNewXp.toString(), inline: true },
              { name: 'Override', value: override ? 'Yes' : 'No', inline: true }
            )
            .setColor('Orange')
            .setTimestamp();
          await interaction.client.rest.post(Routes.channelMessages(logChannelId), {
            body: { embeds: [embed.toJSON()] },
          });
        }
      }
    } catch (error) {
      await interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
    }
  },
};

module.exports = SetXpCommand;
