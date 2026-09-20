import fs from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

// Genuine 17x15 VP9 WebM encoded as yuv444p. The odd dimensions make both
// parts of the compatibility contract observable: 4:2:0 needs even dimensions,
// and without an explicit pixel format libx264 inherits the source's 4:4:4.
const ODD_YUV444_WEBM = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAPpEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggPT7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAf0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WImno3S88gyCOcgQAitZyDdW5kiIEAhoVWX1ZQOYOBASPjg4QHc1lA4JCwgRG6gQ+agQJVsIRVuYEBElTDZ0B/c3OfY8CAZ8iZRaOHRU5DT0RFUkSHjExhdmY2MS43LjEwM3Nz2mPAi2PFiJp6N0vPIMgjZ8ilRaOHRU5DT0RFUkSHmExhdmM2MS4xOS4xMDEgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDAuNTAwMDAwMDAwAB9DtnVCJeeBAKNBuoEAAICiSYNCAAAgABzABwSDgxGAAAQAAH5Gdo//GNpDid+YCyge+ftfsgX5pAafb1vO/r7nybP0SF8LS4+DUfC2YNvZRcf/4V6HCVOEkMPKdhHWsGD/8SHMmPSdb8X7EpI8s+LDduKOT3FlXU/cp2T03D3ONXa7kKUicqF9awVeT4fHf/6nhLoxGt/jCoR0MUEehwvytexF7oFZJ3/X/AI/svvvnbWC9qzMGuh5zqSskvGVzSs2jgqTLrwQA19/3ytdLWviNDpPdoYXTA/A3V9Y5a/sIC9dNZLY/BgL6d//WnQt0nUGETh0vIAVa76AiD0fpy+7Ve6n++ebP/fmnIG+Bpv6eP7//5cxXkH/HKSQWmtoLG48oS8p2bYhEscCEURVq+bJQ6BQaRaNOnw/6M20yK/+ZLuFHVwjkKCzfv4GeB0saOku6p/+GDB6PA4RfxD7+MrrtEiBzC///kmawYMiE0+eF5guv/k4RrIbkdVwvwEW2uDWdnZvbObL3xTzFO3cy2mnBvV4lbxgikOI455n+IegPZ+fuHRuk8Y//VAU7YrcKVPwLHHZwnKSW4UQ2fpBnE+qX5PxVgCjloEAfQCmAECSnABUAAADIAAAU3zv6gCjs4EA+gCmAECSnABS4AADIAAAKPiiEumHl7hAsdJ0CrJmFuqSObtC+Q9fXNPqh1bP4YnsAKOWgQF3AKYAQJKcAFQAAAMgAABQOyzbABxTu2uRu4+zgQC3iveBAfGCAajwgQM=';

test('Video Speed writes broadly compatible 4:2:0 H.264', async ({ page }) => {
  await page.goto('/video-speed');
  await page.locator('#file-input').setInputFiles({
    name: 'odd-yuv444.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(ODD_YUV444_WEBM, 'base64'),
  });

  await expect(page.locator('.file-item__name')).toHaveText('odd-yuv444.webm');
  await expect(page.locator('#action-btn')).toBeEnabled();
  await page.locator('#speed-preset').selectOption('2');
  await page.locator('#keep-audio').uncheck();
  await page.locator('#action-btn').click();
  await expect(page.locator('.btn-download')).toBeVisible({ timeout: 120_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.btn-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('odd-yuv444-timelapse.mp4');

  const outputPath = await download.path();
  expect(outputPath).toBeTruthy();
  const output = await fs.readFile(outputPath);
  expect(output.indexOf(Buffer.from('ftyp'))).toBeGreaterThan(0);

  const avcC = output.indexOf(Buffer.from('avcC'));
  expect(avcC).toBeGreaterThan(0);
  // AVC profile_idc 100 = High profile. Before the fix this input becomes
  // High 4:4:4 Predictive (244). A successful 4:2:0 encode also proves the
  // 17x15 source was padded to even dimensions rather than rejected.
  expect(output[avcC + 5]).toBe(100);
});
