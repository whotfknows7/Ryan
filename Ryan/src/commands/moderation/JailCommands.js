// src/commands/moderation/JailCommands.js

const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  PermissionFlagsBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  MessageFlags 
} = require('discord.js');
const { PunishmentService } = require('../../services/PunishmentService');
const { ConfigService } = require('../../services/ConfigService');
const { getIds } = require('../../utils/GuildIdsHelper');
const logger = require('../../lib/logger');

const JailCommand = {
  data: new SlashCommandBuilder()
    .setName('jail')
    .setDescription('Jail moderation system commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(sub => 
      sub.setName('punish')
         .setDescription('Punish a member')
         .addUserOption(opt => opt.setName('member').setDescription('Target member').setRequired(true))
         .addStringOption(opt => opt.setName('reason').setDescription('Reason').setRequired(true))
    )
    .addSubcommand(sub => 
      sub.setName('forgive')
         .setDescription('Forgive a member')
         .addUserOption(opt => opt.setName('member').setDescription('Target member').setRequired(true))
    )
    .addSubcommand(sub => 
      sub.setName('lets_go_ez')
         .setDescription('Reduce punishment (lets_go_ez)')
         .addUserOption(opt => opt.setName('member').setDescription('Target member').setRequired(true))
    ),

  execute: async (interaction) => {
    const subcommand = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('member', true);
    
    // 1. SELF-HARM PREVENTION CHECK
    if (targetUser.id === interaction.client.user.id) {
      return interaction.reply({ 
        content: "🛡️ **Security Alert:** I cannot punish myself. Doing so would cause a paradox and likely crash the universe.", 
        flags: MessageFlags.Ephemeral 
      });
    }

    const guild = interaction.guild;
    const member = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      await interaction.reply({ 
        content: 'Member not found or not in server!', 
        flags: MessageFlags.Ephemeral 
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
      const reason = interaction.options.getString('reason', true);
      
      if (!groundRoleId) {
        return interaction.reply({ 
          content: '❌ Ground role not configured.', 
          flags: MessageFlags.Ephemeral 
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
               guildId, userId, 
               username: member.user.username,
               status: 'jailed',
               offences: newOffences,
               punishmentEnd: null,
               votes: []
             });
             
             if (logsChannelId) {
               const logChannel = guild.channels.cache.get(logsChannelId);
               if (logChannel) {
                 const embed = new EmbedBuilder()
                   .setTitle('🔨 Member Banned')
                   .setColor('DarkRed')
                   .setThumbnail(member.user.displayAvatarURL())
                   .addFields(
                     { name: 'Member', value: member.toString(), inline: true },
                     { name: 'Reason', value: 'Reached 8 offences', inline: true },
                     { name: 'Banned By', value: interaction.user.toString(), inline: false }
                   )
                   .setTimestamp();
                 await logChannel.send({ embeds: [embed] });
               }
             }
             
             return interaction.reply({ 
               content: `${member} banned (8 offences).`, 
               flags: MessageFlags.Ephemeral 
             });
          } catch (e) {
             logger.error(`Ban failed: ${e}`);
             return interaction.reply({ 
               content: 'Failed to ban member.', 
               flags: MessageFlags.Ephemeral 
             });
          }
        }

        // 2. EXTEND CASE (Already Jailed)
        if (log && log.status === 'jailed') {
           const newEnd = PunishmentService.getPunishmentDuration(newOffences);
           
           if (groundRoleId) await member.roles.add(groundRoleId).catch(() => {});

           await ConfigService.createOrUpdateJailLog({
             guildId, userId,
             username: member.user.username,
             offences: newOffences,
             status: 'jailed',
             punishmentEnd: newEnd,
             votes: [] // Reset votes on extend
           });
           
           const embed = new EmbedBuilder()
             .setTitle('⚠️ Member Already Punished')
             .setColor('Red')
             .setThumbnail(member.user.displayAvatarURL())
             .addFields(
               { name: 'Member', value: member.toString(), inline: true },
               { name: 'Offences Increased', value: `${log.offences} → ${newOffences}`, inline: true },
               { name: 'New Release Time', value: `<t:${Math.floor(newEnd.getTime() / 1000)}:R>`, inline: false },
               { name: 'Reason', value: reason, inline: false },
               { name: 'Punished By', value: interaction.user.toString(), inline: false }
             )
             .setTimestamp();
           
           if (logsChannelId) {
             const logChannel = guild.channels.cache.get(logsChannelId);
             if (logChannel) await logChannel.send({ embeds: [embed] });
           }
           
           return interaction.reply({ 
             content: `Offences increased to ${newOffences}. Time extended.`, 
             flags: MessageFlags.Ephemeral 
           });
        }

        // 3. NEW PUNISHMENT
        if (groundRoleId) await member.roles.add(groundRoleId);
        
        const punishmentEnd = PunishmentService.getPunishmentDuration(newOffences);
        
        // --- 3a. Send "Vote to Release" Embed to the CURRENT CHANNEL ---
        const voteEmbed = new EmbedBuilder()
            .setTitle(`${member.user.username} has been thrown into the Torture Chamber!`)
            .setDescription(`**Reason:** ${reason}\n**Offence:** ${newOffences}\n**Release:** <t:${Math.floor(punishmentEnd.getTime() / 1000)}:R>`)
            .setColor('Red')
            .setThumbnail(member.user.displayAvatarURL());

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`vote_release:${userId}`)
                .setLabel('Vote to Release')
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({ 
            content: `Member punished.`, 
            flags: MessageFlags.Ephemeral 
        });

        const voteMessage = await interaction.channel.send({
            embeds: [voteEmbed],
            components: [row]
        });

        // --- 3b. Send Flavor Text to the JAIL CHANNEL ---
        if (jailChannelId) {
           const jailChannel = guild.channels.cache.get(jailChannelId);
           if (jailChannel) {
             await jailChannel.send(
                `## ${member.toString()}, Oh no, It looks like someone Cheeky got locked up in The Torture Chamber for violating the <#1228738698292625570>!\n` +
                `### Don't worry, we'll take good care of you… by making you suffer in the most boring way possible.\n` +
                `**The only thing you'll hear is the echoes of your sins.**\n` +
                `* __Punishments:__\n` +
                `\`\`\`1st sin: 30 minutes\n2nd sin: 1 hour\n3rd sin: 12 hours\n4th sin: 36 hours\n5th sin: 7 days\n6th sin: 2 weeks\n7th sin: 4 weeks\n8th sin: Ban\`\`\`*Calling mods won't help you, You can cry them a River, Build a Bridge, and get the fuck over it!*`
             );
           }
        }

        // Save to DB
        await ConfigService.createOrUpdateJailLog({
          guildId, userId,
          username: member.user.username,
          offences: newOffences,
          status: 'jailed',
          punishmentEnd,
          messageId: voteMessage.id,
          votes: []
        });

        // Send Log
        if (logsChannelId) {
          const logChannel = guild.channels.cache.get(logsChannelId);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('⛓️ Member Jailed')
              .setColor('Red')
              .setThumbnail(member.user.displayAvatarURL())
              .addFields(
                { name: 'Member', value: member.toString(), inline: true },
                { name: 'Offence Count', value: `${newOffences}`, inline: true },
                { name: 'Release Time', value: `<t:${Math.floor(punishmentEnd.getTime() / 1000)}:R>`, inline: false },
                { name: 'Reason', value: reason, inline: false },
                { name: 'Punished By', value: interaction.user.toString(), inline: false }
              )
              .setTimestamp();
            await logChannel.send({ embeds: [embed] });
          }
        }

        logger.info(`${interaction.user.tag} punished ${member.user.tag} (Offence ${newOffences})`);

      } catch (error) {
        logger.error('Punish error:', error);
        if (!interaction.replied) {
            await interaction.reply({ 
            content: '❌ Error executing punishment.', 
            flags: MessageFlags.Ephemeral 
            });
        }
      }
    }

    // --- FORGIVE LOGIC ---
    else if (subcommand === 'forgive') {
      try {
        const log = await ConfigService.getJailLog(guildId, userId);

        if (!log) {
          return interaction.reply({ 
            content: 'Member is not in the system.', 
            flags: MessageFlags.Ephemeral 
          });
        }

        if (log.status === 'jailed') {
          await PunishmentService.releaseMember(interaction.client, guildId, userId, log);
        }

        await ConfigService.createOrUpdateJailLog({
            guildId, userId,
            username: member.user.username,
            status: 'forgiven',
            offences: 0,
            punishmentEnd: null,
            votes: []
        });

        if (logsChannelId) {
          const logChannel = guild.channels.cache.get(logsChannelId);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('🕊️ Member Forgiven')
              .setColor('Green')
              .setThumbnail(member.user.displayAvatarURL())
              .addFields(
                { name: 'Member', value: member.toString(), inline: true },
                { name: 'Previous Offences', value: `${log.offences}`, inline: true },
                { name: 'Forgiven By', value: interaction.user.toString(), inline: false }
              )
              .setTimestamp();
            await logChannel.send({ embeds: [embed] });
          }
        }

        await interaction.reply({ 
          content: `${member} has been forgiven.`, 
          flags: MessageFlags.Ephemeral 
        });

      } catch (error) {
        logger.error('Error executing forgive command:', error);
        await interaction.reply({ 
          content: '❌ Failed to forgive member.', 
          flags: MessageFlags.Ephemeral 
        });
      }
    }

    // --- LESSEN LOGIC ---
    else if (subcommand === 'lets_go_ez') {
      try {
        const log = await ConfigService.getJailLog(guildId, userId);

        if (!log || log.offences === 0) {
          return interaction.reply({ 
            content: 'No offences to reduce.', 
            flags: MessageFlags.Ephemeral 
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
             guildId, userId,
             username: member.user.username,
             offences: 0,
             status: 'released',
             punishmentEnd: null,
             votes: []
          });

          await interaction.reply({ 
            content: 'Offences reduced to 0. Member released.', 
            flags: MessageFlags.Ephemeral 
          });
          
        } else {
          // Recalculate time
          const oldDuration = PunishmentService.getDurationMs(log.offences);
          const newDuration = PunishmentService.getDurationMs(newOffences);
          const diff = oldDuration - newDuration;
          
          let replyMsg = "";
          
          if (log.status === 'jailed' && log.punishmentEnd) {
              const currentEnd = new Date(log.punishmentEnd).getTime();
              const newEndMs = currentEnd - diff;
              
              if (newEndMs <= Date.now()) {
                  // Time served immediately
                  const updatedLog = { ...log, offences: newOffences, status: 'released', punishmentEnd: null };
                  await PunishmentService.releaseMember(interaction.client, guildId, userId, updatedLog);
                  
                  await ConfigService.createOrUpdateJailLog({
                     guildId, userId,
                     username: member.user.username,
                     offences: newOffences,
                     status: 'released',
                     punishmentEnd: null,
                     votes: []
                  });
                  replyMsg = `Offences reduced to ${newOffences}. Time served! Member released.`;
              } else {
                  // Just shorten time
                  const newEnd = new Date(newEndMs);
                  await ConfigService.createOrUpdateJailLog({
                     guildId, userId,
                     username: member.user.username,
                     offences: newOffences,
                     status: 'jailed',
                     punishmentEnd: newEnd
                  });
                  replyMsg = `Offences reduced to ${newOffences}. New release: <t:${Math.floor(newEndMs / 1000)}:R>`;
              }
          } else {
              await ConfigService.createOrUpdateJailLog({
                 guildId, userId,
                 username: member.user.username,
                 offences: newOffences
              });
              replyMsg = `Offences reduced to ${newOffences}. (Member was not currently jailed or timer was paused).`;
          }

          await interaction.reply({ 
            content: replyMsg, 
            flags: MessageFlags.Ephemeral 
          });
        }

        if (logsChannelId) {
          const logChannel = guild.channels.cache.get(logsChannelId);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('📉 Punishment Lessened')
              .setColor('Orange')
              .setThumbnail(member.user.displayAvatarURL())
              .addFields(
                { name: 'Member', value: member.toString(), inline: true },
                { name: 'Offences', value: `${log.offences} → ${newOffences}`, inline: true },
                { name: 'Lessened By', value: interaction.user.toString(), inline: false }
              )
              .setTimestamp();
            await logChannel.send({ embeds: [embed] });
          }
        }

      } catch (error) {
        logger.error('Error executing lessen command:', error);
        await interaction.reply({ 
          content: '❌ Failed to lessen punishment.', 
          flags: MessageFlags.Ephemeral 
        });
      }
    }
  }
};

module.exports = JailCommand;
