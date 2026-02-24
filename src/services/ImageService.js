// src/services/ImageService.js

const MetricsService = require('./MetricsService');
const logger = require('../lib/logger');

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
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer).toString('base64');
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
  // LEADERBOARD GENERATION (via Rust)
  // =================================================================

  async generateLeaderboard(users, highlightUserId = null) {
    try {
      // Build the payload for the Rust renderer
      const payload = {
        users: users.map((user) => ({
          user_id: user.userId,
          username: user.username,
          avatar_url: user.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png',
          xp: user.xp,
          rank: user.rank,
        })),
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

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Renderer HTTP error! status: ${response.status}, body: ${errorText}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        logger.error('❌ Rust Renderer is unreachable! Is it running on port 3000?');
      } else {
        logger.error('Leaderboard Generation Failed:', error.message);
      }
      throw new Error('Failed to generate leaderboard via Rust service.', { cause: error });
    }
  }

  // =================================================================
  // ROLE REWARDS (via Rust)
  // =================================================================

  async generateBaseRewardViaRust(roleName, roleColorHex, iconUrl) {
    try {
      const payload = {
        role_name: roleName,
        role_color_hex: roleColorHex || '#FFFFFF',
        icon_url: iconUrl || null,
      };

      const endpointUrl = this.rendererUrl.replace('/render', '/render/role_reward/base');
      const timer = MetricsService.rendererRequestDuration.startTimer();
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      timer();

      if (!response.ok) throw new Error(`Renderer HTTP error! status: ${response.status}`);

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      logger.error('Base Reward Generation Failed:', error.message);
      throw new Error('Failed to generate base reward via Rust service.', { cause: error });
    }
  }

  async generateFinalRewardViaRust(baseImageBuffer, username) {
    try {
      const base64Image = baseImageBuffer.toString('base64');
      const payload = {
        base_image_b64: base64Image,
        username: username,
      };

      const endpointUrl = this.rendererUrl.replace('/render', '/render/role_reward/final');
      const timer = MetricsService.rendererRequestDuration.startTimer();
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      timer();

      if (!response.ok) throw new Error(`Renderer HTTP error! status: ${response.status}`);

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      logger.error('Final Reward Generation Failed:', error.message);
      throw new Error('Failed to generate final reward via Rust service.', { cause: error });
    }
  }

  formatPoints(points) {
    if (points >= 1_000_000) {
      const num = points / 1_000_000;
      return `${Number.isInteger(num) ? num : num.toFixed(1)}m`;
    } else if (points >= 1_000) {
      const num = points / 1_000;
      return `${Number.isInteger(num) ? num : num.toFixed(1)}k`;
    }
    return points.toString();
  }

  async fetchImage(url) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch {
      logger.warn(`[ImageService] Failed to fetch image: ${url}`);
      throw new Error(`Failed to load image from ${url}`);
    }
  }

  async preloadAssets() {
    // Rust renderer handles fonts now
    logger.info('[ImageService] Legacy preloadAssets called but no longer needed in Node.');
  }
}

module.exports = new ImageService();
