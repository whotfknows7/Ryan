// src/commands/moderation/JailCommands.js

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  Routes,
} = require('discord.js');
const { PunishmentService } = require('../../services/PunishmentService');
const { ConfigService } = require('../../services/ConfigService');
const { getIds, hasRole } = require('../../utils/GuildIdsHelper');
const { generateCaseId } = require('../../utils/CaseIdGenerator');
const logger = require('../../lib/logger');

const JailCommand = {
  data: new SlashCommandBuilder()
    .setName('jail')
    .setDescription('Jail moderation system commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) =>
      sub
        .setName('punish')
        .setDescription('Punish a member')
        .addUserOption((opt) => opt.setName('member').setDescription('Target member').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Reason (optional, can include Message IDs)').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('release')
        .setDescription('Release a member (keep offences)')
        .addUserOption((opt) => opt.setName('member').setDescription('Target member').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('forgive')
        .setDescription('Forgive a member (reduce offences)')
        .addUserOption((opt) => opt.setName('member').setDescription('Target member').setRequired(true))
    ),

  execute: async (interaction) => {
    const subcommand = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('member', true);
    let member = interaction.options.getMember('member');

    // 1. SELF-HARM PREVENTION CHECK
    if (targetUser.id === interaction.client.user.id) {
      return interaction.reply({
        content:
          '🛡️ **Security Alert:** I cannot punish myself. Doing so would cause a paradox and likely crash the universe.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const guild = interaction.guild;

    // Fallback fetch if the member object isn't cached/provided in the payload
    if (!member) {
      member = await guild.members.fetch(targetUser.id).catch(() => null);
    }

    if (!member) {
      await interaction.reply({
        content: 'Member not found or not in server!',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const userId = member.id;
    const guildId = guild.id;

    const ids = await getIds(guildId);
    const groundRoleId = ids.groundRoleId;
    const logsChannelId = ids.logsChannelId;
    const jailChannelId = ids.jailChannelId;

    // --- PUNISH LOGIC ---
    if (subcommand === 'punish') {
      let reason = interaction.options.getString('reason') || 'No reason provided';

      // [NEW] Message ID Fetching and Channel Context
      const messageIdRegex = /\b\d{17,19}\b/g;
      const foundIds = reason.match(messageIdRegex);

      if (foundIds && foundIds.length > 0) {
        const fetchedContents = [];
        for (const msgId of foundIds) {
          try {
            const msg = await interaction.channel.messages.fetch(msgId).catch(() => null);
            if (msg && msg.content) {
              fetchedContents.push(`${msgId} = "${msg.content}"`);
            }
          } catch {
            /* ignore fetch errors */
          }
        }

        if (fetchedContents.length > 0) {
          reason += `\n**Context:**\n${fetchedContents.join('\n')}`;
        }
      }

      if (!groundRoleId) {
        return interaction.reply({
          content: '❌ Ground role not configured.',
          flags: MessageFlags.Ephemeral,
        });
      }

      try {
        let log = await ConfigService.getJailLog(guildId, userId);

        const currentOffences = log?.offences || 0;
        const newOffences = Math.min(currentOffences + 1, 8);

        // 1. BAN CASE
        if (newOffences >= 8) {
          try {
            await member.ban({ reason: 'Reached 8 offences' });

            await ConfigService.createOrUpdateJailLog({
              guildId,
              userId,
              username: member.user.username,
              status: 'jailed',
              offences: newOffences,
              punishmentEnd: null,
              votes: [],
            });

            if (logsChannelId) {
              const logChannel = await guild.channels.fetch(logsChannelId).catch(() => null);
              if (logChannel) {
                const embed = new EmbedBuilder()
                  .setTitle('🔨 Member Banned')
                  .setColor('DarkRed')
                  .setThumbnail(member.user.displayAvatarURL())
                  .addFields(
                    { name: 'Member', value: `${member} (${member.user.username})`, inline: true },
                    { name: 'Reason', value: 'Reached 8 offences', inline: true },
                    { name: 'Channel', value: interaction.channel.toString(), inline: true },
                    { name: 'Banned By', value: interaction.user.toString(), inline: false }
                  )
                  .setTimestamp();
                await interaction.client.rest.post(Routes.channelMessages(logsChannelId), {
                  body: { embeds: [embed.toJSON()] },
                });
              }
            }

            return interaction.reply({
              content: `${member} banned (8 offences).`,
              flags: MessageFlags.Ephemeral,
            });
          } catch (e) {
            logger.error(`Ban failed: ${e}`);
            return interaction.reply({
              content: 'Failed to ban member.',
              flags: MessageFlags.Ephemeral,
            });
          }
        }

        // 2. EXTEND CASE (Already Jailed)
        if (log && log.status === 'jailed') {
          const newEnd = PunishmentService.getPunishmentDuration(newOffences);

          if (groundRoleId && !hasRole(member, groundRoleId)) {
            await member.roles.add(groundRoleId).catch(() => {});
          }

          await ConfigService.createOrUpdateJailLog({
            guildId,
            userId,
            username: member.user.username,
            offences: newOffences,
            status: 'jailed',
            punishmentEnd: newEnd,
            votes: [], // Reset votes on extend
          });

          // [NEW] Salty Message for Extension
          if (jailChannelId) {
            await interaction.client.rest.post(Routes.channelMessages(jailChannelId), {
              body: {
                content: `## ${member.toString()} Your sentence has been increased *(bahahaha)* (Sin #${newOffences}) \n*Enjoy your extended stay!*`,
              },
            });
          }

          const embed = new EmbedBuilder()
            .setTitle('⚠️ Member Already Punished')
            .setColor('Red')
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
              { name: 'Member', value: `${member} (${member.user.username})`, inline: true },
              { name: 'Offences Increased', value: `${log.offences} → ${newOffences}`, inline: true },
              { name: 'New Release Time', value: `<t:${Math.floor(newEnd.getTime() / 1000)}:R>`, inline: false },
              { name: 'Channel', value: interaction.channel.toString(), inline: true },
              { name: 'Reason', value: reason, inline: false },
              { name: 'Punished By', value: interaction.user.toString(), inline: false }
            )
            .setFooter({ text: `Case ID: ${log.caseId || 'N/A'}` })
            .setTimestamp();

          if (logsChannelId) {
            await interaction.client.rest.post(Routes.channelMessages(logsChannelId), {
              body: { embeds: [embed.toJSON()] },
            });
          }

          return interaction.reply({
            content: `Offences increased to ${newOffences}. Time extended.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // 3. NEW PUNISHMENT
        if (groundRoleId && !hasRole(member, groundRoleId)) {
          await member.roles.add(groundRoleId).catch(() => {});
        }

        const punishmentEnd = PunishmentService.getPunishmentDuration(newOffences);

        // Generate new Case ID
        const caseIdCount = await ConfigService.getNextPunishmentId(guildId);
        const caseId = generateCaseId(caseIdCount);

        // --- 3a. Send "Vote to Release" Embed to the CURRENT CHANNEL ---
        const voteEmbed = new EmbedBuilder()
          .setTitle(`${member.user.username} has been thrown into the Torture Chamber!`)
          .setDescription(
            `**Reason:** ${reason}\n**Offence:** ${newOffences}\n**Release:** <t:${Math.floor(punishmentEnd.getTime() / 1000)}:R>`
          )
          .setColor('Red')
          .setThumbnail(member.user.displayAvatarURL())
          .setFooter({ text: `Case ID: ${caseId}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`vote_release:${userId}:${caseId}`)
            .setLabel('Vote to Release')
            .setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('⚖️ Justice Served')
              .setDescription(`Member punished successfully.\n**User:** ${member.user.username}`)
              .setColor('Red')
              .setFooter({ text: `Case ID: ${caseId}` }),
          ],
          flags: MessageFlags.Ephemeral,
        });

        const voteMessage = await interaction.client.rest.post(Routes.channelMessages(interaction.channelId), {
          body: { embeds: [voteEmbed.toJSON()], components: [row.toJSON()] },
        });

        // --- 3b. Send Flavor Text to the JAIL CHANNEL ---
        if (jailChannelId) {
          await interaction.client.rest.post(Routes.channelMessages(jailChannelId), {
            body: {
              content:
                `## ${member.toString()}, Oh no, It looks like someone Cheeky got locked up in The Torture Chamber for violating the <#1228738698292625570>! (Sin #${newOffences})\n` +
                `### Don't worry, we'll take good care of you… by making you suffer in the most boring way possible.\n` +
                `**The only thing you'll hear is the echoes of your sins.**\n` +
                `* __Punishments:__\n` +
                `\`\`\`1st sin: 30 minutes\n2nd sin: 1 hour\n3rd sin: 12 hours\n4th sin: 36 hours\n5th sin: 7 days\n6th sin: 2 weeks\n7th sin: 4 weeks\n8th sin: Ban\`\`\`*Calling mods won't help you, You can cry them a River, Build a Bridge, and get the fuck over it!*`,
            },
          });
        }

        // Save to DB
        await ConfigService.createOrUpdateJailLog({
          guildId,
          userId,
          username: member.user.username,
          offences: newOffences,
          status: 'jailed',
          punishmentEnd,
          messageId: voteMessage.id,
          caseId: caseId,
          votes: [],
        });

        // Send Log
        if (logsChannelId) {
          const logChannel = await guild.channels.fetch(logsChannelId).catch(() => null);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('⛓️ Member Jailed')
              .setColor('Red')
              .setThumbnail(member.user.displayAvatarURL())
              .addFields(
                { name: 'Member', value: `${member} (${member.user.username})`, inline: true },
                { name: 'Offence Count', value: `${newOffences}`, inline: true },
                { name: 'Release Time', value: `<t:${Math.floor(punishmentEnd.getTime() / 1000)}:R>`, inline: false },
                { name: 'Channel', value: interaction.channel.toString(), inline: true },
                { name: 'Reason', value: reason, inline: false },
                { name: 'Punished By', value: interaction.user.toString(), inline: false }
              )
              .setFooter({ text: `Case ID: ${caseId}` })
              .setTimestamp();
            await interaction.client.rest.post(Routes.channelMessages(logsChannelId), {
              body: { embeds: [embed.toJSON()] },
            });
          }
        }

        logger.info(`${interaction.user.tag} punished ${member.user.tag} (Offence ${newOffences})`);
      } catch (error) {
        if (error.code === 10062 || error.code === 10008) return; // Ignore unknown interaction/message
        logger.error('Punish error:', error);
        const payload = { content: '❌ Error executing punishment.', flags: MessageFlags.Ephemeral };
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload);
          } else {
            await interaction.reply(payload);
          }
        } catch (e) {
          logger.error('Failed to send error response:', e);
        }
      }
    }

    // --- RELEASE LOGIC (Formerly Forgive) ---
    else if (subcommand === 'release') {
      try {
        const log = await ConfigService.getJailLog(guildId, userId);

        if (!log) {
          return interaction.reply({
            content: 'Member is not in the system.',
            flags: MessageFlags.Ephemeral,
          });
        }

        if (log.status === 'jailed') {
          // Suppress notification effectively handled by setting notify: false (need to update service first)
          // Actually, I need to update PunishmentService first to accept options.
          // Assuming service update is next:
          await PunishmentService.releaseMember(interaction.client, guildId, userId, log, { notify: false });
        } else if (log.status === 'released') {
          // ALREADY RELEASED - Do NOT log to channel, just reply ephemeral
          return interaction.reply({
            content: `Member is already released. (Offences: ${log.offences})`,
            flags: MessageFlags.Ephemeral,
          });
        }

        // Update status to released, REMOVE punishmentEnd, KEEP offences
        await ConfigService.createOrUpdateJailLog({
          guildId,
          userId,
          username: member.user.username,
          status: 'released',
          offences: log.offences, // Keep current offences
          punishmentEnd: null,
          votes: [],
        });

        if (logsChannelId) {
          const logChannel = await guild.channels.fetch(logsChannelId).catch(() => null);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('🔓 Member Released')
              .setColor('Green')
              .setThumbnail(member.user.displayAvatarURL())
              .addFields(
                { name: 'Member', value: `${member} (${member.user.username})`, inline: true },
                { name: 'Offences', value: `${log.offences} (Preserved)`, inline: true },
                { name: 'Channel', value: interaction.channel.toString(), inline: true },
                { name: 'Released By', value: interaction.user.toString(), inline: false }
              )
              .setFooter({ text: `Case ID: ${log.caseId || 'N/A'}` })
              .setTimestamp();
            await interaction.client.rest.post(Routes.channelMessages(logsChannelId), {
              body: { embeds: [embed.toJSON()] },
            });
          }
        }

        await interaction.reply({
          content: `${member} has been released (offences maintained).`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        logger.error('Error executing release command:', error);
        const payload = { content: '❌ Failed to release member.', flags: MessageFlags.Ephemeral };
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload);
          } else {
            await interaction.reply(payload);
          }
        } catch (e) {
          logger.error('Failed to send error response:', e);
        }
      }
    }

    // --- FORGIVE LOGIC (Formerly Lets Go Ez) ---
    else if (subcommand === 'forgive') {
      try {
        const log = await ConfigService.getJailLog(guildId, userId);

        if (!log || log.offences === 0) {
          return interaction.reply({
            content: 'No offences to reduce.',
            flags: MessageFlags.Ephemeral,
          });
        }

        const newOffences = log.offences - 1;

        if (newOffences === 0) {
          // Full release
          const updatedLog = { ...log, offences: 0, status: 'released', punishmentEnd: null };

          if (log.status === 'jailed') {
            await PunishmentService.releaseMember(interaction.client, guildId, userId, updatedLog);
          }

          await ConfigService.createOrUpdateJailLog({
            guildId,
            userId,
            username: member.user.username,
            offences: 0,
            status: 'released',
            punishmentEnd: null,
            votes: [],
          });

          await interaction.reply({
            content: 'Offences reduced to 0. Member released.',
            flags: MessageFlags.Ephemeral,
          });
        } else {
          // Recalculate time
          const oldDuration = PunishmentService.getDurationMs(log.offences);
          const newDuration = PunishmentService.getDurationMs(newOffences);
          const diff = oldDuration - newDuration;

          let replyMsg = '';

          if (log.status === 'jailed' && log.punishmentEnd) {
            const currentEnd = new Date(log.punishmentEnd).getTime();
            const newEndMs = currentEnd - diff;

            if (newEndMs <= Date.now()) {
              // Time served immediately
              const updatedLog = { ...log, offences: newOffences, status: 'released', punishmentEnd: null };
              await PunishmentService.releaseMember(interaction.client, guildId, userId, updatedLog);

              await ConfigService.createOrUpdateJailLog({
                guildId,
                userId,
                username: member.user.username,
                offences: newOffences,
                status: 'released',
                punishmentEnd: null,
                votes: [],
              });
              replyMsg = `Offences reduced to ${newOffences}. Time served! Member released.`;
            } else {
              // Just shorten time
              const newEnd = new Date(newEndMs);
              await ConfigService.createOrUpdateJailLog({
                guildId,
                userId,
                username: member.user.username,
                offences: newOffences,
                status: 'jailed',
                punishmentEnd: newEnd,
              });
              replyMsg = `Offences reduced to ${newOffences}. New release: <t:${Math.floor(newEndMs / 1000)}:R>`;
            }
          } else {
            await ConfigService.createOrUpdateJailLog({
              guildId,
              userId,
              username: member.user.username,
              offences: newOffences,
            });
            replyMsg = `Offences reduced to ${newOffences}. (Member was not currently jailed or timer was paused).`;
          }

          await interaction.reply({
            content: replyMsg,
            flags: MessageFlags.Ephemeral,
          });
        }

        if (logsChannelId) {
          const logChannel = await guild.channels.fetch(logsChannelId).catch(() => null);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('📉 Punishment Reduced')
              .setColor('Orange')
              .setThumbnail(member.user.displayAvatarURL())
              .addFields(
                { name: 'Member', value: `${member} (${member.user.username})`, inline: true },
                { name: 'Offences', value: `${log.offences} → ${newOffences}`, inline: true },
                { name: 'Channel', value: interaction.channel.toString(), inline: true },
                { name: 'Reduced By', value: interaction.user.toString(), inline: false }
              )
              .setFooter({ text: `Case ID: ${log.caseId || 'N/A'}` })
              .setTimestamp();
            await interaction.client.rest.post(Routes.channelMessages(logsChannelId), {
              body: { embeds: [embed.toJSON()] },
            });
          }
        }
      } catch (error) {
        logger.error('Error executing forgive command:', error);
        const payload = { content: '❌ Failed to forgive (reduce punishment).', flags: MessageFlags.Ephemeral };
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload);
          } else {
            await interaction.reply(payload);
          }
        } catch (e) {
          logger.error('Failed to send error response:', e);
        }
      }
    }
  },
};

module.exports = JailCommand;
