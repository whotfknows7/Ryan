const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const { DatabaseService } = require('../../services/DatabaseService');
const { ImageService } = require('../../services/ImageService');
const { AssetService } = require('../../services/AssetService');
const { AssetService } = require('../../services/AssetService');
const { XpService } = require('../../services/XpService');
const { invalidate } = require('../../utils/GuildIdsHelper');
const { defaultRedis } = require('../../config/redis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup_role_rewards')
    .setDescription('Configure role rewards, announcements, and custom role eligibility.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  execute: async (interaction) => {
    // 1. Initial State: Ask for Roles
    const selectMenu = new RoleSelectMenuBuilder()
      .setCustomId('role_select')
      .setPlaceholder('Select roles to configure (Max 10)')
      .setMinValues(1)
      .setMaxValues(10);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const initialReply = await interaction.reply({
      content: '👇 **Select the roles you want to configure as rewards:**',
      components: [row],
      fetchReply: true,
    });

    // Create a collector for the Select Menu
    const collector = initialReply.createMessageComponentCollector({
      componentType: ComponentType.RoleSelect,
      filter: (i) => i.user.id === interaction.user.id,
      time: 60000,
      max: 1,
    });

    collector.on('collect', async (selectInteraction) => {
      // Sort roles by position (Ascending: Lowest Role First)
      const selectedRoles = selectInteraction.roles.sort((a, b) => a.position - b.position);
      const guildId = interaction.guildId;

      // Store state for the wizard
      let currentIndex = 0;
      const rolesArray = [...selectedRoles.values()];
      const totalRoles = rolesArray.length;

      // --- Recursive Wizard Function ---
      const showConfigButton = async (i) => {
        if (currentIndex >= totalRoles) {
          const finishedContent = '✅ **All roles have been configured and cached!**';
          if (i.deferred || i.replied) {
            await i.editReply({ content: finishedContent, components: [] });
          } else {
            await i.update({ content: finishedContent, components: [] });
          }
          return;
        }

        const role = rolesArray[currentIndex];

        const btnRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`config_btn_${role.id}`)
            .setLabel(`Configure @${role.name} (${currentIndex + 1}/${totalRoles})`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚙️')
        );

        const content = `**Step ${currentIndex + 1}/${totalRoles}:** Configuring ${role}\nClick the button below to set XP, Message, and Icon.`;

        // Handle interaction types (Update vs Edit)
        if (i.deferred || i.replied) {
          await i.editReply({ content, components: [btnRow] });
        } else {
          await i.update({ content, components: [btnRow] });
        }
      };

      // Start the loop
      await showConfigButton(selectInteraction);

      // Collector for the "Configure" button (Longer timeout for user input)
      const buttonCollector = initialReply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: 900000, // 15 minutes total session time
      });

      buttonCollector.on('collect', async (btnInteraction) => {
        const role = rolesArray[currentIndex];

        // Open Modal
        const modal = new ModalBuilder().setCustomId(`modal_${role.id}`).setTitle(`Config: ${role.name.slice(0, 20)}`);

        const xpInput = new TextInputBuilder()
          .setCustomId('xp_threshold')
          .setLabel('XP Threshold (Number)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 1000')
          .setRequired(true);

        const msgInput = new TextInputBuilder()
          .setCustomId('announcement_msg')
          .setLabel('Announcement Message (Empty = Silent)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Congrats {user}! You got {role}!')
          .setRequired(false);

        const imgInput = new TextInputBuilder()
          .setCustomId('icon_url')
          .setLabel('Role Icon URL (Optional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https://example.com/icon.png')
          .setRequired(false);

        const customRoleInput = new TextInputBuilder()
          .setCustomId('is_custom_role')
          .setLabel('Unlock Custom Role Command? (yes/no)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('no')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(xpInput),
          new ActionRowBuilder().addComponents(msgInput),
          new ActionRowBuilder().addComponents(imgInput),
          new ActionRowBuilder().addComponents(customRoleInput)
        );

        await btnInteraction.showModal(modal);

        // Await Modal Submit
        try {
          const modalSubmit = await btnInteraction.awaitModalSubmit({
            filter: (i) => i.customId === `modal_${role.id}`,
            time: 300000, // 5 mins per role
          });

          // Defer immediately to allow time for Image Gen & DB Save
          await modalSubmit.deferUpdate();

          // Process Data
          const xp = parseInt(modalSubmit.fields.getTextInputValue('xp_threshold').replace(/,/g, ''));
          const message = modalSubmit.fields.getTextInputValue('announcement_msg');
          const iconUrl = modalSubmit.fields.getTextInputValue('icon_url');
          const isCustom = modalSubmit.fields.getTextInputValue('is_custom_role').toLowerCase().includes('yes');

          if (isNaN(xp)) {
            await modalSubmit.followUp({ content: '❌ XP Threshold must be a valid number.', ephemeral: true });
            return; // Don't advance index, let them try again? Or skip? Assuming skip for now or loop logic needed.
          }

          // --- 1. Hybrid Image Gen (Base Image) ---
          let assetMessageId = null;
          if (message) {
            try {
              // Generate the Base Image (Icon + Role Name)
              const buffer = await ImageService.generateBaseReward(role.name, role.hexColor, iconUrl);

              // Store in Dev Channel
              const assetLink = await AssetService.storeToDevChannel(
                interaction.client,
                buffer,
                `base_reward_${role.id}.png`,
                `Base Reward Template: ${role.name} (${role.id})`
              );

              assetMessageId = assetLink;
            } catch (err) {
              console.error('Base Image Gen Failed:', err);
            }
          }

          // --- 2. Update Database ---
          const guildConfig = await DatabaseService.getFullGuildConfig(guildId);
          const configData = guildConfig.config || {};
          const announcementRoles = configData.announcement_roles || {};

          announcementRoles[role.id] = {
            xp: xp,
            message: message || null, // Null = Silent
            assetMessageLink: assetMessageId,
            roleId: role.id,
          };

          configData.announcement_roles = announcementRoles;

          const updatePayload = { config: configData };

          // Handle Custom Role Eligibility ID
          if (isCustom) {
            // Merge into IDs object
            const idsData = guildConfig.ids || {};
            idsData.customRoleEligibilityId = role.id;
            updatePayload.ids = idsData;
          }

          await DatabaseService.updateGuildConfig(guildId, updatePayload);

          // --- 3. Update RAM Cache Immediately ---
          invalidate(guildId);
          await defaultRedis.publish('config_update', guildId);

          // Move to next role
          currentIndex++;
          await showConfigButton(modalSubmit);
        } catch (err) {
          console.error('Modal Error or Timeout:', err);
        }
      });
    });
  },
};
