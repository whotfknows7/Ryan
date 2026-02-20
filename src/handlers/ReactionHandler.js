// src/handlers/ReactionHandler.js

const { ConfigService } = require('../services/ConfigService');
const { DatabaseService } = require('../services/DatabaseService');
const { hasRole } = require('../utils/GuildIdsHelper');
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

      if (hasRole(member, roleConfig.roleId)) {
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
      const msg = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
      if (!msg) return;

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

        // Blind Remove Reaction
        const otherReaction = msg.reactions.cache.find(
          (r) => r.emoji.name === clan.emoji || r.emoji.toString() === clan.emoji || r.emoji.id === clan.emoji
        );

        if (otherReaction) {
          // We don't want to throw an error if we lack permissions
          await otherReaction.users.remove(user.id).catch(() => null);
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

    // --- 5-MINUTE INTEGRITY CHECK ---
    setTimeout(
      async () => {
        try {
          const freshMember = await guild.members.fetch(user.id).catch(() => null);
          if (!freshMember) return;

          // Fetch Truth from DB
          const stats = await DatabaseService.getUserStats(guildId, user.id);
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
                // const clanMsg = await guild.channels.fetch(guildIds.clanChannelId) // Assuming checks are in clan channel?
                //   .then(ch => ch.messages.fetch(guildIds.clanMessageId))
                //   .catch(() => null);

                // Actually we have the message ID from the reaction passed in, or we can fetch via config if needed.
                // But inside setTimeout `reaction.message` might be stale/gone from cache?
                // Use `guildIds.clanMessageId` fetched earlier or available via `DatabaseService`.
                // The `msg` from reaction handler scope is available in closure, but better typically to fetch fresh if 5 mins passed.
                // Let's use the closure `reaction.message` ID.

                if (reaction.message) {
                  const safeMsg = await reaction.message.fetch().catch(() => null);
                  if (safeMsg) {
                    const badReaction = safeMsg.reactions.cache.find(
                      (r) => r.emoji.name === c.emoji || r.emoji.toString() === c.emoji || r.emoji.id === c.emoji
                    );
                    if (badReaction) {
                      await badReaction.users.remove(user.id).catch(() => null);
                      correctionNeeded = true;
                    }
                  }
                }
              } catch {
                // Ignore reaction fix errors
              }
            }
          }

          if (correctionNeeded) {
            logger.info(`Clan integrity check corrected user ${user.tag}`);
          }
        } catch (error) {
          logger.error(`Error in Clan Integrity Check for ${user.tag}: ${error}`);
        }
      },
      5 * 60 * 1000
    ); // 5 minutes
  }
}

module.exports = { ReactionHandler };
