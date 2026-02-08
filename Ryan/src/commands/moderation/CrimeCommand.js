// src/commands/moderation/CrimeCommand.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ConfigService } = require('../../services/ConfigService');
const { PunishmentService } = require('../../services/PunishmentService');

const CrimeCommand = {
  data: new SlashCommandBuilder()
    .setName('crime_investigation')
    .setDescription('View the Torture Chamber leaderboard or criminal record')
    .addUserOption(opt => opt.setName('member').setDescription('Investigate specific member')),

  execute: async (interaction) => {
    const targetUser = interaction.options.getUser('member');
    const guildId = interaction.guildId;
    const now = new Date();

    // 1. Specific Member Report - OPTIMIZED: fetch only the target user's data
    if (targetUser) {
      const log = await ConfigService.getJailLog(guildId, targetUser.id);
      if (!log) {
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setTitle('🕊️ CLEAN RECORD')
            .setDescription(`<@${targetUser.id}> has never entered the Torture Chamber!`)
            .setThumbnail(targetUser.displayAvatarURL())
            .setColor('Green')]
        });
      }

      const isJailed = log.status === 'jailed' && log.punishmentEnd;
      let statusStr = "🆓 Released (Sentence Completed)";
      let color = 0x00FF00; // Green
      let progressBar = "▰".repeat(10); // Full bar

      if (isJailed && log.punishmentEnd) {
        const endDate = new Date(log.punishmentEnd);
        if (endDate > now) {
            const totalDuration = PunishmentService.getDurationMs(log.offences);
            const timeLeft = endDate.getTime() - now.getTime();
            const elapsed = Math.max(0, totalDuration - timeLeft);
            const percentage = Math.min(100, (elapsed / totalDuration) * 100);
            
            const filled = Math.floor(percentage / 10);
            progressBar = '▰'.repeat(filled) + '▱'.repeat(10 - filled);
            
            const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
            const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            
            statusStr = `🔄 Serving Sentence (${days}d ${hours}h ${minutes}m)`;
            color = 0xFFA500; // Orange
        }
      }

      // Generate Offence History List
      const historyList = Array.from({ length: log.offences }, (_, i) => 
        `• ${i + 1}${getOrdinal(i + 1)} offence: ${PunishmentService.getDurationText(i + 1)}`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setTitle(`🦹‍♂️ CRIMINAL DOSSIER: ${log.username}`)
        .setColor(color)
        .setThumbnail("https://media.tenor.com/9vNrcVYLVicAAAPo/caught-mug-shot.mp4")
        .addFields(
            { name: '**IDENTITY**', value: `\`\`\`${log.username}\nID: ${targetUser.id}\`\`\``, inline: false },
            { name: '**STATUS**', value: `${statusStr}\n\`${progressBar}\``, inline: false },
            { name: '⚖️ **OFFENCE HISTORY**', value: `\`\`\`ansi\n\u001b[0;31m${log.offences} CONVICTIONS\u001b[0m\n${historyList}\`\`\``, inline: false }
        );

      return interaction.reply({ embeds: [embed] });
    }

    // 2. Leaderboard - fetch all logs only when showing leaderboard
    const jailLogs = await ConfigService.getJailLogs(guildId);
    const sorted = Object.entries(jailLogs)
        .sort(([, a], [, b]) => b.offences - a.offences)
        .slice(0, 15);

    const embed = new EmbedBuilder()
        .setTitle('🔥 TORTURE CHAMBER LEADERBOARD')
        .setDescription('Most notorious rule-breakers in the server')
        .setColor('DarkRed')
        .setThumbnail("https://media.tenor.com/9vNrcVYLVicAAAPo/caught-mug-shot.mp4");

    if (sorted.length === 0) {
        embed.addFields({ name: '🎉 ALL CLEAR!', value: 'The Torture Chamber stands empty... for now.' });
    } else {
        sorted.forEach(([uid, data], index) => {
            const endDate = data.punishmentEnd ? new Date(data.punishmentEnd) : null;
            const isActive = data.status === 'jailed' && endDate && endDate > now;
            
            let statusText = "🔓 RELEASED (INACTIVE CASE)";
            if (isActive && endDate) {
                const timeLeft = endDate.getTime() - now.getTime();
                const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
                const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                statusText = `⏳ ${days}d ${hours}h remaining`;
            }
            
            const nameDisplay = data.username || `User ${uid}`;
            embed.addFields({
                name: `#${index + 1} ━ ${nameDisplay}`,
                value: `\`\`\`📜 Offences: ${data.offences}\n${statusText}\`\`\``
            });
        });
    }
    
    embed.setFooter({ text: "🔍 Use /crime_investigation member:@user for detailed reports" });

    return interaction.reply({ embeds: [embed] });
  }
};

function getOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

module.exports = CrimeCommand;
