const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { DatabaseService } = require('../../services/DatabaseService');
const { AssetService } = require('../../services/AssetService');
const { GifService } = require('../../services/GifService');
const CONSTANTS = require('../../lib/constants');
const logger = require('../../lib/logger');
const fs = require('fs');

const ClanCommand = {
  data: new SlashCommandBuilder()
    .setName('clans')
    .setDescription('Display live Clan Wars leaderboard'),
  
  execute: async (interaction) => {
    if (!interaction.guildId) {
      return interaction.reply({
        content: 'This command only works in guilds!',
        flags: MessageFlags.Ephemeral
      });
    }

    // 1. Defer Reply (Generation takes time)
    await interaction.deferReply();
    
    try {
      const clanTotals = await DatabaseService.getClanTotalXp(interaction.guildId);
      const ids = await DatabaseService.getGuildIds(interaction.guildId);
      const totalXp = Object.values(clanTotals).reduce((sum, xp) => sum + xp, 0);
      
      // 2. Prepare Clan Data
      const clanRoles = {
        1: ids.clanRole1Id, 
        2: ids.clanRole2Id, 
        3: ids.clanRole3Id, 
        4: ids.clanRole4Id
      };
      
      const activeClans = [];
      for (let i = 1; i <= 4; i++) {
        if (clanTotals[i] > 0 || clanRoles[i]) {
          activeClans.push({
            id: i,
            xp: clanTotals[i] || 0,
            roleId: clanRoles[i]
          });
        }
      }
      
      // Sort: Highest XP first
      activeClans.sort((a, b) => b.xp - a.xp);
      
      // 3. Build Embed Description
      let description = "";
      const isTie = activeClans.length >= 2 && activeClans[0].xp === activeClans[1].xp && totalXp > 0;
      
      if (isTie) {
        description += "**IT'S A TIE!**\n\n";
      } else if (activeClans.length === 0) {
        description = "No active clans found for this server.";
      }
      
      activeClans.forEach((clan, index) => {
        const percentage = totalXp > 0 ? (clan.xp / totalXp * 100) : 0;
        
        let rankEmoji;
        if (index === 0) rankEmoji = CONSTANTS.EMOJIS.RANK_1;
        else if (index === 1) rankEmoji = CONSTANTS.EMOJIS.RANK_2;
        else rankEmoji = `**#${index + 1}**`;
        
        const roleMention = clan.roleId ? `<@&${clan.roleId}>` : `**Clan ${clan.id}**`;
        
        // Progress Bar
        const bars = Math.floor(percentage / 10);
        const safeBars = Math.max(0, Math.min(10, bars));
        const progressBar = "▰".repeat(safeBars) + "▱".repeat(10 - safeBars);
        
        description += `${rankEmoji} ${CONSTANTS.EMOJIS.DASH_BLUE} ${roleMention}\n` +
          "```\n" +
          `${clan.xp.toLocaleString()} XP Pts\n` +
          `${progressBar} ${percentage.toFixed(1)}% Destruction Inflicted` +
          "```\n";
      });
      
      const embed = new EmbedBuilder()
        .setTitle('⚔️ **CLAN WAR CONQUEST** ⚔️')
        .setDescription(description)
        .setColor(0x823EF0) // Custom Purple
        .setFooter({ text: 'Current standings • Updates live' })
        .setTimestamp();

      // =========================================================
      // 4. GIF PIPELINE (Check Cache -> Generate -> Upload)
      // =========================================================
      
      if (!isTie && activeClans.length >= 2) {
        try {
          // A. Generate Hash
          const rankHash = `count:${activeClans.length}|` + 
                           activeClans.map((c, i) => `${i+1}:${c.roleId}`).join('|');
          
          let gifUrl = null;
          const winnerRoleIds = activeClans.map(c => c.roleId || 'unknown');

          // B. Check Cache
          const cachedEntry = await DatabaseService.getGifCache(rankHash);
          
          if (cachedEntry) {
            // Verify Link & Get Fresh URL
            const msg = await fetchMessageFromLink(interaction.client, cachedEntry.messageLink);
            if (msg && msg.attachments.first()) {
              gifUrl = msg.attachments.first().url;
            }
          }
          
          // C. Cache Miss -> GENERATE
          if (!gifUrl) {
            // Generate
            const tempFilePath = await GifService.generateClanGif(winnerRoleIds, activeClans.length);
            
            // Upload to Dev Channel
            const fileBuffer = fs.readFileSync(tempFilePath);
            const contextText = `CMD Gen: ${activeClans[0].id} (Count: ${activeClans.length})`;
            const persistentMsgLink = await AssetService.storeToDevChannel(interaction.client, fileBuffer, 'clan_status.gif', contextText);
            
            // Cache
            if (persistentMsgLink) {
              await DatabaseService.setGifCache(rankHash, persistentMsgLink);
              const msg = await fetchMessageFromLink(interaction.client, persistentMsgLink);
              if (msg) gifUrl = msg.attachments.first().url;
            }
            
            // Cleanup
            fs.unlinkSync(tempFilePath);
          }
          
          if (gifUrl) {
            embed.setImage(gifUrl);
          }
        } catch (gifError) {
          logger.error(`[ClansCommand] GIF Pipeline failed: ${gifError.message}`);
          // We continue without the image if generation fails
        }
      }
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      logger.error('Clan command error:', error);
      await interaction.editReply({
        content: '❌ Failed to fetch clan data. Please try again later.'
      });
    }
  }
};

// Helper to resolve Message Link to actual Object
async function fetchMessageFromLink(client, link) {
  try {
    const match = link.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) return null;
    const [, gId, cId, mId] = match;
    const ch = await client.channels.fetch(cId);
    return await ch.messages.fetch(mId);
  } catch { return null; }
}

module.exports = ClanCommand;
