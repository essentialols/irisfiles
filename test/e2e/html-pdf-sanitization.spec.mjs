import { test, expect } from '@playwright/test';

function embeddedSvgDataUrl() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="20"><rect width="32" height="20" fill="#087a5b"/></svg>';
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

async function installRendererProbe(page) {
  await page.evaluate(() => {
    window.__htmlPdfSanitizedStyles = null;

    window.html2canvas = async root => {
      const view = root.ownerDocument.defaultView;
      const background = id => view.getComputedStyle(root.querySelector(id)).backgroundImage;
      window.__htmlPdfSanitizedStyles = {
        stylesheetEmbedded: background('#stylesheet-embedded'),
        inlineEmbedded: background('#inline-embedded'),
        stylesheetRemote: background('#stylesheet-remote'),
        inlineRemote: background('#inline-remote'),
      };
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 120;
      return canvas;
    };

    class FakeJsPDF {
      constructor() {
        this.internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } };
      }
      addPage() {}
      addImage() {}
      output() {
        return new Blob(['%PDF-1.4\n% embedded CSS sanitizer regression\n%%EOF\n'], { type: 'application/pdf' });
      }
    }
    window.jspdf = { jsPDF: FakeJsPDF };
  });
}

test('HTML to PDF preserves embedded CSS images while stripping remote URLs', async ({ page }) => {
  await page.goto('/html-to-pdf');
  await installRendererProbe(page);

  const dataUrl = embeddedSvgDataUrl();
  const html = `<!doctype html>
    <meta charset="utf-8">
    <style>
      #stylesheet-embedded { width:32px; height:20px; background-image:url("${dataUrl}"); }
      #stylesheet-remote { width:32px; height:20px; background-image:url("https://example.invalid/stylesheet.png"); }
    </style>
    <div id="stylesheet-embedded">embedded stylesheet image</div>
    <div id="stylesheet-remote">remote stylesheet image</div>
    <div id="inline-embedded" style="width:32px;height:20px;background-image:url('DATA:image/svg+xml;base64,${dataUrl.split(',')[1]}')">embedded inline image</div>
    <div id="inline-remote" style="width:32px;height:20px;background-image:url('https://example.invalid/inline.png')">remote inline image</div>`;

  await page.locator('#file-input').setInputFiles({
    name: 'Résumé_日本語-self-contained.html',
    mimeType: 'text/html',
    buffer: Buffer.from(html),
  });
  await page.locator('#action-btn').click();

  await expect.poll(() => page.evaluate(() => window.__htmlPdfSanitizedStyles)).not.toBeNull();
  const styles = await page.evaluate(() => window.__htmlPdfSanitizedStyles);

  expect(styles.stylesheetEmbedded).toContain('data:image/svg+xml');
  expect(styles.inlineEmbedded).toContain('data:image/svg+xml');
  expect(styles.stylesheetRemote).toBe('none');
  expect(styles.inlineRemote).toBe('none');

  await expect(page.locator('#html-pdf-result .file-item__name')).toHaveText('Résumé_日本語-self-contained.pdf');
  await expect(page.locator('#html-pdf-download')).toBeVisible();
});

test('HTML to PDF never requests remote CSS url() targets', async ({ page }) => {
  // route() only sees requests that got past the page's CSP.
  const leaked = [];
  await page.route('**://example.invalid/**', route => {
    leaked.push(route.request().url());
    return route.abort();
  });
  await page.goto('/html-to-pdf');
  await installRendererProbe(page);

  // Plain, quoted, upper-case and CSS-escaped (u\72l = url) spellings, in a
  // stylesheet and an inline style. The escaped one survives the regex, so it
  // is the CSP that has to hold (Chromium reports those as failed with "csp");
  // this is a guard test, not a change detector.
  const html = `<!doctype html>
    <meta charset="utf-8">
    <style>
      #stylesheet-embedded { background-image:url(https://example.invalid/a.png); }
      #stylesheet-remote { background-image:URL( "https://example.invalid/b.png" ); }
      @font-face { font-family:x; src:url(https://example.invalid/c.woff2); }
      body { font-family:x; }
    </style>
    <div id="stylesheet-embedded" style="background-image:u\\72l(https://example.invalid/d.png)">a</div>
    <div id="stylesheet-remote">b</div>
    <div id="inline-embedded" style="background-image:url(//example.invalid/e.png)">c</div>
    <div id="inline-remote" style="background:u\\72l('https://example.invalid/f.png')">d</div>`;

  await page.locator('#file-input').setInputFiles({ name: 'remote.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  await page.locator('#action-btn').click();
  await expect(page.locator('#html-pdf-download')).toBeVisible();
  expect(leaked).toEqual([]);
});
