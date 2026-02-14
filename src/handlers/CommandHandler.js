// src/handlers/CommandHandler.js

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const logger = require('../lib/logger');

async function loadCommands(client) {
  const commandsPath = path.join(__dirname, '../commands');

  if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath, { recursive: true });
  }

  const commandFolders = fs.readdirSync(commandsPath);
  const slashCommands = [];

  for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;

    const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
      const filePath = path.join(folderPath, file);
      try {
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
          command.category = folder;
          client.commands.set(command.data.name, command);
          slashCommands.push(command.data.toJSON());
          logger.info(`Loaded command: /${command.data.name}`);
        } else {
          logger.warn(`Command at ${filePath} is missing "data" or "execute".`);
        }
      } catch (error) {
        logger.error(`Failed to load command from ${filePath}:`, error);
      }
    }
  }

  // Register AND Cleanup
  await registerCommands(client, slashCommands);
}

async function registerCommands(client, slashCommands) {
  const rest = new REST().setToken(config.TOKEN);

  try {
    logger.info('Started refreshing application (/) commands.');

    // 1. GLOBAL REGISTRATION
    if (config.REGISTER_COMMANDS_GLOBALLY) {
      logger.info('Registering commands GLOBALLY...');
      await rest.put(Routes.applicationCommands(config.CLIENT_ID), { body: slashCommands });

      // CLEANUP: Remove commands from Dev Guilds to prevent duplicates
      if (config.DEV_GUILD_IDS.length > 0) {
        logger.info('Cleaning up old GUILD commands...');
        for (const guildId of config.DEV_GUILD_IDS) {
          try {
            // Sending an empty body [] deletes all commands for that guild
            await rest.put(Routes.applicationGuildCommands(config.CLIENT_ID, guildId), { body: [] });
          } catch (e) { /* Ignore access errors */ }
        }
      }
    }

    // 2. GUILD REGISTRATION
    else {
      logger.info('Registering commands to GUILDS...');

      // CLEANUP: Remove Global commands so they don't persist as Zombies
      // (Only do this if you are sure you want NO global commands)
      logger.info('Cleaning up old GLOBAL commands...');
      await rest.put(Routes.applicationCommands(config.CLIENT_ID), { body: [] });

      // Register to Dev Guilds
      if (config.DEV_GUILD_IDS.length > 0) {
        for (const guildId of config.DEV_GUILD_IDS) {
          await rest.put(Routes.applicationGuildCommands(config.CLIENT_ID, guildId), { body: slashCommands });
          logger.info(`Registered to guild: ${guildId}`);
        }
      } else {
        // Register to ALL Guilds (Not recommended for large bots, but fine for private ones)
        if (!client.isReady()) await new Promise(r => client.once('ready', r));
        for (const [guildId, guild] of client.guilds.cache) {
          await rest.put(Routes.applicationGuildCommands(config.CLIENT_ID, guildId), { body: slashCommands });
        }
      }
    }

    logger.info('Successfully reloaded application (/) commands.');
  } catch (error) {
    logger.error('Failed to register commands:', error);
  }
}

/**
 * Registers commands to a specific guild (Used on GuildJoin)
 */
async function registerCommandsForGuild(guildId, slashCommands) {
  const rest = new REST().setToken(config.TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(config.CLIENT_ID, guildId), { body: slashCommands });
  } catch (error) {
    logger.error(`Failed to register commands to guild ${guildId}:`, error);
  }
}

module.exports = { loadCommands, registerCommandsForGuild };