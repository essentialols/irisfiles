/**
 * IrisFiles - Video to audio conversion engine.
 * Fast path: reuse the existing Web Audio + lamejs/WAV pipeline.
 * Fallback: FFmpeg.wasm for containers/codecs the browser cannot decode directly.
 */

import { convertAudio } from './audio-engine.js';
import { withFFmpeg } from './ffmpeg-shared.js';

const TARGETS = {
  mp3: { ext: 'mp3', mime: 'audio/mpeg', args: ['-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '128k'] },
  wav: { ext: 'wav', mime: 'audio/wav', args: ['-vn', '-map', '0:a:0', '-c:a', 'pcm_s16le'] },
};

function inputExtension(file) {
  const match = (file.name || '').match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : 'bin';
}

/**
 * Extract/convert the first audio track from a video to MP3 or WAV.
 * @param {File} file
 * @param {'mp3'|'wav'} targetFormat
 * @param {(pct:number)=>void} onProgress
 * @returns {Promise<Blob>}
 */
export async function convertVideoToAudio(file, targetFormat, onProgress = () => {}) {
  const target = TARGETS[targetFormat];
  if (!target) throw new Error(`Unsupported audio target: ${targetFormat}`);

  // This is deliberately attempted first. On MP4/MOV files with browser-supported
  // audio codecs it avoids downloading the much larger FFmpeg WebAssembly bundle.
  try {
    return await convertAudio(file, targetFormat, onProgress);
  } catch (browserDecodeError) {
    onProgress(5);
    try {
      return await withFFmpeg(async (ffmpeg) => {
        const inputName = `media-input.${inputExtension(file)}`;
        const outputName = `media-output.${target.ext}`;
        let progressHandler = null;
        try {
          await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
          progressHandler = ({ progress }) => {
            onProgress(Math.min(92, 10 + Math.round(progress * 82)));
          };
          ffmpeg.on('progress', progressHandler);

          const exitCode = await ffmpeg.exec(['-i', inputName, ...target.args, '-y', outputName]);
          if (exitCode !== 0) {
            throw new Error('No usable audio track was found, or the video codec/container is unsupported.');
          }

          const data = await ffmpeg.readFile(outputName);
          onProgress(100);
          return new Blob([data.buffer], { type: target.mime });
        } finally {
          if (progressHandler) ffmpeg.off('progress', progressHandler);
          try { await ffmpeg.deleteFile(inputName); } catch {}
          try { await ffmpeg.deleteFile(outputName); } catch {}
        }
      });
    } catch (ffmpegError) {
      const detail = ffmpegError?.message || browserDecodeError?.message || 'Conversion failed.';
      throw new Error(`Could not extract audio from this video. ${detail}`);
    }
  }
}
