import fs from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test.setTimeout(120000);

// Genuine 17x15 VP9 WebM encoded as yuv444p. Odd dimensions make the
// compatibility regression explicit: H.264 4:2:0 requires even dimensions.
const ODD_YUV444_WEBM = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAQCEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggPs7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuNy4xMDNXQYxMYXZmNjEuNy4xMDNEiYhAj0AAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIAcwvfN1ZjyqcgQAitZyDdW5kiIEAhoVWX1ZQOYOBASPjg4Q7msoA4JCwgRG6gQ+agQJVsIRVuYEBElTDZ0B/c3OfY8CAZ8iZRaOHRU5DT0RFUkSHjExhdmY2MS43LjEwM3Nz2mPAi2PFiAHML3zdWY8qZ8ilRaOHRU5DT0RFUkSHmExhdmM2MS4xOS4xMDEgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnVCPueBAKNCOIEAAICiSYNCAAAgABzABwSDgwhAAAQAAHeozf/8t4A3Gr23+EUgfW11J2E3/WMZfYa5sewq9ruxGP/8AnWw/OYxvnh/kgUV7ejlXt/QzxuLlMG6apEP//TSKL0T1XRKdN3ICeYb3f/9SV/Cmv/AH9wvyV5igFVP+hQu3U8/eNadXk8wPGVXCqt+iEmD5Im59CZBsZHQWbYkSmTWw36I/f/64DI/3cBRf/hcWV5so+xBf9Hz31n/XVwYM4l31/dm/Io4V7ZRRaedSBb6HtrpgmuTVZi//rFb/3n4i//nkX/NlHE6vE1xdMzDQ//1lWh8i4mj8//n7Bk76tcu7v4jf3uQ2h6gJ//8Vxb9iA+EJtEpNPCwZTNXf/9MnVysIfanlHkcOM/xjRYYo/9B+8cMt/8l2gK6/fSO9Yn8HK3/+d6hH6Ok/E6DfjGmwX//CmR26b/XtoJeO6ULqJ4P+ux9G+GlovcTf6r513pqgBv/1S9GN/RFiGW5y3e/7tf/5YU5v+/Xh/REu/+/KLJ/+L//h3TdwP2Qbbf3s/zbUGR5V7xjEf/lE3//NNV3bWxENKeQvdkudfDS0d9cVPZg+//+OeHzFsjRwvS3VT5SANRmf/K34WwGo/JRo1IrrUAv+WuFEOjXLj65daH/9Plm88G1aCvweCbUtaksBYKTp0ce7PyAUsK3Xk5YH8ocWYqAMF//+xAU///vnKJH//tVy17eyLOnMyabLoWT/X9InDUceIclOSU3PnQ/gAAcU7trkbuPs4EAt4r3gQHxggGo8IED';

test('WebM to MP4 writes broadly compatible 4:2:0 H.264', async ({ page }) => {
  await page.goto('/webm-to-mp4');
  await page.locator('#file-input').setInputFiles({
    name: 'odd-yuv444.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(ODD_YUV444_WEBM, 'base64'),
  });

  await expect(page.locator('.file-item__name')).toHaveText('odd-yuv444.webm');
  await expect(page.locator('#action-btn')).toBeEnabled();
  await page.locator('#action-btn').click();
  await expect(page.locator('.btn-download')).toBeVisible({ timeout: 120000 });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.btn-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('odd-yuv444.mp4');

  const outputPath = await download.path();
  expect(outputPath).toBeTruthy();
  const output = await fs.readFile(outputPath);
  const avcC = output.indexOf(Buffer.from('avcC'));
  expect(avcC).toBeGreaterThan(0);
  // AVC profile_idc 100 = High profile. Before the fix this valid WebM became
  // High 4:4:4 Predictive (profile_idc 244), which is far less compatible.
  expect(output[avcC + 5]).toBe(100);
});
