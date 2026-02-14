const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { DatabaseService } = require('../../services/DatabaseService');
const { getIds } = require('../../utils/GuildIdsHelper');
const { prisma } = require('../../lib/prisma');

const SetXpCommand = {
  data: new SlashCommandBuilder()
    .setName('set_xp')
    .setDescription("Set or adjust a user's XP")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(opt => opt.setName('xp').setDescription('XP amount (e.g. 1.5k, 2000, -500)').setRequired(true))
    .addBooleanOption(opt => opt.setName('override').setDescription('Override current XP instead of adding')),

  execute: async (interaction) => {
    const targetUser = interaction.options.getUser('user', true);
    const xpInput = interaction.options.getString('xp', true);
    const override = interaction.options.getBoolean('override') || false;

    const parseXpInput = (input) => {
        const cleaned = input.replace(/\s+/g, '').toLowerCase();
        if (cleaned.endsWith('k')) return parseFloat(cleaned.replace('k', '')) * 1000;
        if (cleaned.endsWith('m')) return parseFloat(cleaned.replace('m', '')) * 1000000;
        const num = parseInt(cleaned);
        if (isNaN(num)) throw new Error("Invalid XP format. Example: 1.5k, 2000");
        return num;
    };

    try {
        const amount = parseXpInput(xpInput);
        const guildId = interaction.guildId;
        
        const currentData = await prisma.userXp.findUnique({
            where: { guildId_userId: { guildId, userId: targetUser.id } }
        });
        const oldXp = currentData ? currentData.xp : 0;
        
        if (override) {
            await DatabaseService.setUserXp(guildId, targetUser.id, amount);
        } else {
            await DatabaseService.updateUserXp(guildId, targetUser.id, amount);
        }

        const newData = await prisma.userXp.findUnique({
            where: { guildId_userId: { guildId, userId: targetUser.id } }
        });
        const actualNewXp = newData ? newData.xp : 0;

        const verb = override ? "set" : "adjusted";
        await interaction.reply({ 
            content: `✅ XP for ${targetUser} has been **${verb}** from \`${oldXp}\` to \`${actualNewXp}\`.`, 
            flags: MessageFlags.Ephemeral
        });

        const ids = await getIds(guildId);
        const logChannelId = ids.trueLogsChannelId || ids.logsChannelId;
        
        if (logChannelId) {
            const logChannel = interaction.guild?.channels.cache.get(logChannelId);
            if (logChannel?.isTextBased()) {
                const embed = new EmbedBuilder()
                    .setTitle('⚙️ XP Change Log')
                    .setDescription(`${interaction.user} ${verb} XP for ${targetUser}`)
                    .addFields(
                        { name: 'Old XP', value: oldXp.toString(), inline: true },
                        { name: 'New XP', value: actualNewXp.toString(), inline: true },
                        { name: 'Override', value: override ? 'Yes' : 'No', inline: true }
                    )
                    .setColor('Orange')
                    .setTimestamp();
                await logChannel.send({ embeds: [embed] });
            }
        }
    } catch (error) {
        await interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
    }
  }
};

module.exports = SetXpCommand;
