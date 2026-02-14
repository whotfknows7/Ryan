// src/services/ImageService.js

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const opentype = require('opentype.js');

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
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      return Buffer.from(response.data, 'binary').toString('base64');
    } catch (error) {
      console.error(`Failed to convert image to base64: ${url}`, error.message);
      return "";
    }
  }

  async generateRankCard(data) {
    try {
      // 1. Convert external resources to Base64
      const avatarBase64 = await this.urlToBase64(data.avatarUrl);

      // 2. Construct Payload
      const payload = {
        username: data.username,
        avatar_base64: avatarBase64,
        current_xp: data.currentXp,
        required_xp: data.requiredXp,
        rank: data.rank,
        level: data.level,
        hex_color: data.hexColor,
        badge_urls: data.badgeUrls || []
      };

      // 3. Call Rust Renderer
      // [FIX] Added timeout and better error logging
      const response = await axios.post(this.rendererUrl, payload, {
        responseType: 'arraybuffer',
        timeout: 5000 // 5 second timeout
      });

      return Buffer.from(response.data);

    } catch (error) {
      // [FIX] Improved error logging to see WHY it failed
      if (error.code === 'ECONNREFUSED') {
        console.error('❌ Rust Renderer is unreachable! Is it running on port 3000?');
      } else {
        console.error('Rank Card Generation Failed:', error.message);
      }
      throw new Error('Failed to generate rank card via Rust service.');
    }
  }

  // =================================================================
  // CANVAS-BASED IMAGE GENERATION (Leaderboards & Role Rewards)
  // =================================================================

  async loadFont() {
    if (cachedFont) return cachedFont;

    const fontDirs = [
      path.join(ASSETS_DIR, 'font'),
      path.join(ASSETS_DIR, 'fonts')
    ];

    for (const fontDir of fontDirs) {
      if (fs.existsSync(fontDir)) {
        const files = fs.readdirSync(fontDir);
        const fontFile = files.find(f => f.toLowerCase().endsWith('.ttf'));

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
    const font = await this.loadFont();

    const width = 800;
    const height = (users.length * 60) + 20;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, width, height);

    if (users.length === 0) {
      canvas.height = 100;
      this.renderOpenTypeText(ctx, font, "No-one is yapping right now...", 10, 60, 30);
      return canvas.toBuffer('image/png');
    }

    let yPosition = 10;
    const padding = 10;

    const rankColors = {
      1: '#FFD700', // Gold
      2: '#E6E8FA', // Silver
      3: '#CD7F32', // Bronze
    };

    // Pre-fetch all avatars in parallel (Optimization)
    const avatarPromises = users.map(user => {
      const url = user.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
      return this.fetchImage(url).catch(() => null);
    });

    // Wait for all avatar fetches (up to 10 users = 10 avatars)
    const avatars = await Promise.all(avatarPromises);

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const avatarImage = avatars[i]; // Pre-fetched image or null

      let bgColor = '#36393e';

      if (highlightUserId && user.userId === highlightUserId) {
        bgColor = '#823EF0';
      } else if (rankColors[user.rank]) {
        bgColor = rankColors[user.rank];
      }

      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.roundRect(padding, yPosition, width - (padding * 2), 57, 10);
      ctx.fill();

      if (avatarImage) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(padding, yPosition, 57, 58, 10);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatarImage, padding, yPosition, 57, 58);
        ctx.restore();
      } else {
        // Fallback placeholder grey box if image failed
        ctx.fillStyle = '#808080';
        ctx.beginPath();
        ctx.roundRect(padding, yPosition, 57, 58, 10);
        ctx.fill();
      }

      const textBaselineY = yPosition + 40;
      const fontSize = 30;

      const rankText = `#${user.rank}`;
      const rankX = padding + 65;
      const rankEndX = this.renderOpenTypeText(ctx, font, rankText, rankX, textBaselineY, fontSize);

      const separatorX = rankEndX + 12;
      const sep1EndX = this.renderOpenTypeText(ctx, font, "|", separatorX, textBaselineY, fontSize);

      const nameStartX = sep1EndX + 12;
      const nameEndX = await this.renderNameWithEmojis(ctx, font, user.username, nameStartX, textBaselineY, fontSize, 440);

      const sep2X = nameEndX + 8;
      const sep2EndX = this.renderOpenTypeText(ctx, font, "|", sep2X, textBaselineY, fontSize);

      const xpText = `XP: ${this.formatPoints(user.xp)} pts`;
      const xpX = sep2EndX + 12;
      this.renderOpenTypeText(ctx, font, xpText, xpX, textBaselineY, fontSize);

      yPosition += 60;
    }

    return canvas.toBuffer('image/png');
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
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E0}-\u{1F1FF}]/gu;

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
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
      return await loadImage(Buffer.from(response.data));
    } catch (e) {
      console.warn(`[ImageService] Failed to fetch image: ${url}`);
      throw new Error(`Failed to load image from ${url}`);
    }
  }

  async fetchEmojiImage(char) {
    const hex = [...char].map(c => c.codePointAt(0).toString(16)).join('-');
    if (!hex) return null;

    const filePath = path.join(EMOJI_DIR, `${hex}.png`);

    try {
      if (fs.existsSync(filePath)) {
        return await loadImage(filePath);
      }

      const url = `https://raw.githubusercontent.com/whotfknows7/bangbang/main/unicode/64/${hex}.png`;
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000, validateStatus: () => true });

      if (response.status !== 200) return null;

      const buffer = Buffer.from(response.data);
      fs.writeFileSync(filePath, buffer);

      return await loadImage(buffer);
    } catch (e) {
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