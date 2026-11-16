import { Innertube } from 'youtubei.js';
import { subscriptions, parseFeed } from './feeds';
import { download } from './media';
import { canonical, hash, type Store } from './store';

/** Sources the reader manages from the sidebar or their own files: RSS/Atom/JSON feeds, YouTube channels, X accounts. */
export type SourceKind = 'rss' | 'youtube' | 'web' | 'x';
export type XAccount = { handle: string; name: string; enabled: boolean };
const HANDLE = /^\w{1,15}$/;
const YOUTUBE_FEED = /youtube\.com\/feeds\/videos\.xml\?channel_id=/;
export const sourceKind = (url: string | null): SourceKind => !url ? 'web' : YOUTUBE_FEED.test(url) ? 'youtube' : 'rss';

/** Adds every feed and handle once: a source the reader removed or switched off later stays that way. */
export function seedOnce(store: Store, key: string, add: () => void) {
  if (store.db.query('SELECT 1 FROM seeded WHERE key=?').get(key)) return;
  store.db.transaction(() => { add(); store.db.query('INSERT INTO seeded VALUES(?)').run(key); })();
}
export function insertFeed(store: Store, url: string, title: string, ai: boolean, sourceKey = 'opmlrss::' + title) {
  const existing = store.db.query('SELECT id FROM sources WHERE name=? COLLATE NOCASE LIMIT 1').get(title) as { id: string } | null;
  const sourceId = existing?.id || hash(sourceKey);
  store.db.query('INSERT OR IGNORE INTO sources(id,name) VALUES(?,?)').run(sourceId, title);
  store.db.query('INSERT OR IGNORE INTO feeds(id,url,title,source_id,ai) VALUES(?,?,?,?,?)').run(hash(url), url, title, sourceId, Number(ai));
  return sourceId;
}
export function seedOpml(store: Store, xml: string, ai?: boolean) {
  for (const item of subscriptions(xml)) seedOnce(store, 'feed::' + item.url, () => insertFeed(store, item.url, item.title, ai ?? item.ai));
}
/** One handle per line; "#" starts a comment; "@" is optional. */
export function seedAccounts(store: Store, text: string) {
  for (const line of text.split('\n')) {
    const handle = line.replace(/#.*/, '').trim().replace(/^@/, '');
    if (HANDLE.test(handle)) seedOnce(store, 'x::' + handle.toLowerCase(), () => store.db.query('INSERT OR IGNORE INTO x_accounts(handle,name) VALUES(?,?)').run(handle, handle));
  }
}

let client: Promise<Innertube> | undefined;
/** A YouTube channel page (/@name, /channel/UC…, /c/…) becomes the channel's feed URL and name. */
async function youtubeChannel(url: URL) {
  const direct = /^\/channel\/(UC[\w-]{22})/.exec(url.pathname)?.[1];
  const yt = await (client ??= Innertube.create({ retrieve_player: false }));
  const id = direct ?? (await yt.resolveURL(url.href)).payload?.browseId;
  if (!id || !/^UC[\w-]{22}$/.test(id)) throw new Error('This YouTube link is not a channel');
  const channel = await yt.getChannel(id);
  return { url: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, title: String(channel.metadata.title || 'YouTube channel') };
}

/** A feed URL, or a page that announces one (or has one at the usual paths). Returns the feed and its title. */
export async function findFeed(input: string, get: typeof download = download): Promise<{ url: string; title: string }> {
  const page = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  if (!['http:', 'https:'].includes(page.protocol)) throw new Error('Use an http or https link');
  if (/(^|\.)youtube\.com$/.test(page.hostname) && !YOUTUBE_FEED.test(page.href)) return youtubeChannel(page);
  const tried = new Set<string>(), candidates = [page.href];
  const probe = async (url: string) => {
    const response = await get(url, 4000000);
    const body = new TextDecoder().decode(response.bytes);
    return { body, entries: await parseFeed(body, { id: 'probe', url, title: '', ai: 0 }).catch(() => []), finalUrl: response.url };
  };
  for (let i = 0; i < candidates.length && i < 12; i++) {
    const url = candidates[i]!;
    if (tried.has(url)) continue; tried.add(url);
    try {
      const { body, entries, finalUrl } = await probe(url);
      if (entries.length) {
        const title = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i.exec(body)?.[1]?.trim() || (body.trimStart().startsWith('{') ? String(JSON.parse(body).title || '') : '') || page.hostname;
        return { url: canonical(url), title: title.replace(/&amp;/g, '&').slice(0, 120) };
      }
      if (i === 0) {
        for (const m of body.matchAll(/<link\b[^>]*>/gi)) {
          const tag = m[0], href = /href=["']([^"']+)/i.exec(tag)?.[1];
          if (href && /rel=["']?alternate/i.test(tag) && /type=["']?application\/(rss|atom|feed)\+(xml|json)/i.test(tag)) candidates.splice(1, 0, new URL(href, finalUrl).href);
        }
        candidates.push(...['feed', 'rss.xml', 'atom.xml', 'feed.xml', 'index.xml', 'rss'].map(p => new URL('/' + p, finalUrl).href));
      }
    } catch { /* next candidate */ }
  }
  throw new Error('No RSS, Atom or JSON feed found at this address');
}

/** A source the reader added: it goes through the relevance filter like any general feed (ai=0). */
export async function addSource(store: Store, input: string, name?: string, get: typeof download = download) {
  const feed = await findFeed(input, get);
  const title = name?.trim().slice(0, 120) || feed.title;
  return source(store, insertFeed(store, feed.url, title, false, 'added::' + feed.url))!;
}

/** Only feed sources can be removed; web scrapers and X are switched off instead. Removal survives a reseed. */
export function removeSource(store: Store, id: string) {
  const feeds = store.db.query('SELECT url FROM feeds WHERE source_id=?').all(id) as { url: string }[];
  if (!feeds.length) throw new Error('This source cannot be removed; switch it off instead');
  store.db.transaction(() => {
    for (const { url } of feeds) store.db.query('INSERT OR IGNORE INTO seeded VALUES(?)').run('feed::' + url);
    store.db.query('DELETE FROM feeds WHERE source_id=?').run(id);
    store.db.query('DELETE FROM article_sources WHERE source_id=?').run(id);
    store.db.query('DELETE FROM sources WHERE id=?').run(id);
  })();
}

export function source(store: Store, id: string) {
  return list(store).find(s => s.id === id);
}
export function list(store: Store) {
  return (store.sources() as { id: string; name: string; enabled: number; articles: number; error: string | null }[]).map(s => {
    const url = (store.db.query('SELECT url FROM feeds WHERE source_id=? LIMIT 1').get(String(s.id)) as { url: string } | null)?.url ?? null;
    return { ...s, url, kind: s.name === 'X follows' ? 'x' as const : sourceKind(url) };
  });
}

export function accounts(store: Store): XAccount[] {
  return (store.db.query('SELECT handle,name,enabled FROM x_accounts ORDER BY handle COLLATE NOCASE').all() as { handle: string; name: string; enabled: number }[]).map(a => ({ ...a, enabled: Boolean(a.enabled) }));
}
export function setAccount(store: Store, handle: unknown, enabled: unknown) {
  const clean = typeof handle === 'string' ? handle.trim().replace(/^@/, '') : '';
  if (!HANDLE.test(clean) || typeof enabled !== 'boolean') throw new Error('Invalid X account');
  store.db.query('INSERT INTO x_accounts(handle,name,enabled) VALUES(?,?,?) ON CONFLICT(handle) DO UPDATE SET enabled=excluded.enabled').run(clean, clean, Number(enabled));
  return { handle: clean, enabled };
}
