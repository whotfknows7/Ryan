// src/services/PunishmentService.js

const { EmbedBuilder } = require('discord.js');
const { getIds } = require('../utils/GuildIdsHelper');
const logger = require('../lib/logger');
const { prisma } = require('../lib/prisma');

class PunishmentService {
  
  static getDurationMs(offences) {
    switch (offences) {
      case 1: return 30 * 60 * 1000;              // 30 minutes
      case 2: return 60 * 60 * 1000;              // 1 hour
      case 3: return 12 * 60 * 60 * 1000;         // 12 hours
      case 4: return 36 * 60 * 60 * 1000;         // 36 hours
      case 5: return 7 * 24 * 60 * 60 * 1000;     // 7 days
      case 6: return 14 * 24 * 60 * 60 * 1000;    // 2 weeks
      case 7: return 28 * 24 * 60 * 60 * 1000;    // 4 weeks
      default: return 52 * 7 * 24 * 60 * 60 * 1000; // 1 year
    }
  }

  static getDurationText(offences) {
    switch (offences) {
      case 1: return "30 minutes";
      case 2: return "1 hour";
      case 3: return "12 hours";
      case 4: return "36 hours";
      case 5: return "7 days";
      case 6: return "2 weeks";
      case 7: return "4 weeks";
      default: return "Ban";
    }
  }

  static getPunishmentDuration(offences) {
    return new Date(Date.now() + this.getDurationMs(offences));
  }
  
  static async checkExpiredPunishments(client) {
    try {
      const expiredLogs = await prisma.jailLog.findMany({
        where: {
          status: 'jailed',
          punishmentEnd: { 
            lte: new Date(),
            not: null 
          }
        }
      });
      
      for (const log of expiredLogs) {
        await this.releaseMember(client, log.guildId, log.userId, log);
      }
    } catch (error) {
      logger.error('Error checking expired punishments:', error);
    }
  }

  static async releaseMember(client, guildId, userId, log) {
    let guild;
    
    try {
      // [FIX] Use fetch to ensure we find the guild even if not in cache (cold boot)
      // If the bot was kicked from the guild, this will throw.
      guild = await client.guilds.fetch(guildId);
    } catch (e) {
      logger.warn(`Could not fetch guild ${guildId} for releaseMember. Bot may have been kicked. Marking as released to stop loop.`);
      // [FIX] Update DB regardless of Discord status to prevent infinite loop of "checkExpiredPunishments"
      await prisma.jailLog.update({
        where: { guildId_userId: { guildId, userId } },
        data: { status: 'released' }
      });
      return;
    }

    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      
      // Update DB to Released
      await prisma.jailLog.update({
        where: { guildId_userId: { guildId, userId } },
        data: { status: 'released' }
      });

      const ids = await getIds(guildId);
      const groundRoleId = ids.groundRoleId;
      const logsChannelId = ids.logsChannelId;
      const logChannel = logsChannelId ? guild.channels.cache.get(logsChannelId) : null;

      if (member) {
        if (groundRoleId && member.roles.cache.has(groundRoleId)) {
          try {
            await member.roles.remove(groundRoleId);
          } catch (roleError) {
            // [FIX] Handle Role Removal Failure ("Ghost Prisoner")
            logger.error(`Failed to remove role from ${userId}: ${roleError}`);
            
            if (logChannel) {
              const errEmbed = new EmbedBuilder()
                .setTitle('⚠️ Release Error: Role Removal Failed')
                .setColor('DarkOrange')
                .setDescription(`The user <@${userId}> was marked as released in the database, but I could not remove the Ground Role. **Please check my role hierarchy.**`)
                .setTimestamp();
              await logChannel.send({ embeds: [errEmbed] });
            }
          }
        }
      }
      
      // Send Success Log
      if (logChannel) {
        const embed = new EmbedBuilder()
          .setTitle('Member Released Automatically')
          .setColor('Green')
          .addFields(
            { name: 'Member', value: `<@${userId}>` },
            { name: 'Offences', value: `${log.offences}` }
          )
          .setTimestamp();
        await logChannel.send({ embeds: [embed] });
      }
      
      logger.info(`Automatically released member ${userId}`);
      
    } catch (error) {
      logger.error(`Failed to release member ${userId}: ${error}`);
    }
  }

  static async handleMemberJoin(member) {
    try {
      const log = await prisma.jailLog.findUnique({
        where: { guildId_userId: { guildId: member.guild.id, userId: member.id } }
      });

      if (!log || log.status !== 'jailed') return false;
      
      if (log.offences >= 8) {
        await member.ban({ reason: "Rejoined after reaching 8 offences." });
        logger.info(`Banned ${member.user.tag} for reaching 8 offences upon rejoin`);
        return true;
      }
      
      const ids = await getIds(member.guild.id);
      const groundRoleId = ids.groundRoleId;
      const jailChannelId = ids.jailChannelId;
      const logsChannelId = ids.logsChannelId;
      
      if (groundRoleId && !member.roles.cache.has(groundRoleId)) {
        await member.roles.add(groundRoleId);
      }
      
      const newEnd = this.getPunishmentDuration(log.offences);
      
      await prisma.jailLog.update({
        where: { guildId_userId: { guildId: member.guild.id, userId: member.id } },
        data: { punishmentEnd: newEnd }
      });
          
      if (jailChannelId) {
        const jailChannel = member.guild.channels.cache.get(jailChannelId);
        if (jailChannel) {
          await jailChannel.send(
            `${member.toString()}, welcome back! Your sentence has been increased/resumed for leaving the server. Enjoy your extended stay!`
          );
        }
      }
      
      if (logsChannelId) {
        const logChannel = member.guild.channels.cache.get(logsChannelId);
        if (logChannel) {
          const embed = new EmbedBuilder()
            .setTitle("Member Grounded (Rejoined)")
            .setColor("Red")
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
              { name: "Member", value: member.toString(), inline: true },
              { name: "Offences", value: `${log.offences}`, inline: true },
              { name: "Action", value: "Re-jailed for evasion", inline: false }
            )
            .setTimestamp();
          await logChannel.send({ embeds: [embed] });
        }
      }
      
      logger.info(`Re-jailed ${member.user.tag} for evasion attempt`);
      return true;

    } catch (error) {
      logger.error('Error in handleMemberJoin:', error);
      return false;
    }
  }
  
  static async handleMemberLeave(member) {
    const guildId = member.guild.id;
    
    try {
      const log = await prisma.jailLog.findUnique({
        where: { guildId_userId: { guildId, userId: member.id } }
      });
      
      if (log && log.status === 'jailed') {
        const ids = await getIds(guildId);
        const logsChannelId = ids.logsChannelId;
        const logChannel = logsChannelId 
          ? member.guild.channels.cache.get(logsChannelId)
          : null;
        
        const newOffences = log.offences + 1;
        const userTag = member.user?.tag || `User ${member.id}`;
        const avatarUrl = member.user?.displayAvatarURL();
        
        if (newOffences >= 8) {
          try {
            await member.guild.members.ban(member.id, { 
              reason: "Reached 8 offences upon leaving." 
            });
            
            await prisma.jailLog.update({
              where: { guildId_userId: { guildId, userId: member.id } },
              data: { 
                status: 'jailed',
                offences: newOffences,
                punishmentEnd: null
              }
            });
            
            if (logChannel) {
              const embed = new EmbedBuilder()
                .setTitle("Member Banned")
                .setColor("DarkRed")
                .addFields(
                  { name: "Member", value: userTag, inline: false },
                  { name: "Reason", value: "Reached 8 offences upon leaving", inline: false }
                )
                .setTimestamp();
              if (avatarUrl) embed.setThumbnail(avatarUrl);
              await logChannel.send({ embeds: [embed] });
            }
          } catch (e) {
            logger.error(`Failed to ban ${userTag}: ${e}`);
          }
        } else {
          // Pause timer by setting end to null
          await prisma.jailLog.update({
            where: { guildId_userId: { guildId, userId: member.id } },
            data: { 
              offences: newOffences,
              punishmentEnd: null 
            }
          });
          
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle("Member Left While Jailed")
              .setColor("Orange")
              .addFields(
                { name: "Member", value: userTag, inline: false },
                { name: "New Offence Count", value: `${newOffences}`, inline: false },
                { name: "Penalty", value: "Offence increased. Timer paused until rejoin.", inline: false }
              )
              .setTimestamp();
            if (avatarUrl) embed.setThumbnail(avatarUrl);
            await logChannel.send({ embeds: [embed] });
          }
          logger.info(`Increased offences for ${userTag} to ${newOffences} and paused timer.`);
        }
      }
    } catch (error) {
      logger.error('Error in handleMemberLeave:', error);
    }
  }
}

module.exports = { PunishmentService };
