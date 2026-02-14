const dotenv = require('dotenv');
dotenv.config();

/**
 * Core configuration - Only contains essential bot setup values
 * All role IDs, channel IDs, and guild-specific settings are now managed
 * through the database and setup wizard (/setup command)
 * * MULTI-GUILD SUPPORT: This bot is designed to work across multiple guilds.
 * Each guild has its own configuration stored in the database.
 */
const config = {
  TOKEN: process.env.DISCORD_BOT_TOKEN,
  CLIENT_ID: process.env.CLIENT_ID,
  DATABASE_URL: process.env.DATABASE_URL,
  
  // Optional: Set to 'true' to register commands globally instead of per-guild
  // Global commands can take up to 1 hour to propagate
  // Guild commands update instantly but require manual registration per guild
  REGISTER_COMMANDS_GLOBALLY: process.env.REGISTER_COMMANDS_GLOBALLY === 'true',
  
  // Optional: Comma-separated list of guild IDs for development/testing
  // If specified, commands will only be registered to these guilds (faster updates)
  // Leave empty for global registration or production deployment
  DEV_GUILD_IDS: process.env.DEV_GUILD_IDS ? process.env.DEV_GUILD_IDS.split(',').filter(Boolean) : [],
};

// Validate required environment variables
if (!config.TOKEN) throw new Error("Missing DISCORD_BOT_TOKEN");
if (!config.DATABASE_URL) throw new Error("Missing DATABASE_URL");
if (!config.CLIENT_ID) throw new Error("Missing CLIENT_ID");

/**
 * NOTE: All role and channel IDs should now be configured via:
 * 1. Run `/setup wizard` command in your Discord server
 * 2. Follow the interactive setup to configure all roles and channels
 * 3. Values are stored in the database and accessed via GuildIdsHelper
 */

module.exports = { config };
