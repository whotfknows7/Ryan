const { EmbedBuilder, Collection, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { getIds } = require('../utils/GuildIdsHelper');
const logger = require('../lib/logger');

const cooldowns = new Collection();
const silentLogCooldowns = new Collection();
const COOLDOWN_DURATION = 10 * 60 * 1000; // 10 minutes
const SILENT_LOG_COOLDOWN_DURATION = 10 * 1000; // 10 seconds

class EmergencyService {
    /**
     * Handles the emergency request from either a slash command or a message.
     * @param {Object} context - The interaction or message object.
     * @param {boolean} isInteraction - Whether the context is an interaction.
     */
    static async handleEmergency(context, isInteraction = false) {
        const guild = context.guild;
        const member = isInteraction ? context.member : context.member;
        const channel = isInteraction ? context.channel : context.channel;

        if (!guild || !member) return;

        const ids = await getIds(guild.id);
        const logsChannelId = ids.logsChannelId;
        const adminRoleId = ids.adminRoleId; // Fallback
        const modRoleId = ids.modRoleId; // Primary

        // 1. Check Cooldown
        const now = Date.now();
        const lastUsed = cooldowns.get(guild.id);

        if (lastUsed && (now - lastUsed < COOLDOWN_DURATION)) {
            const timeLeft = Math.ceil((COOLDOWN_DURATION - (now - lastUsed)) / 60000);
            const cooldownEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('🚨 Emergency Services Busy')
                .setDescription(`Mods have already been alerted recently.\nPlease wait **${timeLeft} minutes** before calling again.`)
                .setFooter({ text: 'Stay safe and keep calm.', iconURL: guild.iconURL() });

            if (isInteraction) {
                await context.reply({ embeds: [cooldownEmbed], flags: MessageFlags.Ephemeral });
            } else {
                await channel.send({ embeds: [cooldownEmbed] });
            }

            // Silent Logging if within 5 minutes of the last cooldown trigger
            if (logsChannelId) {
                const logChannel = guild.channels.cache.get(logsChannelId);

                // [NEW] Check Silent Log Cooldown (10s)
                const lastSilentLog = silentLogCooldowns.get(guild.id);

                if (logChannel && (!lastSilentLog || (now - lastSilentLog >= SILENT_LOG_COOLDOWN_DURATION))) {
                    const silentLogEmbed = new EmbedBuilder()
                        .setColor('#FFA500')
                        .setTitle('⚠️ Emergency Cooldown Attempt')
                        .setDescription(`**User:** ${member.toString()}\n**Channel:** ${channel.toString()}\n**Note:** User attempted to call 911 during cooldown.`)
                        .setTimestamp();

                    // Send without pings
                    logChannel.send({ embeds: [silentLogEmbed] }).catch(e => logger.error('Failed to send silent log:', e));

                    // Update Silent Log Cooldown
                    silentLogCooldowns.set(guild.id, now);
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
            if (isInteraction) {
                await context.reply({ embeds: [dialingEmbed], fetchReply: true });
                replyMessage = await context.fetchReply();
            } else {
                replyMessage = await channel.send({ embeds: [dialingEmbed] });
            }
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

            if (isInteraction) {
                await context.editReply({ embeds: [errorEmbed] });
            } else if (replyMessage) {
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

            if (isInteraction) {
                await context.editReply({ embeds: [errorEmbed] });
            } else if (replyMessage) {
                await replyMessage.edit({ embeds: [errorEmbed] });
            }
            return;
        }

        // 4. Send Alert to Mod Channel
        try {
            const jumpLink = isInteraction
                ? `https://discord.com/channels/${guild.id}/${channel.id}/${replyMessage.id}`
                : context.url;

            let description = `**Caller:** ${member.toString()}\n**Channel:** ${channel.toString()}\n**Location:** [Jump to Incident](${jumpLink})`;

            // Add Reply Context
            if (!isInteraction && context.reference) {
                try {
                    const referencedMsg = await channel.messages.fetch(context.reference.messageId);
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

            if (isInteraction) {
                await context.editReply({ embeds: [errorEmbed] });
            } else if (replyMessage) {
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
            if (isInteraction) {
                await context.editReply({ embeds: [successEmbed] });
            } else if (replyMessage) {
                await replyMessage.edit({ embeds: [successEmbed] });
            }
        }, 1500);

        // 6. Set Cooldown
        cooldowns.set(guild.id, now);
    }
}

module.exports = { EmergencyService };
