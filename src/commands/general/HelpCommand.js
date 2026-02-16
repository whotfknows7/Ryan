// src/commands/general/HelpCommand.js

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const CATEGORY_LABELS = {
  general: '⚡ General',
  config: '⚙️ Config',
  moderation: '🔨 Moderation',
  admin: '🛡️ Admin',
  owner: '👑 Owner',
};

const HelpCommand = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show all available commands'),

  execute: async (interaction) => {
    const commands = interaction.client.commands;

    // Group commands by category
    const categories = {};
    commands.forEach((cmd) => {
      const cat = cmd.category || 'other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(cmd);
    });

    const embed = new EmbedBuilder()
      .setTitle('📖 Ryan — Command List')
      .setColor(0x5865f2)
      .setFooter({ text: `${commands.size} commands available` })
      .setTimestamp();

    // Sort categories in a consistent order
    const order = ['general', 'config', 'moderation', 'admin', 'owner'];
    const sortedKeys = Object.keys(categories).sort(
      (a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b))
    );

    for (const cat of sortedKeys) {
      const label = CATEGORY_LABELS[cat] || `📁 ${cat.charAt(0).toUpperCase() + cat.slice(1)}`;
      const lines = categories[cat]
        .sort((a, b) => a.data.name.localeCompare(b.data.name))
        .map((cmd) => `\`/${cmd.data.name}\` — ${cmd.data.description}`)
        .join('\n');

      embed.addFields({ name: label, value: lines });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

module.exports = HelpCommand;
