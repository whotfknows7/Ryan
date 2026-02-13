// src/services/GifService.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Worker } = require('worker_threads');
const { execFile } = require('child_process');
const gifsicle = require('gifsicle');
const { AssetService } = require('./AssetService');
const { DatabaseService } = require('./DatabaseService');
const logger = require('../lib/logger');

// Setup RAM Disk (Extremely fast I/O)
const USE_RAM_DISK = process.platform === 'linux' && fs.existsSync('/dev/shm');
const TEMP_DIR = USE_RAM_DISK ? '/dev/shm' : path.join(process.cwd(), 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// 2-vCPU Limit out of the 4 available on e2-standard-4
const MAX_WORKERS = 2;

class GifService {
  static queue = [];
  static activeWorkers = 0;

  static async generateClanGif(client, clanRoleIds, clanCount) {
    return new Promise((resolve, reject) => {
      this.queue.push({ client, clanRoleIds, clanCount, resolve, reject });
      this.processQueue();
    });
  }

  static async processQueue() {
    // Stop if queue is empty or we are using our 2 allocated vCores
    if (this.queue.length === 0 || this.activeWorkers >= MAX_WORKERS) return;

    const jobToRun = this.queue.shift();
    this.activeWorkers++;

    this._runWorker(jobToRun)
      .then(() => {
        this.activeWorkers--;
        this.processQueue(); // Pull next job immediately
      })
      .catch((err) => {
        logger.error('[GifService] Generation Error:', err);
        this.activeWorkers--;
        this.processQueue();
      });

    // If we only started 1 worker and the queue has more, fire up the 2nd one
    if (this.activeWorkers < MAX_WORKERS && this.queue.length > 0) {
      this.processQueue();
    }
  }

  static async _runWorker(task) {
    const { client, clanRoleIds, clanCount, resolve, reject } = task;
    const tempFiles = [];

    try {
      const template = await DatabaseService.getGifTemplate(clanCount);
      if (!template) throw new Error(`No template for ${clanCount} clans`);

      // EXPECTATION: You must convert the background sequence to a 'template.mp4' for maximum speed
      const templatePath = path.join(process.cwd(), 'assets', 'gif_templates', String(clanCount), template.name, 'template.mp4');
      const coordsPath = path.join(process.cwd(), 'assets', 'gif_templates', String(clanCount), template.name, 'coords.json');

      if (!fs.existsSync(coordsPath)) throw new Error('Missing coords.json');
      const coordsData = JSON.parse(fs.readFileSync(coordsPath, 'utf8'));

      const effectiveRoles = (clanCount === 2) ? [clanRoleIds[0]] : clanRoleIds;
      const iconBuffers = await this.prepareClanIcons(client, effectiveRoles);
      const iconPaths = [];

      // Write icons to RAM Disk
      for (let i = 0; i < iconBuffers.length; i++) {
        const p = path.join(TEMP_DIR, `icon_${Date.now()}_${i}.png`);
        if (iconBuffers[i]) {
          await sharp(iconBuffers[i]).toFile(p);
        } else {
          await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(p);
        }
        iconPaths.push(p);
        tempFiles.push(p);
      }

      const outputPath = path.join(TEMP_DIR, `out_${Date.now()}.gif`);
      tempFiles.push(outputPath);

      // Spin up the FFmpeg Worker
      const worker = new Worker(path.join(__dirname, '../workers/gifWorker.js'), {
        workerData: { templatePath, iconPaths, outputPath, clanCount, coords: coordsData }
      });

      await new Promise((wRes, wErr) => {
        worker.on('message', m => m.success ? wRes() : wErr(new Error(m.error)));
        worker.on('error', wErr);
        worker.on('exit', c => c !== 0 && wErr(new Error(`Exit ${c}`)));
        worker.postMessage({});
      });

      // Final optimization with Gifsicle
      const finalPath = path.join(process.cwd(), `final_${Date.now()}.gif`);
      await new Promise((res, rej) => {
        execFile(gifsicle, ['-O3', '--no-warnings', '-i', outputPath, '-o', finalPath], (e) => e ? rej(e) : res());
      });

      resolve(finalPath);
    } catch (e) {
      reject(e);
    } finally {
      // Clean up RAM Disk instantly
      tempFiles.forEach(f => fs.existsSync(f) && fs.unlinkSync(f));
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
