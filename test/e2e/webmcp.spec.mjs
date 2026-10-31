import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { fixture } from './helpers.mjs';

// No shipping agent consumes WebMCP yet, so these tests play the agent: a stub
// document.modelContext records what the page registers, and the test calls the
// tools' execute() the way a browser agent would.
async function installAgentStub(page) {
  await page.addInitScript(() => {
    const tools = new Map();
    window.__webmcpTools = tools;
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool(descriptor) { tools.set(descriptor.name, descriptor); } },
    });
  });
}

async function callTool(page, name, args = {}) {
  const raw = await page.evaluate(async ([toolName, toolArgs]) => {
    const tool = window.__webmcpTools.get(toolName);
    if (!tool) throw new Error(`tool ${toolName} not registered`);
    return tool.execute(toolArgs);
  }, [name, args]);
  expect(typeof raw).toBe('string');
  return JSON.parse(raw);
}

async function registeredTools(page) {
  await expect.poll(() => page.evaluate(() => window.__webmcpTools.size)).toBeGreaterThan(0);
  return page.evaluate(() => Array.from(window.__webmcpTools.keys()).sort());
}

async function fileArg(name) {
  return { name, data_base64: (await readFile(fixture(name))).toString('base64') };
}

test.describe('WebMCP page tools', () => {
  test('does nothing in a browser without WebMCP', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/js/webmcp.js');
    await page.goto('/png-to-jpg');
    expect((await loaded).status()).toBe(200);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => 'modelContext' in document)).toBe(false);
    // The module really ran (a 404 or a throw at import would otherwise pass):
    // importing it again hits the cache, and with no WebMCP it registers nothing.
    const outcome = await page.evaluate(async () => {
      const mod = await import('/js/webmcp.js');
      return { context: mod.getModelContext(), registered: mod.registerPageTools() };
    });
    expect(outcome).toEqual({ context: null, registered: null });
    expect(errors).toEqual([]);
  });

  test('landing registers catalog tools but not convert_files', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/');
    expect(await registeredTools(page)).toEqual(['find_tool', 'get_page_info']);

    const result = await callTool(page, 'find_tool', { query: 'convert HEIC to JPEG' });
    expect(result.tools[0].url).toMatch(/\/heic-to-jpg$/);
    expect(result.tools[0].name).toBe('HEIC to JPG');

    const merge = await callTool(page, 'find_tool', { query: 'merge pdf' });
    expect(merge.tools.map(t => new URL(t.url).pathname)).toContain('/merge-pdf');

    const none = await callTool(page, 'find_tool', { query: 'definitely-not-a-format' });
    expect(none.count).toBe(0);
  });

  test('tool page describes itself', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/heic-to-jpg');
    expect(await registeredTools(page)).toEqual(['convert_files', 'find_tool', 'get_page_info']);
    const info = await callTool(page, 'get_page_info');
    expect(info.is_tool_page).toBe(true);
    expect(info.accepts).toContain('.heic');
    expect(info.multiple_files).toBe(true);
    expect(info.quality_control).toMatchObject({ min: 10, max: 100 });
    expect(info.faq.length).toBeGreaterThan(0);
  });

  test('convert_files runs an auto-converting image page and returns the JPG without a real download', async ({ page }) => {
    await installAgentStub(page);
    let downloads = 0;
    page.on('download', () => { downloads += 1; });
    await page.goto('/png-to-jpg');
    await registeredTools(page);

    const result = await callTool(page, 'convert_files', { files: [await fileArg('sample.png')], quality: 75 });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.quality).toBe(75);
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].name).toBe('sample.jpg');
    const bytes = Buffer.from(result.outputs[0].data_base64, 'base64');
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(downloads).toBe(0);

    // The person sees the same result as if they had dropped the file.
    await expect(page.locator('.file-item.done')).toHaveCount(1);
    // Normal download buttons still download after the agent call.
    const download = page.waitForEvent('download');
    await page.locator('.file-item.done .btn-download').first().click();
    expect((await download).suggestedFilename()).toBe('sample.jpg');
  });

  test('a second call returns only its own outputs', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/png-to-webp');
    await registeredTools(page);
    const first = await callTool(page, 'convert_files', { files: [await fileArg('sample.png')] });
    expect(first.outputs.map(o => o.name)).toEqual(['sample.webp']);
    const second = await callTool(page, 'convert_files', { files: [await fileArg('portrait.png')] });
    expect(second.outputs.map(o => o.name)).toEqual(['portrait.webp']);
  });

  test('convert_files presses the start button on panel tools', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/create-zip');
    await registeredTools(page);
    const result = await callTool(page, 'convert_files', {
      files: [await fileArg('sample.png'), await fileArg('sample.jpg')],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].name).toMatch(/\.zip$/);
    expect(Buffer.from(result.outputs[0].data_base64, 'base64').subarray(0, 2).toString()).toBe('PK');
  });

  test('convert_files reports the page error for an unusable file', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/png-to-jpg');
    await registeredTools(page);
    const result = await callTool(page, 'convert_files', { files: [await fileArg('corrupt-truncated.png')], timeout_seconds: 30 });
    expect(result.ok).toBe(false);
    expect(result.errors.length + (result.error ? 1 : 0)).toBeGreaterThan(0);
  });

  test('convert_files returns quickly when the tool needs choices made on the page', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/images-to-gif');
    await registeredTools(page);
    const started = Date.now();
    // One image: "Need at least 2 images" keeps the button disabled.
    const result = await callTool(page, 'convert_files', { files: [await fileArg('sample.png')] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/stays disabled/);
    expect(Date.now() - started).toBeLessThan(25_000);
  });

  test('images-to-gif builds a GIF from files sent without a MIME type', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/images-to-gif');
    await registeredTools(page);
    const result = await callTool(page, 'convert_files', {
      files: [await fileArg('sample.png'), await fileArg('portrait.png')],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(Buffer.from(result.outputs[0].data_base64, 'base64').subarray(0, 3).toString()).toBe('GIF');
  });

  test('convert_files after earlier files returns only its own output and keeps the saved quality', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/png-to-jpg');
    await registeredTools(page);
    // The person converts a file first, with their own quality.
    await page.locator('#quality-slider').evaluate(el => {
      el.value = '50';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.setInputFiles('#file-input', fixture('sample.png'));
    await expect(page.locator('.file-item.done')).toHaveCount(1);

    const result = await callTool(page, 'convert_files', { files: [await fileArg('portrait.png')], quality: 75 });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.quality).toBe(75);
    expect(result.outputs.map(o => o.name)).toEqual(['portrait.jpg']);

    // The person's value and their earlier file are untouched.
    expect(await page.evaluate(() => localStorage.getItem('cf-quality'))).toBe('50');
    expect(await page.locator('#quality-slider').inputValue()).toBe('50');
    await expect(page.locator('.file-item.done')).toHaveCount(2);
    await expect(page.locator('.file-item__status', { hasText: 'Queued' })).toHaveCount(0);
  });

  test('a download the person clicks during a call is not captured or handed to the agent', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/png-to-jpg');
    await registeredTools(page);
    const personal = page.waitForEvent('download');
    const result = JSON.parse(await page.evaluate(async file => {
      const run = window.__webmcpTools.get('convert_files').execute({ files: [file] });
      // The call is in flight (it is still waiting on the page): the person saves
      // another file through the same <a download> mechanism the tools use.
      const a = document.createElement('a');
      a.download = 'personal.txt';
      a.href = URL.createObjectURL(new Blob(['private']));
      document.body.append(a);
      a.click();
      a.remove();
      return run;
    }, await fileArg('sample.png')));
    expect((await personal).suggestedFilename()).toBe('personal.txt');
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.outputs.map(o => o.name)).toEqual(['sample.jpg']);
  });

  test('page globals are restored after success, error and timeout', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/png-to-jpg');
    await registeredTools(page);
    const file = await fileArg('sample.png');
    const restored = await page.evaluate(async f => {
      const tool = window.__webmcpTools.get('convert_files');
      const click = HTMLAnchorElement.prototype.click;
      const create = URL.createObjectURL;
      const intact = () => HTMLAnchorElement.prototype.click === click && URL.createObjectURL === create;
      const run = async args => JSON.parse(await tool.execute(args));
      const out = {};
      out.success = (await run({ files: [f] })).ok && intact();
      out.error = !(await run({ files: [{ name: 'x.png' }] })).ok && intact();
      // Timeout: swallow the change event and leave a row that never finishes.
      document.getElementById('file-input').addEventListener('change', e => {
        e.stopImmediatePropagation();
        const row = document.createElement('div');
        row.className = 'file-item';
        document.getElementById('file-list').append(row);
      }, true);
      const timedOut = await run({ files: [f], timeout_seconds: 5 });
      out.timeout = /Timed out/.test(timedOut.error) && intact();
      return out;
    }, file);
    expect(restored).toEqual({ success: true, error: true, timeout: true });
  });

  test('convert_files returns an error instead of hanging when the batch limit blocks the files', async ({ page }) => {
    test.setTimeout(120_000);
    await installAgentStub(page);
    await page.goto('/png-to-jpg');
    await registeredTools(page);
    const png = await fileArg('sample.png');
    const fill = await callTool(page, 'convert_files', {
      files: Array.from({ length: 50 }, (_, i) => ({ ...png, name: `fill-${i}.png` })),
      include_data: false,
    });
    expect(fill.ok, JSON.stringify(fill)).toBe(true);
    const started = Date.now();
    const result = await callTool(page, 'convert_files', { files: [png] });
    expect(result.ok, JSON.stringify({ ...result, outputs: result.outputs?.map(o => o.name) })).toBe(false);
    expect(result.error).toMatch(/did not accept the files/);
    expect(result.error).toMatch(/Batch limit/);
    expect(Date.now() - started).toBeLessThan(20_000);
  });

  test('non-numeric arguments fall back to defaults', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/png-to-jpg');
    await registeredTools(page);
    const found = await callTool(page, 'find_tool', { query: 'pdf', limit: 'lots' });
    expect(found.count).toBeGreaterThan(0);
    expect(found.count).toBeLessThanOrEqual(10);
    const result = await callTool(page, 'convert_files', {
      files: [await fileArg('sample.png')], quality: 'high', timeout_seconds: 'soon',
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.quality).toBeNull();
  });

  test('convert_files refuses bad input clearly', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/png-to-jpg');
    await registeredTools(page);
    expect((await callTool(page, 'convert_files', { files: [] })).error).toMatch(/at least one file/);
    expect((await callTool(page, 'convert_files', { files: [{ name: 'x.png' }] })).error).toMatch(/data_base64/);
  });
});
