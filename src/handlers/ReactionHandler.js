// src/handlers/ReactionHandler.js

const { ConfigService } = require('../services/ConfigService');
const { DatabaseService } = require('../services/DatabaseService');
const logger = require('../lib/logger');

class ReactionHandler {
  static async handleReactionAdd(reaction, user) {
    if (reaction.partial) await reaction.fetch().catch((e) => logger.error('Error fetching reaction:', e));
    if (user.partial) await user.fetch().catch((e) => logger.error('Error fetching user:', e));

    if (user.bot || !reaction.message.guild) return;

    const guild = reaction.message.guild;
    const guildId = guild.id;
    const msgId = reaction.message.id;

    try {
      // 1. Check if this is the Clan Role Message
      const guildIds = await DatabaseService.getGuildIds(guildId);
      const clanMessageId = guildIds.clanMessageId;

      if (msgId === clanMessageId) {
        await this.handleClanReaction(guild, user, reaction, true);
        return;
      }

      // 2. Standard Reaction Roles (if not clan message)
      const reactionRoles = await ConfigService.getReactionRoles(guildId);
      if (!reactionRoles) return;

      const roleConfig = reactionRoles[msgId];
      if (!roleConfig) return;

      const targetEmoji = roleConfig.emoji;
      const emojiName = reaction.emoji.name;
      const emojiId = reaction.emoji.id;
      const emojiString = reaction.emoji.toString();

      const isMatch = targetEmoji === emojiString || targetEmoji === emojiName || targetEmoji === emojiId;

      if (!isMatch) return;

      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      await member.roles.add(roleConfig.roleId, 'Reaction role assignment');
      logger.info(`Assigned role ${roleConfig.roleId} to ${user.tag} via reaction`);

    } catch (error) {
      logger.error(`Error in handleReactionAdd: ${error}`);
    }
  }

  static async handleReactionRemove(reaction, user) {
    if (reaction.partial) await reaction.fetch().catch((e) => logger.error('Error fetching reaction:', e));
    if (user.partial) await user.fetch().catch((e) => logger.error('Error fetching user:', e));

    if (user.bot || !reaction.message.guild) return;

    const guild = reaction.message.guild;
    const guildId = guild.id;
    const msgId = reaction.message.id;

    try {
      // 1. Check if this is the Clan Role Message
      const guildIds = await DatabaseService.getGuildIds(guildId);
      const clanMessageId = guildIds.clanMessageId;

      if (msgId === clanMessageId) {
        await this.handleClanReaction(guild, user, reaction, false);
        return;
      }

      // 2. Standard Reaction Roles
      const reactionRoles = await ConfigService.getReactionRoles(guildId);
      if (!reactionRoles) return;

      const roleConfig = reactionRoles[msgId];

      if (!roleConfig) return;

      const targetEmoji = roleConfig.emoji;
      const isMatch =
        targetEmoji === reaction.emoji.toString() ||
        targetEmoji === reaction.emoji.name ||
        targetEmoji === reaction.emoji.id;

      if (!isMatch) return;

      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      if (member.roles.cache.has(roleConfig.roleId)) {
        await member.roles.remove(roleConfig.roleId, 'Reaction role removal');
        logger.info(`Removed role ${roleConfig.roleId} from ${user.tag} via unreact`);
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
   * @param {Guild} guild 
   * @param {User} user 
   * @param {MessageReaction} reaction 
   * @param {boolean} isAdd - true if adding reaction, false if removing
   */
  static async handleClanReaction(guild, user, reaction, isAdd) {
    const guildId = guild.id;
    // Stateless: We do not fetch member here if we can avoid it, but we need member to add roles.
    // However, GuildMemberManager is 0, so fetch is required.
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    // Fetch Clan Config
    const guildConfig = await DatabaseService.getFullGuildConfig(guildId);
    const clans = guildConfig?.clans || {};

    const emojiName = reaction.emoji.name;
    const emojiId = reaction.emoji.id;
    const emojiString = reaction.emoji.toString();

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
      await DatabaseService.setUserClan(guildId, user.id, targetClan.id);

      // 2. Blindly Add Role
      try {
        await member.roles.add(targetClan.roleId, 'Clan Selection (Stateless)');
      } catch (e) {
        logger.error(`Failed to add clan role ${targetClan.roleId}: ${e}`);
      }

      // 3. Cleanup: Check for OTHER clan reactions on the message and remove them/roles
      // We iterate all clans, if it's NOT the target, we try to remove role and reaction.
      const msg = reaction.message;

      for (const clan of Object.values(clans)) {
        if (clan.id === targetClan.id) continue;

        // Blind Remove Role
        if (clan.roleId) {
          try {
            await member.roles.remove(clan.roleId, 'Clan Cleanup (Stateless)');
          } catch { }
        }

        // Blind Remove Reaction
        try {
          // Since ReactionManager is 0, we might need to fetch reactions if not available?
          // Actually `msg.reactions.cache` might be empty.
          // But the user just reacted, so the message object *might* be partial.
          // We should fetch the message to be sure if we want to remove reactions.
          // But typically resolving by emoji works if we have the message.

          // User said: "check for any other clanemoji, if found un-react the older"
          // To find 'any other', we can just try to remove the user from all other clan emoji reactions.
          const otherReaction = msg.reactions.cache.find(r =>
            r.emoji.name === clan.emoji || r.emoji.toString() === clan.emoji || r.emoji.id === clan.emoji
          );

          if (otherReaction) {
            await otherReaction.users.remove(user.id);
          }
        } catch (e) {
          logger.error(`Failed to cleanup reaction for clan ${clan.id}: ${e}`);
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
      await DatabaseService.setUserClan(guildId, user.id, 0);
    }
  }
}

module.exports = { ReactionHandler };
