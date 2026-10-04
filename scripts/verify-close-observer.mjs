import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { installWindowClose } from '../src/window-close.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const outputRoot = path.resolve('../output');
const base = await mkdtemp(path.join(outputRoot, 'close-observer-'));
const shell = path.join(base, 'distBuild', 'app.html');
await mkdir(path.dirname(shell));
await writeFile(shell, '<!doctype html><button class="closeButton" onclick="window.nativeClicks=(window.nativeClicks||0)+1">Close</button>');
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(shell).href);
  const cdp = await page.context().newCDPSession(page);
  const client = { send: (...args) => cdp.send(...args), on(name, callback) { cdp.on(name, callback); return () => cdp.off(name, callback); } };
  let closes = 0;
  const cleanup = await installWindowClose(client, () => { closes++; }, { deferUnload: true });
  await page.reload();
  assert.equal(closes, 0, 'Intentional startup reload must not disconnect');
  await page.locator('button.closeButton').click();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(closes, 1, 'Recreated world must observe native X');
  assert.equal(await page.evaluate(() => window.nativeClicks), 1, 'Native handler must run');
  await cleanup();
  await page.reload();
  await page.locator('button.closeButton').click();
  assert.equal(closes, 1, 'Cleanup must remove future observation');
  const second = await installWindowClose(client, () => { closes++; }, { deferUnload: true });
  second.armUnload();
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(closes, 2, 'Armed window unload must notify');
  await second();
  console.log('Chromium integration passed: startup reload, native X, native click preservation, removal, and armed unload.');
} finally {
  await browser?.close();
  assert.equal(path.dirname(base), outputRoot, 'Only remove the generated test directory');
  await rm(base, { recursive: true, force: true });
}
