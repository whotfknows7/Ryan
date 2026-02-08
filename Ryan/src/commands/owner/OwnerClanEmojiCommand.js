const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { prisma } = require('../../lib/prisma');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Owner only commands')
    .addSubcommand(sub =>
      sub.setName('clanemoji')
      .setDescription('Set a custom emoji for a clan (Paid Feature)')
      .addStringOption(opt => opt.setName('guild_id').setDescription('Target Guild ID').setRequired(true))
      .addIntegerOption(opt => opt.setName('clan_id').setDescription('Clan ID (1-4)').setRequired(true).setMinValue(1).setMaxValue(4))
      .addStringOption(opt => opt.setName('emoji').setDescription('The Emoji String (or "NONE" to remove)').setRequired(true))
    ),
  
  execute: async (interaction) => {
    if (interaction.user.id !== "762715169351532555") {
      return interaction.reply({ content: "❌ You are not the owner.", flags: MessageFlags.Ephemeral });
    }
    
    const guildId = interaction.options.getString('guild_id');
    const clanId = interaction.options.getInteger('clan_id');
    const emojiInput = interaction.options.getString('emoji');
    
    try {
      const config = await prisma.guildConfig.findUnique({ where: { guildId } });
      
      if (!config) {
        return interaction.reply({ content: "❌ Guild config not found.", flags: MessageFlags.Ephemeral });
      }
      
      let clans = config.clans || {};
      if (typeof clans !== 'object') clans = {};
      
      if (!clans[clanId]) {
        clans[clanId] = {
          name: `Clan ${clanId}`,
          roleId: undefined
        };
      }
      
      if (emojiInput === "NONE") {
        delete clans[clanId].emoji;
      } else {
        clans[clanId].emoji = emojiInput;
      }
      
      await prisma.guildConfig.update({
        where: { guildId },
        data: { clans }
      });
      
      return interaction.reply({
        content: `✅ **Updated!**\nGuild: \`${guildId}\`\nClan: ${clanId}\nEmoji: ${emojiInput === "NONE" ? "Removed" : emojiInput}`,
        flags: MessageFlags.Ephemeral
      });
      
    } catch (error) {
      console.error(error);
      return interaction.reply({ content: "❌ Database error.", flags: MessageFlags.Ephemeral });
    }
  }
};
