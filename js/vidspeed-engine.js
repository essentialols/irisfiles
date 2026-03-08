/**
 * IrisFiles - Video speed change engine
 * Uses FFmpeg.wasm for client-side time lapse and slow motion.
 */

import { ensureFFmpeg } from './ffmpeg-shared.js';

export const WARN_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB soft warning
export const MAX_DURATION = 600; // 10 minutes

const SPEED_PRESETS = {
  0.125: { setpts: '8.0*PTS',   atempo: ['0.5', '0.5', '0.5'] },
  0.25:  { setpts: '4.0*PTS',   atempo: ['0.5', '0.5'] },
  0.5:   { setpts: '2.0*PTS',   atempo: ['0.5'] },
  2:     { setpts: '0.5*PTS',   atempo: ['2.0'] },
  4:     { setpts: '0.25*PTS',  atempo: ['2.0', '2.0'] },
  8:     { setpts: '0.125*PTS', atempo: null },
  16:    { setpts: '0.0625*PTS', atempo: null },
};

/**
 * Change video speed using FFmpeg.wasm.
 * @param {File} file - Source video
 * @param {object} opts - { speed: number, keepAudio: boolean }
 * @param {function} onProgress - Progress callback (0-100)
 * @param {function} onStatus - Status message callback
 * @returns {Promise<Blob>}
 */
export async function changeVideoSpeed(file, opts, onProgress, onStatus) {

  const preset = SPEED_PRESETS[opts.speed];
  if (!preset) throw new Error(`Unsupported speed: ${opts.speed}`);

  if (onProgress) onProgress(5);
  const ffmpeg = await ensureFFmpeg(onStatus);

  if (onProgress) onProgress(15);
  if (onStatus) onStatus('Reading file...');

  const inputExt = (file.name.match(/\.(\w+)$/) || [, 'mp4'])[1].toLowerCase();
  const inputName = `input.${inputExt}`;
  const outputName = 'output.mp4';

  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

  if (onProgress) onProgress(20);
  if (onStatus) onStatus('Changing speed (this may take a while)...');

  const args = ['-i', inputName, '-vf', `setpts=${preset.setpts}`,
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '23'];

  if (opts.keepAudio && preset.atempo) {
    args.push('-af', preset.atempo.map(v => `atempo=${v}`).join(','));
    args.push('-c:a', 'aac', '-b:a', '128k');
  } else {
    args.push('-an');
  }

  args.push('-movflags', '+faststart', '-y', outputName);

  const progressHandler = ({ progress }) => {
    const pct = Math.min(90, 20 + Math.round(progress * 70));
    if (onProgress) onProgress(pct);
  };
  ffmpeg.on('progress', progressHandler);

  let exitCode;
  try {
    exitCode = await ffmpeg.exec(args);
  } finally {
    ffmpeg.off('progress', progressHandler);
  }

  if (exitCode !== 0) {
    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(outputName); } catch {}
    throw new Error('Speed change failed. The file may be corrupted or use an unsupported codec.');
  }

  if (onProgress) onProgress(95);
  if (onStatus) onStatus('Preparing download...');

  const data = await ffmpeg.readFile(outputName);
  try { await ffmpeg.deleteFile(inputName); } catch {}
  try { await ffmpeg.deleteFile(outputName); } catch {}

  if (onProgress) onProgress(100);
  return new Blob([data.buffer], { type: 'video/mp4' });
}
