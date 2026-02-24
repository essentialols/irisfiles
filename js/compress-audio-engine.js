/**
 * IrisFiles - Audio compression engine
 * Re-encodes audio to MP3 with adjustable bitrate via FFmpeg.wasm.
 */

import { ensureFFmpeg } from './ffmpeg-shared.js';

export const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100MB
export const MAX_AUDIO_DURATION = 3600; // 60 minutes

const BITRATE = { high: '192k', medium: '128k', low: '64k' };

/**
 * Compress audio by re-encoding to MP3 with adjustable bitrate.
 * @param {File} file - Source audio file
 * @param {object} opts - { quality: 'high'|'medium'|'low' }
 * @param {function} onProgress - Progress callback (0-100)
 * @param {function} onStatus - Status message callback
 * @returns {Promise<Blob>}
 */
export async function compressAudio(file, opts, onProgress, onStatus) {
  if (file.size > MAX_AUDIO_SIZE) {
    throw new Error(`File too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum is 100MB.`);
  }

  if (onProgress) onProgress(5);

  const ffmpeg = await ensureFFmpeg(onStatus);

  if (onProgress) onProgress(15);
  if (onStatus) onStatus('Reading file...');

  const inputExt = (file.name.match(/\.(\w+)$/) || [, 'mp3'])[1].toLowerCase();
  const inputName = `input.${inputExt}`;
  const outputName = 'output.mp3';

  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

  if (onProgress) onProgress(20);
  if (onStatus) onStatus('Compressing...');

  const bitrate = BITRATE[opts.quality] || '128k';
  const args = ['-i', inputName, '-c:a', 'libmp3lame', '-b:a', bitrate, '-y', outputName];

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
    throw new Error('Compression failed. The file may be corrupted or use an unsupported codec.');
  }

  if (onProgress) onProgress(95);
  if (onStatus) onStatus('Preparing download...');

  const data = await ffmpeg.readFile(outputName);

  try { await ffmpeg.deleteFile(inputName); } catch {}
  try { await ffmpeg.deleteFile(outputName); } catch {}

  if (onProgress) onProgress(100);
  return new Blob([data.buffer], { type: 'audio/mpeg' });
}

/**
 * Get audio duration using HTML audio element.
 * @param {File} file
 * @returns {Promise<{duration: number}>}
 */
export function getAudioMetadata(file) {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const url = URL.createObjectURL(file);
    audio.src = url;
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ duration: isFinite(audio.duration) ? audio.duration : 0 });
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ duration: 0 });
    };
  });
}
