// Regenerates the README images in docs/assets/: a demo state (demo.ts), the real server on it, raw screenshots of
// the app, then compositions (compose.ts) photographed at 2x. No network: the server only reads its caches and the
// browser gets every non-local request answered from the demo's drawn pictures or aborted.
//   bun run docs:shots     (PW=<playwright-core>, CHROME=<chromium binary> when they are not found on their own)
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compositions } from './compose';

const root = resolve(import.meta.dir, '../../..'), out = join(root, 'docs/assets');
const home = mkdtempSync(join(tmpdir(), 'stillfeed-shots-')), state = join(home, 'state'), raw = join(home, 'raw');
mkdirSync(raw, { recursive: true });
// SOCIALDATA_API_KEY only marks X as connected in the UI; collections are a no-op command and never call SocialData.
const env = { PATH: process.env.PATH!, HOME: home, STILLFEED_HOME: home, STILLFEED_LLM: 'none', STILLFEED_LANGUAGE: 'English', SOCIALDATA_API_KEY: 'demo-only',
  STILLFEED_NO_WORKER: '1', STILLFEED_DISABLE_SCHEDULE: '1', STILLFEED_COLLECT_COMMAND: 'true', TZ: 'UTC' };

const demo = spawnSync('bun', [join(import.meta.dir, 'demo.ts'), state], { env, cwd: home, encoding: 'utf8' });
if (demo.status !== 0) throw new Error(demo.stderr);
const { reader, remote } = JSON.parse(demo.stdout) as { reader: string; remote: Record<string, string> };

const port = 23000 + Math.floor(Math.random() * 2000), base = `http://127.0.0.1:${port}`;
const server = spawn('bun', [join(root, 'src/server.ts'), '--state-dir', state, '--port', String(port)], { env, cwd: home, stdio: ['ignore', 'ignore', 'inherit'] });
const stop = () => { server.kill(); rmSync(home, { recursive: true, force: true }); };
process.on('exit', stop);
for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await Bun.sleep(100); }

const require = createRequire(import.meta.url);
const pw = process.env.PW || join(process.env.HOME!, '.bun/install/cache/playwright-core@1.65.0@@@1/index.js');
const chrome = process.env.CHROME || join(process.env.HOME!, '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell');
const { chromium } = require(pw) as typeof import('playwright-core');
const browser = await chromium.launch({ executablePath: existsSync(chrome) ? chrome : undefined });

type Device = 'phone' | 'desktop';
const devices = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
} as const;

async function app(device: Device, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ ...devices[device], ...(viewport ? { viewport } : {}), colorScheme: 'dark', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC' });
  await context.route(url => url.hostname !== '127.0.0.1', route => {
    const file = remote[route.request().url()];
    return file ? route.fulfill({ body: readFileSync(file), contentType: 'image/svg+xml' }) : route.abort();
  });
  // The demo stays as it was: opening or scrolling past an item marks nothing as opened or seen.
  await context.route(/\/api\/(seen|seen-batch|article\/[a-f0-9]{32}\/opened)$/, route => route.fulfill({ json: { ok: true } }));
  await context.addInitScript(() => { localStorage.setItem('stillfeed-setup-dismissed', '1'); });
  const page = await context.newPage();
  return { context, page };
}

/** Waits until every visible image has loaded and the fonts are in, then captures the viewport. */
async function settle(page: import('playwright-core').Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 50; i++) {
      const pending = [...document.images].filter(img => { const r = img.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && !img.complete; });
      if (!pending.length) break;
      await new Promise(r => setTimeout(r, 100));
    }
  });
  await page.waitForTimeout(400);
}
const shot = async (page: import('playwright-core').Page, name: string) => { await settle(page); await page.screenshot({ path: join(raw, name + '.png') }); };

// Phone: Feed, Hot, Saved and the reader.
{
  const { context, page } = await app('phone');
  await page.goto(base + '/');
  await page.waitForSelector('#feed .feed-card');
  await shot(page, 'phone-feed');
  await page.click('#viewHot');
  await page.waitForSelector('#hot .feed-card');
  await shot(page, 'phone-hot');
  await page.click('#viewSaved');
  await page.waitForSelector('#feed .feed-card');
  await shot(page, 'phone-saved');
  await page.goto(base + `/article/${reader}`);
  await page.waitForSelector('.ai-summary li');
  await shot(page, 'phone-reader');
  await context.close();
}
// Desktop: the feed, the reader and the Sources page.
{
  const { context, page } = await app('desktop');
  await page.goto(base + '/');
  await page.waitForSelector('#feed .feed-card');
  await shot(page, 'desktop-feed');
  await page.goto(base + `/article/${reader}`);
  await page.waitForSelector('.ai-summary li');
  await shot(page, 'desktop-reader');
  await context.close();
}
// The Sources page at the width of its browser frame.
{
  const { context, page } = await app('desktop', { width: 1280, height: 900 });
  await page.goto(base + '/sources');
  await page.waitForSelector('#sourcesPage .source-item');
  await shot(page, 'desktop-sources');
  await context.close();
}

/** A 256-colour palette with dithering keeps each image under ~600 KB with no visible loss: pngquant when it is
 *  installed, else Pillow's libimagequant, else the PNG stays as Chromium wrote it. */
function optimize(file: string) {
  if (spawnSync('pngquant', ['--version']).status === 0) { spawnSync('pngquant', ['--force', '--skip-if-larger', '--strip', '--output', file, '256', file]); return; }
  const pillow = `from PIL import Image; import sys; p = sys.argv[1]; Image.open(p).convert('RGBA').quantize(256, method=Image.Quantize.LIBIMAGEQUANT, dither=Image.Dither.FLOYDSTEINBERG).save(p, optimize=True)`;
  if (spawnSync('python3', ['-I', '-c', pillow, file]).status !== 0) console.warn(`${file}: neither pngquant nor Pillow with libimagequant is available; left unoptimized`);
}

// Compositions: each is an HTML page next to the raw shots, photographed at 2x.
const fonts = join(root, 'assets/fonts');
for (const { name, width, height, html } of compositions({ raw, fonts })) {
  const file = join(raw, name + '.html');
  await Bun.write(file, html);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await context.route(url => url.protocol !== 'file:', route => route.abort());
  const page = await context.newPage();
  await page.goto('file://' + file);
  await settle(page);
  const target = join(out, name + '.png');
  await page.screenshot({ path: target, type: 'png' });
  await context.close();
  optimize(target);
  console.log(`${name}.png ${Math.round(statSync(target).size / 1024)} KB`);
}
if (process.env.KEEP_RAW) { spawnSync('cp', ['-r', raw, process.env.KEEP_RAW]); }
await browser.close();
process.exit(0);
