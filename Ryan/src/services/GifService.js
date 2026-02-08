// src/services/GifService.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const GIFEncoder = require('gifencoder');
const { execFile } = require('child_process');
const gifsicle = require('gifsicle');
const { AssetService } = require('./AssetService');
const { DatabaseService } = require('./DatabaseService');
const logger = require('../lib/logger');

// [OPTIMIZATION] Limit Sharp threads to keep CPU available for the rest of the bot
sharp.concurrency(1);

const GIF_WIDTH = 498;
const GIF_HEIGHT = 498;
const TEMPLATE_DIR = path.join(process.cwd(), 'assets', 'gif_templates');

class GifService {
  static isProcessing = false;
  static queue = [];

  static async generateClanGif(client, clanRoleIds, clanCount) {
    if (this.isProcessing) {
      logger.info(`[GifService] CPU Busy. Adding request to queue...`);
      return new Promise((resolve, reject) => {
        this.queue.push({ client, clanRoleIds, clanCount, resolve, reject });
      });
    }

    this.isProcessing = true;

    try {
      const result = await this._internalGenerate(client, clanRoleIds, clanCount);
      return result;
    } finally {
      this.isProcessing = false;
      this.processQueue();
    }
  }

  static async processQueue() {
    if (this.queue.length > 0 && !this.isProcessing) {
      const next = this.queue.shift();
      await new Promise(r => setTimeout(r, 2000)); // Cooldown
      try {
        const result = await this.generateClanGif(next.client, next.clanRoleIds, next.clanCount);
        next.resolve(result);
      } catch (err) {
        next.reject(err);
      }
    }
  }

  static async _internalGenerate(client, clanRoleIds, clanCount) {
    const template = await DatabaseService.getGifTemplate(clanCount);
    if (!template) throw new Error(`No GIF template found for ${clanCount} clans.`);

    const templatePath = path.join(TEMPLATE_DIR, template.clanCount.toString(), template.name);
    const framesDir = path.join(templatePath, 'frames');
    const coordsPath = path.join(templatePath, 'coords.json');

    if (!fs.existsSync(framesDir) || !fs.existsSync(coordsPath)) {
      throw new Error(`Template files missing at ${templatePath}`);
    }

    const coordsData = JSON.parse(fs.readFileSync(coordsPath, 'utf8'));
    const frameFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
    
    // 2-Clan Logic: Only load the Winner (Index 0)
    // 4-Clan Logic: Load ALL, we will filter them frame-by-frame later
    const effectiveRoles = (clanCount === 2) ? [clanRoleIds[0]] : clanRoleIds;
    
    const iconBuffers = await this.prepareClanIcons(client, effectiveRoles);

    const rawOutputPath = path.join(process.cwd(), `temp_raw_${Date.now()}.gif`);
    const finalOutputPath = path.join(process.cwd(), `temp_clan_${Date.now()}.gif`);

    const encoder = new GIFEncoder(GIF_WIDTH, GIF_HEIGHT);
    const writeStream = fs.createWriteStream(rawOutputPath);
    
    encoder.createReadStream().pipe(writeStream);
    encoder.start();
    encoder.setRepeat(0);   
    encoder.setDelay(100); // 100ms per frame (10 FPS)
    encoder.setQuality(1); // Best Quality

    // --- FRAME PROCESSING LOOP ---
    for (let i = 0; i < frameFiles.length; i++) {
      
      // [OPTIMIZATION] CPU Breather every 5 frames
      if (i % 5 === 0) await new Promise(resolve => setTimeout(resolve, 50));

      // ---------------------------------------------------------
      // [LOGIC] VISIBILITY CONTROLLER
      // ---------------------------------------------------------
      let visibleIndices = [0, 1, 2, 3]; // Default: Show everyone

      if (clanCount === 4) {
        if (i <= 20) {
            // Frames 0-20: Show #2, #3, #4 (Indices 1, 2, 3)
            visibleIndices = [1, 2, 3];
        } else if (i <= 40) {
            // Frames 21-40: Show #1, #4 (Indices 0, 3)
            visibleIndices = [0, 3];
        } else if (i <= 66) {
            // Frames 41-66: Show #1 (Index 0)
            visibleIndices = [0];
        } else if (i <= 95) {
            // Frames 67-95: Show #1, #2, #3 (Indices 0, 1, 2)
            visibleIndices = [0, 1, 2];
        }
      }
      // ---------------------------------------------------------

      const frameFile = frameFiles[i];
      const framePath = path.join(framesDir, frameFile);
      const frameCoords = coordsData[i] || [];

      const compositeOps = [];
      for (let j = 0; j < iconBuffers.length; j++) {
        // Skip if buffer is missing OR if this clan shouldn't be visible in this frame
        if (!iconBuffers[j]) continue;
        if (!visibleIndices.includes(j)) continue;

        const coord = frameCoords[j] || { x: 0, y: 0 };
        
        compositeOps.push({
          input: iconBuffers[j],
          top: Math.round(coord.y),
          left: Math.round(coord.x)
        });
      }

      const rawBuffer = await sharp(framePath)
        .resize(GIF_WIDTH, GIF_HEIGHT)
        .composite(compositeOps)
        .ensureAlpha()
        .raw() 
        .toBuffer();

      encoder.addFrame({
        getImageData: () => ({ data: rawBuffer }),
        width: GIF_WIDTH,
        height: GIF_HEIGHT
      });
    }

    encoder.finish();
    await new Promise((resolve) => writeStream.on('finish', resolve));

    // Compression
    try {
      await new Promise((resolve, reject) => {
        execFile(gifsicle, [
          '-O3',                
          '--colors', '256',    
          '--lossy=30',         
          '--no-warnings',
          '-i', rawOutputPath,
          '-o', finalOutputPath
        ], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      if (fs.existsSync(rawOutputPath)) fs.unlinkSync(rawOutputPath);
      return finalOutputPath;

    } catch (e) {
      if (fs.existsSync(finalOutputPath)) fs.unlinkSync(finalOutputPath);
      fs.renameSync(rawOutputPath, finalOutputPath);
      return finalOutputPath;
    }
  }

  static async prepareClanIcons(client, roleIds) {
    const icons = [];
    const ICON_SIZE = 60; 
    for (const roleId of roleIds) {
      try {
        const asset = await DatabaseService.getClanAsset(roleId);
        if (asset && client) {
          const buffer = await AssetService.fetchAssetFromLink(client, asset.messageLink);
          if (buffer) {
            const resized = await sharp(buffer).resize(ICON_SIZE, ICON_SIZE).toBuffer();
            icons.push(resized);
            continue;
          }
        }
        icons.push(null);
      } catch (e) {
        icons.push(null);
      }
    }
    return icons;
  }
}

module.exports = { GifService };
