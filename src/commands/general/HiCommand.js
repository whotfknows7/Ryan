// src/commands/general/HiCommand.js

const { SlashCommandBuilder } = require('discord.js');
const { DatabaseService } = require('../../services/DatabaseService');

const HiCommand = {
  data: new SlashCommandBuilder().setName('hi').setDescription('Check bot latency and status'),

  execute: async (interaction) => {
    // 1. Measure Roundtrip
    // EDITED: Removed fetchReply: true from options to fix deprecation warning
    await interaction.reply({
      content: '🏓 Pinging...',
    });

    const sent = await interaction.fetchReply();
    const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;

    // 2. Shard Latency
    const apiLatency = Math.round(interaction.client.ws.ping);

    // 3. Database Latency
    const dbStart = Date.now();
    await DatabaseService.checkDatabaseIntegrity();
    const dbLatency = Date.now() - dbStart;

    // 4. Cluster Latency (if clustered)
    const clusterLatency = interaction.client.cluster ? Math.round(interaction.client.cluster.ping) : null;

    // 5. Message Latency (time since message was created)
    const messageLatency = Date.now() - interaction.createdTimestamp;

    const status = apiLatency < 100 ? '🟢 Excellent' : apiLatency < 200 ? '🟡 Good' : '🔴 High';

    let response =
      `**Bot Status Report**\n` +
      `┕ **Roundtrip:** ${roundtrip}ms\n` +
      `┕ **Shard:** ${apiLatency}ms (${status})\n` +
      `┕ **Database:** ${dbLatency}ms\n` +
      `┕ **Message:** ${messageLatency}ms\n`;

    if (clusterLatency !== null) {
      response += `┕ **Cluster:** ${clusterLatency}ms\n`;
    }

    response += `┕ **Uptime:** ${formatUptime(process.uptime())}`;

    await interaction.editReply(response);
  },
};

const formatUptime = (seconds) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
};

module.exports = HiCommand;
