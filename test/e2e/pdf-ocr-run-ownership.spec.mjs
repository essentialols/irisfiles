import { test, expect } from '@playwright/test';

const TEXT_PDF = Buffer.from(
  'JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA1MDAgMjUwIF0gL1BhcmVudCA2IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNiAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwOTIyMDUwNjE3KzAwJzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwOTIyMDUwNjE3KzAwJzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAyMjcKPj4Kc3RyZWFtCkdhclcxYjZsKj8nTF9cRWBAVFBuMkNhTTgnYW9VOWVFW0A4YWMyOmc4U05kO15HZT1sL25BPyoxVygyYC80bUtbMjhHKSdjMzssaEEwPktaKS8rZDdvaG1FVmRxUSpWIyY7TjJcJkVvO2ZINiVFQWROP0llc1xHdGY7dFx0Q0lbQjNLXmcpVmxONyhKXC1uUj07XU1OU1ZwUEtkInFDU0RqclhZKTJQYFMhU09SSDpqMjBSVUJcT2c3ZFdtMz9bLClyc190PSw7b04tZFAtOWUoUHEuXlQ2UVw0LS45bloiQX4+ZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgOAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNjEgMDAwMDAgbiAKMDAwMDAwMDA5MiAwMDAwMCBuIAowMDAwMDAwMTk5IDAwMDAwIG4gCjAwMDAwMDAzOTIgMDAwMDAgbiAKMDAwMDAwMDQ2MCAwMDAwMCBuIAowMDAwMDAwNzIxIDAwMDAwMCBuIAowMDAwMDAwNzgwIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPDFjMDM3M2NiMTQ3Yjk3NDI4NzQxNTEzYmIyZTcxYzFhPjwxYzAzNzNjYjE0N2I5NzQyODc0MTUxM2JiMmU3MWMxYT5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNSAwIFIKL1Jvb3QgNCAwIFIKL1NpemUgOAo+PgpzdGFydHhyZWYKMTA5NwolJUVPRgo=',
  'base64'
);

async function installSlowFirstRead(page) {
  await page.addInitScript(() => {
    const original = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function (...args) {
      const read = original.apply(this, args);
      if (this instanceof File && this.name === 'first.pdf') {
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            read.then(value => {
              window.__firstPdfReadDone = true;
              resolve(value);
            }, reject);
          }, 700);
        });
      }
      return read;
    };
  });
}

test.describe('PDF OCR run ownership', () => {
  test('replacing the PDF during extraction cannot publish the old result under the new file', async ({ page }) => {
    await installSlowFirstRead(page);
    await page.goto('/pdf-ocr');

    await page.locator('#file-input').setInputFiles({
      name: 'first.pdf',
      mimeType: 'application/pdf',
      buffer: TEXT_PDF,
    });
    await page.locator('#action-btn').click();
    await expect(page.locator('#action-btn')).toBeDisabled();

    await page.locator('#file-input').setInputFiles({
      name: 'second.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% deliberately not converted in this test\n'),
    });

    await expect(page.locator('.file-item__name')).toHaveText('second.pdf');
    await expect(page.locator('#action-btn')).toBeEnabled();
    await expect(page.locator('#action-btn')).toHaveText('Extract Text');
    await expect(page.locator('#ocr-lang')).toBeEnabled();
    await expect(page.locator('#ocr-progress')).toBeHidden();
    await expect(page.locator('#ocr-results')).toBeHidden();

    await page.waitForFunction(() => window.__firstPdfReadDone === true);
    await page.waitForTimeout(1500);

    await expect(page.locator('.file-item__name')).toHaveText('second.pdf');
    await expect(page.locator('#ocr-results')).toBeHidden();
    await expect(page.locator('#ocr-progress')).toBeHidden();
    await expect(page.locator('#action-btn')).toBeEnabled();
  });

  test('clearing during extraction keeps the cleared state after the old run finishes', async ({ page }) => {
    await installSlowFirstRead(page);
    await page.goto('/pdf-ocr');

    await page.locator('#file-input').setInputFiles({
      name: 'first.pdf',
      mimeType: 'application/pdf',
      buffer: TEXT_PDF,
    });
    await page.locator('#action-btn').click();
    await page.locator('#clear-all').click();

    await expect(page.locator('.file-item')).toHaveCount(0);
    await expect(page.locator('#action-btn')).toBeHidden();
    await expect(page.locator('#ocr-progress')).toBeHidden();
    await expect(page.locator('#ocr-results')).toBeHidden();

    await page.waitForFunction(() => window.__firstPdfReadDone === true);
    await page.waitForTimeout(1500);

    await expect(page.locator('.file-item')).toHaveCount(0);
    await expect(page.locator('#action-btn')).toBeHidden();
    await expect(page.locator('#ocr-progress')).toBeHidden();
    await expect(page.locator('#ocr-results')).toBeHidden();
  });
});
