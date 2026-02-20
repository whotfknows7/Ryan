const { Client, EmbedBuilder, GatewayIntentBits } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const embed = new EmbedBuilder().setTitle('Test');
console.log("Embed JSON:", JSON.stringify(embed));
console.log("Embed toJSON:", embed.toJSON ? true : false);
