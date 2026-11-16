import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store';
import { accounts, addSource, findFeed, list, removeSource, seedAccounts, seedOpml, setAccount } from './sources';

const opml = `<?xml version="1.0"?><opml version="2.0"><body><outline text="AI"><outline text="Simon Willison" title="Simon Willison" type="rss" xmlUrl="https://simonwillison.net/atom/everything/" ai="1"/><outline text="Blog" xmlUrl="https://blog.example.com/feed"/></outline></body></opml>`;
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Example &amp; Co</title><item><title>Hello</title><link>https://blog.example.com/hello</link><pubDate>Mon, 16 Nov 2026 07:00:00 GMT</pubDate></item></channel></rss>`;
const page = `<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head><body>Blog</body></html>`;
function fixture() { const dir = mkdtempSync(join(tmpdir(), 'stillfeed-sources-')), store = new Store(dir); return { store, done() { store.close(); rmSync(dir, { recursive: true, force: true }); } }; }
const site = (files: Record<string, string>) => (async (url: string) => {
  const body = files[url]; if (body === undefined) throw new Error('Source returned HTTP 404');
  return { url, type: 'text/html', bytes: new TextEncoder().encode(body), status: 200, headers: new Headers() };
}) as unknown as typeof import('./media').download;

test('seeding is idempotent and a removed feed does not come back', () => {
  const f = fixture(); try {
    seedOpml(f.store, opml); seedOpml(f.store, opml);
    expect(list(f.store).map(s => s.name).sort()).toEqual(['Blog', 'Simon Willison']);
    const blog = list(f.store).find(s => s.name === 'Blog')!;
    expect(blog.kind).toBe('rss'); expect(blog.url).toBe('https://blog.example.com/feed');
    removeSource(f.store, blog.id); seedOpml(f.store, opml);
    expect(list(f.store).map(s => s.name)).toEqual(['Simon Willison']);
  } finally { f.done(); }
});

test('the user feeds file goes through the relevance filter (ai=0)', () => {
  const f = fixture(); try {
    seedOpml(f.store, opml, false);
    expect((f.store.db.query('SELECT MAX(ai) AS ai FROM feeds').get() as { ai: number }).ai).toBe(0);
  } finally { f.done(); }
});

test('a page link finds its announced feed; a bare feed link works too', async () => {
  const files = { 'https://blog.example.com/': page, 'https://blog.example.com/rss.xml': rss };
  expect(await findFeed('blog.example.com', site(files))).toEqual({ url: 'https://blog.example.com/rss.xml', title: 'Example & Co' });
  expect(await findFeed('https://blog.example.com/rss.xml', site(files))).toEqual({ url: 'https://blog.example.com/rss.xml', title: 'Example & Co' });
  expect(findFeed('https://nothing.example.com/', site({ 'https://nothing.example.com/': '<html></html>' }))).rejects.toThrow('No RSS');
});

test('an added source is listed, can be renamed on add and removed', async () => {
  const f = fixture(); try {
    const added = await addSource(f.store, 'https://blog.example.com/', 'My blog', site({ 'https://blog.example.com/': page, 'https://blog.example.com/rss.xml': rss }));
    expect(added).toMatchObject({ name: 'My blog', enabled: 1, kind: 'rss', url: 'https://blog.example.com/rss.xml' });
    removeSource(f.store, added.id); expect(list(f.store)).toEqual([]);
    expect(() => removeSource(f.store, 'nope')).toThrow('cannot be removed');
  } finally { f.done(); }
});

test('X accounts: file seeding once, toggling and adding by handle', () => {
  const f = fixture(); try {
    seedAccounts(f.store, '@karpathy\n# comment\nsimonw # Simon\nnot a handle!\n');
    expect(accounts(f.store).map(a => a.handle)).toEqual(['karpathy', 'simonw']);
    expect(accounts(f.store).find(a => a.handle === 'simonw')?.name).toBe('Simon');
    setAccount(f.store, '@karpathy', false); seedAccounts(f.store, 'karpathy');
    expect(accounts(f.store).find(a => a.handle === 'karpathy')?.enabled).toBe(false);
    setAccount(f.store, 'swyx', true); expect(accounts(f.store)).toHaveLength(3);
    expect(() => setAccount(f.store, 'bad handle', true)).toThrow();
  } finally { f.done(); }
});
