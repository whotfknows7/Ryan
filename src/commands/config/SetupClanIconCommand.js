const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { AssetService } = require('../../services/AssetService');
const { DatabaseService } = require('../../services/DatabaseService');
const { getIds } = require('../../utils/GuildIdsHelper');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-clan-icon')
    .setDescription('Set the Emoji and Icon for a Clan')
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('The Clan Role')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('emoji')
        .setDescription('The External Emoji String (e.g. <:icon:123456>)')
        .setRequired(true))
    .addAttachmentOption(option =>
      option.setName('icon')
        .setDescription('The PNG Icon File (Transparent Background)')
        .setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      return interaction.reply({ content: '❌ Admin only.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const role = interaction.options.getRole('role');
    const emoji = interaction.options.getString('emoji');
    const iconAttachment = interaction.options.getAttachment('icon');

    // 1. Identify Clan ID
    const ids = await getIds(interaction.guildId);
    let clanId = null;

    if (role.id === ids.clanRole1Id) clanId = 1;
    else if (role.id === ids.clanRole2Id) clanId = 2;
    else if (role.id === ids.clanRole3Id) clanId = 3;
    else if (role.id === ids.clanRole4Id) clanId = 4;

    if (!clanId) {
      return interaction.editReply(`❌ The role **${role.name}** is not configured as a Clan Role (1-4).`);
    }

    try {
      // 2. Process Icon Upload (for GIF Service)
      const response = await axios.get(iconAttachment.url, { responseType: 'arraybuffer' });
      const imgBuffer = Buffer.from(response.data);
      const filename = `clan_icon_${clanId}_${Date.now()}.png`;
      
      const persistentUrl = await AssetService.storeToDevChannel(
        interaction.client,
        imgBuffer,
        filename,
        `Icon for Clan ${clanId} (${role.name})`
      );

      if (!persistentUrl) throw new Error("Failed to store icon in Dev Channel.");

      // 3. Update Database
      await Promise.all([
        // Store Icon Link for GIF Service
        DatabaseService.setClanAsset(interaction.guildId, role.id, persistentUrl),
        
        // Store Emoji String for Webhooks
        DatabaseService.atomicJsonSetPath(
            interaction.guildId, 
            'clans', 
            [clanId.toString(), 'emoji'], 
            emoji
        )
      ]);

      // 4. Success Response
      const embed = new EmbedBuilder()
        .setTitle(`✅ Clan ${clanId} Updated`)
        .setDescription(`**Role:** ${role}\n**Emoji:** ${emoji}\n**Icon:** Saved for Animations`)
        .setThumbnail(iconAttachment.url)
        .setColor(role.color || 0x00FF00);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error(error);
      await interaction.editReply(`❌ Failed: ${error.message}`);
    }
  }
};
