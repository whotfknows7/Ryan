// src/services/LeaderboardUpdateService.js

const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getIds, clearCache } = require('../utils/GuildIdsHelper');
const { DatabaseService } = require('./DatabaseService');
const ImageService = require('./ImageService');
const logger = require('../lib/logger');

// =================================================================
// CRITICAL: This variable must be defined HERE (Top Level Scope)
// =================================================================
const previousTopUsersJSON = new Map();

class LeaderboardUpdateService {

  static async updateLiveLeaderboard(client) {
    for (const [guildId, guild] of client.guilds.cache) {
      try {
        const ids = await getIds(guildId);
        const channelId = ids.leaderboardChannelId;

        if (!channelId) continue;

        const channel = guild.channels.cache.get(channelId);
        if (!channel?.isTextBased()) continue;

        // 1. Fetch Top 10 for display (Fast)
        const topUsers = await DatabaseService.fetchTopUsers(guildId, 10, 'daily');

        // Optimization: Skip if the data hasn't changed
        const currentJSON = JSON.stringify(topUsers);

        // Check map existence safely
        if (previousTopUsersJSON.has(guildId) && currentJSON === previousTopUsersJSON.get(guildId)) {
          continue;
        }

        // logger.info(`Updating leaderboard for guild ${guildId}...`);

        // 2. Generate Payload
        // logger.info(`[${guildId}] Generating payload...`);
        const payload = await this.generateLeaderboardPayload(guild, 'daily', 1, null, true);
        // logger.info(`[${guildId}] Payload generated.`);

        // 3. Delete Old Message & Send New
        if (ids.dailyLeaderboardMessageId) {
          try {
            logger.debug(`[${guildId}] Fetching old message ${ids.dailyLeaderboardMessageId}...`);
            const oldMsg = await channel.messages.fetch(ids.dailyLeaderboardMessageId).catch(() => null);
            if (oldMsg) {
              logger.debug(`[${guildId}] Deleting old message...`);
              await oldMsg.delete();
            }
          } catch (e) {
            logger.warn(`[${guildId}] Failed to delete old message: ${e.message}`);
          }
        }

        // logger.info(`[${guildId}] Sending new leaderboard message...`);

        // Retry logic for unstable connections
        let newMessage;
        const maxRetries = 3;
        for (let i = 0; i < maxRetries; i++) {
          try {
            newMessage = await channel.send(payload);
            break; // Success!
          } catch (sendError) {
            if (i === maxRetries - 1) throw sendError; // Rethrow if last attempt
            logger.warn(`[${guildId}] Failed to send message (Attempt ${i + 1}/${maxRetries}): ${sendError.message}. Retrying...`);
            await new Promise(r => setTimeout(r, 1000)); // Wait 1s
          }
        }

        // logger.info(`[${guildId}] Leaderboard updated. Message ID: ${newMessage.id}`);

        // Update State
        previousTopUsersJSON.set(guildId, currentJSON);
        await DatabaseService.updateGuildIds(guildId, { dailyLeaderboardMessageId: newMessage.id });
        clearCache(guildId);

      } catch (e) {
        logger.error(`Failed to update leaderboard for guild ${guildId}: ${e.message}`, e);
        if (e.name === 'AbortError' || e.code === 'UND_ERR_SOCKET') {
          logger.error(`[${guildId}] Network/Socket Error detected. Request failed.`);
        }
      }
    }
  }

  /**
   * Generates the embed, image, and buttons for any leaderboard page
   * @param {Guild} guild 
   * @param {string} type - 'daily', 'weekly', or 'lifetime'
   * @param {number} page - Page number (1-based)
   * @param {string|null} highlightUserId - ID of user to highlight (for "Me" button)
   * @param {boolean} showSwitchers - Whether to include Weekly/All-time buttons
   */
  static async generateLeaderboardPayload(guild, type, page, highlightUserId = null, showSwitchers = false) {
    const limit = 10;
    const skip = (page - 1) * limit;

    // 1. Fetch Data
    const topUsers = await DatabaseService.fetchTopUsers(guild.id, limit, type, skip);
    const totalCount = await DatabaseService.getUserCount(guild.id, type);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    // 2. Map Data for Image
    // 2. Map Data for Image
    let members = new Map();
    try {
      const userIds = topUsers.map(u => u.userId);
      if (userIds.length > 0) {
        members = await guild.members.fetch({ user: userIds });
      }
    } catch (e) {
      logger.error(`Failed to bulk fetch members for leaderboard:`, e);
    }

    const usersForImage = topUsers.map((u, index) => {
      const member = members.get(u.userId);

      // Determine which XP value to display
      let xpVal = 0;
      if (type === 'weekly') xpVal = u.weeklyXp;
      else if (type === 'lifetime') xpVal = u.xp;
      else xpVal = u.dailyXp;

      return {
        rank: skip + index + 1,
        userId: u.userId,
        username: member ? member.displayName : 'Unknown',
        avatarUrl: member?.displayAvatarURL({ extension: 'png' }) || null,
        xp: xpVal
      };
    });

    // 3. Generate Image (with highlight support)
    const imageBuffer = await ImageService.generateLeaderboard(usersForImage, highlightUserId);
    logger.info(`[${guild.id}] Generated leaderboard image size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'leaderboard.png' });

    // 4. Build Embed
    const titles = {
      daily: "Yappers of the day!",
      weekly: "Yappers of the week!",
      lifetime: "All-time Yappers!"
    };

    const embed = new EmbedBuilder()
      .setTitle(titles[type] || titles.daily)
      .setDescription(`Leaderboard • Page ${page}/${totalPages}`)
      .setColor('Gold')
      .setThumbnail("https://media.discordapp.net/attachments/1301183910838796460/1333160889419038812/tenor.gif")
      .setImage("attachment://leaderboard.png")
      .setFooter({ text: `Page ${page} of ${totalPages} • Updates Live` });

    // Show legend only if switchers are active (Main LB)
    if (showSwitchers) {
      embed.setDescription(
        `Leaderboard • Page ${page}/${totalPages}\n` +
        `📅 **Weekly** | 🌎 **All-time**`
      );
    }

    // 5. Build Buttons
    const row = new ActionRowBuilder();

    // PREV
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`leaderboard_page:prev:${page - 1}:${type}`)
        .setLabel('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1)
    );

    if (showSwitchers) {
      // FULL BUTTON SET (Main LB)
      row.addComponents(
        new ButtonBuilder().setCustomId('leaderboard_view:weekly').setLabel('📅').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`leaderboard_show_rank:${type}`).setLabel('Me').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('leaderboard_view:lifetime').setLabel('🌎').setStyle(ButtonStyle.Secondary)
      );
    } else {
      // COMPACT BUTTON SET (Popup LBs / Pagination)
      row.addComponents(
        new ButtonBuilder().setCustomId(`leaderboard_show_rank:${type}`).setLabel('Me').setStyle(ButtonStyle.Primary)
      );
    }

    // NEXT
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`leaderboard_page:next:${page + 1}:${type}`)
        .setLabel('▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages)
    );

    return { embeds: [embed], files: [attachment], components: [row], fetchReply: true };
  }
}

module.exports = { LeaderboardUpdateService };
