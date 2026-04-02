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
      // 2. Standard Reaction Roles (if not clan message)
      const reactionRoles = await ConfigService.getReactionRoles(guildId);
      if (!reactionRoles) return;

      let roleConfig = null;
      for (const config of Object.values(reactionRoles)) {
        if (
          config.messageId === messageId &&
          (config.emoji === emojiString || config.emoji === emojiName || config.emoji === emojiId)
        ) {
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
        for (const otherConfig of Object.values(reactionRoles)) {
          // CRITICAL FIX: Skip ONLY the exact role the user just clicked.
          if (otherConfig.roleId === roleConfig.roleId) continue;

          if (otherConfig.isClanRole || otherConfig.uniqueRoles) {
            // 1. Remove the old role (Keep cache check here to avoid rate-limiting the bot)
            if (hasRole(member, otherConfig.roleId)) {
              try {
                await member.roles.remove(otherConfig.roleId, 'Clan Exclusivity Auto-Removal');
                logger.info(`Removed exclusive role ${otherConfig.roleId} from user ${userId}`);
              } catch (e) {
                logger.error(`Failed to remove exclusive role: ${e}`);
              }
            }

            // 2. Remove the old reaction via REST (BLIND REMOVAL)
            // Moved OUTSIDE the role check to defeat rapid-click race conditions!
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

        // 3. Sync Clan to Database for XP tracking
        const config = await DatabaseService.getFullGuildConfig(guildId);
        const ids = config?.ids || {};
        let clanId = 0;

        if (ids.clanRole1Id === roleConfig.roleId) clanId = 1;
        else if (ids.clanRole2Id === roleConfig.roleId) clanId = 2;
        else if (ids.clanRole3Id === roleConfig.roleId) clanId = 3;
        else if (ids.clanRole4Id === roleConfig.roleId) clanId = 4;

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
      // 2. Standard Reaction Roles
      const reactionRoles = await ConfigService.getReactionRoles(guildId);
      if (!reactionRoles) return;

      let roleConfig = null;
      for (const config of Object.values(reactionRoles)) {
        if (
          config.messageId === messageId &&
          (config.emoji === emojiString || config.emoji === emojiName || config.emoji === emojiId)
        ) {
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
}

module.exports = { ReactionHandler };
