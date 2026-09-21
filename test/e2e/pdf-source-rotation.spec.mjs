import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees } from 'pdf-lib';
import { test, expect } from '@playwright/test';

async function makeRotatedPdf(angle = 90) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date('2000-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2000-01-01T00:00:00Z'));
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(`Source rotation ${angle} degrees`, { x: 72, y: 700, size: 24, font });
  page.setRotation(degrees(angle));
  return Buffer.from(await doc.save());
}

// pdf-lib's setRotation refuses anything that is not a multiple of 90, so these
// awkward /Rotate values have to be written onto the page dictionary directly.
async function makeRawRotatedPdf(angle) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date('2000-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2000-01-01T00:00:00Z'));
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(`Source rotation ${angle} degrees`, { x: 72, y: 700, size: 24, font });
  page.node.set(PDFName.of('Rotate'), PDFNumber.of(angle));
  return Buffer.from(await doc.save());
}

async function rotateOnceAndSave(page, name, buffer) {
  await page.goto('/rotate-pdf');
  await page.locator('#file-input').setInputFiles({ name, mimeType: 'application/pdf', buffer });
  const card = page.locator('.pdf-page-card').first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  const badgeBefore = await card.locator('.pdf-page-card__badge').textContent();
  await card.getByRole('button', { name: /Rotate page 1 90 degrees clockwise/ }).click();
  const badgeAfter = await card.locator('.pdf-page-card__badge').textContent();
  await page.locator('#action-btn').click();
  const downloadButton = page.locator('#pdf-result-download');
  await expect(downloadButton).toBeVisible({ timeout: 15_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    downloadButton.click(),
  ]);
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const output = await PDFDocument.load(await readFile(downloadedPath));
  return { badgeBefore, badgeAfter, angle: output.getPage(0).getRotation().angle };
}

test.describe('Rotate PDF existing page rotation', () => {
  test('badge and accessible label show the effective angle that will be saved', async ({ page }) => {
    await page.goto('/rotate-pdf');
    await page.locator('#file-input').setInputFiles({
      name: 'already-rotated.pdf',
      mimeType: 'application/pdf',
      buffer: await makeRotatedPdf(90),
    });

    const card = page.locator('.pdf-page-card').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const action = page.locator('#action-btn');
    const rotate = card.getByRole('button', { name: /Rotate page 1 90 degrees clockwise/ });

    await expect(card.locator('.pdf-page-card__badge')).toHaveText('90°');
    await expect(rotate).toHaveAttribute('aria-label', /Current rotation 90 degrees/);
    await expect(action).toBeDisabled();

    await rotate.click();
    await expect(card.locator('.pdf-page-card__badge')).toHaveText('180°');
    await expect(rotate).toHaveAttribute('aria-label', /Current rotation 180 degrees/);
    expect(await card.locator('img').evaluate(img => img.style.transform)).toBe('rotate(90deg)');
    await expect(action).toBeEnabled();

    await action.click();
    const downloadButton = page.locator('#pdf-result-download');
    await expect(downloadButton).toBeVisible({ timeout: 15_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadButton.click(),
    ]);
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    const output = await PDFDocument.load(await readFile(downloadedPath));
    expect(output.getPage(0).getRotation().angle).toBe(180);
  });

  test('a source rotation that is not a multiple of 90 still saves, matching the badge', async ({ page }) => {
    const result = await rotateOnceAndSave(page, 'skewed.pdf', await makeRawRotatedPdf(45));
    expect(result.badgeBefore).toBe('0°');
    expect(result.badgeAfter).toBe('90°');
    expect(result.angle).toBe(90);
  });

  test('a negative source rotation does not produce a negative angle in the output', async ({ page }) => {
    const result = await rotateOnceAndSave(page, 'negative.pdf', await makeRawRotatedPdf(-270));
    expect(result.badgeBefore).toBe('90°');
    expect(result.badgeAfter).toBe('180°');
    expect(result.angle).toBe(180);
  });
});