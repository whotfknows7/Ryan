// src/commands/owner/SetupGifCommand.js

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const path = require('path');

const { execFile } = require('child_process');
const { DatabaseService } = require('../../services/DatabaseService');
const logger = require('../../lib/logger');

const TEMPLATE_DIR = path.join(process.cwd(), 'assets', 'gif_templates');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-gif')
    .setDescription('Upload and process a new Clan GIF template (Owner Only)')
    .addStringOption((option) =>
      option.setName('name').setDescription('Unique name for this template').setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('clan_count')
        .setDescription('How many clans are in this GIF?')
        .setRequired(true)
        .addChoices({ name: '2 Clans', value: 2 }, { name: '3 Clans', value: 3 }, { name: '4 Clans', value: 4 })
    ),

  async execute(interaction) {
    if (interaction.user.id !== process.env.OWNER_ID) {
      return interaction.reply({ content: 'Restricted.', flags: MessageFlags.Ephemeral });
    }

    const name = interaction.options.getString('name');
    const clanCount = interaction.options.getInteger('clan_count');

    await interaction.reply({
      content: `Please upload the GIF file for **"${name}"** (${clanCount} Clans) now. I am listening...`,
    });

    const filter = (m) => m.author.id === interaction.user.id && m.attachments.size > 0;
    const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });

    collector.on('collect', async (message) => {
      const attachment = message.attachments.first();
      if (!attachment.contentType?.startsWith('image/gif')) {
        return interaction.followUp('❌ That is not a GIF.');
      }

      await interaction.followUp('⏳ Processing GIF frames (using Sharp)...');

      try {
        // 1. Download GIF
        const response = await fetch(attachment.url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());

        // 2. Setup Directories
        const targetDir = path.join(TEMPLATE_DIR, clanCount.toString(), name);
        const framesDir = path.join(targetDir, 'frames');

        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
        fs.mkdirSync(framesDir, { recursive: true });

        // 3. Save buffer to disk temporarily for FFmpeg
        const tempGifPath = path.join(targetDir, 'temp.gif');
        fs.writeFileSync(tempGifPath, buffer);

        // 4. Extract Frames using FFmpeg
        await new Promise((resolve, reject) => {
          execFile('ffmpeg', ['-y', '-i', tempGifPath, path.join(framesDir, '%03d.png')], (error) => {
            if (error) reject(error);
            else resolve();
          });
        });

        // Clean up temp gif
        if (fs.existsSync(tempGifPath)) fs.rmSync(tempGifPath);

        // Count frames generated
        const frames = fs.readdirSync(framesDir).filter((f) => f.endsWith('.png'));
        const pages = frames.length;

        const coords = [];
        for (let i = 0; i < pages; i++) {
          coords.push(Array(clanCount).fill({ x: 0, y: 0 }));
        }

        // 5. Save coords.json
        fs.writeFileSync(path.join(targetDir, 'coords.json'), JSON.stringify(coords, null, 2));

        // 5. Register in DB
        await DatabaseService.createGifTemplate(name, clanCount, targetDir);

        await interaction.followUp(
          `✅ **Success!**\n- Template: \`${name}\`\n- Frames: ${pages}\n- Path: \`${targetDir}\`\n\n**Next:** Edit \`coords.json\` in that folder.`
        );
      } catch (error) {
        logger.error('GIF Setup failed:', error);
        await interaction.followUp(`❌ Error processing GIF: ${error.message}`);
      }
    });
  },
};
