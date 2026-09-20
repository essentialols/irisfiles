import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

test('MOBI to TXT preserves headings, paragraphs, line breaks, and preformatted text', async ({ page }) => {
  await page.goto('/mobi-to-txt');
  await page.locator('#file-input').setInputFiles(fixture('sample.mobi'));

  await page.locator('#action-btn').click();
  const downloadButton = page.locator('#dl-doc');
  await expect(downloadButton).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadButton.click(),
  ]);

  expect(download.suggestedFilename()).toBe('sample.txt');
  const output = await readFile(await download.path(), 'utf8');
  expect(output).toBe([
    'Chapter α',
    'First paragraph.',
    'Second line',
    'after break.',
    'A  B',
    'C',
  ].join('\n'));
});
