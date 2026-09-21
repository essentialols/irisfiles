import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// #207 routes any archive whose central-directory count disagrees with the
// unique-name count through fflate's streaming Unzip, which reads LOCAL headers
// and registers only DEFLATE. The concern raised in #213 was that a
// duplicate-name archive ALSO using data descriptors or ZIP64 would fail there
// even though unzipSync could read it.
//
// These three fixtures were hand-built to be exactly that case and verified
// valid by Python's zipfile. All three extract correctly, so the concern does
// not reproduce. The tests exist so that stays measured rather than assumed,
// and so an fflate upgrade cannot regress it silently.
const VARIANTS = [
  {
    label: 'data descriptors (bit 3, sizes in a trailing descriptor)',
    zip: 'UEsDBBQACAAIAAAAAAAAAAAAAAAAAAAAAAAHAAAAZHVwLnR4dHPzDAoO0XVx4QIAUEsHCMltm98LAAAACQAAAFBLAwQUAAgACAAAAAAAAAAAAAAAAAAAAAAABwAAAGR1cC50eHQLdnX293PRdXHhAgBQSwcInnfX+QwAAAAKAAAAUEsDBBQACAAIAAAAAAAAAAAAAAAAAAAAAAAJAAAAb3RoZXIudHh0K8hJzMzjAgBQSwcI0PkVOQgAAAAGAAAAUEsBAhQAFAAIAAgAAAAAAMltm98LAAAACQAAAAcAAAAAAAAAAAAAAAAAAAAAAGR1cC50eHRQSwECFAAUAAgACAAAAAAAnnfX+QwAAAAKAAAABwAAAAAAAAAAAAAAAABAAAAAZHVwLnR4dFBLAQIUABQACAAIAAAAAADQ+RU5CAAAAAYAAAAJAAAAAAAAAAAAAAAAAIEAAABvdGhlci50eHRQSwUGAAAAAAMAAwChAAAAwAAAAAAA',
    first: 'FIRST-DD\n',
    second: 'SECOND-DD\n',
  },
  {
    label: 'sizes in the local header, no descriptor',
    zip: 'UEsDBBQAAAAIAAAAAADJbZvfCwAAAAkAAAAHAAAAZHVwLnR4dHPzDAoO0XVx4QIAUEsDBBQAAAAIAAAAAACed9f5DAAAAAoAAAAHAAAAZHVwLnR4dAt2dfb3c9F1ceECAFBLAwQUAAAACAAAAAAA0PkVOQgAAAAGAAAACQAAAG90aGVyLnR4dCvISczM4wIAUEsBAhQAFAAAAAgAAAAAAMltm98LAAAACQAAAAcAAAAAAAAAAAAAAAAAAAAAAGR1cC50eHRQSwECFAAUAAAACAAAAAAAnnfX+QwAAAAKAAAABwAAAAAAAAAAAAAAAAAwAAAAZHVwLnR4dFBLAQIUABQAAAAIAAAAAADQ+RU5CAAAAAYAAAAJAAAAAAAAAAAAAAAAAGEAAABvdGhlci50eHRQSwUGAAAAAAMAAwChAAAAkAAAAAAA',
    first: 'FIRST-DD\n',
    second: 'SECOND-DD\n',
  },
  {
    label: 'ZIP64 extra fields with 0xFFFFFFFF size sentinels',
    zip: 'UEsDBC0AAAAIAAAAAAAFYMZ2//////////8HABQAZHVwLnR4dAEAEAAKAAAAAAAAAAwAAAAAAAAAc/MMCg7RjTIz4QIAUEsDBC0AAAAIAAAAAABI6O+D//////////8HABQAZHVwLnR4dAEAEAALAAAAAAAAAA0AAAAAAAAAC3Z19vdz0Y0yM+ECAFBLAwQtAAAACAAAAAAA0PkVOf//////////CQAUAG90aGVyLnR4dAEAEAAGAAAAAAAAAAgAAAAAAAAAK8hJzMzjAgBQSwECLQAtAAAACAAAAAAABWDGdv//////////BwAcAAAAAAAAAAAAAAD/////ZHVwLnR4dAEAGAAKAAAAAAAAAAwAAAAAAAAAAAAAAAAAAABQSwECLQAtAAAACAAAAAAASOjvg///////////BwAcAAAAAAAAAAAAAAD/////ZHVwLnR4dAEAGAALAAAAAAAAAA0AAAAAAAAARQAAAAAAAABQSwECLQAtAAAACAAAAAAA0PkVOf//////////CQAcAAAAAAAAAAAAAAD/////b3RoZXIudHh0AQAYAAYAAAAAAAAACAAAAAAAAACLAAAAAAAAAFBLBgYsAAAAAAAAAC0ALQAAAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAD1AAAAAAAAAM4AAAAAAAAAUEsGBwAAAADDAQAAAAAAAAEAAABQSwUGAAAAAP///////////////wAA',
    first: 'FIRST-Z64\n',
    second: 'SECOND-Z64\n',
  },
];

for (const variant of VARIANTS) {
  test('duplicate members survive an archive using ' + variant.label, async ({ page }) => {
    await page.goto('/extract-zip');
    await page.locator('#file-input').setInputFiles({
      name: 'duplicates.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(variant.zip, 'base64'),
    });
    await page.locator('#action-btn').click();
    await page.locator('#archive-results').waitFor({ timeout: 20000 });

    await expect(page.locator('#archive-results .file-item__name'))
      .toHaveText(['dup.txt', 'dup (2).txt', 'other.txt']);
    await expect(page.locator('.batch-summary')).toContainText('3 files extracted');

    // Both copies must carry their own bytes, not the same member twice.
    const expected = [['dup.txt', variant.first], ['dup (2).txt', variant.second]];
    for (const [name, body] of expected) {
      const row = page.locator('#archive-results .file-item').filter({ hasText: name });
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        row.locator('.dl-btn').first().click(),
      ]);
      expect(await readFile(await download.path(), 'utf8')).toBe(body);
    }
  });
}
