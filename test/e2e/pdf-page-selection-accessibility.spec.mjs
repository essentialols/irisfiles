import { test, expect } from '@playwright/test';

function multiPagePdf(labels = ['ALPHA', 'BRAVO', 'CHARLIE']) {
  const objects = [];
  const add = value => { objects.push(value); return objects.length; };
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES_PLACEHOLDER');
  const pageIds = [];

  for (const label of labels) {
    const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    const stream = `BT /F1 28 Tf 72 400 Td (${label}) Tj ET`;
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }

  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets[i + 1] = Buffer.byteLength(pdf);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

async function loadPages(page, path) {
  await page.goto(path);
  await page.locator('#file-input').setInputFiles({
    name: 'three-pages.pdf',
    mimeType: 'application/pdf',
    buffer: multiPagePdf(),
  });
  await expect(page.locator('.pdf-page-card')).toHaveCount(3, { timeout: 15000 });
}

test.describe('PDF page selection accessibility', () => {
  test('delete page cards support keyboard selection and preserve focus', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await loadPages(page, '/delete-pdf-pages');

    await expect(page.locator('#action-btn')).toBeDisabled();
    const pageTwo = page.getByRole('button', { name: 'Page 2: keep' });
    await expect(pageTwo).toHaveAttribute('aria-pressed', 'false');
    await pageTwo.focus();
    await page.keyboard.press('Space');

    const selected = page.getByRole('button', { name: 'Page 2: selected for deletion' });
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(selected).toBeFocused();
    await expect(selected.locator('.pdf-page-card__badge')).toHaveText('Will delete');
    await expect(page.locator('#action-btn')).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('extract cards expose selection state and work at narrow mobile widths', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await loadPages(page, '/extract-pdf-pages');

    await expect(page.locator('#action-btn')).toBeDisabled();
    const pageThree = page.getByRole('button', { name: 'Page 3: skip' });
    await pageThree.focus();
    await page.keyboard.press('Enter');

    const selected = page.getByRole('button', { name: 'Page 3: selected for extraction' });
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await expect(selected).toBeFocused();
    await expect(selected.locator('.pdf-page-card__badge')).toHaveText('Will extract');
    await expect(page.locator('#action-btn')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
