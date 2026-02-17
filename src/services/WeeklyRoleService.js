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
      // 1. Fetch Config & IDs
      const guildConfig = await DatabaseService.getFullGuildConfig(guildId);
      const ids = guildConfig?.ids || {};
      const config = guildConfig?.config || {};

      const roleId = ids.weeklyBestChatterRoleId;

      // 2. Validation
      if (!roleId) return; // Feature not configured

      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;

      // 3. Fetch Top Winner
      const topUsers = await DatabaseService.fetchTopUsers(guildId, 1, 'weekly');
      const newWinnerId = topUsers.length > 0 ? topUsers[0].userId : null;
      const oldWinnerId = config.currentWeeklyWinnerId;

      if (newWinnerId === oldWinnerId) {
        // Optimization: If winner is same, ensure they have the role?
        // For stateless, we assume if ID matches, role was given. 
        // But to be robust against restarts/missed events, we can check.
        // Since GuildMemberManager is 0, checking costs API call.
        // Let's only check if they CHANGED.
        return;
      }

      // 4. Handle Change

      // a. Remove Role from Old Winner
      if (oldWinnerId) {
        try {
          // We must fetch to remove role
          const oldMember = await guild.members.fetch(oldWinnerId).catch(() => null);
          if (oldMember) {
            await oldMember.roles.remove(roleId, 'Weekly Winner Changed');
            logger.info(`Removed Weekly Best Chatter role from previous winner ${oldMember.user.tag}`);
          }
        } catch (e) {
          logger.error(`Failed to remove weekly role from old winner ${oldWinnerId}: ${e}`);
        }
      }

      // b. Add Role to New Winner
      if (newWinnerId) {
        try {
          const newMember = await guild.members.fetch(newWinnerId).catch(() => null);
          if (newMember) {
            await newMember.roles.add(roleId, 'New Weekly Best Chatter');
            logger.info(`Assigned Weekly Best Chatter role to ${newMember.user.tag}`);
          }
        } catch (e) {
          logger.error(`Failed to assign weekly role to new winner ${newWinnerId}: ${e}`);
        }
      }

      // c. Update Persisted State in DB
      // We store `currentWeeklyWinnerId` in the `config` JSON column
      await DatabaseService.atomicJsonMerge(guildId, 'config', JSON.stringify({ currentWeeklyWinnerId: newWinnerId }));

    } catch (error) {
      logger.error(`Error in WeeklyRoleService for guild ${guildId}:`, error);
    }
  }
}

module.exports = { WeeklyRoleService };
