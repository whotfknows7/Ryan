const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { ConfigService } = require('../../services/ConfigService');

const SetClanRoleCommand = {
  data: new SlashCommandBuilder()
    .setName('set_clan_role')
    .setDescription('Setup a reaction role message for clans')
    .addStringOption((opt) =>
      opt.setName('message').setDescription('Message content (Leave blank to keep existing)').setRequired(false)
    )
    .addStringOption((opt) => opt.setName('emoji').setDescription('Reaction Emoji (Optional)').setRequired(false))
    .addRoleOption((opt) => opt.setName('role').setDescription('Role to assign (Optional)').setRequired(false)),

  execute: async (interaction) => {
    const { hasPermission } = require('../../utils/GuildIdsHelper');
    const { DatabaseService } = require('../../services/DatabaseService');

    if (!hasPermission(interaction.member, 'Administrator')) {
      return interaction.reply({
        content: '❌ This command is restricted to server administrators.',
        flags: MessageFlags.Ephemeral,
      });
    }

    let messageContent = interaction.options.getString('message');
    if (messageContent) {
      // Allow users to explicitly type \n for newlines as a workaround for Discord's slash command limitations
      messageContent = messageContent.replace(/\\n/g, '\n');
    }
    const emoji = interaction.options.getString('emoji');
    const role = interaction.options.getRole('role');

    if (!messageContent && (!emoji || !role)) {
      return interaction.reply({
        content:
          '❌ You must provide at least a `message` to edit the text, or BOTH an `emoji` and `role` to add a reaction.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if ((emoji && !role) || (!emoji && role)) {
      return interaction.reply({
        content:
          '❌ You must provide BOTH an `emoji` and a `role` to add a reaction, or leave both blank just to edit the message.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const guildIds = await DatabaseService.getGuildIds(interaction.guildId);
    const clanMessageId = guildIds.clanMessageId;

    let sentMsg = null;
    if (clanMessageId) {
      sentMsg = await interaction.channel.messages.fetch(clanMessageId).catch(() => null);
    }

    if (sentMsg) {
      if (messageContent) {
        await sentMsg.edit(messageContent);
      }
    } else {
      if (!messageContent) {
        return interaction.reply({
          content: '❌ No existing clan message found. You must provide the `message` parameter to create a new one.',
          flags: MessageFlags.Ephemeral,
        });
      }
      sentMsg = await interaction.channel?.send(messageContent);
      if (!sentMsg) return interaction.reply({ content: 'Failed to send message.', flags: MessageFlags.Ephemeral });

      await DatabaseService.updateGuildIds(interaction.guildId, { clanMessageId: sentMsg.id });
    }

    if (emoji && role) {
      try {
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
      } catch (error) {
        console.error('Failed to react to message:', error);
        return interaction.reply({
          content: '❌ Failed to react to the message. Are you sure the emoji is valid and the bot has access to it?',
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    await interaction.reply({ content: '✅ Clan role setup complete!', flags: MessageFlags.Ephemeral });
  },
};

module.exports = SetClanRoleCommand;
