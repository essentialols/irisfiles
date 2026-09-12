import { test, expect } from '@playwright/test';

test('file picker normalizes known signature-catalog spelling errors', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('#route-panel');

  await panel.evaluate((element) => {
    element.innerHTML = '<div title="CANNON EOS JPEG FILE | Symantex Ghost image file">CANNON EOS JPEG FILE · Symantex Ghost image file · Quatro Pro for Windows 7.0 · ZoneAlam data file</div>';
    element.style.display = '';
  });

  await expect(panel).toContainText('CANON EOS JPEG FILE');
  await expect(panel).toContainText('Symantec Ghost image file');
  await expect(panel).toContainText('Quattro Pro for Windows 7.0');
  await expect(panel).toContainText('ZoneAlarm data file');
  await expect(panel).not.toContainText(/CANNON|Symantex|Quatro|ZoneAlam/);
  await expect(panel.locator('[title]')).toHaveAttribute('title', 'CANON EOS JPEG FILE | Symantec Ghost image file');
});
