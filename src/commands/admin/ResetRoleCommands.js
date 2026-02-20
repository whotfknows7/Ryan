const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { DatabaseService } = require('../../services/DatabaseService');
const { prisma } = require('../../lib/prisma');
const { addMinutes } = require('date-fns');
const { hasRole } = require('../../utils/GuildIdsHelper');

const ResetRoleCommand = {
  data: new SlashCommandBuilder()
    .setName('resetrole_system')
    .setDescription('Manage Reset Roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('Remove a role from everyone and store it')
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to reset').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('readd')
        .setDescription('Re-add a stored role to members')
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to restore').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List currently stored roles')),

  execute: async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    const guildConfig = await DatabaseService.getFullGuildConfig(guildId);

    if (!guildConfig && sub !== 'reset') {
      return interaction.reply({
        content: '❌ Guild configuration not found.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const resetData = guildConfig?.resetRoleData || {};

    if (sub === 'list') {
      if (Object.keys(resetData).length === 0) {
        return interaction.reply({ content: '📋 No roles are currently stored.', flags: MessageFlags.Ephemeral });
      }

      const lines = Object.entries(resetData).map(([roleId, data]) => {
        if (!data || !data.expiry) return `<@&${roleId}>: Error`;
        const expiry = new Date(data.expiry);
        const timeLeft = Math.max(0, Math.floor((expiry.getTime() - Date.now()) / 60000));
        return `<@&${roleId}>: ${data.members.length} members (Expires in ${timeLeft}m)`;
      });

      return interaction.reply({ content: `**Stored Roles:**\n${lines.join('\n')}`, flags: MessageFlags.Ephemeral });
    }

    const role = interaction.options.getRole('role', true);

    if (sub === 'reset') {
      if (resetData[role.id]) {
        return interaction.reply({
          content: '⚠️ Data already exists for this role. Use `list` or `readd` first.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.reply({ content: `🔄 Fetching members targeting ${role}...` });

      const guild = interaction.guild;

      // Targeted role fetching breakthrough
      const membersWithRole = await guild.members.fetch({ force: true, role: role.id });
      const memberIds = membersWithRole.map((m) => m.id);

      if (memberIds.length === 0) {
        return interaction.editReply(`⚠️ Found 0 members with ${role}.`);
      }

      const newData = {
        members: memberIds,
        expiry: addMinutes(new Date(), 15).toISOString(),
      };

      await DatabaseService.atomicJsonMerge(
        guildId,
        'resetRoleData',
        JSON.stringify({
          [role.id]: newData,
        })
      );

      const QueueService = require('../../services/QueueService');
      await QueueService.queues.tasks.add('mass-role-removal', {
        guildId,
        roleId: role.id,
        memberIds,
      });

      await interaction.editReply(
        `✅ Identified ${memberIds.length} members with ${role}. Processing started in the background. Use \`/resetrole_system readd\` within 15 mins to restore.`
      );
    }

    if (sub === 'readd') {
      const data = resetData[role.id];
      if (!data) {
        return interaction.reply({ content: '❌ No stored data found for this role.', flags: MessageFlags.Ephemeral });
      }

      if (new Date() > new Date(data.expiry)) {
        await DatabaseService.atomicJsonDeleteKey(guildId, 'resetRoleData', role.id);
        return interaction.reply({ content: '❌ Data has expired.', flags: MessageFlags.Ephemeral });
      }

      await interaction.reply({ content: `🔄 Restoring ${role} to ${data.members.length} members...` });

      const guild = interaction.guild;
      let addedCount = 0;

      // Group user IDs to perform a single bulk fetch from Discord instead of querying one by one
      let members = new Map();
      if (data.members && data.members.length > 0) {
        members = await guild.members.fetch({ user: data.members }).catch(() => new Map());
      }

      for (const userId of data.members) {
        const member = members.get(userId);
        if (member) {
          try {
            await member.roles.add(role);
            addedCount++;
          } catch {
            /* best-effort */
          }
        }
      }

      await DatabaseService.atomicJsonDeleteKey(guildId, 'resetRoleData', role.id);

      await interaction.editReply(`✅ Re-added ${role} to ${addedCount} members.`);
    }
  },
};

async function cleanExpiredResetRoles(guildId) {
  const config = await prisma.guildConfig.findUnique({ where: { guildId } });
  if (!config?.resetRoleData) return;

  const now = Date.now();
  for (const [roleId, data] of Object.entries(config.resetRoleData)) {
    if (data.expiry && now > new Date(data.expiry).getTime()) {
      await DatabaseService.atomicJsonDeleteKey(guildId, 'resetRoleData', roleId);
    }
  }
}

async function processMassRoleRemoval(client, guildId, roleId, memberIds) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  for (const userId of memberIds) {
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member && hasRole(member, roleId)) {
        await member.roles.remove(roleId);
      }
    } catch {
      console.error(`Failed to background remove role ${roleId} from user ${userId}`);
    }
  }
}

module.exports = ResetRoleCommand;
module.exports.cleanExpiredResetRoles = cleanExpiredResetRoles;
module.exports.processMassRoleRemoval = processMassRoleRemoval;
