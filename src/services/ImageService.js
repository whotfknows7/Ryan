// src/services/ImageService.js

const { createCanvas, loadImage } = require('@napi-rs/canvas');

const path = require('path');
const fs = require('fs');
const opentype = require('opentype.js');
const MetricsService = require('./MetricsService');

// Constants
const ASSETS_DIR = path.join(process.cwd(), 'assets');
const ROLE_TEMPLATE_PATH = path.join(ASSETS_DIR, 'role template', 'role_announcement_template.png');
const EMOJI_DIR = path.join(ASSETS_DIR, 'emojis');

// Cache objects
let cachedFont = null;
let cachedRoleTemplate = null;

// Ensure required directories exist
if (!fs.existsSync(EMOJI_DIR)) {
  fs.mkdirSync(EMOJI_DIR, { recursive: true });
}

// Pre-load validation
if (!fs.existsSync(ROLE_TEMPLATE_PATH)) {
  console.warn(`[ImageService] Missing Template: ${ROLE_TEMPLATE_PATH}`);
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
  // CANVAS-BASED IMAGE GENERATION (Leaderboards & Role Rewards)
  // =================================================================

  async loadFont() {
    if (cachedFont) return cachedFont;

    const fontDirs = [path.join(ASSETS_DIR, 'font'), path.join(ASSETS_DIR, 'fonts')];

    for (const fontDir of fontDirs) {
      if (fs.existsSync(fontDir)) {
        const files = fs.readdirSync(fontDir);
        const fontFile = files.find((f) => f.toLowerCase().endsWith('.ttf'));

        if (fontFile) {
          const fullPath = path.join(fontDir, fontFile);
          console.log(`[ImageService] Font loaded from: ${fullPath}`);
          cachedFont = await opentype.load(fullPath);
          return cachedFont;
        }
      }
    }

    console.error(`[ImageService] CRITICAL: No .ttf font file found in ${fontDirs.join(' or ')}`);
    throw new Error('No .ttf font file found in assets/font or assets/fonts');
  }

  async generateLeaderboard(users, highlightUserId = null) {
    try {
      const font = await this.loadFont();

      // Build the payload for the Rust renderer
      const payload = {
        users: await Promise.all(
          users.map(async (user) => {
            const rankStr = `#${user.rank}`;
            const rankWidth = font.getAdvanceWidth(rankStr, 30);
            const separatorX = 75 + rankWidth + 8;
            const usernameX = separatorX + font.getAdvanceWidth('|', 30) + 12;
            const maxWidth = 585 - usernameX;

            const { username, emojis, textEndX } = await this.prepareNameWithEmojis(font, user.username, 30, maxWidth);
            return {
              user_id: user.userId,
              username,
              emojis,
              avatar_url: user.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png',
              xp: user.xp,
              rank: user.rank,
              text_end_x: textEndX,
              separator_x: separatorX,
              username_x: usernameX,
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
   * Strips emojis from username, calculates their X offsets using font metrics,
   * and ensures each emoji PNG is cached to disk for the Rust renderer to read.
   */
  async prepareNameWithEmojis(font, text, fontSize, maxWidth) {
    /* eslint-disable no-misleading-character-class */
    const emojiRegex =
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E0}-\u{1F1FF}]/gu;
    /* eslint-enable no-misleading-character-class */

    const textPart = text.replace(emojiRegex, '').trim();
    const emojiMatches = text.match(emojiRegex) || [];

    // Truncate text if too wide
    let displayText = textPart;
    if (font.getAdvanceWidth(displayText, fontSize) > maxWidth) {
      const ellipsis = '...';
      while (font.getAdvanceWidth(displayText + ellipsis, fontSize) > maxWidth && displayText.length > 0) {
        displayText = displayText.slice(0, -1);
      }
      displayText += ellipsis;
    }

    // Calculate text width to determine where emojis start
    const textWidth = font.getAdvanceWidth(displayText, fontSize);
    const emojiSize = 30;
    let currentX = textWidth; // Relative to the username text start (145px in the SVG)
    const emojis = [];

    for (const emoji of emojiMatches) {
      if (currentX + emojiSize > maxWidth) break;

      const hex = [...emoji].map((c) => c.codePointAt(0).toString(16)).join('-');
      if (!hex) continue;

      // Ensure emoji is cached to disk
      await this.ensureEmojiCached(hex);

      emojis.push({
        hex,
        x_offset: currentX,
      });
      currentX += emojiSize + 7;
    }

    return { username: displayText, emojis, textEndX: currentX };
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

  // ... (Keep existing methods: generateBaseReward, generateFinalReward, helper methods) ...
  // [OMITTED FOR BREVITY - KEEP YOUR EXISTING CODE BELOW THIS LINE]

  async generateBaseReward(roleName, roleColorHex, iconUrl) {
    if (!cachedRoleTemplate) {
      cachedRoleTemplate = await loadImage(ROLE_TEMPLATE_PATH);
    }
    const background = cachedRoleTemplate;

    const canvas = createCanvas(background.width, background.height);
    const ctx = canvas.getContext('2d');
    const font = await this.loadFont();

    ctx.drawImage(background, 0, 0);

    if (iconUrl) {
      const iconImg = await this.fetchImage(iconUrl);
      if (iconImg) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(74 + 171 / 2, 67 + 172 / 2, 171 / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(iconImg, 74, 67, 171, 172);
        ctx.restore();
      }
    }

    const fontSize = 50;
    const x = 298;
    const yBaseline = 111 + 48;
    const maxWidth = 641;

    let displayText = roleName;
    const ellipsis = '...';

    while (font.getAdvanceWidth(displayText, fontSize) > maxWidth && displayText.length > 0) {
      displayText = displayText.slice(0, -1);
    }
    if (displayText !== roleName) {
      displayText += ellipsis;
    }

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    const path = font.getPath(displayText, x, yBaseline, fontSize);

    path.fill = null;
    path.stroke = 'black';
    path.strokeWidth = 5;
    path.draw(ctx);

    path.fill = roleColorHex || '#FFFFFF';
    path.stroke = null;
    path.draw(ctx);
    ctx.restore();

    return canvas.toBuffer('image/png');
  }

  async generateFinalReward(baseImageBuffer, username) {
    const baseImage = await loadImage(baseImageBuffer);
    const canvas = createCanvas(baseImage.width, baseImage.height);
    const ctx = canvas.getContext('2d');
    const font = await this.loadFont();

    ctx.drawImage(baseImage, 0, 0);

    const fontSize = 40;
    const x = 298;
    const yBaseline = 206 + 35;
    const maxWidth = 637;

    let displayText = username;
    const ellipsis = '...';

    while (font.getAdvanceWidth(displayText, fontSize) > maxWidth && displayText.length > 0) {
      displayText = displayText.slice(0, -1);
    }
    if (displayText !== username) {
      displayText += ellipsis;
    }

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    const path = font.getPath(displayText, x, yBaseline, fontSize);

    path.fill = null;
    path.stroke = 'black';
    path.strokeWidth = 5;
    path.draw(ctx);

    path.fill = 'white';
    path.stroke = null;
    path.draw(ctx);
    ctx.restore();

    return canvas.toBuffer('image/png');
  }

  renderOpenTypeText(ctx, font, text, x, y, fontSize) {
    const scale = fontSize / font.unitsPerEm;
    let cursorX = x;

    for (const char of text) {
      const glyph = font.charToGlyph(char);
      const glyphPath = glyph.getPath(cursorX, y, fontSize);

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      glyphPath.fill = null;
      glyphPath.stroke = 'black';
      glyphPath.strokeWidth = 5;
      glyphPath.draw(ctx);
      ctx.restore();

      ctx.save();
      glyphPath.fill = 'white';
      glyphPath.stroke = null;
      glyphPath.draw(ctx);
      ctx.restore();

      cursorX += glyph.advanceWidth * scale;
    }
    return cursorX;
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

  async renderNameWithEmojis(ctx, font, text, x, y, fontSize, maxWidth) {
    /* eslint-disable no-misleading-character-class */
    const emojiRegex =
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E0}-\u{1F1FF}]/gu;
    /* eslint-enable no-misleading-character-class */

    const textPart = text.replace(emojiRegex, '').trim();
    const emojis = text.match(emojiRegex) || [];

    let displayText = textPart;
    let textWidth = font.getAdvanceWidth(displayText, fontSize);

    if (textWidth > maxWidth) {
      const ellipsis = '...';
      while (font.getAdvanceWidth(displayText + ellipsis, fontSize) > maxWidth && displayText.length > 0) {
        displayText = displayText.slice(0, -1);
      }
      displayText += ellipsis;
    }

    const textEndX = this.renderOpenTypeText(ctx, font, displayText, x, y, fontSize);

    let currentX = textEndX + 8;
    const emojiSize = 30;

    for (const emoji of emojis) {
      if (currentX + emojiSize > x + maxWidth) break;

      const emojiImage = await this.fetchEmojiImage(emoji);
      if (emojiImage) {
        ctx.drawImage(emojiImage, currentX, y - 25, emojiSize, emojiSize);
        currentX += emojiSize + 7;
      }
    }
    return currentX;
  }

  async fetchImage(url) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await loadImage(Buffer.from(await response.arrayBuffer()));
    } catch {
      console.warn(`[ImageService] Failed to fetch image: ${url}`);
      throw new Error(`Failed to load image from ${url}`);
    }
  }

  async fetchEmojiImage(char) {
    const hex = [...char].map((c) => c.codePointAt(0).toString(16)).join('-');
    if (!hex) return null;

    const filePath = path.join(EMOJI_DIR, `${hex}.png`);

    try {
      if (fs.existsSync(filePath)) {
        return await loadImage(filePath);
      }

      const url = `https://raw.githubusercontent.com/whotfknows7/bangbang/main/unicode/64/${hex}.png`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

      if (response.status !== 200) return null;

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(filePath, buffer);

      return await loadImage(buffer);
    } catch {
      console.warn(`[ImageService] Failed to fetch emoji: ${char} (${hex})`);
      return null;
    }
  }

  clearEmojiCache() {
    if (!fs.existsSync(EMOJI_DIR)) return 0;

    const files = fs.readdirSync(EMOJI_DIR);
    let count = 0;

    for (const file of files) {
      if (file.endsWith('.png')) {
        fs.unlinkSync(path.join(EMOJI_DIR, file));
        count++;
      }
    }

    console.log(`[ImageService] Cleared ${count} cached emoji images`);
    return count;
  }

  async preloadAssets() {
    try {
      await this.loadFont();
      console.log('[ImageService] Font preloaded successfully');

      if (fs.existsSync(ROLE_TEMPLATE_PATH)) {
        cachedRoleTemplate = await loadImage(ROLE_TEMPLATE_PATH);
        console.log('[ImageService] Role template preloaded successfully');
      }
    } catch (e) {
      console.error('[ImageService] Failed to preload assets:', e.message);
    }
  }
}

module.exports = new ImageService();
