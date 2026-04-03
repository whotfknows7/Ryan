// src/commands/config/SetTimezoneCommand.js

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { DatabaseService } = require('../../services/DatabaseService');
const { invalidate } = require('../../utils/GuildIdsHelper');
const { defaultRedis } = require('../../config/redis');
const logger = require('../../lib/logger');

// A curated list of common timezones for autocomplete.
// Format: { name: 'Display Label', value: 'IANA Timezone' }
const COMMON_TIMEZONES = [
  { name: 'UTC', value: 'UTC' },
  { name: 'US/Eastern (EST/EDT) — New York, Toronto', value: 'America/New_York' },
  { name: 'US/Central (CST/CDT) — Chicago, Dallas', value: 'America/Chicago' },
  { name: 'US/Mountain (MST/MDT) — Denver, Phoenix', value: 'America/Denver' },
  { name: 'US/Pacific (PST/PDT) — Los Angeles, Seattle', value: 'America/Los_Angeles' },
  { name: 'US/Alaska (AKST/AKDT) — Anchorage', value: 'America/Anchorage' },
  { name: 'US/Hawaii (HST) — Honolulu', value: 'Pacific/Honolulu' },
  { name: 'Canada/Atlantic (AST/ADT) — Halifax', value: 'America/Halifax' },
  { name: 'Brazil/São Paulo (BRT/BRST)', value: 'America/Sao_Paulo' },
  { name: 'Argentina (ART) — Buenos Aires', value: 'America/Argentina/Buenos_Aires' },
  { name: 'UK (GMT/BST) — London', value: 'Europe/London' },
  { name: 'Central Europe (CET/CEST) — Paris, Berlin, Rome', value: 'Europe/Paris' },
  { name: 'Eastern Europe (EET/EEST) — Athens, Bucharest', value: 'Europe/Athens' },
  { name: 'Moscow (MSK) — Moscow', value: 'Europe/Moscow' },
  { name: 'Turkey (TRT) — Istanbul', value: 'Europe/Istanbul' },
  { name: 'Gulf (GST) — Dubai, Abu Dhabi', value: 'Asia/Dubai' },
  { name: 'Pakistan (PKT) — Karachi, Islamabad', value: 'Asia/Karachi' },
  { name: 'India (IST) — Mumbai, Delhi', value: 'Asia/Kolkata' },
  { name: 'Bangladesh (BST) — Dhaka', value: 'Asia/Dhaka' },
  { name: 'Indochina (ICT) — Bangkok, Ho Chi Minh City', value: 'Asia/Bangkok' },
  { name: 'China/Singapore/Philippines (CST/SGT) — Beijing, Singapore', value: 'Asia/Singapore' },
  { name: 'Japan/Korea (JST/KST) — Tokyo, Seoul', value: 'Asia/Tokyo' },
  { name: 'Australia/Perth (AWST)', value: 'Australia/Perth' },
  { name: 'Australia/Sydney (AEST/AEDT)', value: 'Australia/Sydney' },
  { name: 'New Zealand (NZST/NZDT) — Auckland', value: 'Pacific/Auckland' },
];

/**
 * Validates that a string is a valid IANA timezone using native Intl.
 */
function isValidTimezone(tz) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('set_timezone')
    .setDescription('Set the server timezone for daily & weekly reset cycles (resets happen at 12:00 AM local time).')
    .addStringOption((option) =>
      option
        .setName('timezone')
        .setDescription('Your server\'s timezone (e.g., "America/New_York"). Use autocomplete for common options.')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const filtered = COMMON_TIMEZONES.filter(
      (tz) => tz.name.toLowerCase().includes(focused) || tz.value.toLowerCase().includes(focused)
    ).slice(0, 25); // Discord limit

    await interaction.respond(filtered.map((tz) => ({ name: tz.name, value: tz.value })));
  },

  async execute(interaction) {
    const { hasPermission } = require('../../utils/GuildIdsHelper');
    if (!hasPermission(interaction.member, 'Administrator')) {
      return interaction.reply({
        content: '❌ This command is restricted to server administrators.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const guildId = interaction.guildId;
    const timezone = interaction.options.getString('timezone').trim();

    if (!isValidTimezone(timezone)) {
      return interaction.reply({
        content:
          `❌ **Invalid timezone:** \`${timezone}\`\n` +
          `Please use a valid IANA timezone (e.g., \`America/New_York\`, \`Europe/London\`).\n` +
          `Use the autocomplete suggestions for a quick list of common timezones.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Persist to GuildConfig.config.timezone
      await DatabaseService.atomicJsonMerge(guildId, 'config', { timezone });

      // Invalidate local cache so the new timezone takes effect immediately
      invalidate(guildId);
      await defaultRedis.publish('config_update', guildId);

      // Show an example of when their next midnight will be
      const now = new Date();
      const localMidnightStr = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      }).format(now);

      await interaction.editReply({
        content:
          `✅ **Timezone set to \`${timezone}\`**\n\n` +
          `• **Current time in this timezone:** \`${localMidnightStr}\`\n` +
          `• Daily resets will now trigger at **12:00 AM ${timezone}**\n` +
          `• Weekly resets (clan wars) will trigger every **Sunday at 12:00 AM ${timezone}**\n\n` +
          `> ℹ️ **Tip:** The bot checks every minute. Your first reset will fire at the next local midnight.`,
      });

      logger.info(`[SetTimezone] Guild ${guildId} set timezone to ${timezone}`);
    } catch (error) {
      logger.error(`[SetTimezone] Error for guild ${guildId}:`, error);
      await interaction.editReply({ content: '❌ An error occurred while saving the timezone.' });
    }
  },
};
