// src/workers/gifWorker.js
const { parentPort, workerData } = require('worker_threads');
const { spawn } = require('child_process');

const runFFmpeg = async ({ templatePath, iconPaths, outputPath, clanCount, coords }) => {
  return new Promise((resolve, reject) => {
    const args = ['-y'];

    // RESTRICT CPU USAGE: Force FFmpeg to use exactly 1 vCore.
    // Since GifService runs max 2 workers, this guarantees only 2 vCores are ever used.
    args.push('-threads', '1');

    args.push('-i', templatePath);
    iconPaths.forEach((icon) => args.push('-i', icon));

    // Visibility Logic
    const getVisibilityRanges = (roleIndex) => {
      if (clanCount === 2) return roleIndex === 0 ? [[0, 999]] : [];
      if (clanCount === 4) {
        const ranges = [];
        if ([1, 2, 3].includes(roleIndex)) ranges.push([0, 20]);
        if ([0, 3].includes(roleIndex)) ranges.push([21, 40]);
        if ([0].includes(roleIndex)) ranges.push([41, 66]);
        if ([0, 1, 2].includes(roleIndex)) ranges.push([67, 95]);
        return ranges;
      }
      return [];
    };

    const mergeRanges = (ranges) => {
      if (ranges.length === 0) return [];
      ranges.sort((a, b) => a[0] - b[0]);
      const merged = [ranges[0]];
      for (let i = 1; i < ranges.length; i++) {
        const current = ranges[i];
        const last = merged[merged.length - 1];
        if (current[0] <= last[1] + 1) last[1] = Math.max(last[1], current[1]);
        else merged.push(current);
      }
      return merged;
    };

    const getEnableExpr = (ranges) => {
      if (ranges.length === 0) return null;
      return ranges.map((r) => `between(t,${r[0] * 0.1},${r[1] * 0.1 + 0.05})`).join('+');
    };

    // MOTION COMPILER: Turns coords.json into FFmpeg Math
    const getMotionExpr = (roleIndex, axis) => {
      const segments = [];
      let currentVal = null;
      let startFrame = 0;
      const maxFrames = coords.length;

      for (let i = 0; i < maxFrames; i++) {
        const frameCoord = coords[i] && coords[i][roleIndex] ? coords[i][roleIndex][axis] : 0;

        if (currentVal === null) {
          currentVal = frameCoord;
          startFrame = i;
        } else if (frameCoord !== currentVal) {
          segments.push(`between(n,${startFrame},${i - 1})*${currentVal}`);
          currentVal = frameCoord;
          startFrame = i;
        }
      }
      segments.push(`between(n,${startFrame},${maxFrames})*${currentVal}`);
      return segments.join('+');
    };

    let filterComplex = '';
    let lastOutput = '0:v';

    iconPaths.forEach((_, index) => {
      const iconInputIdx = index + 1;

      const rawRanges = getVisibilityRanges(index);
      const mergedRanges = mergeRanges(rawRanges);
      const enableExpr = getEnableExpr(mergedRanges);

      if (!enableExpr && !(clanCount === 2 && index === 0)) return;

      const xExpr = getMotionExpr(index, 'x');
      const yExpr = getMotionExpr(index, 'y');

      const nextOutput = `tmp${iconInputIdx}`;
      const enablePart = enableExpr ? `:enable='${enableExpr}'` : '';

      filterComplex += `[${lastOutput}][${iconInputIdx}:v]overlay=x='${xExpr}':y='${yExpr}'${enablePart}[${nextOutput}];`;
      lastOutput = nextOutput;
    });

    filterComplex = filterComplex.slice(0, -1);

    // Single-pass Palette Generation
    filterComplex += `[${lastOutput}]split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;

    args.push('-filter_complex', filterComplex);
    args.push('-r', '10');
    args.push(outputPath);

    const ffmpeg = spawn('ffmpeg', args);
    let errorLog = '';
    ffmpeg.stderr.on('data', (d) => {
      errorLog += d.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`FFmpeg error: ${errorLog}`));
    });
  });
};

parentPort.on('message', async () => {
  try {
    const result = await runFFmpeg(workerData);
    parentPort.postMessage({ success: true, path: result });
  } catch (err) {
    parentPort.postMessage({ success: false, error: err.message });
  }
});
