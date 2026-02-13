// src/commands/config/SetupClanIconCommand.js

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { AssetService } = require('../../services/AssetService');
const { DatabaseService } = require('../../services/DatabaseService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-clan-icon')
    .setDescription('Set the custom overlay icon for a Clan Role')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('The Clan Role')
        .setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral });
    }

    const role = interaction.options.getRole('role');

    await interaction.reply({
      content: `Upload the transparent PNG icon for **${role.name}** now.`
    });

    const filter = m => m.author.id === interaction.user.id && m.attachments.size > 0;
    const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });

    collector.on('collect', async (message) => {
      const attachment = message.attachments.first();

      try {
        // 1. Download
        const buffer = await AssetService.fetchAssetFromLink(interaction.client, message.url); // Or direct download
        // Simple direct download for initial setup:
        const axios = require('axios');
        const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
        const imgBuffer = Buffer.from(response.data);

        // 2. Upload to Dev Channel (Permanent Storage)
        const filename = `clan_icon_${role.id}.png`;
        const persistentUrl = await AssetService.storeToDevChannel(
          interaction.client,
          imgBuffer,
          filename,
          `Icon for role ${role.name} (${role.id})`
        );

        if (!persistentUrl) {
          throw new Error("Failed to store asset in Dev Channel.");
        }

        // 3. Save to DB
        await DatabaseService.setClanAsset(
          interaction.guildId,
          role.id,
          persistentUrl // Storing the Message Jump Link
        );

        await interaction.followUp(`✅ Icon for ${role} saved!`);

      } catch (error) {
        await interaction.followUp(`❌ Failed: ${error.message}`);
      }
    });
  }
};
