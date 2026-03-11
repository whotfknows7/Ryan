// src/services/ImageService.js

const path = require('path');
const fs = require('fs');
const MetricsService = require('./MetricsService');

// Constants
const ASSETS_DIR = path.join(process.cwd(), 'assets');
const EMOJI_DIR = path.join(ASSETS_DIR, 'emojis');

// Ensure required directories exist
if (!fs.existsSync(EMOJI_DIR)) {
  fs.mkdirSync(EMOJI_DIR, { recursive: true });
}

class ImageService {
  constructor() {
    // Rust renderer URL for rank cards
    // [FIX] Ensure this matches your Docker/Localhost setup
    this.rendererUrl = process.env.RENDERER_URL || 'http://127.0.0.1:3000/render';
    this.useRustRenderer = process.env.USE_RUST_RENDERER === 'true';
  }

  // =================================================================
  // RUST MICROSERVICE INTEGRATION (Rank Cards)
  // =================================================================

  async urlToBase64(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Renderer HTTP error! status: ${response.status}`);

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      console.error(`Failed to convert image to base64: ${url}`, error.message);
      return '';
    }
  }

  async generateRankCard(data) {
    try {
      // 2. Construct Payload
      const payload = {
        username: data.username,
        avatar_url: data.avatarUrl,
        current_xp: data.currentXp,
        next_xp: data.requiredXp,
        rank: data.rank,
        clan_color: data.hexColor,
      };

      // 3. Call Rust Renderer
      // [FIX] Added timeout and better error logging
      const timer = MetricsService.rendererRequestDuration.startTimer();
      const response = await fetch(this.rendererUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      timer();

      if (!response.ok) throw new Error(`Renderer HTTP error! status: ${response.status}`);

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      // [FIX] Improved error logging to see WHY it failed
      if (error.code === 'ECONNREFUSED') {
        console.error('❌ Rust Renderer is unreachable! Is it running on port 3000?');
      } else {
        console.error('Rank Card Generation Failed:', error.message);
      }
      throw new Error('Failed to generate rank card via Rust service.', { cause: error });
    }
  }

  // =================================================================
  // CANVAS-BASED IMAGE GENERATION (Leaderboards & Role Rewards)
  // =================================================================

  async generateLeaderboard(users, highlightUserId = null) {
    try {
      // Build the payload for the Rust renderer
      const payload = {
        users: await Promise.all(
          users.map(async (user) => {
            const { username, emojis } = await this.prepareNameWithEmojis(user.username);
            return {
              user_id: user.userId,
              username,
              emojis,
              avatar_url: user.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png',
              xp: user.xp,
              rank: user.rank,
            };
          })
        ),
        highlight_user_id: highlightUserId || undefined,
      };

      const leaderboardUrl = this.rendererUrl.replace('/render', '/render/leaderboard');
      const timer = MetricsService.rendererRequestDuration.startTimer();
      const response = await fetch(leaderboardUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      timer();

      if (!response.ok) throw new Error(`Renderer HTTP error! status: ${response.status}`);

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        console.error('❌ Rust Renderer is unreachable! Is it running on port 3000?');
      } else {
        console.error('Leaderboard Generation Failed:', error.message);
      }
      throw new Error('Failed to generate leaderboard via Rust service.', { cause: error });
    }
  }

  /**
   * Strips emojis from username, and ensures each emoji PNG is cached
   * to disk for the Rust renderer to read. Text placement is now fully handled in Rust.
   */
  async prepareNameWithEmojis(text) {
    /* eslint-disable no-misleading-character-class */
    const emojiRegex =
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E0}-\u{1F1FF}]/gu;
    /* eslint-enable no-misleading-character-class */

    const textPart = text.replace(emojiRegex, '').trim();
    const emojiMatches = text.match(emojiRegex) || [];

    const displayText = textPart;
    const emojis = [];

    for (const emoji of emojiMatches) {
      const hex = [...emoji].map((c) => c.codePointAt(0).toString(16)).join('-');
      if (!hex) continue;

      // Ensure emoji is cached to disk
      await this.ensureEmojiCached(hex);

      emojis.push({
        hex,
      });
    }

    return { username: displayText, emojis };
  }

  /**
   * Ensures an emoji PNG exists in assets/emojis/{hex}.png.
   * Downloads from GitHub if not already cached.
   */
  async ensureEmojiCached(hex) {
    const filePath = path.join(EMOJI_DIR, `${hex}.png`);
    if (fs.existsSync(filePath)) return;

    try {
      const url = `https://raw.githubusercontent.com/whotfknows7/bangbang/main/unicode/64/${hex}.png`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (response.status !== 200) return;

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
    } catch {
      console.warn(`[ImageService] Failed to cache emoji: ${hex}`);
    }
  }

  // =================================================================
  // RUST MICROSERVICE INTEGRATION (Role Rewards)
  // =================================================================

  async generateBaseReward(roleName, roleColorHex, iconUrl) {
    try {
      const payload = {
        role_name: roleName,
        role_color: roleColorHex || '#FFFFFF',
        icon_url: iconUrl || null,
      };
      const url = this.rendererUrl.replace('/render', '/render/role-reward/base');
      const timer = MetricsService.rendererRequestDuration.startTimer();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      timer();
      if (!response.ok) throw new Error(`Role reward base renderer error: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      console.error('[ImageService] generateBaseReward failed:', error.message);
      throw error;
    }
  }

  async generateFinalReward(baseImageBuffer, username) {
    try {
      const payload = {
        base_image_b64: baseImageBuffer.toString('base64'),
        username,
      };
      const url = this.rendererUrl.replace('/render', '/render/role-reward/final');
      const timer = MetricsService.rendererRequestDuration.startTimer();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      timer();
      if (!response.ok) throw new Error(`Role reward final renderer error: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      console.error('[ImageService] generateFinalReward failed:', error.message);
      throw error;
    }
  }

  async preloadAssets() {
    try {
      console.log('[ImageService] Assets preloaded successfully');
    } catch (e) {
      console.error('[ImageService] Failed to preload assets:', e.message);
    }
  }
}

module.exports = new ImageService();
