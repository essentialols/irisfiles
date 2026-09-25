import { test, expect } from '@playwright/test';
import { cacheCdnAssets } from './helpers.mjs';

// Each test gets a fresh context, so each one refetched the ~25MB FFmpeg core.
test.beforeEach(async ({ page }) => { await cacheCdnAssets(page); });

// Builds an N-channel PCM WAV in the page, runs it through the real convertAudio
// path, and decodes the MP3 the browser actually produced. Asserting on decoded
// audio rather than on the encoder's input is what makes this a regression guard
// for the downmix itself.
async function convertAndMeasure(page, amplitudes, { sampleRate = 44100, seconds = 0.4 } = {}) {
  return page.evaluate(async ({ amplitudes, sampleRate, seconds }) => {
    const channels = amplitudes.length;
    const frames = Math.floor(sampleRate * seconds);
    const blockAlign = channels * 2;
    const dataSize = frames * blockAlign;
    const buf = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buf);
    const ascii = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

    ascii(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ascii(8, 'WAVE');
    ascii(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, dataSize, true);

    let off = 44;
    for (let i = 0; i < frames; i++) {
      const phase = (2 * Math.PI * 440 * i) / sampleRate;
      for (let c = 0; c < channels; c++) {
        const v = Math.max(-1, Math.min(1, amplitudes[c] * Math.sin(phase)));
        view.setInt16(off, Math.round(v * 32767), true);
        off += 2;
      }
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;

    // Goertzel magnitude at one frequency: enough to compare a harmonic against
    // the fundamental without pulling in an FFT.
    const magnitudeAt = (data, freq, rate) => {
      const w = (2 * Math.PI * freq) / rate;
      const coeff = 2 * Math.cos(w);
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < data.length; i++) {
        const s = data[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s;
      }
      return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / data.length;
    };

    const measure = (data, rate) => {
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > peak) peak = a;
        sum += data[i] * data[i];
      }
      const fundamental = magnitudeAt(data, 440, rate);
      return {
        peak,
        rms: Math.sqrt(sum / data.length),
        // Clipping a sine generates odd harmonics; a scaled sine does not.
        thirdHarmonicRatio: fundamental > 0 ? magnitudeAt(data, 1320, rate) / fundamental : 0,
      };
    };

    // Guard: if the browser folded the source to stereo on decode, the downmix
    // under test never ran and the assertions below would prove nothing.
    const probeCtx = new Ctx();
    const source = await probeCtx.decodeAudioData(buf.slice(0));
    const sourceChannels = source.numberOfChannels;
    probeCtx.close();

    const file = new File([buf], 'input.wav', { type: 'audio/wav' });
    const { convertAudio } = await import('/js/audio-engine.js');
    const mp3 = await convertAudio(file, 'mp3');

    const outCtx = new Ctx();
    const decoded = await outCtx.decodeAudioData(await mp3.arrayBuffer());
    const stats = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      stats.push(measure(decoded.getChannelData(c), decoded.sampleRate));
    }
    outCtx.close();

    return { sourceChannels, outputChannels: decoded.numberOfChannels, stats };
  }, { amplitudes, sampleRate, seconds });
}

test.describe('multichannel to MP3 downmix', () => {
  test('a loud 5.1 source keeps its waveform instead of clipping flat', async ({ page }) => {
    await page.goto('/wav-to-mp3');
    const { sourceChannels, outputChannels, stats } = await convertAndMeasure(page, [0.75, 0.75, 0.75, 0.75, 0.75, 0.75]);

    expect(sourceChannels).toBe(6);
    expect(outputChannels).toBe(2);

    // Summing 5.1 at 0.75 per channel reaches 1.81, and clamping that to full
    // scale flattens the tone into odd harmonics. Measured third-harmonic ratio
    // is 0.20 when clamped versus 0.00006 when the pair is scaled instead, so
    // this threshold sits three orders of magnitude from both outcomes.
    for (const { peak, thirdHarmonicRatio } of stats) {
      expect(peak).toBeGreaterThan(0.1);
      expect(thirdHarmonicRatio).toBeLessThan(0.02);
    }
  });

  test('a 3-channel center reaches both sides at equal level', async ({ page }) => {
    await page.goto('/wav-to-mp3');
    const { sourceChannels, outputChannels, stats } = await convertAndMeasure(page, [0, 0, 0.6]);

    expect(sourceChannels).toBe(3);
    expect(outputChannels).toBe(2);

    const [left, right] = stats;
    expect(left.rms).toBeGreaterThan(0.02);
    expect(right.rms).toBeGreaterThan(0.02);

    // Splitting channels by even/odd index sent this center to the left only and
    // at half gain, so the right channel came out silent.
    const louder = Math.max(left.rms, right.rms);
    expect(Math.abs(left.rms - right.rms) / louder).toBeLessThan(0.05);
  });
});
