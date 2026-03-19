const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { ConfigService } = require('../../services/ConfigService');
const { clearCache } = require('../../utils/GuildIdsHelper');

const RemoveClanRoleCommand = {
  data: new SlashCommandBuilder()
    .setName('remove_clan_role')
    .setDescription('Remove a clan role setup by Message ID and optionally Role')
    .addStringOption((opt) =>
      opt.setName('message_id').setDescription('The ID of the message').setRequired(true)
    )
    .addRoleOption((opt) =>
      opt.setName('role').setDescription('The specific role to remove (optional)').setRequired(false)
    ),

  execute: async (interaction) => {
    const { hasPermission } = require('../../utils/GuildIdsHelper');
    if (!hasPermission(interaction.member, 'Administrator')) {
      return interaction.reply({
        content: '❌ This command is restricted to server administrators.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const messageId = interaction.options.getString('message_id', true);
    const role = interaction.options.getRole('role');
    const guildId = interaction.guildId;

    try {
      const reactionRoles = await ConfigService.getReactionRoles(guildId);

      let keysToRemove = [];
      if (role) {
        // Specific role on this message (Composite Key format)
        const specificKey = `${messageId}_${role.id}`;
        if (reactionRoles[specificKey]) {
          keysToRemove.push(specificKey);
        } else {
          // Fallback: search for any entry matching this role and message (Legacy or Non-Composite Keys)
          for (const [key, config] of Object.entries(reactionRoles)) {
            if (config.messageId === messageId && config.roleId === role.id) {
              keysToRemove.push(key);
            }
          }
        }
      } else {
        // Remove all entries for this message
        keysToRemove = Object.keys(reactionRoles).filter(
          (key) => key === messageId || reactionRoles[key].messageId === messageId
        );
      }

      if (keysToRemove.length === 0) {
        return interaction.reply({
          content: `❌ No configuration found for Message ID \`${messageId}\`${role ? ` and Role \`${role.name}\`` : ''}.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      for (const key of keysToRemove) {
        delete reactionRoles[key];
      }

      await ConfigService.saveReactionRoles(guildId, reactionRoles);
      clearCache(guildId);

      await interaction.reply({
        content: `✅ Successfully removed ${keysToRemove.length} clan role configuration(s) for Message ID: \`${messageId}\`${role ? ` and Role: \`${role.name}\`` : ''}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Error removing clan role:', error);
      await interaction.reply({
        content: '❌ An error occurred while removing the clan role.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

module.exports = RemoveClanRoleCommand;
