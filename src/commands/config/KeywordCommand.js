const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ConfigService } = require('../../services/ConfigService');
const emojiRegex = require('emoji-regex');

const KeywordCommand = {
  data: new SlashCommandBuilder()
    .setName('keyword')
    .setDescription('Manage keyword->emoji mappings')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Add/Update a keyword mapping')
        .addStringOption((opt) => opt.setName('keyword').setDescription('The trigger word').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('emojis').setDescription('Emojis to react with (space separated)').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a keyword mapping')
        .addStringOption((opt) => opt.setName('keyword').setDescription('The trigger word to remove').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List all keyword mappings')),

  execute: async (interaction) => {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (subcommand === 'set') {
      const keyword = interaction.options.getString('keyword', true).toLowerCase().trim();
      const emojisStr = interaction.options.getString('emojis', true);
      const customEmojiRegex = /<a?:\w+:\d+>/g;
      const unicodeEmojiRegex = emojiRegex();
      const customEmojis = emojisStr.match(customEmojiRegex) || [];
      const unicodeEmojis = emojisStr.match(unicodeEmojiRegex) || [];
      const emojiList = [...customEmojis, ...unicodeEmojis];

      if (emojiList.length === 0 || emojiList.length > 5) {
        return interaction.reply({
          content: '❌ Please provide between 1 and 5 valid emojis.',
          flags: MessageFlags.Ephemeral,
        });
      }

      try {
        await ConfigService.addKeyword(guildId, keyword, emojiList);
        return interaction.reply({
          content: `✅ Mapped \`${keyword}\` → ${emojiList.join(' ')}`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        console.error(error);
        return interaction.reply({ content: '❌ Failed to save keyword.', flags: MessageFlags.Ephemeral });
      }
    } else if (subcommand === 'remove') {
      const keyword = interaction.options.getString('keyword', true).toLowerCase().trim();
      try {
        await ConfigService.removeKeyword(guildId, keyword);
        return interaction.reply({
          content: `🗑️ Removed mapping for \`${keyword}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        console.error(error);
        return interaction.reply({ content: '❌ Failed to remove keyword.', flags: MessageFlags.Ephemeral });
      }
    } else if (subcommand === 'list') {
      const currentKeywords = await ConfigService.getKeywords(guildId);
      if (Object.keys(currentKeywords).length === 0) {
        return interaction.reply({
          content: '📋 No keyword mappings configured yet.',
          flags: MessageFlags.Ephemeral,
        });
      }
      const list = Object.entries(currentKeywords)
        .map(([kw, emojis]) => `• \`${kw}\` → ${emojis.join(' ')}`)
        .join('\n');
      return interaction.reply({
        content: `📋 **Keyword Mappings**\n${list}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

module.exports = KeywordCommand;
