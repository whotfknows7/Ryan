const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { DatabaseService } = require('../../services/DatabaseService');
const { invalidate } = require('../../utils/GuildIdsHelper');
const { defaultRedis } = require('../../config/redis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure essential bot settings and role hierarchies.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    // --- [NEW] Module Selection ---
    .addStringOption((opt) =>
      opt
        .setName('reset_module')
        .setDescription('Select the XP Reset Behavior.')
        .addChoices(
          { name: 'Module 1: Default (Daily User Reset)', value: 'module_1' },
          { name: 'Module 2: Weekly User Reset (Persistent Daily)', value: 'module_2' },
          { name: 'Module 3: Lifetime User XP (No Reset)', value: 'module_3' }
        )
    )
    // ------------------------------
    .addChannelOption((opt) =>
      opt.setName('leaderboard_channel').setDescription('Channel for Level-Up alerts and Public Announcements.')
    )
    .addChannelOption((opt) =>
      opt.setName('mod_log_channel').setDescription('Channel for Admin Requests (Custom Roles) and Logs.')
    )
    .addChannelOption((opt) =>
      opt.setName('release_channel').setDescription('Channel where users are pinged upon release from jail.')
    )
    .addRoleOption((opt) =>
      opt.setName('admin_role').setDescription('Users with this role can use Bot Admin commands.')
    )
    .addRoleOption((opt) => opt.setName('mod_role').setDescription('Users with this role receive Emergency Pings.'))
    .addRoleOption((opt) =>
      opt.setName('jail_role').setDescription('The role assigned to Jailed users (should restrict channel access).')
    )
    .addRoleOption((opt) =>
      opt
        .setName('anchor_role_default')
        .setDescription('HIERARCHY: Standard Custom Roles will be placed relative to this role.')
    )
    .addRoleOption((opt) =>
      opt
        .setName('anchor_role_color')
        .setDescription('HIERARCHY: "Color Your Name" roles will be placed relative to this role.')
    )
    .addRoleOption((opt) => opt.setName('clan_role_1').setDescription('The role for Clan 1'))
    .addRoleOption((opt) => opt.setName('clan_role_2').setDescription('The role for Clan 2'))
    .addRoleOption((opt) => opt.setName('clan_role_3').setDescription('The role for Clan 3 (Optional)'))
    .addRoleOption((opt) => opt.setName('clan_role_4').setDescription('The role for Clan 4 (Optional)'))
    .addRoleOption((opt) => opt.setName('weekly_best_chatter_role').setDescription('Role for the top weekly chatter')),

  execute: async (interaction) => {
    const guildId = interaction.guildId;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const leaderboardChannel = interaction.options.getChannel('leaderboard_channel');
      const modLogChannel = interaction.options.getChannel('mod_log_channel');
      const releaseChannel = interaction.options.getChannel('release_channel');
      const adminRole = interaction.options.getRole('admin_role');
      const modRole = interaction.options.getRole('mod_role');
      const jailRole = interaction.options.getRole('jail_role');
      const anchorDefault = interaction.options.getRole('anchor_role_default');
      const anchorColor = interaction.options.getRole('anchor_role_color');
      const resetModule = interaction.options.getString('reset_module'); // [NEW]

      const clan1 = interaction.options.getRole('clan_role_1');
      const clan2 = interaction.options.getRole('clan_role_2');
      const clan3 = interaction.options.getRole('clan_role_3');
      const clan4 = interaction.options.getRole('clan_role_4');
      const weeklyRole = interaction.options.getRole('weekly_best_chatter_role');

      const idUpdates = {};
      let summary = ['✅ **Configuration Updated Successfully!**\n'];

      if (leaderboardChannel) {
        idUpdates.leaderboardChannelId = leaderboardChannel.id;
        summary.push(`**Leaderboard Channel:** ${leaderboardChannel}`);
      }
      if (modLogChannel) {
        idUpdates.modLogChannelId = modLogChannel.id;
        summary.push(`**Mod Log Channel:** ${modLogChannel} (Requests will be sent here)`);
      }
      if (releaseChannel) {
        idUpdates.releaseChannelId = releaseChannel.id;
        summary.push(`**Release Channel:** ${releaseChannel} (Release pings will be sent here)`);
      }
      if (adminRole) {
        idUpdates.adminRoleId = adminRole.id;
        summary.push(`**Admin Role:** ${adminRole}`);
      }
      if (modRole) {
        idUpdates.modRoleId = modRole.id;
        summary.push(`**Mod Role:** ${modRole} (Emergency Pings)`);
      }
      if (jailRole) {
        idUpdates.jailRoleId = jailRole.id;
        summary.push(`**Jail Role:** ${jailRole}`);
      }
      if (anchorDefault) {
        idUpdates.anchorRoleDefaultId = anchorDefault.id;
        summary.push(`**Anchor (Default):** ${anchorDefault}`);
      }
      if (anchorColor) {
        idUpdates.anchorRoleColorId = anchorColor.id;
        summary.push(`**Anchor (Color):** ${anchorColor}`);
      }

      // [NEW] Handle Reset Module
      if (resetModule) {
        // [FIX] atomicJsonMerge expects a plain object, not a stringified JSON
        await DatabaseService.atomicJsonMerge(guildId, 'config', { resetModule });
        const niceName =
          resetModule === 'module_1'
            ? 'Default (Daily Reset)'
            : resetModule === 'module_2'
              ? 'Weekly User Reset'
              : 'Lifetime User XP';
        summary.push(`**XP Reset System:** ${niceName}`);
      }

      const existingConfig = await DatabaseService.getFullGuildConfig(guildId);
      const currentClans = existingConfig?.clans || {};
      const processClan = (id, role) => {
        if (!role) return;
        if (!currentClans[id]) currentClans[id] = { name: `Clan ${id}` };
        currentClans[id].roleId = role.id;
        summary.push(`**Clan ${id} Role:** ${role}`);
      };
      processClan(1, clan1);
      processClan(2, clan2);
      processClan(3, clan3);
      processClan(4, clan4);

      if (weeklyRole) {
        idUpdates.weeklyBestChatterRoleId = weeklyRole.id;
        summary.push(`**Weekly Best Chatter Role:** ${weeklyRole}`);
      }

      if (Object.keys(idUpdates).length > 0) {
        await DatabaseService.updateGuildIds(guildId, idUpdates);
      }

      if (clan1 || clan2 || clan3 || clan4) {
        await DatabaseService.updateGuildConfig(guildId, { clans: currentClans });
      }

      // 1. Invalidate Local Cache
      invalidate(guildId);

      // 2. Publish Global Invalidation
      await defaultRedis.publish('config_update', guildId);

      if (summary.length === 1) {
        summary.push('_No changes were made. Please select options to configure._');
      }

      await interaction.editReply({ content: summary.join('\n') });
    } catch (error) {
      console.error('Setup command error:', error);
      await interaction.editReply({ content: '❌ An error occurred while saving the configuration.' });
    }
  },
};
