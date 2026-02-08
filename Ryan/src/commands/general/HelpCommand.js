// src/handlers/InteractionHandler.js

const { Events, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const logger = require('../lib/logger');
const { CustomRoleService } = require('../services/CustomRoleService');
const { ConfigService } = require('../services/ConfigService');
const { DatabaseService } = require('../services/DatabaseService');
const { ImageService } = require('../services/ImageService');
const { getIds } = require('../utils/GuildIdsHelper');

const handleInteraction = async (interaction) => {
  // 1. SLASH COMMANDS
  if (interaction.isChatInputCommand()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error(`Error executing ${interaction.commandName}:`, error);
      const payload = { content: '❌ Error executing command!', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    }
    return;
  }
  
  // 2. BUTTON INTERACTIONS
  if (interaction.isButton()) {
    const { customId } = interaction;
    const guildId = interaction.guildId;
    
    try {
      // --- LEADERBOARD: SHOW RANK ---
      if (customId === 'leaderboard_show_rank') {
        await handleShowRank(interaction);
        return;
      }
      
      // --- LEADERBOARD: PAGINATION ---
      if (customId.startsWith('leaderboard_page:')) {
        const [_, type, pageNum] = customId.split(':');
        const targetPage = parseInt(pageNum);
        
        // CRITICAL CHECK: Is the button clicked on an Ephemeral message?
        const isEphemeralContext = interaction.message.flags?.has(MessageFlags.Ephemeral);
        
        await handlePagination(interaction, targetPage, isEphemeralContext);
        return;
      }
      
      // --- JAIL: VOTE RELEASE ---
      if (customId.startsWith('vote_release:')) {
        // [FIXED] Use flags instead of ephemeral: true
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const targetUserId = customId.split(':')[1];
        const voterId = interaction.user.id;
        
        const hasVoted = await ConfigService.hasVoted(guildId, targetUserId, voterId);
        if (hasVoted) return interaction.editReply({ content: '❌ You have already voted.' });
        
        await ConfigService.addVote(guildId, targetUserId, voterId);
        const voteCount = await ConfigService.getVoteCount(guildId, targetUserId);
        
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
        const targetName = targetMember ? targetMember.user.username : 'Unknown';
        
        const ids = await getIds(guildId);
        if (ids.logsChannelId) {
          const logChannel = guild.channels.cache.get(ids.logsChannelId);
          if (logChannel) await logChannel.send(`${interaction.user.username} voted to release ${targetName}. Total: ${voteCount}`);
        }
        
        await interaction.editReply({ content: `✅ Vote registered for ${targetName}.` });
        return;
      }
      
      // --- CUSTOM ROLE LOGIC ---
      if (customId.startsWith('custom_role_approve_')) {
        const requestId = customId.replace('custom_role_approve_', '');
        await interaction.deferUpdate();
        await CustomRoleService.approveRoleRequest(interaction.guild, interaction.user, requestId);
        const newEmbed = new EmbedBuilder(interaction.message.embeds[0].data)
          .setColor(0x00FF00).setTitle('✅ Request Approved')
          .addFields({ name: 'Approved By', value: interaction.user.toString(), inline: true });
        await interaction.editReply({ embeds: [newEmbed], components: [] });
        return;
        
      } else if (customId.startsWith('custom_role_deny_')) {
        const requestId = customId.replace('custom_role_deny_', '');
        await interaction.deferUpdate();
        await CustomRoleService.denyRoleRequest(interaction.guild.id, requestId);
        const newEmbed = new EmbedBuilder(interaction.message.embeds[0].data)
          .setColor(0xFF0000).setTitle('❌ Request Denied')
          .addFields({ name: 'Denied By', value: interaction.user.toString(), inline: true });
        await interaction.editReply({ embeds: [newEmbed], components: [] });
        return;
      }
      
    } catch (error) {
      logger.error(`Error handling button ${customId}:`, error);
      // [FIXED] Use flags instead of ephemeral: true
      const errorMsg = { content: '❌ An error occurred while processing this action.', flags: MessageFlags.Ephemeral };
      
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorMsg).catch(e => logger.error('Failed to send error reply:', e));
      } else {
        await interaction.reply(errorMsg).catch(e => logger.error('Failed to send error reply:', e));
      }
    }
  }
};

// =========================================
// HELPER FUNCTIONS
// =========================================

async function handleShowRank(interaction) {
  // [FIXED] Use flags instead of ephemeral: true
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const allUsers = await DatabaseService.getAllUserXp(guildId);
  
  // Find Rank
  allUsers.sort((a, b) => b.xp - a.xp);
  const index = allUsers.findIndex(u => u.userId === userId);
  
  if (index === -1) {
    return interaction.editReply({ content: "You are not ranked yet! Start chatting to earn XP." });
  }
  
  const rank = index + 1;
  const page = Math.ceil(rank / 10);
  
  // Send the page (Pass userId to highlight them)
  await generateAndSendPage(interaction, allUsers, page, userId, false);
}

async function handlePagination(interaction, targetPage, isEphemeralContext) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id; // Highlighting logic remains for the user clicking
  const allUsers = await DatabaseService.getAllUserXp(guildId);
  allUsers.sort((a, b) => b.xp - a.xp);
  
  // Logic Branch:
  // 1. If clicked on Public Message -> New Ephemeral Reply (don't touch public msg)
  // 2. If clicked on Private Message -> Update that Private Message
  if (!isEphemeralContext) {
    // [FIXED] Use flags instead of ephemeral: true
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await generateAndSendPage(interaction, allUsers, targetPage, userId, false);
  } else {
    await interaction.deferUpdate();
    await generateAndSendPage(interaction, allUsers, targetPage, userId, true);
  }
}

async function generateAndSendPage(interaction, allUsers, page, highlightUserId, isUpdate) {
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(allUsers.length / pageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));
  
  const startIndex = (safePage - 1) * pageSize;
  const pageUsers = allUsers.slice(startIndex, startIndex + pageSize);
  
  // Parallel fetch for speed
  const usersForImage = await Promise.all(pageUsers.map(async (u, idx) => {
    const member = await interaction.guild.members.fetch(u.userId).catch(() => null);
    return {
      rank: startIndex + idx + 1,
      userId: u.userId,
      username: member ? (member.nickname || member.user.username) : 'Unknown',
      avatarUrl: member?.displayAvatarURL({ extension: 'png' }) || null,
      xp: u.xp
    };
  }));
  
  // Generate Image (Highlighting the user who clicked)
  const imageBuffer = await ImageService.generateLeaderboard(usersForImage, highlightUserId);
  const attachment = new AttachmentBuilder(imageBuffer, { name: `leaderboard_p${safePage}.png` });
  
  // Determine user's actual rank for footer
  const userRankIndex = allUsers.findIndex(u => u.userId === highlightUserId);
  const rankText = userRankIndex !== -1 ? ` • Your Rank: ${userRankIndex + 1}` : '';
  
  const embed = new EmbedBuilder()
    .setTitle(`Leaderboard • Page ${safePage}/${totalPages}`)
    .setImage(`attachment://leaderboard_p${safePage}.png`)
    .setColor('Gold')
    .setFooter({ text: `Page ${safePage} of ${totalPages}${rankText}` });
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
    .setCustomId(`leaderboard_page:prev:${safePage - 1}`)
    .setLabel('◀')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(safePage === 1),
    
    new ButtonBuilder()
    .setCustomId(`leaderboard_page:next:${safePage + 1}`)
    .setLabel('▶')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(safePage === totalPages)
  );
  
  const payload = {
    content: ``, // Clear any previous content
    embeds: [embed],
    files: [attachment],
    components: [row]
  };
  
  await interaction.editReply(payload);
}

module.exports = { handleInteraction };