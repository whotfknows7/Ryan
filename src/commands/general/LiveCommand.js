// src/commands/general/LiveCommand.js

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { DatabaseService } = require('../../services/DatabaseService');
// [FIX] Import the instance directly (No curly braces)
const ImageService = require('../../services/ImageService');

const LiveCommand = {
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Show the current leaderboard immediately'),

  execute: async (interaction) => {
    // We keep the response object to attach the collector
    const response = await interaction.deferReply();

    try {
      const guildId = interaction.guildId;
      const guild = interaction.guild;

      // 1. Fetch Data
      const topUsers = await DatabaseService.fetchTopUsers(guildId, 10);
      const allUsers = await DatabaseService.getAllUserXp(guildId);
      const totalPages = Math.max(1, Math.ceil(allUsers.length / 10));

      // 2. Prepare Image
      const usersForImage = await Promise.all(topUsers.map(async (u, index) => {
        const member = await guild.members.fetch(u.userId).catch(() => null);
        return {
          rank: index + 1,
          userId: u.userId,
          username: member ? (member.nickname || member.user.username) : 'Unknown',
          avatarUrl: member?.displayAvatarURL({ extension: 'png' }) || null,
          xp: u.dailyXp || u.xp // Show Daily XP for Live, or Total if preferred
        };
      }));

      const imageBuffer = await ImageService.generateLeaderboard(usersForImage);
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'leaderboard.png' });

      // 3. Build Embed
      const embed = new EmbedBuilder()
        .setTitle("Yappers of the day! (Live)")
        .setDescription(`Leaderboard • Page 1/${totalPages}`)
        .setColor(0x823EF0)
        .setThumbnail("https://media.discordapp.net/attachments/1301183910838796460/1333160889419038812/tenor.gif")
        .setImage("attachment://leaderboard.png")
        .setFooter({ text: `Page 1 of ${totalPages}` })
        .setTimestamp();

      // 4. Build Buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('leaderboard_page:prev:0')
          .setLabel('◀')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('leaderboard_show_rank')
          .setLabel('Show my rank')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('leaderboard_page:next:2')
          .setLabel('▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(totalPages <= 1)
      );

      await interaction.editReply({ embeds: [embed], files: [attachment], components: [row] });

      // 5. Expiry Logic (2 Minutes)
      const collector = response.createMessageComponentCollector({ 
        componentType: ComponentType.Button, 
        time: 120000 
      });

      collector.on('end', async () => {
        try {
          const msg = await interaction.fetchReply().catch(() => null);
          if (msg) {
            const disabledRow = new ActionRowBuilder().addComponents(
              row.components.map(button => ButtonBuilder.from(button).setDisabled(true))
            );
            await interaction.editReply({ components: [disabledRow] });
          }
        } catch (e) { }
      });

    } catch (error) {
      console.error('Error executing /live:', error);
      await interaction.editReply({ content: '❌ Failed to generate live leaderboard.' });
    }
  }
};

module.exports = LiveCommand;
