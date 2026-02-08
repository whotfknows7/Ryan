const { SlashCommandBuilder, Collection, MessageFlags } = require('discord.js');
const { getIds } = require('../../utils/GuildIdsHelper');

const cooldowns = new Collection();
const COOLDOWN_DURATION = 10 * 60 * 1000; 

const EmergencyCommand = {
  data: new SlashCommandBuilder()
    .setName('911')
    .setDescription('Emergency ping for admins (10m cooldown)'),

  execute: async (interaction) => {
    const guild = interaction.guild;
    const now = Date.now();
    
    const lastUsed = cooldowns.get(guild.id);
    if (lastUsed && (now - lastUsed < COOLDOWN_DURATION)) {
      const timeLeft = Math.ceil((COOLDOWN_DURATION - (now - lastUsed)) / 60000);
      return interaction.reply({ 
        content: `Mods are on their way. Please hold up and stay calm until they arrive. (Cooldown: ${timeLeft}m)`
      });
    }

    const ids = await getIds(guild.id);
    const adminRoleId = ids.adminRoleId;
    const logsChannelId = ids.logsChannelId;

    if (!adminRoleId) {
      return interaction.reply({ 
        content: '❌ Admin role not configured. Please run `/setup wizard` to configure roles.', 
        flags: MessageFlags.Ephemeral
      });
    }

    if (!logsChannelId) {
      return interaction.reply({ 
        content: '❌ Logs channel not configured. Please run `/setup wizard` to configure channels.', 
        flags: MessageFlags.Ephemeral
      });
    }

    const adminRole = guild.roles.cache.get(adminRoleId);
    const logChannel = guild.channels.cache.get(logsChannelId);

    if (!adminRole) {
      return interaction.reply({ 
        content: '❌ Admin role not found. Please reconfigure using `/setup wizard`.', 
        flags: MessageFlags.Ephemeral
      });
    }

    if (!logChannel) {
      return interaction.reply({ 
        content: '❌ Logs channel not found. Please reconfigure using `/setup wizard`.', 
        flags: MessageFlags.Ephemeral
      });
    }

    await logChannel.send(
      `${adminRole.toString()} Emergency! Please respond immediately to ${interaction.channel?.toString()}.`
    );
    
    cooldowns.set(guild.id, now);
    
    return interaction.reply({ 
      content: 'Admins have been called. Please wait for them to respond.'
    });
  }
};

module.exports = EmergencyCommand;
