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
const ImageService = require('../../services/ImageService');
const { AssetService } = require('../../services/AssetService');
const logger = require('../../lib/logger');

const { invalidate } = require('../../utils/GuildIdsHelper');
const { defaultRedis } = require('../../config/redis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup_role_rewards')
    .setDescription('Configure role rewards, announcements, and custom role eligibility.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  execute: async (interaction) => {
    const guildId = interaction.guildId;
    const guildConfig = await DatabaseService.getFullGuildConfig(guildId);
    const configData = guildConfig?.config || {};
    const announcementRoles = configData.announcement_roles || {};
    const existingRoleIds = Object.keys(announcementRoles);

    // 1. Initial State: Ask for Roles
    const selectMenu = new RoleSelectMenuBuilder()
      .setCustomId('role_select')
      .setPlaceholder('Select roles to configure (Max 10)')
      .setMinValues(1)
      .setMaxValues(10);

    // Pre-select existing roles
    if (existingRoleIds.length > 0) {
      selectMenu.addDefaultRoles(existingRoleIds);
    }

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const components = [row];

    // Add "Next" button if rewards already exist
    if (existingRoleIds.length > 0) {
      const nextBtn = new ButtonBuilder()
        .setCustomId('wizard_next')
        .setLabel('Next (Continue with existing)')
        .setStyle(ButtonStyle.Success)
        .setEmoji('➡️');
      components.push(new ActionRowBuilder().addComponents(nextBtn));
    }

    await interaction.reply({
      content: '👇 **Select the roles you want to configure as rewards:**',
      components: components,
    });
    const initialReply = await interaction.fetchReply();

    logger.info(`[SetupRoleRewards] Initial message sent. Collectors starting for user ${interaction.user.id}`);

    // --- Wizard Helper Function ---
    const startWizard = async (triggerInteraction, rolesCollection) => {
      // Sort roles by position (Ascending: Lowest Role First)
      const rolesArray = [...rolesCollection.values()].sort((a, b) => a.position - b.position);
      const totalRoles = rolesArray.length;
      let currentIndex = 0;

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
        const currentConfig = await DatabaseService.getFullGuildConfig(guildId);
        const currentData = currentConfig.config || {};
        const currentAnnounce = currentData.announcement_roles || {};
        const isConfigured = currentAnnounce[role.id] && currentAnnounce[role.id].xp > 0;

        const btnRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('nav_prev')
            .setLabel('◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentIndex === 0),
          new ButtonBuilder()
            .setCustomId(`config_btn_${role.id}`)
            .setLabel(`Configure @${role.name} (${currentIndex + 1}/${totalRoles})`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚙️'),
          new ButtonBuilder()
            .setCustomId('nav_next')
            .setLabel('▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentIndex === totalRoles - 1 || !isConfigured)
        );

        const content = `**Step ${currentIndex + 1}/${totalRoles}:** Configuring ${role}\nClick the button below to set XP, Message, and Icon.`;

        if (i.deferred || i.replied) {
          await i.editReply({ content, components: [btnRow] });
        } else {
          await i.update({ content, components: [btnRow] });
        }
      };

      await showConfigButton(triggerInteraction);

      const buttonCollector = initialReply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: 900000,
      });

      buttonCollector.on('collect', async (btnInteraction) => {
        if (btnInteraction.customId === 'nav_prev') {
          currentIndex--;
          await btnInteraction.deferUpdate();
          return showConfigButton(btnInteraction);
        }

        if (btnInteraction.customId === 'nav_next') {
          currentIndex++;
          await btnInteraction.deferUpdate();
          return showConfigButton(btnInteraction);
        }

        if (btnInteraction.customId === 'wizard_next' || !btnInteraction.customId.startsWith('config_btn_')) return;

        const role = rolesArray[currentIndex];
        const currentGuildConfig = await DatabaseService.getFullGuildConfig(guildId);
        const currentAnnouncementRoles = currentGuildConfig?.config?.announcement_roles || {};
        const currentRoleConfig = currentAnnouncementRoles[role.id] || {};
        const isCurrentCustom = currentGuildConfig?.ids?.customRoleEligibilityId === role.id;

        const modal = new ModalBuilder()
          .setCustomId(`modal_${role.id}`)
          .setTitle(`Config: ${role.name.slice(0, 20)}`);

        const xpInput = new TextInputBuilder()
          .setCustomId('xp_threshold')
          .setLabel('XP Threshold (Number)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 1000')
          .setValue(currentRoleConfig.xp ? currentRoleConfig.xp.toString() : '')
          .setRequired(true);

        const msgInput = new TextInputBuilder()
          .setCustomId('announcement_msg')
          .setLabel('Announcement Message (Empty = Silent)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Congrats {user}! You got {role}!')
          .setValue(currentRoleConfig.message || '')
          .setRequired(false);

        const imgInput = new TextInputBuilder()
          .setCustomId('icon_url')
          .setLabel('Role Icon URL (Optional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https://example.com/icon.png')
          .setValue(currentRoleConfig.iconUrl || '')
          .setRequired(false);

        const customRoleInput = new TextInputBuilder()
          .setCustomId('is_custom_role')
          .setLabel('Unlock Custom Role Command? (yes/no)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('no')
          .setValue(isCurrentCustom ? 'yes' : 'no')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(xpInput),
          new ActionRowBuilder().addComponents(msgInput),
          new ActionRowBuilder().addComponents(imgInput),
          new ActionRowBuilder().addComponents(customRoleInput)
        );

        await btnInteraction.showModal(modal);

        try {
          const modalSubmit = await btnInteraction.awaitModalSubmit({
            filter: (i) => i.customId === `modal_${role.id}`,
            time: 3600000,
          });

          await modalSubmit.deferUpdate();

          const xp = parseInt(modalSubmit.fields.getTextInputValue('xp_threshold').replace(/,/g, ''));
          const message = modalSubmit.fields.getTextInputValue('announcement_msg');
          const iconUrl = modalSubmit.fields.getTextInputValue('icon_url');
          const isCustom = modalSubmit.fields.getTextInputValue('is_custom_role').toLowerCase().includes('yes');

          if (isNaN(xp)) {
            await modalSubmit.followUp({ content: '❌ XP Threshold must be a valid number.', ephemeral: true });
            return;
          }

          let assetMessageId = null;
          if (message) {
            try {
              const buffer = await ImageService.generateBaseReward(role.name, role.hexColor, iconUrl);
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

          const currentConf = await DatabaseService.getFullGuildConfig(guildId);
          const currentConfigData = currentConf.config || {};
          const currentAnnounceRoles = currentConfigData.announcement_roles || {};

          currentAnnounceRoles[role.id] = {
            xp: xp,
            message: message || null,
            assetMessageLink: assetMessageId,
            roleId: role.id,
            roleName: role.name,
            roleColor: role.color,
            iconUrl: iconUrl || null,
          };

          currentConfigData.announcement_roles = currentAnnounceRoles;
          const updatePayload = { config: currentConfigData };

          const idsData = (await DatabaseService.getFullGuildConfig(guildId)).ids || {};
          if (isCustom) {
            idsData.customRoleEligibilityId = role.id;
            updatePayload.ids = idsData;
          } else if (idsData.customRoleEligibilityId === role.id) {
            delete idsData.customRoleEligibilityId;
            updatePayload.ids = idsData;
          }

          await DatabaseService.updateGuildConfig(guildId, updatePayload);
          invalidate(guildId);
          await defaultRedis.publish('config_update', guildId);

          currentIndex++;
          await showConfigButton(modalSubmit);
        } catch (err) {
          if (err.code === 'InteractionCollectorError') {
            logger.info(`[SetupRoleRewards] Modal timed out for user ${btnInteraction.user.id} (Role: ${role.name})`);
          } else if (err.code === 10062) {
            logger.warn(`[SetupRoleRewards] Modal interaction expired (Unknown interaction) for user ${btnInteraction.user.id}`);
          } else {
            logger.error(`[SetupRoleRewards] Unexpected modal error:`, err);
          }
        }
      });
    };

    // Role Select Collector
    const selectCollector = initialReply.createMessageComponentCollector({
      componentType: ComponentType.RoleSelect,
      filter: (i) => i.user.id === interaction.user.id,
      time: 60000,
      max: 1,
    });

    selectCollector.on('collect', async (selectInteraction) => {
      logger.info(`[SetupRoleRewards] Received RoleSelect interaction from ${selectInteraction.user.id}`);
      try {
        await selectInteraction.deferUpdate();

        const selectedRoleIds = selectInteraction.values;
        const currentConf = await DatabaseService.getFullGuildConfig(guildId);
        const currentData = currentConf?.config || {};
        const currentAnnounce = currentData.announcement_roles || {};
        const existingIds = Object.keys(currentAnnounce);

        const deselectedRoleIds = existingIds.filter((id) => !selectedRoleIds.includes(id));

        if (deselectedRoleIds.length > 0) {
          const idsData = (await DatabaseService.getFullGuildConfig(guildId)).ids || {};
          let needsIdUpdate = false;

          deselectedRoleIds.forEach((id) => {
            delete currentAnnounce[id];
            if (idsData.customRoleEligibilityId === id) {
              delete idsData.customRoleEligibilityId;
              needsIdUpdate = true;
            }
          });

          currentData.announcement_roles = currentAnnounce;
          const updatePayload = { config: currentData };
          if (needsIdUpdate) updatePayload.ids = idsData;

          await DatabaseService.updateGuildConfig(guildId, updatePayload);
          invalidate(guildId);
          await defaultRedis.publish('config_update', guildId);
        }

        await startWizard(selectInteraction, selectInteraction.roles);
      } catch (err) {
        console.error('Error in RoleSelectMenu:', err);
      }
    });

    // Next Button Collector
    const nextCollector = initialReply.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id && i.customId === 'wizard_next',
      time: 60000,
      max: 1,
    });

    nextCollector.on('collect', async (btnInteraction) => {
      logger.info(`[SetupRoleRewards] User ${btnInteraction.user.id} clicked Next button`);
      try {
        await btnInteraction.deferUpdate();

        const currentConf = await DatabaseService.getFullGuildConfig(guildId);
        const currentAnnounce = currentConf?.config?.announcement_roles || {};
        const existingIds = Object.keys(currentAnnounce);

        const rolesCollection = new Map();
        for (const id of existingIds) {
          const role = interaction.guild.roles.cache.get(id);
          if (role) rolesCollection.set(id, role);
        }
        await startWizard(btnInteraction, rolesCollection);
      } catch (err) {
        console.error('Error in Next Button:', err);
      }
    });
  },
};
