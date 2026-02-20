// src/services/CustomRoleService.js

const { prisma } = require('../lib/prisma');
const logger = require('../lib/logger');
const { DatabaseService } = require('./DatabaseService');

class CustomRoleService {
  static async createRoleRequest(guildId, request) {
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId } });
    const currentRequests = guildConfig?.roleRequests || [];

    currentRequests.push(request);

    await prisma.guildConfig.update({
      where: { guildId },
      data: { roleRequests: currentRequests },
    });
  }

  static async approveRoleRequest(guild, admin, requestId) {
    const guildId = guild.id;
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId } });
    const requests = guildConfig?.roleRequests || [];

    const request = requests.find((r) => r.id === requestId);
    if (!request) throw new Error('Request not found.');

    const member = await guild.members.fetch(request.userId).catch(() => null);
    if (!member) throw new Error('Member not found in server.');

    // 1. Create Role
    const newRole = await guild.roles.create({
      name: request.roleName,
      color: request.hexColor,
      reason: `Custom Role approved by ${admin.username}`,
    });

    // 2. Position Role Logic (Dynamic Anchor Check)
    const ids = await DatabaseService.getGuildIds(guildId);

    // FETCH SNAPSHOT: Grab all roles from API since cache is 0
    const allRoles = await guild.roles.fetch();

    const targetAnchorId = request.colorYourName ? ids.anchorRoleColorId : ids.anchorRoleDefaultId;

    let anchorRole = null;
    if (targetAnchorId) {
      // Look up against the fresh snapshot
      anchorRole = allRoles.get(targetAnchorId);
    }

    if (anchorRole) {
      // Fetch the bot member and its roles explicitly to calculate highest position
      const botMember = await guild.members.fetch(guild.client.user.id).catch(() => null);

      // Safety check: ensure we can resolve the bot's highest role
      if (botMember && botMember.roles.highest.position > anchorRole.position) {
        try {
          await newRole.setPosition(anchorRole.position);
          logger.info(`Positioned role ${newRole.name} at anchor position`);
        } catch (e) {
          logger.warn(`Could not position role ${newRole.name}: ${e}`);
        }
      } else {
        logger.warn(`Cannot position role ${newRole.name} near ${anchorRole.name}. Bot's highest role is too low.`);
      }
    } else {
      logger.warn(`Anchor role not configured or found. New role created at default position.`);
    }

    // 3. Assign Role
    await member.roles.add(newRole);

    // 4. Remove Request from DB
    const updatedRequests = requests.filter((r) => r.id !== requestId);
    await prisma.guildConfig.update({
      where: { guildId },
      data: { roleRequests: updatedRequests },
    });

    return newRole.id;
  }

  static async denyRoleRequest(guildId, requestId) {
    const guildConfig = await prisma.guildConfig.findUnique({ where: { guildId } });
    const requests = guildConfig?.roleRequests || [];

    const updatedRequests = requests.filter((r) => r.id !== requestId);

    await prisma.guildConfig.update({
      where: { guildId },
      data: { roleRequests: updatedRequests },
    });
  }
}

module.exports = { CustomRoleService };
