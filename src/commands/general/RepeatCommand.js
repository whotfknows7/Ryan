const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const emojiRegex = require('emoji-regex');

const RepeatCommand = {
  data: new SlashCommandBuilder()
    .setName('repeat')
    .setDescription('Repeat a message or reply to someone')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((opt) => opt.setName('message').setDescription('Text to send'))
    .addChannelOption((opt) => opt.setName('channel').setDescription('Target channel (defaults to current)'))
    .addStringOption((opt) =>
      opt.setName('reply_to').setDescription('Text to search for and reply to (searches last 20 messages)')
    )
    .addStringOption((opt) => opt.setName('reactions').setDescription('Emojis to add (space separated)'))
    .addBooleanOption((opt) =>
      opt.setName('allow_ping').setDescription('Allow mentions in the message? (Default: False)')
    )
    .addIntegerOption((opt) =>
      opt
        .setName('search_limit')
        .setDescription('How many messages to search? (Default: 20, Max: 100)')
        .setMinValue(1)
        .setMaxValue(100)
    ),

  execute: async (interaction) => {
    const messageContent = interaction.options.getString('message');
    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    const replyToQuery = interaction.options.getString('reply_to');
    const reactionsStr = interaction.options.getString('reactions');
    const allowPing = interaction.options.getBoolean('allow_ping') || false;
    const searchLimit = interaction.options.getInteger('search_limit') || 20;

    if (!targetChannel?.isTextBased()) {
      return interaction.reply({ content: '❌ Invalid channel.', flags: MessageFlags.Ephemeral });
    }
    if (!messageContent && !reactionsStr) {
      return interaction.reply({
        content: '❌ You must provide either a message or reactions.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      let targetMessage = null;
      let sentMessage;

      if (replyToQuery) {
        const messages = await targetChannel.messages.fetch({ limit: searchLimit });
        targetMessage = messages.find((m) => m.content.toLowerCase().includes(replyToQuery.toLowerCase())) || null;
      }

      const msgOptions = {
        content: messageContent || undefined,
        allowedMentions: allowPing ? { parse: ['users', 'roles', 'everyone'] } : { parse: [] },
      };

      if (targetMessage) {
        if (messageContent) {
          sentMessage = await targetMessage.reply(msgOptions);
        } else {
          sentMessage = targetMessage;
        }
      } else {
        if (replyToQuery) {
          if (messageContent) {
            sentMessage = await targetChannel.send(msgOptions);
            await interaction.followUp({
              content: '⚠️ Target message not found. Sent as new message.',
              flags: MessageFlags.Ephemeral,
            });
          } else {
            return interaction.editReply('❌ Target message not found and no text provided.');
          }
        } else {
          if (messageContent) {
            sentMessage = await targetChannel.send(msgOptions);
          } else {
            return interaction.editReply('❌ No text provided to send.');
          }
        }
      }

      if (reactionsStr) {
        const customEmojiRegex = /<a?:\w+:\d+>/g;
        const unicodeEmojiRegex = emojiRegex();
        const customEmojis = reactionsStr.match(customEmojiRegex) || [];
        const unicodeEmojis = reactionsStr.match(unicodeEmojiRegex) || [];
        const emojis = [...customEmojis, ...unicodeEmojis];

        for (const emoji of emojis) {
          try {
            await sentMessage.react(emoji);
            await new Promise((r) => setTimeout(r, 500));
          } catch {
            console.error(`Failed to react with ${emoji}`);
          }
        }
      }

      await interaction.editReply(`✅ Done in ${targetChannel}.`);
    } catch (error) {
      console.error('Repeat command error:', error);
      await interaction.editReply('❌ Failed to execute command.');
    }
  },
};

module.exports = RepeatCommand;
