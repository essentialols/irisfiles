import { test, expect } from '@playwright/test';

test('FFmpeg script load can retry after a network failure', async ({ page }) => {
  await page.goto('/mp4-to-webm');

  const result = await page.evaluate(async () => {
    const scriptUrl = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js';
    const originalAppendChild = document.head.appendChild.bind(document.head);
    const originalFetch = window.fetch;
    let attempts = 0;

    document.head.appendChild = (node) => {
      const result = originalAppendChild(node);
      if (node.tagName === 'SCRIPT' && node.src === scriptUrl) {
        attempts++;
        queueMicrotask(() => {
          if (attempts === 1) {
            node.onerror();
          } else {
            window.FFmpegWASM = {
              FFmpeg: class {
                async load() {}
              },
            };
            node.onload();
          }
        });
      }
      return result;
    };
    window.fetch = async () => new Response('worker');

    const { withFFmpeg } = await import('/js/ffmpeg-shared.js');
    let firstError;
    try {
      await withFFmpeg(() => 'unexpected');
    } catch (error) {
      firstError = error.message;
    }
    const failedScripts = document.querySelectorAll(`script[src="${scriptUrl}"]`).length;
    const retryResult = await withFFmpeg(() => 'converted');

    document.head.appendChild = originalAppendChild;
    window.fetch = originalFetch;
    return { attempts, firstError, failedScripts, retryResult };
  });

  expect(result.firstError).toContain('Failed to load video converter');
  expect(result.failedScripts).toBe(0);
  expect(result.attempts).toBe(2);
  expect(result.retryResult).toBe('converted');
});

test('lamejs script load can retry after a network failure', async ({ page }) => {
  await page.goto('/wav-to-mp3');

  const result = await page.evaluate(async () => {
    const scriptUrl = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
    const originalAppendChild = document.head.appendChild.bind(document.head);
    let attempts = 0;

    class AudioContextStub {
      async decodeAudioData() {
        return {
          numberOfChannels: 1,
          sampleRate: 44100,
          length: 1,
          getChannelData: () => new Float32Array([0]),
        };
      }

      close() {}
    }

    window.AudioContext = AudioContextStub;
    document.head.appendChild = (node) => {
      const result = originalAppendChild(node);
      if (node.tagName === 'SCRIPT' && node.src === scriptUrl) {
        attempts++;
        queueMicrotask(() => {
          if (attempts === 1) {
            node.onerror();
          } else {
            window.lamejs = {
              Mp3Encoder: class {
                encodeBuffer() {
                  return new Int8Array([1]);
                }

                flush() {
                  return new Int8Array();
                }
              },
            };
            node.onload();
          }
        });
      }
      return result;
    };

    const file = new File([new Uint8Array([0])], 'sample.wav', { type: 'audio/wav' });
    const { convertAudio } = await import('/js/audio-engine.js');
    let firstError;
    try {
      await convertAudio(file, 'mp3');
    } catch (error) {
      firstError = error.message;
    }
    const failedScripts = document.querySelectorAll(`script[src="${scriptUrl}"]`).length;
    const retryResult = await convertAudio(file, 'mp3');

    document.head.appendChild = originalAppendChild;
    return { attempts, firstError, failedScripts, retrySize: retryResult.size };
  });

  expect(result.firstError).toContain('Failed to load MP3 encoder');
  expect(result.failedScripts).toBe(0);
  expect(result.attempts).toBe(2);
  expect(result.retrySize).toBeGreaterThan(0);
});
