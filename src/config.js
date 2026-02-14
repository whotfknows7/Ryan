const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config();

// ============================================================================
// Environment Schema — Validates all env vars at startup
// ============================================================================

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z
    .string({ required_error: 'Missing DISCORD_BOT_TOKEN' })
    .min(1, 'DISCORD_BOT_TOKEN cannot be empty'),

  CLIENT_ID: z
    .string({ required_error: 'Missing CLIENT_ID' })
    .min(1, 'CLIENT_ID cannot be empty'),

  DATABASE_URL: z
    .string({ required_error: 'Missing DATABASE_URL' })
    .min(1, 'DATABASE_URL cannot be empty'),

  REGISTER_COMMANDS_GLOBALLY: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val === 'true'),

  DEV_GUILD_IDS: z
    .string()
    .optional()
    .default('')
    .transform((val) => val.split(',').filter(Boolean)),
});

// Parse & validate — throws a descriptive ZodError on failure
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.issues
    .map((issue) => `  ✗ ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error('❌ Invalid environment variables:\n' + formatted);
  process.exit(1);
}

/**
 * Core configuration - Only contains essential bot setup values
 * All role IDs, channel IDs, and guild-specific settings are now managed
 * through the database and setup wizard (/setup command)
 *
 * MULTI-GUILD SUPPORT: This bot is designed to work across multiple guilds.
 * Each guild has its own configuration stored in the database.
 */
const config = {
  TOKEN: parsed.data.DISCORD_BOT_TOKEN,
  CLIENT_ID: parsed.data.CLIENT_ID,
  DATABASE_URL: parsed.data.DATABASE_URL,
  REGISTER_COMMANDS_GLOBALLY: parsed.data.REGISTER_COMMANDS_GLOBALLY,
  DEV_GUILD_IDS: parsed.data.DEV_GUILD_IDS,
};

/**
 * NOTE: All role and channel IDs should now be configured via:
 * 1. Run `/setup wizard` command in your Discord server
 * 2. Follow the interactive setup to configure all roles and channels
 * 3. Values are stored in the database and accessed via GuildIdsHelper
 */

module.exports = { config };
