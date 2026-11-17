// Speed budgets: what a phone downloads before the first paint, and how fast the API answers on a database the
// size of a month of real use. Fails when a budget is exceeded. Optional: LIGHTHOUSE=<path to lighthouse cli>
// CHROME_PATH=<chrome> also runs Lighthouse (median of three, mobile and desktop) and requires 100 everywhere.
//   bun tests/perf.ts            (after bun run build)
import { brotliCompressSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, type RecordData } from '../src/store';

const root = join(import.meta.dir, '..');
const BUDGET = { firstPaintKB: 120, feedMs: 40, pageMs: 15, statusMs: 15, hotMs: 15 };
const failures: string[] = [];
const report = (name: string, value: number, budget: number, unit: string) => {
  const ok = value <= budget;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${value.toFixed(1)} ${unit} (budget ${budget})`);
  if (!ok) failures.push(name);
};

// 1. First paint: the HTML (with the inlined stylesheet), the entry script, its static chunks and the preloaded font.
const html = await Bun.file(join(root, 'index.html')).text();
const firstPaint = ['index.html', ...[...html.matchAll(/(?:src|href)="\/(assets\/(?:build\/[^"]+\.js|fonts\/[^"]+\.woff2))"/g)].map(m => m[1]!)];
let bytes = 0;
for (const file of firstPaint) {
  const body = new Uint8Array(await Bun.file(join(root, file)).arrayBuffer());
  bytes += file.endsWith('.woff2') ? body.byteLength : brotliCompressSync(body).byteLength;
}
report(`first paint download (${firstPaint.length} files, brotli)`, bytes / 1024, BUDGET.firstPaintKB, 'KB');

// 2. API latency on a month of data: 6000 updates over 30 days, a third of them X posts.
const temp = mkdtempSync(join(tmpdir(), 'stillfeed-perf-'));
const state = join(temp, 'state'), now = Date.now();
const store = new Store(state);
const records: RecordData[] = Array.from({ length: 6000 }, (_, i) => {
  const at = new Date(now - i * 7 * 60000).toISOString(), x = i % 3 === 2;
  return x
    ? { url: `https://x.com/user${i % 40}/status/${1900000000000000000n + BigInt(i)}`, title: `Post ${i} about agents`, source: 'X follows', site_id: 'opmlrss', published_at: at, ai_is_related: i % 5 !== 0,
        tweet: { id: String(1900000000000000000n + BigInt(i)), handle: `user${i % 40}`, text: `Post ${i}: a new model for coding agents and data pipelines.`, published: Math.floor(Date.parse(at) / 1000), name: `User ${i % 40}`, kind: 'post', likes: i, replies: 1, reposts: 2, views: 100, media: [], links: [] } }
    : { url: `https://blog${i % 60}.example.com/posts/${i}`, title: `Article ${i}: what changed in open models this week`, source: `Blog ${i % 60}`, site_id: 'opmlrss', published_at: at, ai_is_related: i % 5 !== 0, summary: 'A summary paragraph. '.repeat(20) };
});
store.ingest(records, new Date(now).toISOString());
store.close();
const port = 23000 + Math.floor(Math.random() * 20000), base = `http://127.0.0.1:${port}`;
const server = Bun.spawn([process.execPath, join(root, 'src/server.ts'), '--state-dir', state, '--port', String(port)], {
  env: { PATH: process.env.PATH ?? '', HOME: temp, STILLFEED_HOME: temp, STILLFEED_LLM: 'none', STILLFEED_NO_WORKER: '1', STILLFEED_DISABLE_SCHEDULE: '1', SOCIALDATA_API_KEY: '' },
  stdout: 'ignore', stderr: 'inherit',
});
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await Bun.sleep(100); }
  const median = async (path: () => string, runs = 25) => {
    const times: number[] = [];
    for (let i = 0; i < runs; i++) { const t = performance.now(); const r = await fetch(base + path(), { headers: { 'Accept-Encoding': 'gzip, br' } }); await r.arrayBuffer(); if (!r.ok) throw new Error(`${path()} returned ${r.status}`); times.push(performance.now() - t); }
    return times.sort((a, b) => a - b)[Math.floor(times.length / 2)]!;
  };
  await fetch(base + '/api/feed?scope=ai&kind=all&hideSeen=1'); // warm the statement cache like a running server
  report('new feed snapshot (/api/feed)', await median(() => '/api/feed?scope=ai&kind=all&hideSeen=1'), BUDGET.feedMs, 'ms');
  const first = await (await fetch(base + '/api/feed?scope=all&kind=all&hideSeen=0')).json() as { batch: string };
  report('next page of a snapshot', await median(() => `/api/feed?batch=${first.batch}&offset=60`), BUDGET.pageMs, 'ms');
  report('/api/status', await median(() => '/api/status'), BUDGET.statusMs, 'ms');
  report('personal selection status', await median(() => '/api/personal'), BUDGET.hotMs, 'ms');

  // 3. Lighthouse, when available: the median score of three runs per form factor must be 100.
  if (process.env.LIGHTHOUSE) {
    for (const preset of ['mobile', 'desktop']) {
      const runs: Record<string, number>[] = [];
      for (let i = 0; i < 3; i++) {
        const out = join(temp, `lh-${preset}-${i}.json`);
        const child = Bun.spawn(['node', process.env.LIGHTHOUSE, base + '/', '--quiet', '--output=json', `--output-path=${out}`, '--chrome-flags=--headless=new --no-sandbox', ...(preset === 'desktop' ? ['--preset=desktop'] : [])], { stdout: 'ignore', stderr: 'ignore' });
        await child.exited;
        const result = await Bun.file(out).json() as { categories: Record<string, { score: number | null }> };
        runs.push(Object.fromEntries(Object.entries(result.categories).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)])));
      }
      for (const category of Object.keys(runs[0]!)) {
        const scores = runs.map(r => r[category]!).sort((a, b) => a - b);
        const value = scores[1]!, ok = value === 100;
        console.log(`${ok ? 'ok  ' : 'FAIL'} lighthouse ${preset} ${category}: ${value} (runs ${scores.join(', ')})`);
        if (!ok) failures.push(`lighthouse ${preset} ${category}`);
      }
    }
  }
} finally { server.kill(); rmSync(temp, { recursive: true, force: true }); }
if (failures.length) { console.error(`\n${failures.length} budget(s) exceeded: ${failures.join(', ')}`); process.exit(1); }
