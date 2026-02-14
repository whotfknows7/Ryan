const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { getIds } = require('../utils/GuildIdsHelper');
const logger = require('../lib/logger');

// 1 use per 10 minutes, keyed by guildId
const emergencyLimiter = new RateLimiterMemory({
    points: 1,
    duration: 10 * 60, // 10 minutes in seconds
    keyPrefix: 'emergency',
});

// 1 silent log per 10 seconds, keyed by guildId
const silentLogLimiter = new RateLimiterMemory({
    points: 1,
    duration: 10, // 10 seconds
    keyPrefix: 'emergency-silent-log',
});

class EmergencyService {
    /**
     * Handles the emergency request triggered by a message.
     * @param {Message} message - The message object.
     */
    static async handleEmergency(message) {
        const guild = message.guild;
        const member = message.member;
        const channel = message.channel;

        if (!guild || !member) return;

        const ids = await getIds(guild.id);
        const logsChannelId = ids.logsChannelId;
        const adminRoleId = ids.adminRoleId; // Fallback
        const modRoleId = ids.modRoleId; // Primary

        // 1. Check Cooldown
        try {
            await emergencyLimiter.consume(guild.id);
        } catch (rateLimiterRes) {
            // On cooldown — show user feedback
            const timeLeft = Math.ceil(rateLimiterRes.msBeforeNext / 60000);
            const cooldownEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('🚨 Emergency Services Busy')
                .setDescription(`Mods have already been alerted recently.\nPlease wait **${timeLeft} minutes** before calling again.`)
                .setFooter({ text: 'Stay safe and keep calm.', iconURL: guild.iconURL() });

            await channel.send({ embeds: [cooldownEmbed] });

            // Silent Logging (rate-limited to 1 per 10s)
            if (logsChannelId) {
                const logChannel = guild.channels.cache.get(logsChannelId);
                if (logChannel) {
                    try {
                        await silentLogLimiter.consume(guild.id);
                        const silentLogEmbed = new EmbedBuilder()
                            .setColor('#FFA500')
                            .setTitle('⚠️ Emergency Cooldown Attempt')
                            .setDescription(`**User:** ${member.toString()}\n**Channel:** ${channel.toString()}\n**Note:** User attempted to call 911 during cooldown.`)
                            .setTimestamp();

                        logChannel.send({ embeds: [silentLogEmbed] }).catch(e => logger.error('Failed to send silent log:', e));
                    } catch (_silentLimitErr) {
                        // Silent log on cooldown, skip
                    }
                }
            }
            return;
        }

        // 2. Initial "Dialing..." Feedback
        let replyMessage;
        const dialingEmbed = new EmbedBuilder()
            .setColor('#FFFF00')
            .setTitle('📞 Dialing 911...')
            .setDescription('Connecting to the nearest available mod...')
            .setThumbnail('https://cdn.discordapp.com/emojis/1049286377778941973.webp?size=96&quality=lossless');

        try {
            replyMessage = await channel.send({ embeds: [dialingEmbed] });
        } catch (error) {
            logger.error('Failed to send dialing message:', error);
            return;
        }

        // 3. Validate Configuration
        const targetRoleId = modRoleId || adminRoleId;

        if (!targetRoleId || !logsChannelId) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Connection Failed')
                .setDescription('Emergency services are not fully configured for this server.\nPlease contact a server owner directly.');

            if (replyMessage) {
                await replyMessage.edit({ embeds: [errorEmbed] });
            }
            return;
        }

        const targetRole = guild.roles.cache.get(targetRoleId);
        const logChannel = guild.channels.cache.get(logsChannelId);

        if (!targetRole || !logChannel) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Connection Error')
                .setDescription('Could not reach the staff team (Role/Channel missing).');

            if (replyMessage) {
                await replyMessage.edit({ embeds: [errorEmbed] });
            }
            return;
        }

        // 4. Send Alert to Mod Channel
        try {
            const jumpLink = message.url;

            let description = `**Caller:** ${member.toString()}\n**Channel:** ${channel.toString()}\n**Location:** [Jump to Incident](${jumpLink})`;

            // Add Reply Context
            if (message.reference) {
                try {
                    const referencedMsg = await channel.messages.fetch(message.reference.messageId);
                    if (referencedMsg) {
                        const refContent = referencedMsg.content.length > 100
                            ? referencedMsg.content.substring(0, 100) + '...'
                            : referencedMsg.content || '[Attachment/Embed]';
                        description += `\n\n**Replying To:** ${referencedMsg.author.toString()}: "${refContent}"\n[View Context](${referencedMsg.url})`;
                    }
                } catch (e) {
                    logger.warn('Failed to fetch referenced message for emergency context:', e);
                }
            }

            const adminAlertEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('🚨 EMERGENCY CALL RECEIVED')
                .setDescription(description)
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp()
                .setFooter({ text: 'Immediate Assistance Requested' });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setLabel('View Incident')
                        .setStyle(ButtonStyle.Link)
                        .setURL(jumpLink),
                );

            await logChannel.send({
                content: `${targetRole.toString()} **EMERGENCY REPORTED!**`,
                embeds: [adminAlertEmbed],
                components: [row]
            });

        } catch (error) {
            logger.error('Failed to send admin alert:', error);
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setTitle('❌ Call Dropped')
                .setDescription('Failed to connect to the emergency line.');

            if (replyMessage) {
                await replyMessage.edit({ embeds: [errorEmbed] });
            }
            return;
        }

        // 5. Update User Feedback to Success
        const successEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🚨 The mods have been notified')
            .setDescription('They are on their way...\n**Please stay calm and wait for assistance.**')
            .setFooter({ text: 'Do not spam this command.' });

        setTimeout(async () => {
            if (replyMessage) {
                await replyMessage.edit({ embeds: [successEmbed] });
            }
        }, 1500);

        // Cooldown is automatically set by emergencyLimiter.consume() above
    }
}

module.exports = { EmergencyService };
