const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { ConfigService } = require('../../services/ConfigService');

const SetClanRoleCommand = {
  data: new SlashCommandBuilder()
    .setName('set_clan_role')
    .setDescription('Setup a reaction role message for clans')
    .addStringOption((opt) => opt.setName('message').setDescription('Message content').setRequired(true))
    .addStringOption((opt) => opt.setName('emoji').setDescription('Reaction Emoji').setRequired(true))
    .addRoleOption((opt) => opt.setName('role').setDescription('Role to assign').setRequired(true)),

  execute: async (interaction) => {
    const { hasPermission } = require('../../utils/GuildIdsHelper');
    const { DatabaseService } = require('../../services/DatabaseService');

    if (!hasPermission(interaction.member, 'Administrator')) {
      return interaction.reply({
        content: '❌ This command is restricted to server administrators.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const messageContent = interaction.options.getString('message', true);
    const emoji = interaction.options.getString('emoji', true);
    const role = interaction.options.getRole('role', true);

    const guildIds = await DatabaseService.getGuildIds(interaction.guildId);
    const clanMessageId = guildIds.clanMessageId;

    let sentMsg = null;
    if (clanMessageId) {
      sentMsg = await interaction.channel.messages.fetch(clanMessageId).catch(() => null);
    }

    if (sentMsg) {
      await sentMsg.edit(`${sentMsg.content}\n\n${messageContent}`);
    } else {
      sentMsg = await interaction.channel?.send(messageContent);
      if (!sentMsg) return interaction.reply({ content: 'Failed to send message.', flags: MessageFlags.Ephemeral });
      
      await DatabaseService.updateGuildIds(interaction.guildId, { clanMessageId: sentMsg.id });
    }

    await sentMsg.react(emoji);

    const reactionRoles = await ConfigService.getReactionRoles(interaction.guildId);
    
    // Use a composite key guaranteed to be unique for every reaction on that message
    reactionRoles[`${sentMsg.id}_${role.id}`] = {
      messageId: sentMsg.id,
      emoji: emoji,
      roleId: role.id,
      channelId: interaction.channelId,
      isClanRole: true,
      uniqueRoles: true,
    };

    await ConfigService.saveReactionRoles(interaction.guildId, reactionRoles);
    await interaction.reply({ content: '✅ Clan role setup complete!', flags: MessageFlags.Ephemeral });
  },
};

module.exports = SetClanRoleCommand;
