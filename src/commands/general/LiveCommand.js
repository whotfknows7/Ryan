// src/commands/general/LiveCommand.js

const {
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const { DatabaseService } = require('../../services/DatabaseService');
const { defaultRedis } = require('../../config/redis');
// [FIX] Import the instance directly (No curly braces)
const ImageService = require('../../services/ImageService');

const LiveCommand = {
  data: new SlashCommandBuilder().setName('live').setDescription('Show the current leaderboard immediately'),

  execute: async (interaction) => {
    // We keep the response object to attach the collector
    const response = await interaction.deferReply();

    try {
      const guildId = interaction.guildId;
      const guild = interaction.guild;

      // 1. Fetch Data
      const topUsers = await DatabaseService.getLiveTopUsers(guildId, 10, 'daily');
      const totalCount = await DatabaseService.getUserCount(guildId, 'daily');
      const totalPages = Math.max(1, Math.ceil(totalCount / 10));

      // 2. Prepare Image (Using Redis HASH Cache)
      const cacheKey = `member_cache:${guildId}`;
      const dbUserIds = topUsers.map((u) => u.userId);

      let profiles = [];
      let missingUserIds = [];
      let missingIndices = [];

      if (dbUserIds.length > 0) {
        try {
          // Fetch multiple users from the Redis hash
          const cachedData = await defaultRedis.hmget(cacheKey, ...dbUserIds);

          for (let i = 0; i < dbUserIds.length; i++) {
            if (cachedData[i]) {
              // Cache hit
              const parsed = JSON.parse(cachedData[i]);
              profiles.push({
                userId: dbUserIds[i],
                displayName: parsed.displayName,
                avatarUrl: parsed.avatarUrl,
              });
            } else {
              // Cache miss
              profiles.push(null);
              missingUserIds.push(dbUserIds[i]);
              missingIndices.push(i);
            }
          }
        } catch (err) {
          console.error(`[LiveCommandCache] Failed to fetch hash cache for ${guildId}: ${err.message}`);
          missingUserIds = dbUserIds;
          missingIndices = dbUserIds.map((_, i) => i);
        }

        if (missingUserIds.length > 0) {
          // Fetch ONLY the missing members from Discord
          let fetchedMembers = new Map();
          try {
            fetchedMembers = await guild.members.fetch({ user: missingUserIds }).catch(() => new Map());
          } catch (err) {
            console.error(`[LiveCommandCache] Failed to fetch missing members for ${guildId}: ${err.message}`);
          }

          const pipeline = defaultRedis.pipeline();
          let updates = 0;

          for (let j = 0; j < missingUserIds.length; j++) {
            const uId = missingUserIds[j];
            const pIndex = missingIndices[j];
            const member = fetchedMembers.get(uId);

            const profileBase = {
              displayName: member ? member.nickname || member.user.username : 'Unknown (Left',
              avatarUrl: member?.displayAvatarURL({ extension: 'png' }) || null,
            };

            profiles[pIndex] = {
              userId: uId,
              ...profileBase,
            };

            // Pipeline HSET
            pipeline.hset(cacheKey, uId, JSON.stringify(profileBase));
            updates++;
          }

          if (updates > 0) {
            pipeline
              .exec()
              .catch((e) =>
                console.error(`[LiveCommandCache] Failed to save hash pipeline for ${guildId}: ${e.message}`)
              );
          }
        }
      }

      const usersForImage = topUsers.map((u, index) => {
        const profile = profiles[index];
        return {
          rank: index + 1,
          userId: u.userId,
          username: profile ? profile.displayName : 'Unknown (Left',
          avatarUrl: profile ? profile.avatarUrl : null,
          xp: u.dailyXp || 0, // Show Daily XP for Live, explicit 0 fallback
        };
      });

      const imageBuffer = await ImageService.generateLeaderboard(usersForImage);
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'leaderboard.png' });

      // 3. Build Embed
      const embed = new EmbedBuilder()
        .setTitle('Yappers of the day! (Live)')
        .setDescription(`Leaderboard • Page 1/${totalPages}`)
        .setColor(0x823ef0)
        .setThumbnail('https://media.discordapp.net/attachments/1301183910838796460/1333160889419038812/tenor.gif')
        .setImage('attachment://leaderboard.png')
        .setFooter({ text: `Page 1 of ${totalPages}` })
        .setTimestamp();

      // 4. Build Buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('leaderboard_page:prev:0')
          .setLabel('◀')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder().setCustomId('leaderboard_show_rank').setLabel('Show my rank').setStyle(ButtonStyle.Primary),
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
        time: 120000,
      });

      collector.on('end', async () => {
        try {
          const msg = await interaction.fetchReply().catch(() => null);
          if (msg) {
            const disabledRow = new ActionRowBuilder().addComponents(
              row.components.map((button) => ButtonBuilder.from(button).setDisabled(true))
            );
            await interaction.editReply({ components: [disabledRow] });
          }
        } catch {
          /* best-effort */
        }
      });
    } catch (error) {
      console.error('Error executing /live:', error);
      await interaction.editReply({ content: '❌ Failed to generate live leaderboard.' });
    }
  },
};

module.exports = LiveCommand;
