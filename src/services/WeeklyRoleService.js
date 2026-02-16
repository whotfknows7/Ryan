const { DatabaseService } = require('./DatabaseService');
const { getIds } = require('../utils/GuildIdsHelper');
const logger = require('../lib/logger');

class WeeklyRoleService {
  /**
   * Checks and assigns the weekly best chatter role to the top user
   * @param {Client} client
   * @param {string} guildId
   */
  static async checkWeeklyRole(client, guildId) {
    try {
      // 1. Fetch Config
      const ids = await getIds(guildId);
      const roleId = ids.weeklyBestChatterRoleId;

      // 2. Validation
      if (!roleId) return; // Feature not configured

      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;

      // 3. Fetch Role
      const role = guild.roles.cache.get(roleId);
      if (!role) {
        logger.warn(`Weekly Role ID ${roleId} configured for guild ${guildId} but role not found.`);
        return;
      }

      // 4. Fetch Winner
      // fetchTopUsers(guildId, limit, type)
      const topUsers = await DatabaseService.fetchTopUsers(guildId, 1, 'weekly');
      const winnerId = topUsers.length > 0 ? topUsers[0].userId : null;

      // 5. Manage Role
      // Remove role from users who shouldn't have it
      for (const [memberId, member] of role.members) {
        if (memberId !== winnerId) {
          try {
            await member.roles.remove(role);
            logger.info(`Removed Weekly Best Chatter role from ${member.user.tag} in ${guild.name}`);
          } catch (err) {
            logger.error(`Failed to remove weekly role from ${member.user.tag}:`, err);
          }
        }
      }

      // Add role to the winner if they don't have it
      if (winnerId) {
        try {
          const winnerMember = await guild.members.fetch(winnerId).catch(() => null);
          if (winnerMember && !winnerMember.roles.cache.has(roleId)) {
            await winnerMember.roles.add(role);
            logger.info(`Assigned Weekly Best Chatter role to ${winnerMember.user.tag} in ${guild.name}`);
          }
        } catch (err) {
          logger.error(`Failed to assign weekly role to winner ${winnerId}:`, err);
        }
      }
    } catch (error) {
      logger.error(`Error in WeeklyRoleService for guild ${guildId}:`, error);
    }
  }
}

module.exports = { WeeklyRoleService };
