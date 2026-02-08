// src/handlers/ReactionHandler.js

const { ConfigService } = require('../services/ConfigService');
const logger = require('../lib/logger');

class ReactionHandler {
  
  static async handleReactionAdd(reaction, user) {
    if (reaction.partial) await reaction.fetch().catch(e => logger.error('Error fetching reaction:', e));
    if (user.partial) await user.fetch().catch(e => logger.error('Error fetching user:', e));
    
    if (user.bot || !reaction.message.guild) return;
    
    const guild = reaction.message.guild;
    const guildId = guild.id;
    const msgId = reaction.message.id;
    
    try {
      const reactionRoles = await ConfigService.getReactionRoles(guildId);
      if (!reactionRoles) return;
      
      const roleConfig = reactionRoles[msgId];
      if (!roleConfig) return;
      
      const targetEmoji = roleConfig.emoji;
      const emojiName = reaction.emoji.name;
      const emojiId = reaction.emoji.id;
      const emojiString = reaction.emoji.toString();
      
      const isMatch =
        targetEmoji === emojiString ||
        targetEmoji === emojiName ||
        targetEmoji === emojiId;
      
      if (!isMatch) return;
      
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return;
      
      // FIX 2: Handle clan switching BEFORE adding the new role to prevent race conditions
      if (roleConfig.isClanRole) {
        await this.handleClanRoleSwitch(
          guild,
          member,
          user,
          msgId,
          roleConfig.roleId,
          reactionRoles
        );
      }
      
      await member.roles.add(roleConfig.roleId, 'Reaction role assignment');
      logger.info(`Assigned role ${roleConfig.roleId} to ${user.tag} via reaction`);
      
    } catch (error) {
      logger.error(`Error in handleReactionAdd: ${error}`);
    }
  }
  
  static async handleClanRoleSwitch(
    guild,
    member,
    user,
    currentMsgId,
    assignedRoleId,
    reactionRoles
  ) {
    for (const [otherMsgId, otherConfig] of Object.entries(reactionRoles)) {
      if (otherMsgId === currentMsgId) continue;
      if (!otherConfig.isClanRole) continue;
      
      const otherRoleId = otherConfig.roleId;
      
      if (member.roles.cache.has(otherRoleId)) {
        await member.roles.remove(otherRoleId, 'Switched clans');
        logger.info(`Removed clan role ${otherRoleId} from ${user.tag} (switched to ${assignedRoleId})`);
        
        if (otherConfig.channelId) {
          try {
            const channel = guild.channels.cache.get(otherConfig.channelId);
            if (channel) {
              const oldMessage = await channel.messages.fetch(otherMsgId).catch(() => null);
              if (oldMessage) {
                // Try to resolve by name or ID
                const reactionToRemove = oldMessage.reactions.resolve(otherConfig.emoji);
                
                if (reactionToRemove) {
                  await reactionToRemove.users.remove(user.id);
                }
              }
            }
          } catch (error) {
            logger.error(`Error removing old clan reaction: ${error}`);
          }
        }
      }
    }
  }
  
  static async handleReactionRemove(reaction, user) {
    if (reaction.partial) await reaction.fetch().catch(e => logger.error('Error fetching reaction:', e));
    if (user.partial) await user.fetch().catch(e => logger.error('Error fetching user:', e));
    
    if (user.bot || !reaction.message.guild) return;
    
    const guild = reaction.message.guild;
    const guildId = guild.id;
    const msgId = reaction.message.id;
    
    try {
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
}

module.exports = { ReactionHandler };
