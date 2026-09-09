import { test, expect } from '@playwright/test';
import { fixture, getFileItemCount } from './helpers.mjs';

test.setTimeout(90000);

// The *-to-gif pages are not generic converters: they run gif-boot.js, which
// has no #converter-config, no #action-btn and no file list, and instead
// reveals trim/fps controls with a preview. They are covered separately below.
const sourceFormats = {
  mp4: { fixture: 'sample.mp4', targets: ['avi', 'mkv', 'mov', 'webm'] },
  // mov-to-mp4 is excluded: MOV and MP4 share a container, so it runs
  // remux-boot.js, which converts on drop with no config element or action
  // button. It is covered separately below.
  mov: { fixture: 'sample.mov', targets: ['avi', 'mkv', 'webm'] },
  avi: { fixture: 'sample.avi', targets: ['mp4', 'mkv', 'mov', 'webm'] },
  mkv: { fixture: 'sample.mp4', targets: ['mp4', 'avi', 'mov', 'webm'] },
  webm: { fixture: 'sample.mp4', targets: ['mp4', 'avi', 'mkv', 'mov'] },
  gif: { fixture: 'sample.gif', targets: ['mp4', 'webm', 'mov', 'avi', 'mkv'] },
};

const GIF_ROUTES = ['/mp4-to-gif', '/mov-to-gif', '/avi-to-gif', '/mkv-to-gif', '/webm-to-gif', '/video-to-gif'];

const fixtureAvailable = {
  mp4: true,
  mov: true,
  avi: true,
  gif: true,
};

test.describe('MP4 Conversions', () => {
  const source = 'mp4';
  const sourceFormats_mp4 = sourceFormats[source];

  sourceFormats_mp4.targets.forEach((target) => {
    const pageUrl = `/mp4-to-${target}`;

    test.describe(`MP4 to ${target.toUpperCase()}`, () => {
      test('page loads with drop zone', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#drop-zone')).toBeVisible();
      });

      test('config has correct target format', async ({ page }) => {
        await page.goto(pageUrl);
        const config = page.locator('#converter-config');
        await expect(config).toHaveAttribute('data-target-format', target);
      });

      test('action button hidden initially', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#action-btn')).not.toBeVisible();
      });

      test('clear all hidden initially', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#clear-all')).not.toBeVisible();
      });

      if (fixtureAvailable[source]) {
        test('shows file item after upload', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture(sourceFormats_mp4.fixture));
          await expect(page.locator('.file-item')).toBeVisible();
          const fileName = page.locator('.file-item__name');
          await expect(fileName).toContainText('sample');
          const size = page.locator('.file-item__meta');
          await expect(size).toBeVisible();
        });

        test('action button appears after upload', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture(sourceFormats_mp4.fixture));
          await expect(page.locator('#action-btn')).toBeVisible();
          await expect(page.locator('#action-btn')).toBeEnabled();
        });

        test('clear all resets state', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture(sourceFormats_mp4.fixture));
          await expect(page.locator('.file-item')).toBeVisible();
          await page.locator('#clear-all').click();
          await expect(page.locator('.file-item')).not.toBeVisible();
          await expect(page.locator('#action-btn')).not.toBeVisible();
        });

        test('second upload replaces first', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture('sample.mp4'));
          let count = await getFileItemCount(page);
          expect(count).toBe(1);
          await page.locator('#file-input').setInputFiles(fixture('sample.mov'));
          count = await getFileItemCount(page);
          expect(count).toBe(1);
        });
      }
    });
  });
});

test.describe('MOV Conversions', () => {
  const source = 'mov';
  const sourceFormats_mov = sourceFormats[source];

  sourceFormats_mov.targets.forEach((target) => {
    const pageUrl = `/mov-to-${target}`;

    test.describe(`MOV to ${target.toUpperCase()}`, () => {
      test('page loads with drop zone', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#drop-zone')).toBeVisible();
      });

      test('config has correct target format', async ({ page }) => {
        await page.goto(pageUrl);
        const config = page.locator('#converter-config');
        await expect(config).toHaveAttribute('data-target-format', target);
      });

      test('action button hidden initially', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#action-btn')).not.toBeVisible();
      });

      test('clear all hidden initially', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#clear-all')).not.toBeVisible();
      });

      if (fixtureAvailable[source]) {
        test('shows file item after upload', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture(sourceFormats_mov.fixture));
          await expect(page.locator('.file-item')).toBeVisible();
          const fileName = page.locator('.file-item__name');
          await expect(fileName).toContainText('sample');
          const size = page.locator('.file-item__meta');
          await expect(size).toBeVisible();
        });

        test('action button appears after upload', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture(sourceFormats_mov.fixture));
          await expect(page.locator('#action-btn')).toBeVisible();
          await expect(page.locator('#action-btn')).toBeEnabled();
        });

        test('clear all resets state', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture(sourceFormats_mov.fixture));
          await expect(page.locator('.file-item')).toBeVisible();
          await page.locator('#clear-all').click();
          await expect(page.locator('.file-item')).not.toBeVisible();
          await expect(page.locator('#action-btn')).not.toBeVisible();
        });

        test('second upload replaces first', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture('sample.mov'));
          let count = await getFileItemCount(page);
          expect(count).toBe(1);
          await page.locator('#file-input').setInputFiles(fixture('sample.mp4'));
          count = await getFileItemCount(page);
          expect(count).toBe(1);
        });
      }
    });
  });
});

test.describe('AVI Conversions', () => {
  const source = 'avi';
  const sourceFormats_avi = sourceFormats[source];

  sourceFormats_avi.targets.forEach((target) => {
    const pageUrl = `/avi-to-${target}`;

    test.describe(`AVI to ${target.toUpperCase()}`, () => {
      test('page loads with drop zone', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#drop-zone')).toBeVisible();
      });

      test('config has correct target format', async ({ page }) => {
        await page.goto(pageUrl);
        const config = page.locator('#converter-config');
        await expect(config).toHaveAttribute('data-target-format', target);
      });

      test('action button hidden initially', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#action-btn')).not.toBeVisible();
      });

      test('clear all hidden initially', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#clear-all')).not.toBeVisible();
      });

      if (fixtureAvailable[source]) {
        test('shows file item after upload', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture(sourceFormats_avi.fixture));
          await expect(page.locator('.file-item')).toBeVisible();
          const fileName = page.locator('.file-item__name');
          await expect(fileName).toContainText('sample');
          const size = page.locator('.file-item__meta');
          await expect(size).toBeVisible();
        });

        test('action button appears after upload', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture(sourceFormats_avi.fixture));
          await expect(page.locator('#action-btn')).toBeVisible();
          await expect(page.locator('#action-btn')).toBeEnabled();
        });

        test('clear all resets state', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture(sourceFormats_avi.fixture));
          await expect(page.locator('.file-item')).toBeVisible();
          await page.locator('#clear-all').click();
          await expect(page.locator('.file-item')).not.toBeVisible();
          await expect(page.locator('#action-btn')).not.toBeVisible();
        });

        test('second upload replaces first', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture('sample.avi'));
          let count = await getFileItemCount(page);
          expect(count).toBe(1);
          await page.locator('#file-input').setInputFiles(fixture('sample.mp4'));
          count = await getFileItemCount(page);
          expect(count).toBe(1);
        });
      }
    });
  });
});

test.describe('MKV Conversions', () => {
  const source = 'mkv';
  const sourceFormats_mkv = sourceFormats[source];

  sourceFormats_mkv.targets.forEach((target) => {
    const pageUrl = `/mkv-to-${target}`;

    test.describe(`MKV to ${target.toUpperCase()}`, () => {
      test('page loads with drop zone', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#drop-zone')).toBeVisible();
      });

      test('config has correct target format', async ({ page }) => {
        await page.goto(pageUrl);
        const config = page.locator('#converter-config');
        await expect(config).toHaveAttribute('data-target-format', target);
      });

      test('action button hidden initially', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#action-btn')).not.toBeVisible();
      });

      test('clear all hidden initially', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#clear-all')).not.toBeVisible();
      });

      test('page structure correct', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#drop-zone')).toBeVisible();
        await expect(page.locator('#converter-config')).toBeAttached();
        await expect(page.locator('#action-btn')).not.toBeVisible();
        await expect(page.locator('#clear-all')).not.toBeVisible();
      });
    });
  });
});

test.describe('WebM Conversions', () => {
  const source = 'webm';
  const sourceFormats_webm = sourceFormats[source];

  sourceFormats_webm.targets.forEach((target) => {
    const pageUrl = `/webm-to-${target}`;

    test.describe(`WebM to ${target.toUpperCase()}`, () => {
      test('page loads with drop zone', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#drop-zone')).toBeVisible();
      });

      test('config has correct target format', async ({ page }) => {
        await page.goto(pageUrl);
        const config = page.locator('#converter-config');
        await expect(config).toHaveAttribute('data-target-format', target);
      });

      test('action button hidden initially', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#action-btn')).not.toBeVisible();
      });

      test('clear all hidden initially', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#clear-all')).not.toBeVisible();
      });

      test('page structure correct', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#drop-zone')).toBeVisible();
        await expect(page.locator('#converter-config')).toBeAttached();
        await expect(page.locator('#action-btn')).not.toBeVisible();
        await expect(page.locator('#clear-all')).not.toBeVisible();
      });
    });
  });
});

test.describe('GIF Conversions', () => {
  const source = 'gif';
  const sourceFormats_gif = sourceFormats[source];

  sourceFormats_gif.targets.forEach((target) => {
    const pageUrl = `/gif-to-${target}`;

    test.describe(`GIF to ${target.toUpperCase()}`, () => {
      test('page loads with drop zone', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#drop-zone')).toBeVisible();
      });

      test('config has correct target format', async ({ page }) => {
        await page.goto(pageUrl);
        const config = page.locator('#converter-config');
        await expect(config).toHaveAttribute('data-target-format', target);
      });

      test('config has gif source type', async ({ page }) => {
        await page.goto(pageUrl);
        const config = page.locator('#converter-config');
        await expect(config).toHaveAttribute('data-source-type', 'gif');
      });

      test('action button hidden initially', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#action-btn')).not.toBeVisible();
      });

      test('clear all hidden initially', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#clear-all')).not.toBeVisible();
      });

      if (fixtureAvailable[source]) {
        test('shows file item after upload', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture(sourceFormats_gif.fixture));
          await expect(page.locator('.file-item')).toBeVisible();
          const fileName = page.locator('.file-item__name');
          await expect(fileName).toContainText('sample');
          const size = page.locator('.file-item__meta');
          await expect(size).toBeVisible();
        });

        test('action button appears after upload', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture(sourceFormats_gif.fixture));
          await expect(page.locator('#action-btn')).toBeVisible();
          await expect(page.locator('#action-btn')).toBeEnabled();
        });

        test('clear all resets state', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture(sourceFormats_gif.fixture));
          await expect(page.locator('.file-item')).toBeVisible();
          await page.locator('#clear-all').click();
          await expect(page.locator('.file-item')).not.toBeVisible();
          await expect(page.locator('#action-btn')).not.toBeVisible();
        });

        test('second upload replaces first', async ({ page }) => {
          await page.goto(pageUrl);
          await page.locator('#file-input').setInputFiles(fixture('sample.gif'));
          let count = await getFileItemCount(page);
          expect(count).toBe(1);
          await page.locator('#file-input').setInputFiles(fixture('sample.mp4'));
          count = await getFileItemCount(page);
          expect(count).toBe(1);
        });
      }
    });
  });
});

test.describe('MOV to MP4 (remux)', () => {
  const pageUrl = '/mov-to-mp4';

  test('page loads with drop zone', async ({ page }) => {
    await page.goto(pageUrl);
    await expect(page.locator('#drop-zone')).toBeVisible();
  });

  test('remuxes on drop without an action button', async ({ page }) => {
    await page.goto(pageUrl);
    await expect(page.locator('#action-btn')).toHaveCount(0);
    await page.locator('#file-input').setInputFiles(fixture('sample.mov'));
    await expect(page.locator('.file-item.done')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.btn-download')).toBeVisible();
  });

  test('clear all resets state', async ({ page }) => {
    await page.goto(pageUrl);
    await page.locator('#file-input').setInputFiles(fixture('sample.mov'));
    await expect(page.locator('.file-item')).toBeVisible();
    await page.locator('#clear-all').click();
    await expect(page.locator('.file-item')).toHaveCount(0);
  });
});

test.describe('Video to GIF', () => {
  // gif-boot pages reveal trim/fps controls and a preview instead of the
  // converter's file list, so they are asserted against that contract.
  for (const pageUrl of GIF_ROUTES) {
    test.describe(pageUrl, () => {
      test('page loads with a drop zone, convert button waiting inside the controls', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#drop-zone')).toBeVisible();
        // The button lives inside #gif-controls, which is hidden until a video
        // is added, so it is present but not yet visible.
        await expect(page.locator('#convert-btn')).toBeAttached();
        await expect(page.locator('#convert-btn')).toBeHidden();
      });

      test('trim and fps controls stay hidden until a video is added', async ({ page }) => {
        await page.goto(pageUrl);
        await expect(page.locator('#gif-controls')).toBeHidden();
      });

      test('adding a video reveals the controls and previews it', async ({ page }) => {
        await page.goto(pageUrl);
        await page.locator('#file-input').setInputFiles(fixture('sample.mp4'));
        await expect(page.locator('#gif-controls')).toBeVisible();
        await expect(page.locator('#convert-btn')).toBeVisible();
        // The preview is wired to an object URL for the uploaded video.
        await expect
          .poll(() => page.locator('#gif-video').evaluate(el => el.src))
          .toMatch(/^blob:/);
        await expect(page.locator('#fps-value')).not.toBeEmpty();
        await expect(page.locator('#width-value')).not.toBeEmpty();
      });

      test('result area stays empty until a conversion runs', async ({ page }) => {
        await page.goto(pageUrl);
        await page.locator('#file-input').setInputFiles(fixture('sample.mp4'));
        await expect(page.locator('#gif-controls')).toBeVisible();
        await expect(page.locator('#gif-result')).toBeHidden();
      });
    });
  }
});
