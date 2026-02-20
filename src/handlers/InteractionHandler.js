// src/handlers/InteractionHandler.js

const { EmbedBuilder, MessageFlags, Routes } = require('discord.js');
const logger = require('../lib/logger');
const { CustomRoleService } = require('../services/CustomRoleService');
const { ConfigService } = require('../services/ConfigService');
const { DatabaseService } = require('../services/DatabaseService');
const { LeaderboardUpdateService } = require('../services/LeaderboardUpdateService');
const { createGuildHelper } = require('../utils/GuildIdsHelper');
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

    // --- BUTTON COOLDOWN (3 Seconds) ---
    // Simple in-memory map to prevent spam/race conditions
    if (!global.buttonCooldowns) global.buttonCooldowns = new Map();
    const now = Date.now();
    const cooldownEnd = global.buttonCooldowns.get(user.id) || 0;

    if (now < cooldownEnd) {
      const timeLeft = ((cooldownEnd - now) / 1000).toFixed(1);
      return interaction.reply({
        content: `Please wait ${timeLeft}s before using another button.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Set 3s cooldown
    global.buttonCooldowns.set(user.id, now + 3000);
    // Cleanup after 3s to keep map small
    setTimeout(() => global.buttonCooldowns.delete(user.id), 3000);

    try {
      // --- "ME" BUTTON (SHOW MY RANK & HIGHLIGHT) ---
      if (customId.startsWith('leaderboard_show_rank')) {
        // ID format: "leaderboard_show_rank:type" OR just "leaderboard_show_rank" (default daily)
        const parts = customId.split(':');
        const type = parts[1] || 'daily';

        try {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (e) {
          if (e.code === 10062) {
            logger.warn(`[Interaction] Unknown interaction (timeout): ${customId}`);
            return;
          }
          throw e;
        }

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

        const {
          tempLeaderboards,
          saveTempLeaderboard,
          removeTempLeaderboard,
        } = require('../services/LeaderboardUpdateService');
        const guildTemps = tempLeaderboards.get(guildId) || {};
        const prevTempEntry = guildTemps[type]; // Now an object: { messageId, channelId, expiresAt }
        const prevTempId = prevTempEntry ? prevTempEntry.messageId : null;

        let useFallback = false;
        try {
          await interaction.deferReply(); // Public
        } catch (e) {
          if (e.code === 10062) {
            logger.warn(`[Interaction] Unknown interaction (timeout): ${customId}. Switching to fallback mode.`);
            useFallback = true;
          } else {
            throw e;
          }
        }

        // Delete previous temp leaderboard of the SAME TYPE only
        if (prevTempId) {
          try {
            if (interaction.message && interaction.message.id === prevTempId) {
              await interaction.message.delete();
            } else {
              await interaction.channel.messages.delete(prevTempId);
            }
          } catch (e) {
            logger.warn(`Failed to delete previous temp leaderboard: ${e.message}`);
          }
          removeTempLeaderboard(guildId, type);
        }

        // Generate Payload
        const payload = await LeaderboardUpdateService.generateLeaderboardPayload(guild, type, 1);

        // Send Message
        let msg;
        if (useFallback) {
          msg = await interaction.client.rest.post(Routes.channelMessages(interaction.channelId), {
            body: {
              embeds: payload.embeds?.map((e) => e.toJSON()),
              components: payload.components?.map((c) => c.toJSON()),
            },
            files: payload.files,
          });
        } else {
          msg = await interaction.editReply(payload);
        }

        // Persist new temp ID by type (map + JSON)
        saveTempLeaderboard(guildId, type, msg.id, interaction.channel.id);

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
        const targetName = targetMember ? targetMember.user.username : 'Unknown (Left)';

        const helper = await createGuildHelper(guild);
        const logChannel = await helper.getTrueLogsChannel();

        if (logChannel) {
          await interaction.client.rest.post(Routes.channelMessages(logChannel.id), {
            body: {
              content: `🗳️ **Vote:** ${user.username} voted to release ${targetName}. (Case ID: ${caseId}, Total: ${voteCount})`,
            },
          });
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
      if (interaction.deferred || interaction.replied) await interaction.editReply(errorMsg).catch(() => {});
      else await interaction.reply(errorMsg).catch(() => {});
    }
  }
};

module.exports = { handleInteraction };
