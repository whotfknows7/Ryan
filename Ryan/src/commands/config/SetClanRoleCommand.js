const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ConfigService } = require('../../services/ConfigService');

const SetClanRoleCommand = {
  data: new SlashCommandBuilder()
    .setName('set_clan_role')
    .setDescription('Setup a reaction role message for clans')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt => opt.setName('message').setDescription('Message content').setRequired(true))
    .addStringOption(opt => opt.setName('emoji').setDescription('Reaction Emoji').setRequired(true))
    .addRoleOption(opt => opt.setName('role').setDescription('Role to assign').setRequired(true)),

  execute: async (interaction) => {
    const messageContent = interaction.options.getString('message', true);
    const emoji = interaction.options.getString('emoji', true);
    const role = interaction.options.getRole('role', true);

    const sentMsg = await interaction.channel?.send(messageContent);
    if (!sentMsg) return interaction.reply({ content: 'Failed to send message.', flags: MessageFlags.Ephemeral });

    await sentMsg.react(emoji);

    const reactionRoles = await ConfigService.getReactionRoles(interaction.guildId);
    reactionRoles[sentMsg.id] = {
      messageId: sentMsg.id,
      emoji: emoji,
      roleId: role.id,
      channelId: interaction.channelId,
      isClanRole: true,
      uniqueRoles: true
    };

    await ConfigService.saveReactionRoles(interaction.guildId, reactionRoles);
    await interaction.reply({ content: '✅ Clan role setup complete!', flags: MessageFlags.Ephemeral });
  }
};

module.exports = SetClanRoleCommand;
