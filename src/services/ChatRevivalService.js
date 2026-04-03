const { EmbedBuilder, Routes } = require('discord.js');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { getIds } = require('../utils/GuildIdsHelper');
const logger = require('../lib/logger');

// 1 use per 10 minutes, keyed by guildId
const revivalLimiter = new RateLimiterMemory({
  points: 1,
  duration: 10 * 60, // 10 minutes in seconds
  keyPrefix: 'chat-revival',
});

class ChatRevivalService {
  /**
   * Handles the chat revival request triggered by a message.
   * @param {Message} message - The message object.
   */
  static async handleRevival(message) {
    const guild = message.guild;
    const member = message.member;
    const channel = message.channel;

    if (!guild || !member) return;

    const ids = await getIds(guild.id);
    const chatRevivalRoleId = ids.chatRevivalRoleId;

    if (!chatRevivalRoleId) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Revival Failed')
        .setDescription('The chat revival role is not configured for this server. An admin can set it via `/setup`.');

      await guild.client.rest.post(Routes.channelMessages(channel.id), {
        body: { embeds: [errorEmbed.toJSON()] },
      });
      return;
    }

    const targetRole = await guild.roles.fetch(chatRevivalRoleId).catch(() => null);

    if (!targetRole) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Revival Failed')
        .setDescription('Could not find the configured chat revival role.');

      await guild.client.rest.post(Routes.channelMessages(channel.id), {
        body: { embeds: [errorEmbed.toJSON()] },
      });
      return;
    }

    // Check Cooldown
    try {
      await revivalLimiter.consume(guild.id);
    } catch (rateLimiterRes) {
      // On cooldown — show user feedback
      const timeLeft = Math.ceil(rateLimiterRes.msBeforeNext / 60000);
      const cooldownEmbed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('⏳ Chat Revival on Cooldown')
        .setDescription(
          `A chat revival was already triggered recently.\nPlease wait **${timeLeft} minutes** before trying again.`
        );

      await guild.client.rest.post(Routes.channelMessages(channel.id), {
        body: { embeds: [cooldownEmbed.toJSON()] },
      });
      return;
    }

    // Send the revival mention
    try {
      const revivalEmbed = new EmbedBuilder()
        .setColor('#00FFFF')
        .setTitle('✨ Chat Revival ✨')
        .setDescription(`${member.toString()} is trying to revive the chat!`)
        .setThumbnail(member.user.displayAvatarURL())
        .setTimestamp();

      await guild.client.rest.post(Routes.channelMessages(channel.id), {
        body: {
          content: `${targetRole.toString()}`,
          embeds: [revivalEmbed.toJSON()],
          allowed_mentions: { roles: [targetRole.id] },
        },
      });
    } catch (error) {
      logger.error('Failed to send chat revival alert:', error);
      const errorEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Error')
        .setDescription('Failed to ping the chat revival role.');

      await guild.client.rest.post(Routes.channelMessages(channel.id), {
        body: { embeds: [errorEmbed.toJSON()] },
      });
      return;
    }
  }
}

module.exports = { ChatRevivalService };
