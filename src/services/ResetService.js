// src/services/ResetService.js

const { EmbedBuilder } = require('discord.js');
const { DatabaseService } = require('./DatabaseService');
const { AssetService } = require('./AssetService');
const { GifService } = require('./GifService');
const { getIds, clearCache } = require('../utils/GuildIdsHelper');
const WebhookUtils = require('../utils/WebhookUtils');
const { addDays, isAfter } = require('date-fns');
const logger = require('../lib/logger');
const CONSTANTS = require('../lib/constants');
const fs = require('fs');
const path = require('path');
const { prisma } = require('../lib/prisma');

class ResetService {

  static DAYS_IN_CYCLE = 7;
  static WEEKLY_RESET_DAY = 0;
  static TOP_USERS_LIMIT = 10;

  static async checkResetCycle(client, guildId) {
    try {
      const cycle = await this.getOrInitializeCycle(guildId);
      if (!cycle) return;
      const lastReset = new Date(cycle.lastResetUtc);
      const nextReset = addDays(lastReset, 1);
      const now = new Date();
      if (isAfter(now, nextReset)) {
        await this.processMissedResets(client, guildId, cycle, lastReset, now);
      }
    } catch (error) {
      logger.error(`Critical error in reset cycle for guild ${guildId}:`, error);
    }
  }

  static async getOrInitializeCycle(guildId) {
    let cycle = await DatabaseService.getResetCycle(guildId);
    if (!cycle) {
      cycle = await DatabaseService.initResetCycle(guildId);
      logger.info(`Initialized reset cycle for guild ${guildId}`);
      return null;
    }
    return cycle;
  }

  static async processMissedResets(client, guildId, cycleData, lastReset, now) {
    const resetStats = { daily: 0, weekly: 0, lastValidWeeklyData: null };
    let currentCycle = cycleData.cycleCount;
    let tempLastReset = lastReset;
    let nextReset = addDays(tempLastReset, 1);
    while (isAfter(now, nextReset)) {
      tempLastReset = nextReset;
      nextReset = addDays(tempLastReset, 1);
      currentCycle = (currentCycle + 1) % this.DAYS_IN_CYCLE;
      try {
        if (currentCycle === this.WEEKLY_RESET_DAY) {
          await this.processWeeklyReset(client, guildId, resetStats);
        } else {
          await this.processDailyReset(client, guildId, currentCycle, resetStats);
        }
        await DatabaseService.updateResetCycle(guildId, currentCycle, tempLastReset);
      } catch (error) {
        logger.error(`Failed to process reset for guild ${guildId}:`, error);
        throw error;
      }
    }
    await this.sendResetAnnouncements(client, guildId, resetStats.weekly, resetStats.lastValidWeeklyData);
    this.logResetSummary(guildId, resetStats.daily, resetStats.weekly);
  }

  static async forceSkipCycle(client, guildId) {
    const cycle = await this.getOrInitializeCycle(guildId);
    if (!cycle) throw new Error("Could not initialize reset cycle.");
    const now = new Date();
    const nextCycleCount = (cycle.cycleCount + 1) % this.DAYS_IN_CYCLE;
    logger.info(`[Force Skip] Guild ${guildId} skipping to cycle ${nextCycleCount}`);
    try {
      if (nextCycleCount === this.WEEKLY_RESET_DAY) {
        const resetStats = { daily: 0, weekly: 0, lastValidWeeklyData: null };
        await this.processWeeklyReset(client, guildId, resetStats);
        await this.sendResetAnnouncements(client, guildId, 1, resetStats.lastValidWeeklyData);
      } else {
        const resetStats = { daily: 0, weekly: 0 };
        await this.processDailyReset(client, guildId, nextCycleCount, resetStats);
      }
      await DatabaseService.updateResetCycle(guildId, nextCycleCount, now);
      return { success: true, newCycle: nextCycleCount, isWeekly: nextCycleCount === this.WEEKLY_RESET_DAY, nextReset: new Date(now.getTime() + 24 * 60 * 60 * 1000) };
    } catch (error) {
      logger.error(`[Force Skip] Failed for guild ${guildId}:`, error);
      throw error;
    }
  }

  static async processWeeklyReset(client, guildId, stats) {
    stats.weekly++;
    const weekData = await this.performWeeklyResetSilent(client, guildId);
    if (weekData) {
      const totalXp = this.calculateTotalXp(weekData);
      if (totalXp > 0 || !stats.lastValidWeeklyData) stats.lastValidWeeklyData = weekData;
    }
    logger.info(`Processed WEEKLY reset (${stats.weekly}) for guild ${guildId}`);
  }

  static async processDailyReset(client, guildId, cycleDay, stats) {
    stats.daily++;
    await this.performDailyReset(client, guildId);
    logger.info(`Processed DAILY reset - Day ${cycleDay} for guild ${guildId}`);
  }

  // =================================================================
  // [UPDATED] DAILY RESET LOGIC
  // =================================================================

  static async performDailyReset(client, guildId) {
    try {
      // 1. Capture daily winner (Optional history step)
      const topDaily = await prisma.userXp.findMany({
        where: { guildId },
        orderBy: { dailyXp: 'desc' },
        take: 1
      });

      if (topDaily.length > 0 && topDaily[0].dailyXp > 0) {
        logger.info(`Daily winner for guild ${guildId}: User ${topDaily[0].userId} with ${topDaily[0].dailyXp} XP`);
      }

      // 2. Update Clan War (Syncs current XP to Clan DB)
      // We removed the "Module 1" specific deletion logic. Now all modules behave consistently.
      const clanUpdates = await this.calculateClanUpdates(client, guildId);
      await DatabaseService.syncUserXpToClanXp(guildId, clanUpdates);

      // 3. Reset ONLY the dailyXp column (The "Daily" part of the reset)
      await DatabaseService.resetDailyXp(guildId);

      this.wipeAssetCache();
      logger.info(`Daily reset completed for guild ${guildId}`);

      return topDaily[0] || null;
    } catch (error) {
      logger.error(`Error in performDailyReset for guild ${guildId}:`, error);
      throw error;
    }
  }

  // =================================================================
  // [UPDATED] WEEKLY RESET LOGIC
  // =================================================================

  static async performWeeklyResetSilent(client, guildId) {
    try {
      // 1. Capture weekly winner
      const topWeekly = await prisma.userXp.findMany({
        where: { guildId },
        orderBy: { weeklyXp: 'desc' },
        take: 1
      });

      if (topWeekly.length > 0 && topWeekly[0].weeklyXp > 0) {
        logger.info(`Weekly winner for guild ${guildId}: User ${topWeekly[0].userId} with ${topWeekly[0].weeklyXp} XP`);
      }

      // 2. Final Clan War Sync
      const clanUpdates = await this.calculateClanUpdates(client, guildId);
      await DatabaseService.syncUserXpToClanXp(guildId, clanUpdates);

      this.wipeAssetCache();
      const finalTotals = await DatabaseService.getClanTotalXp(guildId);

      // 3. Reset ONLY the weeklyXp column
      // We do NOT delete UserXp rows anymore, preserving Lifetime XP for everyone
      await DatabaseService.resetWeeklyXp(guildId);

      // 4. Reset ClanXP (New war starts next week)
      await DatabaseService.clearClanXp(guildId);

      logger.info(`Weekly reset completed for guild ${guildId}`);

      return finalTotals;
    } catch (error) {
      logger.error(`Error in performWeeklyResetSilent for guild ${guildId}:`, error);
      throw error;
    }
  }

  static wipeAssetCache() {
    try {
      const emojiDir = path.join(process.cwd(), 'assets', 'emojis');
      if (fs.existsSync(emojiDir)) fs.readdirSync(emojiDir).forEach(f => fs.unlinkSync(path.join(emojiDir, f)));
    } catch (e) { }
  }

  static async calculateClanUpdates(client, guildId) {
    const allUsers = await DatabaseService.getAllUserXp(guildId);
    if (allUsers.length === 0) return [];

    const ids = await getIds(guildId);
    const clanRoleMap = {};
    if (ids.clanRole1Id) clanRoleMap[1] = ids.clanRole1Id;
    if (ids.clanRole2Id) clanRoleMap[2] = ids.clanRole2Id;
    if (ids.clanRole3Id) clanRoleMap[3] = ids.clanRole3Id;
    if (ids.clanRole4Id) clanRoleMap[4] = ids.clanRole4Id;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return [];

    const updates = [];
    const chunkSize = 100;

    for (let i = 0; i < allUsers.length; i += chunkSize) {
      const chunk = allUsers.slice(i, i + chunkSize);
      try {
        const members = await guild.members.fetch({ user: chunk.map(u => u.userId) });
        for (const user of chunk) {
          const member = members.get(user.userId);
          if (!member) continue;
          for (const [clanIdStr, roleId] of Object.entries(clanRoleMap)) {
            if (roleId && member.roles.cache.has(roleId)) {
              updates.push({ userId: user.userId, clanId: parseInt(clanIdStr), xp: user.xp });
              break;
            }
          }
        }
      } catch (e) { logger.error(`Member fetch failed: ${e.message}`); }
    }
    return updates;
  }

  // =================================================================
  // ANNOUNCEMENTS & GIF PIPELINE
  // =================================================================

  static async sendResetAnnouncements(client, guildId, weeklyResetCount, clanData) {
    if (weeklyResetCount >= 1) {
      await this.sendWeeklyAnnouncement(client, guildId, weeklyResetCount === 1, clanData);
    }
  }

  static async sendWeeklyAnnouncement(client, guildId, withPings = true, dataSnapshot = null) {
    try {
      const channel = await this.getLeaderboardChannel(client, guildId);
      if (!channel) return;

      const clanTotals = dataSnapshot ?? await DatabaseService.getClanTotalXp(guildId);
      const config = await DatabaseService.getGuildConfig(guildId);
      const ids = config.ids || {};
      const clansConfig = config.clans || {};
      const totalXp = this.calculateTotalXp(clanTotals);

      const clanRoles = {
        1: ids.clanRole1Id, 2: ids.clanRole2Id, 3: ids.clanRole3Id, 4: ids.clanRole4Id
      };

      const activeClans = [];
      for (let i = 1; i <= 4; i++) {
        if (clanTotals[i] > 0 || clanRoles[i]) {
          activeClans.push({ id: i, xp: clanTotals[i] || 0, roleId: clanRoles[i] });
        }
      }


      activeClans.sort((a, b) => b.xp - a.xp);

      const getClanEmoji = (id) => {
        return clansConfig[id]?.emoji || `**[Clan ${id}]**`;
      };

      const embed = new EmbedBuilder()
        .setTitle("⚔️ **CLAN WAR CONQUEST** ⚔️")
        .setColor(0xFFD700)
        .setFooter({ text: "Help your clan earn more XP points!" })
        .setTimestamp();

      let description = "";
      const isTie = activeClans.length >= 2 && activeClans[0].xp === activeClans[1].xp && totalXp > 0;

      if (isTie) description = "**IT'S A TIE!**\n\n";

      activeClans.forEach((clan, index) => {
        const percentage = totalXp > 0 ? (clan.xp / totalXp * 100) : 0;
        let rankEmoji = index === 0 ? CONSTANTS.EMOJIS.RANK_1 : (index === 1 ? CONSTANTS.EMOJIS.RANK_2 : `**#${index + 1}**`);
        description += `${rankEmoji} ${CONSTANTS.EMOJIS.DASH_BLUE} ${getClanEmoji(clan.id)} ${clan.roleId ? `<@&${clan.roleId}>` : `Clan ${clan.id}`}\n` +
          `\`\`\`\n${clan.xp.toLocaleString()} XP • ${percentage.toFixed(1)}%\n\`\`\`\n`;
      });

      embed.setDescription(description);

      // =========================================================
      // GIF PIPELINE
      // =========================================================

      let gifUrl = null;

      if (!isTie && activeClans.length >= 2) {
        const winnerRoleIds = activeClans.map(c => c.roleId || 'unknown');
        const rankHash = `count:${activeClans.length}|` +
          activeClans.map((c, i) => `${i + 1}:${c.roleId}`).join('|');

        const cachedEntry = await DatabaseService.getGifCache(rankHash);

        if (cachedEntry) {
          logger.info(`[GifPipeline] Cache Hit for ${rankHash}`);
          const msg = await this.fetchMessageFromLink(client, cachedEntry.messageLink);
          if (msg && msg.attachments.first()) {
            gifUrl = msg.attachments.first().url;
          }
        }

        if (!gifUrl) {
          logger.info(`[GifPipeline] Cache Miss. Generating for ${rankHash}...`);
          try {
            const tempFilePath = await GifService.generateClanGif(client, winnerRoleIds, activeClans.length);

            // Use Stream for AssetService
            const fileStream = fs.createReadStream(tempFilePath);
            const contextText = `Clan Win: ${activeClans[0].id} (Count: ${activeClans.length})`;

            const persistentMsgLink = await AssetService.storeToDevChannel(client, fileStream, 'winner.gif', contextText);

            if (persistentMsgLink) {
              await DatabaseService.setGifCache(rankHash, persistentMsgLink);
              const msg = await this.fetchMessageFromLink(client, persistentMsgLink);
              if (msg) gifUrl = msg.attachments.first().url;
            }

            fs.unlinkSync(tempFilePath);
            logger.info(`[GifPipeline] Generation complete & cleaned up.`);

          } catch (err) {
            logger.error(`[GifPipeline] Failed: ${err.message}`);
          }
        }
      }

      if (gifUrl) embed.setImage(gifUrl);

      if (ids.clanLeaderboardMessageId) {
        try {
          const oldMsg = await channel.messages.fetch(ids.clanLeaderboardMessageId).catch(() => null);
          if (oldMsg) await oldMsg.delete();
        } catch (e) { }
      }

      const content = withPings ? await this.getClanMentions(guildId) : undefined;
      const newMsg = await WebhookUtils.sendLeaderboard(channel, embed, content);

      await DatabaseService.updateGuildIds(guildId, { clanLeaderboardMessageId: newMsg.id });
      clearCache(guildId);

    } catch (error) {
      logger.error('Error sending weekly announcement:', error);
    }
  }

  static async fetchMessageFromLink(client, link) {
    try {
      const match = link.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
      if (!match) return null;
      const [, gId, cId, mId] = match;
      const ch = await client.channels.fetch(cId);
      return await ch.messages.fetch(mId);
    } catch { return null; }
  }

  static async getLeaderboardChannel(client, guildId) {
    const ids = await getIds(guildId);
    if (!ids.leaderboardChannelId) return null;
    const guild = client.guilds.cache.get(guildId);
    return guild?.channels.cache.get(ids.leaderboardChannelId) || null;
  }

  static async getClanMentions(guildId) {
    const ids = await getIds(guildId);
    return [ids.clanRole1Id, ids.clanRole2Id, ids.clanRole3Id, ids.clanRole4Id]
      .filter(Boolean).map(id => `<@&${id}>`).join(' ');
  }

  static calculateTotalXp(clanTotals) {
    return Object.values(clanTotals).reduce((sum, xp) => sum + xp, 0);
  }

  static logResetSummary(guildId, daily, weekly) {
    if (daily > 0 || weekly > 0) {
      logger.info(`Catch-up: ${daily} daily, ${weekly} weekly resets for ${guildId}`);
    }
  }
}

module.exports = { ResetService };
