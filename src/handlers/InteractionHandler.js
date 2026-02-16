// src/handlers/InteractionHandler.js

const {
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const logger = require('../lib/logger');
const { CustomRoleService } = require('../services/CustomRoleService');
const { ConfigService } = require('../services/ConfigService');
const { DatabaseService } = require('../services/DatabaseService');
const { LeaderboardUpdateService } = require('../services/LeaderboardUpdateService');
const { getIds } = require('../utils/GuildIdsHelper');
const { checkCooldown } = require('../lib/cooldowns');

const handleInteraction = async (interaction) => {
  // 1. SLASH COMMANDS
  if (interaction.isChatInputCommand()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    const cooldown = await checkCooldown(interaction.user.id, command);
    if (cooldown.onCooldown) {
      return interaction.reply({
        content: `Please wait ${cooldown.timeLeft.toFixed(1)} more second(s) before reusing the \`${command.data.name}\` command.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      if (error.code === 40060) return; // Ignore "Interaction already acknowledged"
      logger.error(`Error executing ${interaction.commandName}:`, error);
      const payload = { content: '❌ Error executing command!', flags: MessageFlags.Ephemeral };
      try {
        if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch {
        /* ignore secondary error */
      }
    }
    return;
  }

  // 2. BUTTON INTERACTIONS
  if (interaction.isButton()) {
    const { customId, guildId, guild, user } = interaction;

    try {
      // --- "ME" BUTTON (SHOW MY RANK & HIGHLIGHT) ---
      if (customId.startsWith('leaderboard_show_rank')) {
        // ID format: "leaderboard_show_rank:type" OR just "leaderboard_show_rank" (default daily)
        const parts = customId.split(':');
        const type = parts[1] || 'daily';

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // 1. Get exact rank for this type
        const rank = await DatabaseService.getUserRank(guildId, user.id, type);

        if (!rank || rank === 0) {
          return interaction.editReply({ content: `You are not ranked in the **${type}** leaderboard yet!` });
        }

        // 2. Calculate Page
        const page = Math.ceil(rank / 10);

        // 3. Generate Payload with Highlight
        const payload = await LeaderboardUpdateService.generateLeaderboardPayload(guild, type, page, user.id);

        return interaction.editReply(payload);
      }

      // --- VIEW SWITCHER (WEEKLY / ALL-TIME) ---
      if (customId.startsWith('leaderboard_view:')) {
        const type = customId.split(':')[1]; // 'weekly' or 'lifetime'
        await interaction.deferReply();

        const payload = await LeaderboardUpdateService.generateLeaderboardPayload(guild, type, 1);
        const msg = await interaction.editReply(payload);

        // Create persistent leaderboard record (Deleted after 5 mins)
        try {
          // Import service inside method to avoid circular deps if needed, or stick to top-level if safe.
          const { LeaderboardCleanupService } = require('../services/LeaderboardCleanupService');

          await LeaderboardCleanupService.addLeaderboard(guildId, msg.channelId, msg.id, msg.url);
        } catch (e) {
          logger.error('Failed to register leaderboard for cleanup:', e);
        }

        return;
      }

      // --- LEADERBOARD PAGINATION ---
      if (customId.startsWith('leaderboard_page:')) {
        const parts = customId.split(':');
        const targetPage = parseInt(parts[2]);
        const type = parts[3] || 'daily';

        const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral);

        // Check if this is a "Me" view by looking for highlight in current message
        const preserveHighlight = isEphemeral; // If ephemeral, likely from "Me" button
        const highlightUserId = preserveHighlight ? user.id : null;

        if (!isEphemeral) {
          // Main LB click -> Ephemeral Reply
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const payload = await LeaderboardUpdateService.generateLeaderboardPayload(
            guild,
            type,
            targetPage,
            highlightUserId
          );
          return interaction.editReply(payload);
        } else {
          // Inside "Me" view or other ephemeral view -> Update In Place
          await interaction.deferUpdate();
          const payload = await LeaderboardUpdateService.generateLeaderboardPayload(
            guild,
            type,
            targetPage,
            highlightUserId
          );
          return interaction.editReply(payload);
        }
      }
      // --- JAIL VOTE RELEASE ---
      if (customId.startsWith('vote_release:')) {
        const parts = customId.split(':');
        const targetUserId = parts[1];
        const buttonCaseId = parts[2]; // May be undefined for old buttons
        const voterId = user.id;

        // 1. Fetch Current Log First
        const log = await ConfigService.getJailLog(guildId, targetUserId);

        if (!log) {
          return interaction.reply({
            content: '❌ Member is not currently in the system.',
            flags: MessageFlags.Ephemeral,
          });
        }

        // 2. Validate Case ID (if button has one)
        if (buttonCaseId && log.caseId !== buttonCaseId) {
          return interaction.reply({
            content: '❌ This vote is for a previous/different case.',
            flags: MessageFlags.Ephemeral,
          });
        }

        // 3. Validate Status
        if (log.status !== 'jailed') {
          return interaction.reply({
            content: '❌ Member is already released or not jailed.',
            flags: MessageFlags.Ephemeral,
          });
        }

        // 4. Validate Ban (Offences >= 8)
        if (log.offences >= 8) {
          return interaction.reply({
            content: '❌ Voting is disabled for banned members.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const hasVoted = await ConfigService.hasVoted(guildId, targetUserId, voterId);
        if (hasVoted) {
          return interaction.reply({ content: '❌ You have already voted.', flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ content: '✅ Vote registered!', flags: MessageFlags.Ephemeral });

        const updatedLog = await ConfigService.addVote(guildId, targetUserId, voterId);
        if (!updatedLog) return;

        const voteCount = updatedLog.votes.length;
        const caseId = updatedLog.caseId || 'N/A';

        const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
        const targetName = targetMember ? targetMember.user.username : 'Unknown';

        const ids = await getIds(guildId);
        if (ids.logsChannelId) {
          const logChannel = guild.channels.cache.get(ids.logsChannelId);
          if (logChannel)
            await logChannel.send(
              `🗳️ **Vote:** ${user.username} voted to release ${targetName}. (Case ID: ${caseId}, Total: ${voteCount})`
            );
        }
        return;
      }

      // --- CUSTOM ROLE LOGIC ---
      if (customId.startsWith('custom_role_approve_')) {
        const requestId = customId.replace('custom_role_approve_', '');
        await interaction.deferUpdate();
        await CustomRoleService.approveRoleRequest(guild, user, requestId);
        const newEmbed = new EmbedBuilder(interaction.message.embeds[0].data)
          .setColor(0x00ff00)
          .setTitle('✅ Request Approved')
          .addFields({ name: 'Approved By', value: user.toString(), inline: true });
        return interaction.editReply({ embeds: [newEmbed], components: [] });
      } else if (customId.startsWith('custom_role_deny_')) {
        const requestId = customId.replace('custom_role_deny_', '');
        await interaction.deferUpdate();
        await CustomRoleService.denyRoleRequest(guildId, requestId);
        const newEmbed = new EmbedBuilder(interaction.message.embeds[0].data)
          .setColor(0xff0000)
          .setTitle('❌ Request Denied')
          .addFields({ name: 'Denied By', value: user.toString(), inline: true });
        return interaction.editReply({ embeds: [newEmbed], components: [] });
      }
    } catch (error) {
      logger.error(`Error handling button ${customId}:`, error);
      const errorMsg = { content: '❌ An error occurred while processing this action.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.editReply(errorMsg).catch(() => { });
      else await interaction.reply(errorMsg).catch(() => { });
    }
  }
};

module.exports = { handleInteraction };
