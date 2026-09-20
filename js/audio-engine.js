/**
 * IrisFiles - Audio conversion engine
 * Decodes audio via Web Audio API, encodes to WAV (native) or MP3 (lamejs, lazy-loaded).
 * For OGG/FLAC/M4A/AAC output, uses FFmpeg.wasm via the shared loader.
 */

import { withFFmpeg } from "./ffmpeg-shared.js";

const LAMEJS_CDN = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js";
let lameReady = null; // Promise that resolves when lamejs is loaded

/**
 * Read the sample rate from the mandatory FLAC STREAMINFO block.
 * Web Audio decodes into the AudioContext's sample rate, so using the
 * browser default would silently resample FLAC -> WAV conversions.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {number|null}
 */
function readFlacSampleRate(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (
    bytes.length < 42 ||
    bytes[0] !== 0x66 ||
    bytes[1] !== 0x4c ||
    bytes[2] !== 0x61 ||
    bytes[3] !== 0x43 ||
    (bytes[4] & 0x7f) !== 0
  ) {
    return null;
  }

  const streamInfoLength =
    (bytes[5] << 16) | (bytes[6] << 8) | bytes[7];
  if (streamInfoLength < 34 || bytes.length < 8 + streamInfoLength) {
    return null;
  }

  const sampleRate =
    (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4);
  return sampleRate || null;
}

const ADTS_SAMPLE_RATES = [
  96000,
  88200,
  64000,
  48000,
  44100,
  32000,
  24000,
  22050,
  16000,
  12000,
  11025,
  8000,
  7350,
];

/**
 * Read the sample rate from the first ADTS AAC frame.
 * Raw .aac files carry this in every frame header, so we can create the
 * AudioContext at the source rate instead of silently resampling to the
 * browser/device default before writing WAV.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {number|null}
 */
function readAdtsSampleRate(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (
    bytes.length < 7 ||
    bytes[0] !== 0xff ||
    (bytes[1] & 0xf6) !== 0xf0
  ) {
    return null;
  }

  const sampleRateIndex = (bytes[2] >> 2) & 0x0f;
  return ADTS_SAMPLE_RATES[sampleRateIndex] || null;
}

/**
 * Read the sample rate from an ISO BMFF audio sample entry (M4A/MP4).
 * AudioSampleEntry stores it as a 16.16 fixed-point value; reading it before
 * Web Audio decoding prevents a 48 kHz M4A from being silently resampled to
 * the browser/device default when the target is WAV.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @returns {number|null}
 */
function readMp4AudioSampleRate(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const length = view.byteLength;
  if (length < 16) return null;

  const typeAt = (offset) => {
    if (offset + 4 > length) return "";
    return String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
  };

  const readBox = (offset, end) => {
    if (offset + 8 > end || offset + 8 > length) return null;
    let size = view.getUint32(offset, false);
    const type = typeAt(offset + 4);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end || offset + 16 > length) return null;
      const high = view.getUint32(offset + 8, false);
      const low = view.getUint32(offset + 12, false);
      // Files large enough to need a non-zero high word cannot exist in a
      // browser ArrayBuffer anyway; rejecting it also keeps arithmetic exact.
      if (high !== 0) return null;
      size = low;
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (
      size < headerSize ||
      offset + size > end ||
      offset + size > length
    ) {
      return null;
    }
    return { offset, size, type, headerSize, end: offset + size };
  };

  const audioSampleEntries = new Set([
    "mp4a",
    "alac",
    "ac-3",
    "ec-3",
    "enca",
  ]);
  const containers = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

  const walk = (start, end) => {
    let offset = start;
    while (offset + 8 <= end) {
      const box = readBox(offset, end);
      if (!box) return null;

      if (box.type === "stsd") {
        // FullBox version/flags + entry_count precede the sample descriptions.
        const entriesStart = box.offset + box.headerSize + 8;
        if (entriesStart > box.end) return null;
        let entryOffset = entriesStart;
        while (entryOffset + 8 <= box.end) {
          const entry = readBox(entryOffset, box.end);
          if (!entry) break;
          if (audioSampleEntries.has(entry.type) && entry.size >= 36) {
            const fixedRate = view.getUint32(entry.offset + 32, false);
            const sampleRate = fixedRate / 65536;
            if (
              Number.isInteger(sampleRate) &&
              sampleRate >= 3000 &&
              sampleRate <= 384000
            ) {
              return sampleRate;
            }
          }
          entryOffset = entry.end;
        }
      } else if (containers.has(box.type)) {
        const found = walk(box.offset + box.headerSize, box.end);
        if (found) return found;
      }

      offset = box.end;
    }
    return null;
  };

  return walk(0, length);
}

/**
 * Lazy-load lamejs from CDN. Only called when MP3 output is needed.
 * @returns {Promise<void>}
 */
function loadLame() {
  if (lameReady) return lameReady;
  lameReady = new Promise((resolve, reject) => {
    if (typeof lamejs !== "undefined") {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = LAMEJS_CDN;
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      lameReady = null;
      reject(new Error("Failed to load MP3 encoder from CDN"));
    };
    document.head.appendChild(script);
  });
  return lameReady;
}

/**
 * Convert an audio file to the target format (WAV or MP3 only).
 * @param {File} file - Source audio file (MP3, WAV, OGG, FLAC, M4A, AAC)
 * @param {string} targetFormat - 'wav' or 'mp3'
 * @param {function} onProgress - Progress callback (0-100)
 * @returns {Promise<Blob>}
 */
export async function convertAudio(
  file,
  targetFormat,
  onProgress = () => {},
  opts = {},
) {
  onProgress(0);

  // Read file into ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();
  onProgress(10);

  // Decode audio data via Web Audio API. decodeAudioData() resamples into
  // the AudioContext's rate, so preserve a source-native rate when it can be
  // read directly from the container/header before decoding WAV output.
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx)
    throw new Error("Audio processing is not supported in this browser.");

  const sourceSampleRate =
    targetFormat === "wav"
      ? readFlacSampleRate(arrayBuffer) ||
        readAdtsSampleRate(arrayBuffer) ||
        readMp4AudioSampleRate(arrayBuffer)
      : null;
  let audioCtx = null;
  if (sourceSampleRate) {
    try {
      audioCtx = new Ctx({ sampleRate: sourceSampleRate });
    } catch {
      // Some browsers may reject uncommon context rates. Fall back to the
      // browser default rather than making a previously working conversion fail.
    }
  }
  if (!audioCtx) audioCtx = new Ctx();
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    throw new Error(
      "Could not decode audio. Format may not be supported by your browser.",
    );
  } finally {
    audioCtx.close();
  }
  onProgress(30);

  if (targetFormat === "wav") {
    const blob = encodeWav(audioBuffer, onProgress);
    onProgress(100);
    return blob;
  }

  if (targetFormat === "mp3") {
    await loadLame();
    onProgress(40);
    const blob = await encodeMp3(audioBuffer, onProgress, opts.bitrate || 128);
    onProgress(100);
    return blob;
  }

  throw new Error(`Unsupported output format: ${targetFormat}`);
}

// FFmpeg-based audio format definitions
const AUDIO_FORMATS = {
  ogg: {
    ext: "ogg",
    mime: "audio/ogg",
    args: ["-c:a", "libvorbis", "-q:a", "4"],
  },
  flac: { ext: "flac", mime: "audio/flac", args: ["-c:a", "flac"] },
  m4a: { ext: "m4a", mime: "audio/mp4", args: ["-c:a", "aac", "-b:a", "128k"] },
  aac: {
    ext: "aac",
    mime: "audio/aac",
    args: ["-c:a", "aac", "-b:a", "128k", "-f", "adts"],
  },
};

/**
 * Convert an audio file to OGG, FLAC, M4A, or AAC using FFmpeg.wasm.
 * @param {File} file - Source audio file
 * @param {string} targetFormat - 'ogg', 'flac', 'm4a', or 'aac'
 * @param {function} onProgress - Progress callback (0-100)
 * @returns {Promise<Blob>}
 */
export async function convertAudioFFmpeg(
  file,
  targetFormat,
  onProgress = () => {},
  opts = {},
) {
  const fmt = AUDIO_FORMATS[targetFormat];
  if (!fmt) throw new Error(`Unsupported FFmpeg audio format: ${targetFormat}`);

  onProgress(5);

  return withFFmpeg((ffmpeg) =>
    runAudioConversion(ffmpeg, file, fmt, targetFormat, onProgress, opts),
  );
}

async function runAudioConversion(
  ffmpeg,
  file,
  fmt,
  targetFormat,
  onProgress,
  opts,
) {
  onProgress(15);

  const inputExt = ((file.name || "").match(/\.(\w+)$/) || [
    ,
    "wav",
  ])[1].toLowerCase();
  const inputName = `input.${inputExt}`;
  const outputName = `output.${fmt.ext}`;

  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

  onProgress(25);

  const progressHandler = ({ progress }) => {
    const pct = Math.min(90, 25 + Math.round(progress * 65));
    onProgress(pct);
  };
  ffmpeg.on("progress", progressHandler);

  // Build args, applying bitrate override for lossy formats
  let args = [...fmt.args];
  if (opts.bitrate && targetFormat !== "flac") {
    const baIdx = args.indexOf("-b:a");
    if (baIdx >= 0 && baIdx + 1 < args.length) {
      args[baIdx + 1] = opts.bitrate + "k";
    } else {
      const qaIdx = args.indexOf("-q:a");
      if (qaIdx >= 0) args.splice(qaIdx, 2, "-b:a", opts.bitrate + "k");
    }
  }

  let exitCode;
  try {
    exitCode = await ffmpeg.exec(["-i", inputName, ...args, "-y", outputName]);
  } finally {
    ffmpeg.off("progress", progressHandler);
  }

  if (exitCode !== 0) {
    try {
      await ffmpeg.deleteFile(inputName);
    } catch {}
    try {
      await ffmpeg.deleteFile(outputName);
    } catch {}
    throw new Error(
      "Conversion failed. The file may be corrupted or use an unsupported codec.",
    );
  }

  onProgress(95);

  const data = await ffmpeg.readFile(outputName);

  try {
    await ffmpeg.deleteFile(inputName);
  } catch {}
  try {
    await ffmpeg.deleteFile(outputName);
  } catch {}

  onProgress(100);
  return new Blob([data.buffer], { type: fmt.mime });
}

/**
 * Encode AudioBuffer to WAV (PCM 16-bit).
 * @param {AudioBuffer} audioBuffer
 * @param {function} onProgress
 * @returns {Blob}
 */
function encodeWav(audioBuffer, onProgress) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numSamples = audioBuffer.length;
  const bytesPerSample = 2; // 16-bit
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave channels and write PCM 16-bit samples
  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      );
      offset += 2;
    }
    // Report progress from 30% to 100%
    if (i % 100000 === 0) {
      onProgress(30 + Math.round((i / numSamples) * 70));
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Fold a multichannel AudioBuffer down to stereo. Uses the Web Audio spec's
 * standard downmix formulas for quad (4) and 5.1 (6) layouts, so surround
 * and center-channel content survives instead of being dropped, then scales
 * the pair back under full scale if the sum overshot.
 * @param {AudioBuffer} audioBuffer
 * @returns {[Float32Array, Float32Array]}
 */
function downmixToStereo(audioBuffer) {
  const n = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const ch = [];
  for (let c = 0; c < n; c++) ch.push(audioBuffer.getChannelData(c));
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  if (n === 4) {
    // L, R, SL, SR
    for (let i = 0; i < length; i++) {
      left[i] = 0.5 * (ch[0][i] + ch[2][i]);
      right[i] = 0.5 * (ch[1][i] + ch[3][i]);
    }
  } else if (n === 6) {
    // L, R, C, LFE, SL, SR
    for (let i = 0; i < length; i++) {
      left[i] = ch[0][i] + 0.7071 * (ch[2][i] + ch[4][i]);
      right[i] = ch[1][i] + 0.7071 * (ch[2][i] + ch[5][i]);
    }
  } else {
    // Unknown layout: the front pair keeps unit gain and every other channel
    // folds into both sides equally. Splitting by even/odd index instead would
    // send the center of a 3ch L/R/C source to the left only, and halve one
    // side's gain but not the other.
    for (let i = 0; i < length; i++) {
      let extra = 0;
      for (let c = 2; c < n; c++) extra += ch[c][i];
      extra *= 0.7071;
      left[i] = ch[0][i] + extra;
      right[i] = ch[1][i] + extra;
    }
  }

  // Summing channels overshoots full scale: 5.1 at 0.75 per channel reaches
  // 1.81, which the Int16 clamp in encodeMp3 would turn into hard clipping.
  // One shared factor keeps the stereo image and relative dynamics intact.
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const l = Math.abs(left[i]);
    const r = Math.abs(right[i]);
    if (l > peak) peak = l;
    if (r > peak) peak = r;
  }
  if (peak > 1) {
    const gain = 1 / peak;
    for (let i = 0; i < length; i++) {
      left[i] *= gain;
      right[i] *= gain;
    }
  }

  return [left, right];
}

/**
 * Encode AudioBuffer to MP3 using lamejs. Yields to main thread periodically.
 * @param {AudioBuffer} audioBuffer
 * @param {function} onProgress
 * @returns {Promise<Blob>}
 */
async function encodeMp3(audioBuffer, onProgress, kbps = 128) {
  const sourceChannels = audioBuffer.numberOfChannels;
  const numChannels = Math.max(1, Math.min(sourceChannels, 2)); // lamejs supports mono/stereo
  const sampleRate = audioBuffer.sampleRate;
  const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);
  const chunkSize = 1152;
  const mp3Chunks = [];

  // Get PCM data as Int16 arrays, downmixing surround sources to stereo first
  const downmixed = sourceChannels > 2 ? downmixToStereo(audioBuffer) : null;
  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) {
    const float32 = downmixed ? downmixed[ch] : audioBuffer.getChannelData(ch);
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    channels.push(int16);
  }

  const totalSamples = channels[0].length;
  let samplesProcessed = 0;

  for (let i = 0; i < totalSamples; i += chunkSize) {
    const end = Math.min(i + chunkSize, totalSamples);
    let mp3buf;

    if (numChannels === 1) {
      mp3buf = encoder.encodeBuffer(channels[0].subarray(i, end));
    } else {
      mp3buf = encoder.encodeBuffer(
        channels[0].subarray(i, end),
        channels[1].subarray(i, end),
      );
    }

    if (mp3buf.length > 0) {
      mp3Chunks.push(mp3buf);
    }

    samplesProcessed = end;

    // Report progress from 40% to 98%
    if (i % (chunkSize * 50) === 0) {
      onProgress(40 + Math.round((samplesProcessed / totalSamples) * 58));
      // Yield to main thread to keep UI responsive
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  // Flush remaining
  const flush = encoder.flush();
  if (flush.length > 0) {
    mp3Chunks.push(flush);
  }

  return new Blob(mp3Chunks, { type: "audio/mpeg" });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
