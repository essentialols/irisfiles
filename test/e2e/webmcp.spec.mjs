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
    await page.goto('/png-to-jpg');
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => 'modelContext' in document)).toBe(false);
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

  test('convert_files refuses bad input clearly', async ({ page }) => {
    await installAgentStub(page);
    await page.goto('/png-to-jpg');
    await registeredTools(page);
    expect((await callTool(page, 'convert_files', { files: [] })).error).toMatch(/at least one file/);
    expect((await callTool(page, 'convert_files', { files: [{ name: 'x.png' }] })).error).toMatch(/data_base64/);
  });
});
