const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { DatabaseService } = require('../../services/DatabaseService');
const ImageService = require('../../services/ImageService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Displays your current rank and stats.')
    .addUserOption((option) => option.setName('user').setDescription('The user to check').setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply();

    const providedUser = interaction.options.getUser('user');
    const targetUser = providedUser || interaction.user;
    const guildId = interaction.guild.id;

    // Check if the user is in the guild
    let inGuild = true;
    if (providedUser) {
      const member = interaction.options.getMember('user');
      if (!member) inGuild = false;
    }

    // 1. Fetch Stats (Breakthrough 1)
    const stats = await DatabaseService.getLiveUserStats(guildId, targetUser.id);
    const weeklyRank = await DatabaseService.getUserRank(guildId, targetUser.id, 'weekly');
    const allTimeRank = await DatabaseService.getUserRank(guildId, targetUser.id, 'lifetime');

    // 2. Prepare Data for Image Service
    const rankData = {
      username: inGuild ? targetUser.username : `${targetUser.username} (Left)`, // Display name or username
      avatarUrl: targetUser.displayAvatarURL({ extension: 'png', size: 512 }),
      // Pill 1 Data
      weeklyXp: stats.weeklyXp,
      allTimeXp: stats.xp,
      // Pill 2 Data
      weeklyRank: weeklyRank,
      allTimeRank: allTimeRank,
      // Color (optional, can fetch from role)
      hexColor: interaction.member.displayHexColor,
    };

    // 3. Generate Card
    try {
      const imageBuffer = await ImageService.generateRankCard(rankData);
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'rank.png' });
      await interaction.editReply({ files: [attachment] });
    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: 'Failed to generate rank card.' });
    }
  },
};
