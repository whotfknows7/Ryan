const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { CustomRoleService } = require('../../../services/CustomRoleService');
const { getIds, hasRole } = require('../../../utils/GuildIdsHelper');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('custom_role')
    .setDescription('Manage your custom role')
    .addSubcommand((sub) =>
      sub
        .setName('request')
        .setDescription('Request a new custom role')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Name of the role').setRequired(true).setMaxLength(32)
        )
        .addStringOption((opt) =>
          opt.setName('color').setDescription('Hex color code (e.g. #FF0000)').setRequired(true)
        )
        .addBooleanOption((opt) =>
          opt
            .setName('color_username')
            .setDescription('Do you want this role to color your username?')
            .setRequired(true)
        )
    ),

  execute: async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'request') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const ids = await getIds(guildId);
      const eligibilityRoleId = ids.customRoleEligibilityId;

      if (eligibilityRoleId) {
        if (!hasRole(interaction.member, eligibilityRoleId)) {
          return interaction.editReply({
            content: `❌ You do not have the required role (<@&${eligibilityRoleId}>) to request a custom role.`,
          });
        }
      }

      const hexColor = interaction.options.getString('color');
      const hexRegex = /^#([0-9A-F]{3}){1,2}$/i;
      if (!hexRegex.test(hexColor)) {
        return interaction.editReply({ content: '❌ Invalid Hex Color. Example: `#FF0000`' });
      }

      const roleName = interaction.options.getString('name');
      const colorYourName = interaction.options.getBoolean('color_username');

      const requestData = {
        id: interaction.id,
        userId: interaction.user.id,
        username: interaction.user.username,
        roleName: roleName,
        hexColor: hexColor,
        colorYourName: colorYourName,
        createdAt: new Date().toISOString(),
      };

      try {
        await CustomRoleService.createRoleRequest(interaction.guild, requestData);
        await interaction.editReply({
          content: `✅ **Request Sent!**\nRole: **${roleName}**\nColor: \`${hexColor}\`\n\nA moderator will review your request shortly.`,
        });
      } catch (error) {
        console.error('Custom Role Request Error:', error);
        await interaction.editReply({ content: '❌ Failed to submit request. Please contact an admin.' });
      }
    }
  },
};
