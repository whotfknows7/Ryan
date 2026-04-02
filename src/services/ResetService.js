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
const { XpSyncService } = require('./XpSyncService');
const { WeeklyRoleService } = require('./WeeklyRoleService');

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
      return cycle;
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
          // Process Daily Reset first to ensure daily XP is flushed before Weekly Reset
          await this.processDailyReset(client, guildId, currentCycle, resetStats);
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

  static async forceSkipCycle(client, guildId, customTargetDate = null) {
    const cycle = await this.getOrInitializeCycle(guildId);
    if (!cycle) throw new Error('Could not initialize reset cycle.');
    const now = new Date();
    const nextCycleCount = (cycle.cycleCount + 1) % this.DAYS_IN_CYCLE;
    logger.info(`[Force Skip] Guild ${guildId} skipping to cycle ${nextCycleCount}`);

    let lastResetToStore = now;
    let nextResetDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    if (customTargetDate) {
      nextResetDate = customTargetDate;
      // Subtract 1 day because `checkResetCycle` calculates nextReset = addDays(lastReset, 1)
      lastResetToStore = new Date(customTargetDate.getTime() - 24 * 60 * 60 * 1000);
    }

    try {
      if (nextCycleCount === this.WEEKLY_RESET_DAY) {
        const resetStats = { daily: 0, weekly: 0, lastValidWeeklyData: null };
        await this.processDailyReset(client, guildId, nextCycleCount, resetStats);
        await this.processWeeklyReset(client, guildId, resetStats);
        await this.sendResetAnnouncements(client, guildId, 1, resetStats.lastValidWeeklyData);
      } else {
        const resetStats = { daily: 0, weekly: 0 };
        await this.processDailyReset(client, guildId, nextCycleCount, resetStats);
      }
      await DatabaseService.updateResetCycle(guildId, nextCycleCount, lastResetToStore);
      return {
        success: true,
        newCycle: nextCycleCount,
        isWeekly: nextCycleCount === this.WEEKLY_RESET_DAY,
        nextReset: nextResetDate,
      };
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
      // 0. Force Sync XP Buffer
      await XpSyncService.processGuildBuffer(`xp_buffer:${guildId}`);

      // 1. Capture daily winner (Optional history step)
      const topDaily = await prisma.userXp.findMany({
        where: { guildId },
        orderBy: { dailyXp: 'desc' },
        take: 1,
      });

      if (topDaily.length > 0 && topDaily[0].dailyXp > 0) {
        logger.info(`Daily winner for guild ${guildId}: User ${topDaily[0].userId} with ${topDaily[0].dailyXp} XP`);
      }

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
      // 0. Force Sync XP Buffer
      await XpSyncService.processGuildBuffer(`xp_buffer:${guildId}`);

      // 0.5. Just-in-Time Clan ID Sync
      // Ensures users who acquired roles manually or pre-ReactionHandler have accurate clan tracking without full-guild scans.
      await this.syncActiveClanIds(client, guildId);

      // 1. Capture weekly winner
      const topWeekly = await prisma.userXp.findMany({
        where: { guildId },
        orderBy: { weeklyXp: 'desc' },
        take: 1,
      });

      if (topWeekly.length > 0 && topWeekly[0].weeklyXp > 0) {
        logger.info(`Weekly winner for guild ${guildId}: User ${topWeekly[0].userId} with ${topWeekly[0].weeklyXp} XP`);
      }

      this.wipeAssetCache();
      const finalTotals = await DatabaseService.getClanTotalXp(guildId);

      // 3. Reset ONLY the weeklyXp column
      // Preserving Lifetime XP for everyone in the unified 7-day loop.
      await WeeklyRoleService.checkWeeklyRole(client, guildId);
      await DatabaseService.resetWeeklyXp(guildId);

      // 4. Reset ClanXP (New war starts next week)
      // ClanXp table is removed. syncUserClanRoles keeps clanId updated.
      // We might want to clear clanIds or just keep them?
      // If "New war starts next week", and clanId is just a property of the user, it persists.
      // The "XP" relevant for the war is "weeklyXp", which we just reset.
      // So no need to clear 'clanId' from users unless they left the clan.
      // We already sync roles daily/weekly. So nothing to do here.

      logger.info(`Weekly reset completed for guild ${guildId}`);

      return finalTotals;
    } catch (error) {
      logger.error(`Error in performWeeklyResetSilent for guild ${guildId}:`, error);
      throw error;
    }
  }

  static async syncActiveClanIds(client, guildId) {
    try {
      const activeUsers = await prisma.userXp.findMany({
        where: { guildId, weeklyXp: { gt: 0 } },
        select: { userId: true, clanId: true },
      });
      if (activeUsers.length === 0) return;

      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return;

      const config = await DatabaseService.getFullGuildConfig(guildId);
      const ids = config?.ids || {};

      const roleToClan = {};
      if (ids.clanRole1Id) roleToClan[ids.clanRole1Id] = 1;
      if (ids.clanRole2Id) roleToClan[ids.clanRole2Id] = 2;
      if (ids.clanRole3Id) roleToClan[ids.clanRole3Id] = 3;
      if (ids.clanRole4Id) roleToClan[ids.clanRole4Id] = 4;

      if (Object.keys(roleToClan).length === 0) return;

      const userIds = activeUsers.map((u) => u.userId);
      const members = await guild.members.fetch({ user: userIds }).catch(() => new Map());

      const updates = [];
      for (const user of activeUsers) {
        const member = members.get(user.userId);
        if (!member) continue;

        let actualClanId = 0;
        for (const roleId of member.roles.cache.keys()) {
          if (roleToClan[roleId]) {
            actualClanId = roleToClan[roleId];
            break;
          }
        }

        if (actualClanId !== user.clanId) {
          updates.push({ userId: user.userId, clanId: actualClanId });
        }
      }

      if (updates.length > 0) {
        const clanGroups = {};
        for (const u of updates) {
          if (!clanGroups[u.clanId]) clanGroups[u.clanId] = [];
          clanGroups[u.clanId].push(u.userId);
        }

        const txs = Object.entries(clanGroups).map(([cId, uIds]) =>
          prisma.userXp.updateMany({
            where: { guildId, userId: { in: uIds } },
            data: { clanId: Number(cId) },
          })
        );
        await prisma.$transaction(txs);
        logger.info(`Synced clan IDs for ${updates.length} active users before weekly reset.`);
      }
    } catch (err) {
      logger.error(`Error syncing active clan IDs for guild ${guildId}:`, err);
    }
  }

  static wipeAssetCache() {
    try {
      const emojiDir = path.join(process.cwd(), 'assets', 'emojis');
      if (fs.existsSync(emojiDir)) fs.readdirSync(emojiDir).forEach((f) => fs.unlinkSync(path.join(emojiDir, f)));
    } catch {
      /* best-effort wipe */
    }
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

      const clanTotals = dataSnapshot ?? (await DatabaseService.getClanTotalXp(guildId));
      const config = await DatabaseService.getGuildConfig(guildId);
      const ids = config.ids || {};
      const reactionRoles = config.reactionRoles || {};
      const totalXp = this.calculateTotalXp(clanTotals);
      
      const clanEmojisByRoleId = {};
      for (const key in reactionRoles) {
        if (reactionRoles[key].isClanRole && reactionRoles[key].roleId && reactionRoles[key].emoji) {
          clanEmojisByRoleId[reactionRoles[key].roleId] = reactionRoles[key].emoji;
        }
      }

      const clanRoles = {
        1: ids.clanRole1Id,
        2: ids.clanRole2Id,
        3: ids.clanRole3Id,
        4: ids.clanRole4Id,
      };

      const activeClans = [];
      for (let i = 1; i <= 4; i++) {
        if (clanTotals[i] > 0 || clanRoles[i]) {
          activeClans.push({ id: i, xp: clanTotals[i] || 0, roleId: clanRoles[i] });
        }
      }

      activeClans.sort((a, b) => b.xp - a.xp);

      const getClanEmojiStr = (roleId) => {
        return clanEmojisByRoleId[roleId] ? `${clanEmojisByRoleId[roleId]} ` : '';
      };

      const embed = new EmbedBuilder()
        .setTitle('⚔️ **CLAN WAR CONQUEST** ⚔️')
        .setColor(0xffd700)
        .setThumbnail(channel.guild?.iconURL({ dynamic: true }) || null)
        .setFooter({ text: 'Help your clan earn more XP points!' })
        .setTimestamp();

      let description = '';
      const isTie = activeClans.length >= 2 && activeClans[0].xp === activeClans[1].xp && totalXp > 0;

      if (isTie) description = "**IT'S A TIE!**\n\n";

      activeClans.forEach((clan, index) => {
        const percentage = totalXp > 0 ? (clan.xp / totalXp) * 100 : 0;
        let rankEmoji =
          index === 0 ? CONSTANTS.EMOJIS.RANK_1 : index === 1 ? CONSTANTS.EMOJIS.RANK_2 : `**#${index + 1}**`;

        const roleMention = clan.roleId ? `<@&${clan.roleId}>` : `**Clan ${clan.id}**`;

        // Progress Bar
        const bars = Math.floor(percentage / 10);
        const safeBars = Math.max(0, Math.min(10, bars));
        const progressBar = '▰'.repeat(safeBars) + '▱'.repeat(10 - safeBars);

        description +=
          `${rankEmoji} ${CONSTANTS.EMOJIS.DASH_BLUE} ${getClanEmojiStr(clan.roleId)}${roleMention}\n` +
          '```\n' +
          `${clan.xp.toLocaleString()} XP Pts\n` +
          `${progressBar} ${percentage.toFixed(1)}% Territorial Control Established\n` +
          '```\n';
      });

      embed.setDescription(description);

      // =========================================================
      // GIF PIPELINE
      // =========================================================

      let gifUrl = null;

      if (!isTie && activeClans.length >= 2) {
        const winnerRoleIds = activeClans.map((c) => c.roleId || 'unknown');
        const rankHash = `count:${activeClans.length}|` + activeClans.map((c, i) => `${i + 1}:${c.roleId}`).join('|');

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

            const persistentMsgLink = await AssetService.storeToDevChannel(
              client,
              fileStream,
              'winner.gif',
              contextText
            );

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
          await channel.messages.delete(ids.clanLeaderboardMessageId);
        } catch {
          /* best-effort delete old msg */
        }
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
      const [, _gId, cId, mId] = match;
      const ch = await client.channels.fetch(cId);
      return await ch.messages.fetch(mId);
    } catch {
      return null;
    }
  }

  static async getLeaderboardChannel(client, guildId) {
    const ids = await getIds(guildId);
    if (!ids.leaderboardChannelId) return null;
    const guild = client.guilds.cache.get(guildId);
    return guild ? await guild.channels.fetch(ids.leaderboardChannelId).catch(() => null) : null;
  }

  static async getClanMentions(guildId) {
    const ids = await getIds(guildId);
    return [ids.clanRole1Id, ids.clanRole2Id, ids.clanRole3Id, ids.clanRole4Id]
      .filter(Boolean)
      .map((id) => `<@&${id}>`)
      .join(' ');
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
