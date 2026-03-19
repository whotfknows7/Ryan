// src/handlers/ReactionHandler.js

const { ConfigService } = require('../services/ConfigService');
const { DatabaseService } = require('../services/DatabaseService');
const { hasRole } = require('../utils/GuildIdsHelper');
const logger = require('../lib/logger');

class ReactionHandler {
  static async handleReactionAdd(client, payload) {
    const { guildId, userId, messageId, emojiName, emojiId, emojiString } = payload;

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    try {
      // 1. Check if this is the Clan Role Message
      const guildIds = await DatabaseService.getGuildIds(guildId);
      const clanMessageId = guildIds.clanMessageId;

      if (messageId === clanMessageId) {
        await this.handleClanReaction(client, payload, true);
        return;
      }

      // 2. Standard Reaction Roles (if not clan message)
      const reactionRoles = await ConfigService.getReactionRoles(guildId);
      if (!reactionRoles) return;

      let roleConfig = null;
      for (const config of Object.values(reactionRoles)) {
        if (config.messageId === messageId && (config.emoji === emojiString || config.emoji === emojiName || config.emoji === emojiId)) {
          roleConfig = config;
          break;
        }
      }

      if (!roleConfig) return;

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return;

      await member.roles.add(roleConfig.roleId, 'Reaction role assignment');
      logger.info(`Assigned role ${roleConfig.roleId} to user ${userId} via reaction`);

      // EXCLUSIVITY LOGIC: Check for existing clan/unique roles
      if (roleConfig.isClanRole || roleConfig.uniqueRoles) {
        for (const [otherMsgId, otherConfig] of Object.entries(reactionRoles)) {
          if (otherMsgId === messageId) continue; // Skip the current reaction

          if (otherConfig.isClanRole || otherConfig.uniqueRoles) {
            if (hasRole(member, otherConfig.roleId)) {
              // 1. Remove the old role
              try {
                await member.roles.remove(otherConfig.roleId, 'Clan Exclusivity Auto-Removal');
                logger.info(`Removed exclusive role ${otherConfig.roleId} from user ${userId}`);
              } catch (e) {
                logger.error(`Failed to remove exclusive role: ${e}`);
              }

              // 2. Remove the old reaction via REST
              try {
                const eStr = otherConfig.emoji;
                const eRest = eStr.match(/<a?:(.+?):(\d+)>/)
                  ? `${eStr.match(/<a?:(.+?):(\d+)>/)[1]}:${eStr.match(/<a?:(.+?):(\d+)>/)[2]}`
                  : encodeURIComponent(eStr);

                await client.rest.delete(
                  `/channels/${otherConfig.channelId}/messages/${otherConfig.messageId}/reactions/${eRest}/${userId}`
                );
              } catch {
                // Ignore API errors if the reaction is already gone
              }
            }
          }
        }

        // 3. Sync Clan to Database for XP tracking
        const ids = await DatabaseService.getGuildIds(guildId);
        let clanId = 0;
        if (roleConfig.roleId === ids.clanRole1Id) clanId = 1;
        else if (roleConfig.roleId === ids.clanRole2Id) clanId = 2;
        else if (roleConfig.roleId === ids.clanRole3Id) clanId = 3;
        else if (roleConfig.roleId === ids.clanRole4Id) clanId = 4;

        if (clanId > 0) await DatabaseService.setUserClan(guildId, userId, clanId);
      }
    } catch (error) {
      logger.error(`Error in handleReactionAdd: ${error}`);
    }
  }

  static async handleReactionRemove(client, payload) {
    const { guildId, userId, messageId, emojiName, emojiId, emojiString } = payload;

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    try {
      // 1. Check if this is the Clan Role Message
      const guildIds = await DatabaseService.getGuildIds(guildId);
      const clanMessageId = guildIds.clanMessageId;

      if (messageId === clanMessageId) {
        await this.handleClanReaction(client, payload, false);
        return;
      }

      // 2. Standard Reaction Roles
      const reactionRoles = await ConfigService.getReactionRoles(guildId);
      if (!reactionRoles) return;

      let roleConfig = null;
      for (const config of Object.values(reactionRoles)) {
        if (config.messageId === messageId && (config.emoji === emojiString || config.emoji === emojiName || config.emoji === emojiId)) {
          roleConfig = config;
          break;
        }
      }

      if (!roleConfig) return;

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return;

      if (hasRole(member, roleConfig.roleId)) {
        await member.roles.remove(roleConfig.roleId, 'Reaction role removal');
        logger.info(`Removed role ${roleConfig.roleId} from user ${userId} via unreact`);

        // Sync departure to Database
        if (roleConfig.isClanRole) {
          await DatabaseService.setUserClan(guildId, userId, 0);
        }
      }
    } catch (error) {
      logger.error(`Error in handleReactionRemove: ${error}`);
    }
  }

  /**
   * Handles logic for Clan Selection (Stateless Switching)
   * @param {Guild} guild
   * @param {User} user
   * @param {MessageReaction} reaction
   * @param {boolean} isAdd - true if adding reaction, false if removing
   */
  /**
   * Handles logic for Clan Selection (Stateless Switching)
   * @param {Client} client
   * @param {Object} payload
   * @param {boolean} isAdd - true if adding reaction, false if removing
   */
  static async handleClanReaction(client, payload, isAdd) {
    const { guildId, userId, channelId, messageId, emojiName, emojiId, emojiString } = payload;

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    // Stateless: We do not fetch member here if we can avoid it, but we need member to add roles.
    // However, GuildMemberManager is 0, so fetch is required.
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    // Fetch Clan Config
    const guildConfig = await DatabaseService.getFullGuildConfig(guildId);
    const clans = guildConfig?.clans || {};

    // Find the clan matching this emoji
    let targetClan = null;
    for (const clan of Object.values(clans)) {
      if (clan.emoji === emojiString || clan.emoji === emojiName || clan.emoji === emojiId) {
        targetClan = clan;
        break;
      }
    }

    if (!targetClan) return;

    if (isAdd) {
      // --- CLAN JOIN / SWITCH (Blunt Logic) ---

      // 1. Write to DB immediately (Source of Truth)
      await DatabaseService.setUserClan(guildId, userId, targetClan.id);

      // 2. Blindly Add Role
      try {
        await member.roles.add(targetClan.roleId, 'Clan Selection (Stateless)');
      } catch (e) {
        logger.error(`Failed to add clan role ${targetClan.roleId}: ${e}`);
      }

      // 3. Cleanup: Check for OTHER clan reactions on the message and remove them/roles
      // We iterate all clans, if it's NOT the target, we try to remove role and reaction.
      // We do this stelessly by using the REST API to remove the user's reaction

      for (const clan of Object.values(clans)) {
        if (clan.id === targetClan.id) continue;

        // Blind Remove Role
        if (clan.roleId) {
          try {
            await member.roles.remove(clan.roleId, 'Clan Cleanup (Stateless)');
          } catch {
            /* best-effort */
          }
        }

        // Blind Remove Reaction via REST API
        try {
          // Format emoji for REST api: name:id or name if no id
          const emojiStringForRest = clan.emoji.match(/<a?:(.+?):(\d+)>/)
            ? `${clan.emoji.match(/<a?:(.+?):(\d+)>/)[1]}:${clan.emoji.match(/<a?:(.+?):(\d+)>/)[2]}`
            : encodeURIComponent(clan.emoji);

          await client.rest.delete(
            `/channels/${channelId}/messages/${messageId}/reactions/${emojiStringForRest}/${userId}`
          );
        } catch {
          // Ignore API errors for missing reactions Let it fail silently
        }
      }
    } else {
      // --- CLAN LEAVE (Blunt Logic) ---
      // user un-reacted.

      // 1. Remove the role associated with THIS emoji
      try {
        await member.roles.remove(targetClan.roleId, 'Clan Left (Stateless)');
      } catch (e) {
        logger.error(`Failed to remove clan role ${targetClan.roleId}: ${e}`);
      }

      // 2. Set DB to 0
      await DatabaseService.setUserClan(guildId, userId, 0);
    }

    // --- 5-MINUTE INTEGRITY CHECK ---
    setTimeout(
      async () => {
        try {
          const freshMember = await guild.members.fetch(userId).catch(() => null);
          if (!freshMember) return;

          // Fetch Truth from DB
          const stats = await DatabaseService.getUserStats(guildId, userId);
          const trueClanId = stats.clanId || 0;

          // Fetch Config for Roles
          const checkConfig = await DatabaseService.getFullGuildConfig(guildId);
          const allClans = checkConfig?.clans || {};
          const trueClan = Object.values(allClans).find((c) => c.id === trueClanId);

          let correctionNeeded = false;

          // 1. Enforce Correct Role
          if (trueClan) {
            if (!hasRole(freshMember, trueClan.roleId)) {
              await freshMember.roles.add(trueClan.roleId, 'Clan Integrity Check');
              correctionNeeded = true;
            }
          }

          // 2. Remove Incorrect Roles
          for (const c of Object.values(allClans)) {
            if (c.id !== trueClanId) {
              if (hasRole(freshMember, c.roleId)) {
                await freshMember.roles.remove(c.roleId, 'Clan Integrity Check');
                correctionNeeded = true;
              }

              // Fix Reactions for incorrect clans
              try {
                const emojiStringForRest = c.emoji.match(/<a?:(.+?):(\d+)>/)
                  ? `${c.emoji.match(/<a?:(.+?):(\d+)>/)[1]}:${c.emoji.match(/<a?:(.+?):(\d+)>/)[2]}`
                  : encodeURIComponent(c.emoji);

                await client.rest.delete(
                  `/channels/${channelId}/messages/${messageId}/reactions/${emojiStringForRest}/${userId}`
                );
              } catch {
                // Ignore reaction fix errors
              }
            }
          }

          if (correctionNeeded) {
            logger.info(`Clan integrity check corrected user ${userId}`);
          }
        } catch (error) {
          logger.error(`Error in Clan Integrity Check for ${userId}: ${error}`);
        }
      },
      5 * 60 * 1000
    ); // 5 minutes
  }
}

module.exports = { ReactionHandler };
