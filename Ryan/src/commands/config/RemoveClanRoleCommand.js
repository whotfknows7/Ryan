const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ConfigService } = require('../../services/ConfigService');
const { clearCache } = require('../../utils/GuildIdsHelper'); 

const RemoveClanRoleCommand = {
  data: new SlashCommandBuilder()
    .setName('remove_clan_role')
    .setDescription('Remove a clan role setup by Message ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt => opt.setName('message_id').setDescription('The ID of the message to remove').setRequired(true)),

  execute: async (interaction) => {
    const messageId = interaction.options.getString('message_id', true);
    const guildId = interaction.guildId;

    try {
      const reactionRoles = await ConfigService.getReactionRoles(guildId);
      if (!reactionRoles[messageId]) {
        return interaction.reply({ content: `❌ No configuration found...`, flags: MessageFlags.Ephemeral });
      }
      
      delete reactionRoles[messageId];
      await ConfigService.saveReactionRoles(guildId, reactionRoles);
      clearCache(guildId);
      
      await interaction.reply({
        content: `✅ Successfully removed clan role configuration for Message ID: \`${messageId}\``,
        flags: MessageFlags.Ephemeral
      });

    } catch (error) {
      console.error('Error removing clan role:', error);
      await interaction.reply({ 
        content: '❌ An error occurred while removing the clan role.', 
        flags: MessageFlags.Ephemeral 
      });
    }
  }
};

module.exports = RemoveClanRoleCommand;
