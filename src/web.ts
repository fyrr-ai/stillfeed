/** Public web sources (ported from scripts/collect_sources.py collect_all and scripts/project_sources.py). */
import { parseHTML } from 'linkedom';
import { XMLParser } from 'fast-xml-parser';
import type { RecordData } from './store';

export type Item = { site_id: string; source: string; title: string; url: string; published_at: Date | null; summary: string };
export type WebStatus = { site_id: string; site_name: string; ok: boolean; item_count: number; duration_ms: number; error: string | null };
type Feed = { title: string; xml_url: string; html_url: string; include_keywords?: string; max_entries?: number; strict_title_filter?: boolean; research_only?: boolean };
export type Entry = { title: string; link: string; published?: string; updated?: string; summary: string };

export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const TZINFOS: Record<string, number> = { UT: 0, UTC: 0, GMT: 0, CET: 3600, CEST: 7200, EST: -18000, EDT: -14400, PST: -28800, PDT: -25200, CST: -21600, CDT: -18000, MST: -25200, MDT: -21600, BST: 3600, JST: 32400 };
export const OFFICIAL_AI_FEEDS: Feed[] = [
  { title: 'OpenAI News', xml_url: 'https://openai.com/news/rss.xml', html_url: 'https://openai.com/news' },
  { title: 'Google DeepMind', xml_url: 'https://deepmind.google/blog/rss.xml', html_url: 'https://deepmind.google/blog' },
  { title: 'Google AI Blog', xml_url: 'https://blog.google/innovation-and-ai/technology/ai/rss/', html_url: 'https://blog.google/innovation-and-ai/technology/ai/' },
  { title: 'Hugging Face Blog', xml_url: 'https://huggingface.co/blog/feed.xml', html_url: 'https://huggingface.co/blog' },
  { title: 'GitHub AI & ML', xml_url: 'https://github.blog/ai-and-ml/feed/', html_url: 'https://github.blog/ai-and-ml/' },
  { title: 'GitHub Changelog', xml_url: 'https://github.blog/changelog/feed/', html_url: 'https://github.blog/changelog/' },
  { title: 'OpenAI Skills', xml_url: 'https://github.com/openai/skills/commits/main.atom', html_url: 'https://github.com/openai/skills', include_keywords: 'hatch,pet,migrate-to-codex' },
];
export const OFFICIAL_AI_MAX_AGE_DAYS = 45, CURATED_AI_MEDIA_MAX_AGE_DAYS = 30;
export const CURATED_AI_MEDIA_FEEDS: Feed[] = [
  { title: 'The Decoder AI News', xml_url: 'https://the-decoder.com/feed/', html_url: 'https://the-decoder.com/', max_entries: 10 },
  { title: 'TechCrunch AI', xml_url: 'https://techcrunch.com/category/artificial-intelligence/feed/', html_url: 'https://techcrunch.com/category/artificial-intelligence/', max_entries: 8 },
  // The Verge's AI topic RSS endpoint is not currently public/stable; keep the all-site RSS behind strict title-level AI filtering.
  { title: 'The Verge', xml_url: 'https://www.theverge.com/rss/index.xml', html_url: 'https://www.theverge.com/ai-artificial-intelligence', include_keywords: 'ai,artificial intelligence,openai,anthropic,claude,chatgpt,gpt,gemini,llm,agent,copilot', max_entries: 6, strict_title_filter: true },
  { title: 'MarkTechPost Research', xml_url: 'https://www.marktechpost.com/feed/', html_url: 'https://www.marktechpost.com/', include_keywords: 'paper,research,arxiv,benchmark,dataset,model,llm,agent,diffusion,transformer,multimodal,reasoning,inference,training,open-source', max_entries: 6, strict_title_filter: true, research_only: true },
  { title: 'VentureBeat AI', xml_url: 'https://venturebeat.com/category/ai/feed', html_url: 'https://venturebeat.com/category/ai/', max_entries: 8 },
  { title: 'Artificial Intelligence News', xml_url: 'https://www.artificialintelligence-news.com/feed/', html_url: 'https://www.artificialintelligence-news.com/', max_entries: 8 },
  { title: 'Claude Code Releases', xml_url: 'https://github.com/anthropics/claude-code/releases.atom', html_url: 'https://github.com/anthropics/claude-code/releases', max_entries: 6 },
];
export const AIBREAKFAST_JINA_URL = 'https://r.jina.ai/https://aibreakfast.beehiiv.com/';
export const FOLLOW_BUILDERS_FEED_BASE = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main';
export const HN_ALGOLIA_URL = 'https://hn.algolia.com/api/v1/search_by_date';
export const HN_ALGOLIA_QUERIES = ['OpenAI', 'Anthropic', 'Claude Code', 'Claude', 'Gemini', 'Google AI', 'DeepSeek', 'Qwen', 'AI agent', 'AI coding', 'Codex', 'Cursor', 'MCP', 'LLM', 'GPT', 'Sora', 'Copilot', 'Nvidia AI'];
export const HN_ALGOLIA_KEYWORDS = ['openai', 'anthropic', 'claude', 'claude code', 'codex', 'cursor', 'mcp', 'gemini', 'deepseek', 'qwen', 'llm', 'gpt', 'sora', 'copilot', 'agent', 'ai coding', 'benchmark', 'eval', 'paper', 'model', 'inference'];
export const HN_ALGOLIA_HITS_PER_QUERY = 35, HN_ALGOLIA_MIN_KEYWORD_SCORE = 0.38, HN_ALGOLIA_MIN_COMMENTS = 2, HN_ALGOLIA_MIN_POINTS = 10, HN_ALGOLIA_QUERY_PAUSE_SECONDS = 0.1;
export const GITHUB_TRENDING_URL = 'https://github.com/trending?since=daily', PRODUCTHUNT_FEED_URL = 'https://www.producthunt.com/feed';
const DAY = 86400000, HOUR = 3600000;
const FEED_ACCEPT = 'application/rss+xml, application/xml, text/xml, */*', LANG = 'zh-CN,zh;q=0.9,en;q=0.8';

// ---- helpers ----
/** Python's iso(): UTC, `Z` suffix, no fraction when whole seconds, microsecond precision otherwise. */
export const iso = (d: Date | null) => d ? d.toISOString().replace('.000Z', 'Z').replace(/\.(\d{3})Z$/, '.$1000Z') : null;
const cut = (s: string, n: number) => Array.from(s).slice(0, n).join('');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const firstNonEmpty = (...values: unknown[]) => { for (const v of values) { if (v == null) continue; const s = String(v).trim(); if (s) return s; } return ''; };

export function normalizeUrl(raw: string): string {
  try {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw.trim())) return raw.trim();
    const u = new URL(raw.trim()), drop = new Set(['ref', 'spm', 'fbclid', 'gclid', 'igshid', 'mkt_tok', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi']);
    const query = [...u.searchParams].filter(([k]) => !k.toLowerCase().startsWith('utm_') && !drop.has(k.toLowerCase()));
    u.search = new URLSearchParams(query).toString(); u.hash = '';
    return u.href.replace(/\/+$/, '');
  } catch { return raw.trim(); }
}

const CP1252: Record<string, number> = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
/** Undo UTF-8 bytes that were decoded as Latin-1/cp1252. */
export function fixMojibake(text: string): string {
  const s = (text || '').trim();
  if (!s || !/[Ãâåèæïð]|[\x80-\x9f]|æ|ç|å|é/.test(s)) return s;
  for (const cp1252 of [false, true]) {
    const bytes: number[] = [];
    for (const ch of s) {
      const c = ch.codePointAt(0)!;
      const b = cp1252 ? (CP1252[ch] ?? (c <= 0xff && !(c >= 0x80 && c <= 0x9f) ? c : -1)) : c <= 0xff ? c : -1;
      if (b < 0) { bytes.length = 0; break; }
      bytes.push(b);
    }
    if (!bytes.length) continue;
    try { const fixed = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); if (fixed && fixed !== s) return fixed; } catch {}
  }
  return s;
}

export function parseUnix(value: unknown): Date | null {
  if (value == null || value === '') return null;
  let n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 10_000_000_000) n /= 1000;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseRelativeZh(text: string, now: Date): Date | null {
  text = (text || '').trim();
  if (!text) return null;
  let m: RegExpMatchArray | null;
  if ((m = text.match(/(\d+)\s*分钟前/))) return new Date(now.getTime() - +m[1] * 60000);
  if ((m = text.match(/(\d+)\s*小时前/))) return new Date(now.getTime() - +m[1] * HOUR);
  if ((m = text.match(/(\d+)\s*天前/))) return new Date(now.getTime() - +m[1] * DAY);
  if (text.includes('刚刚')) return now;
  if (text.includes('昨天')) return new Date(now.getTime() - DAY);
  const at = (base: Date, h: number, min: number) => { const d = new Date(base); d.setUTCHours(h, min, 0, 0); return d; };
  if ((m = text.match(/^(?:今天)?\s*(\d{1,2}):(\d{2})$/))) {
    if (+m[1] > 23 || +m[2] > 59) return null;
    const c = at(now, +m[1], +m[2]);
    return c.getTime() > now.getTime() + 5 * 60000 ? new Date(c.getTime() - DAY) : c;
  }
  if ((m = text.match(/^(?:\d{4}年\s*)?(\d{1,2})月(\d{1,2})日$/))) {
    const make = (y: number) => { const d = new Date(Date.UTC(y, +m![1] - 1, +m![2])); return d.getUTCMonth() === +m![1] - 1 ? d : null; };
    const c = make(now.getUTCFullYear());
    return c && c.getTime() > now.getTime() + 2 * DAY ? make(now.getUTCFullYear() - 1) : c;
  }
  return null;
}

/** Python parse_date_any: unix seconds/ms, relative Chinese times, TechURLs format, else a lenient date string (naive = UTC). */
export function parseDate(value: unknown, now: Date): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return parseUnix(value);
  let s = String(value).trim();
  if (!s) return null;
  if (s.startsWith('$D')) s = s.slice(2);
  if (/^\d{9,11}$/.test(s) || /^\d{12,}$/.test(s)) return parseUnix(Number(s));
  const rel = parseRelativeZh(s, now);
  if (rel) return rel;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})([AP]M)\s+UTC/);
  if (m && +m[4] >= 1 && +m[4] <= 12) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], (+m[4] % 12) + (m[7] === 'PM' ? 12 : 0), +m[5], +m[6]));
  s = s.replace(/\s+\(?([A-Z]{1,4})\)?$/, (all, tz) => tz in TZINFOS ? ` ${TZINFOS[tz] < 0 ? '-' : '+'}${String(Math.abs(TZINFOS[tz]) / 3600 | 0).padStart(2, '0')}${String(Math.abs(TZINFOS[tz]) % 3600 / 60).padStart(2, '0')}` : all);
  if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(s)) s = s.replace(' ', 'T') + (s.length > 10 ? 'Z' : 'T00:00:00Z');
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  // A string without a zone is UTC (dateutil naive -> UTC), but Date.parse reads it as local time.
  const zoned = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:GMT|UTC|UT)\b)\s*$/i.test(s);
  return new Date(zoned ? t : t - new Date(t).getTimezoneOffset() * 60000);
}

/** BeautifulSoup get_text(sep, strip=True): stripped non-empty text nodes joined by sep. */
export function textOf(node: any, sep = ''): string {
  // linkedom splits one text run at entities ("Cook&#39;s"), so adjacent text nodes are merged first.
  const out: string[] = [];
  let run = '';
  const flush = () => { const t = run.trim(); if (t) out.push(t); run = ''; };
  const walk = (n: any) => { for (const c of n?.childNodes ?? []) { if (c.nodeType === 3) run += c.textContent; else { flush(); if (c.nodeType === 1 && !['SCRIPT', 'STYLE', 'TEMPLATE'].includes(c.tagName)) walk(c); flush(); } } };
  walk(node); flush();
  return out.join(sep);
}
const htmlDoc = (html: string) => parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
export const cleanText = (value: unknown) => squash(textOf(htmlDoc(String(value ?? '')).body, ' '));

// ---- feeds (feedparser subset: RSS 2.0, RSS 1.0/RDF, Atom) ----
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false, trimValues: true, processEntities: true, htmlEntities: true, isArray: name => ['item', 'entry', 'link'].includes(name) });
const xmlText = (v: any): string => v == null ? '' : typeof v === 'object' ? Array.isArray(v) ? xmlText(v[0]) : xmlText(v['#text']) : String(v).trim();
export function feedEntries(body: string): Entry[] {
  let doc: any;
  try { doc = xml.parse(body); } catch { return []; }
  const nodes: any[] = doc?.rss?.channel?.item ?? doc?.RDF?.item ?? doc?.channel?.item ?? doc?.feed?.entry ?? [];
  return nodes.map(n => {
    const links: any[] = n.link ?? [];
    const alt = links.find(l => typeof l !== 'object' && String(l).trim()) ?? links.find(l => typeof l === 'object' && l['@_href'] && (!l['@_rel'] || l['@_rel'] === 'alternate')) ?? links.find(l => typeof l === 'object' && l['@_href']);
    let link = typeof alt === 'object' ? String(alt['@_href'] ?? alt['#text'] ?? '').trim() : xmlText(alt);
    // feedparser falls back to a permalink guid when an item has no link.
    if (!link && n.guid?.['@_isPermaLink'] !== 'false' && /^https?:/.test(xmlText(n.guid))) link = xmlText(n.guid);
    return { title: xmlText(n.title), link, published: xmlText(n.pubDate ?? n.published ?? n.issued) || undefined, updated: xmlText(n.updated ?? n.modified ?? n.date) || undefined, summary: xmlText(n.summary ?? n.description) || xmlText(n.content ?? n.encoded) };
  });
}
const entryPublished = (e: Entry, now: Date) => parseDate(e.published, now) ?? parseDate(e.updated, now);
const keywords = (feed: Feed) => String(feed.include_keywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);

// ---- http (requests.Session with Retry(total=3, backoff_factor=0.8, status_forcelist=[429,500,502,503,504])) ----
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export async function get(url: string, timeoutSeconds: number, headers: Record<string, string> = {}): Promise<Response> {
  const merged = { 'User-Agent': BROWSER_UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers };
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try { res = await fetch(url, { headers: merged, signal: AbortSignal.timeout(timeoutSeconds * 1000) }); }
    catch (error) { if (attempt >= 3) throw error; await sleep(attempt ? 800 * 2 ** attempt : 0); continue; }
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 3) { await res.body?.cancel(); await sleep(attempt ? 800 * 2 ** attempt : 0); continue; }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`${res.status} ${res.statusText} for url: ${url}`); }
    return res;
  }
}

// ---- official_ai ----
export function officialFeedItems(body: string, feed: Feed, now: Date): Item[] {
  const include = keywords(feed), out: Item[] = [];
  for (const e of feedEntries(body)) {
    if (!e.title || !e.link) continue;
    if (include.length && !include.some(k => `${e.title} ${e.link}`.toLowerCase().includes(k))) continue;
    const published = entryPublished(e, now);
    if (!published || published.getTime() < now.getTime() - OFFICIAL_AI_MAX_AGE_DAYS * DAY) continue;
    out.push({ site_id: 'official_ai', source: feed.title, title: fixMojibake(e.title), url: e.link, published_at: published, summary: '' });
  }
  return out;
}

export function parseAnthropicNews(html: string, now: Date): Item[] {
  const out: Item[] = [], seen = new Set<string>();
  for (const a of htmlDoc(html).querySelectorAll('a[href^="/news/"]')) {
    const href = String(a.getAttribute('href') || '').trim();
    if (!href || href === '/news/' || href === '/news') continue;
    const title = fixMojibake(textOf(a.querySelector('h1, h2, h3, h4'), ' '));
    if (!title || title.toLowerCase() === 'news') continue;
    const url = new URL(href, 'https://www.anthropic.com').href;
    if (seen.has(url)) continue;
    seen.add(url);
    const time = a.querySelector('time');
    const published = time ? parseDate(time.getAttribute('datetime') || textOf(time, ' '), now) : null;
    if (!published || published.getTime() < now.getTime() - OFFICIAL_AI_MAX_AGE_DAYS * DAY) continue;
    out.push({ site_id: 'official_ai', source: 'Anthropic News', title, url, published_at: published, summary: '' });
  }
  return out;
}

export function parseCodexChangelog(html: string, now: Date): Item[] {
  const out: Item[] = [], seen = new Set<string>();
  for (const node of htmlDoc(html).querySelectorAll('#codex-changelog-content li[id], li[id]')) {
    const id = String(node.getAttribute('id') || '').trim();
    if (!id || seen.has(id)) continue;
    const time = node.querySelector('time'), h3 = node.querySelector('h3');
    if (!time || !h3) continue;
    const title = fixMojibake(textOf(h3, ' ')), published = parseDate(time.getAttribute('datetime') || textOf(time, ' '), now);
    if (!title || !published || published.getTime() < now.getTime() - OFFICIAL_AI_MAX_AGE_DAYS * DAY) continue;
    seen.add(id);
    out.push({ site_id: 'official_ai', source: 'OpenAI Codex Changelog', title, url: `https://developers.openai.com/codex/changelog#${id}`, published_at: published, summary: '' });
  }
  return out;
}

async function fetchOfficial(now: Date): Promise<Item[]> {
  const out: Item[] = [];
  for (const feed of OFFICIAL_AI_FEEDS) {
    try { out.push(...officialFeedItems(await (await get(feed.xml_url, 20, { 'Accept-Language': LANG, Accept: FEED_ACCEPT })).text(), feed, now)); } catch {}
  }
  try { out.push(...parseAnthropicNews(await (await get('https://www.anthropic.com/news', 20)).text(), now)); } catch {}
  try { out.push(...parseCodexChangelog(await (await get('https://developers.openai.com/codex/changelog', 20)).text(), now)); } catch {}
  if (!out.length) throw new Error('No official AI update sources returned items');
  return out;
}

// ---- curated_media ----
export function curatedFeedItems(body: string, feed: Feed, now: Date): Item[] {
  const out: Item[] = [], seen = new Set<string>(), include = keywords(feed), max = Math.max(1, feed.max_entries || 8);
  for (const e of feedEntries(body)) {
    const title = fixMojibake(e.title), link = e.link.trim(), published = entryPublished(e, now);
    if (!title || !link || !published || published.getTime() < now.getTime() - CURATED_AI_MEDIA_MAX_AGE_DAYS * DAY) continue;
    const haystack = feed.strict_title_filter ? title.toLowerCase() : `${title.toLowerCase()} ${link.toLowerCase()} ${feed.title.toLowerCase()}`;
    if (include.length && !include.some(k => haystack.includes(k))) continue;
    const key = normalizeUrl(link);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ site_id: 'curated_media', source: feed.title, title, url: link, published_at: published, summary: '' });
    if (out.length >= max) break;
  }
  return out;
}

async function fetchCurated(now: Date): Promise<Item[]> {
  const out: Item[] = [], failures: string[] = [];
  for (const feed of CURATED_AI_MEDIA_FEEDS) {
    try { out.push(...curatedFeedItems(await (await get(feed.xml_url, 20, { 'Accept-Language': LANG, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' })).text(), feed, now)); }
    catch { failures.push(feed.title || feed.xml_url); }
  }
  if (!out.length && failures.length) throw new Error(`No curated media items parsed; failed feeds: ${failures.slice(0, 4).join(', ')}`);
  return out;
}

// ---- aibreakfast (beehiiv front page through r.jina.ai markdown) ----
export function parseAiBreakfast(markdown: string, now: Date): Item[] {
  const out: Item[] = [], seen = new Set<string>();
  const pattern = /([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+•\s+\d+\s+min read\s+###\s+\*\*([\s\S]*?)\*\*[\s\S]*?\]\((https?:\/\/aibreakfast\.beehiiv\.com\/p\/[^)]+)\)/g;
  for (const [, dateText, titleText, rawUrl] of (markdown || '').matchAll(pattern)) {
    const url = rawUrl.trim();
    if (!url || seen.has(url)) continue;
    const published = parseDate(dateText, now);
    if (!published || published.getTime() < now.getTime() - OFFICIAL_AI_MAX_AGE_DAYS * DAY) continue;
    seen.add(url);
    out.push({ site_id: 'aibreakfast', source: 'AI Breakfast', title: fixMojibake(squash(titleText)), url, published_at: published, summary: '' });
  }
  return out;
}

async function fetchAiBreakfast(now: Date): Promise<Item[]> {
  const out = parseAiBreakfast(await (await get(AIBREAKFAST_JINA_URL, 25, { 'Accept-Language': LANG, Accept: 'text/plain, */*' })).text(), now);
  if (!out.length) throw new Error('No AI Breakfast items parsed');
  return out;
}

// ---- followbuilders ----
export function parseFollowBuilders(feeds: Record<string, any>, now: Date): Item[] {
  const out: Item[] = [], list = (v: any): any[] => Array.isArray(v) ? v : [];
  for (const builder of list(feeds.x?.x)) {
    const name = String(builder.name || builder.handle || '').trim(), handle = String(builder.handle || '').trim();
    const source = `Follow Builders · X · ${name || handle}`.replace(/^[ ·]+|[ ·]+$/g, '');
    for (const tweet of list(builder.tweets)) {
      const text = String(tweet.text || '').trim(), url = String(tweet.url || '').trim(), published = parseDate(tweet.createdAt, now);
      if (!text || !url || !published) continue;
      let title = text.replace(/\s+/g, ' ');
      if (Array.from(title).length > 220) title = cut(title, 217).trimEnd() + '...';
      out.push({ site_id: 'followbuilders', source, title: fixMojibake(title), url, published_at: published, summary: '' });
    }
  }
  for (const [key, label] of [['blogs', 'Blog'], ['podcasts', 'Podcast']]) {
    for (const entry of list(feeds[key]?.[key])) {
      const title = String(entry.title || '').trim(), url = String(entry.url || '').trim();
      const published = parseDate(entry.publishedAt, now) ?? parseDate(feeds[key]?.generatedAt, now);
      if (!title || !url || !published) continue;
      out.push({ site_id: 'followbuilders', source: `Follow Builders · ${label} · ${entry.name || label}`, title: fixMojibake(title), url, published_at: published, summary: '' });
    }
  }
  return out;
}

async function fetchFollowBuilders(now: Date): Promise<Item[]> {
  const feeds: Record<string, any> = {};
  for (const key of ['x', 'blogs', 'podcasts']) feeds[key] = await (await get(`${FOLLOW_BUILDERS_FEED_BASE}/feed-${key}.json`, 20, { Accept: 'application/json, */*' })).json();
  const out = parseFollowBuilders(feeds, now);
  if (!out.length) throw new Error('No Follow Builders items parsed');
  return out;
}

// ---- techurls ----
export function parseTechurls(html: string, now: Date): Item[] {
  const out: Item[] = [];
  for (const block of htmlDoc(html).querySelectorAll('div.publisher-block')) {
    const p = block.querySelector('.publisher-text .primary'), s = block.querySelector('.publisher-text .secondary');
    const primary = p ? textOf(p) : (block.getAttribute('data-publisher') ?? 'unknown'), secondary = s ? textOf(s) : '';
    const source = secondary && secondary !== primary ? `${primary} · ${secondary}` : primary;
    for (const row of block.querySelectorAll('div.publisher-link')) {
      const a = row.querySelector('a.article-link');
      if (!a || !a.getAttribute('href')) continue;
      const aside = row.querySelector('.aside .text');
      const hint = aside ? (aside.getAttribute('title') || textOf(aside, ' ')) : '';
      out.push({ site_id: 'techurls', source, title: textOf(a, ' '), url: a.getAttribute('href')!.trim(), published_at: parseDate(hint, now), summary: '' });
    }
  }
  return out;
}

// ---- zeli ----
export function parseZeli(body: any, now: Date): Item[] {
  const out: Item[] = [];
  for (const p of Array.isArray(body?.posts) ? body.posts : []) {
    const title = String(p.title ?? '').trim(), url = String(p.url ?? '').trim();
    if (title && url) out.push({ site_id: 'zeli', source: 'Hacker News · 24h最热', title, url, published_at: parseUnix(p.time) ?? now, summary: '' });
  }
  return out;
}

// ---- hackernews (Algolia) ----
const hnPatterns = HN_ALGOLIA_KEYWORDS.map(k => new RegExp(`(?<![a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`));
export const hnKeywordScore = (title: string) => Math.min(1, hnPatterns.filter(p => p.test(title.toLowerCase())).length / 3);
const int = (v: unknown) => { const n = Math.trunc(Number(v || 0)); return Number.isFinite(n) ? n : 0; };

export function parseHnHits(payloads: [string, any][], now: Date): Item[] {
  const seen = new Set<string>(), out: (Item & { comments: number; points: number })[] = [];
  for (const [, payload] of payloads) {
    if (!Array.isArray(payload?.hits)) continue;
    for (const hit of payload.hits) {
      if (!hit || typeof hit !== 'object') continue;
      const id = String(hit.objectID || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const title = fixMojibake(firstNonEmpty(hit.title, hit.story_title));
      if (!title || hnKeywordScore(title) < HN_ALGOLIA_MIN_KEYWORD_SCORE) continue;
      const comments = int(hit.num_comments), points = int(hit.points);
      if (comments < HN_ALGOLIA_MIN_COMMENTS && points < HN_ALGOLIA_MIN_POINTS) continue;
      const published = parseDate(hit.created_at, now) ?? parseUnix(hit.created_at_i) ?? now;
      out.push({ site_id: 'hackernews', source: 'HN Algolia · AI 24h', title, url: String(hit.url || '').trim() || `https://news.ycombinator.com/item?id=${id}`, published_at: published, summary: '', comments, points });
    }
  }
  out.sort((a, b) => b.comments - a.comments || b.points - a.points || b.published_at!.getTime() - a.published_at!.getTime());
  return out.map(({ comments, points, ...item }) => item);
}

async function fetchHackerNews(now: Date): Promise<Item[]> {
  const start = Math.trunc((now.getTime() - 24 * HOUR) / 1000), payloads: [string, any][] = [], errors: string[] = [];
  for (const query of HN_ALGOLIA_QUERIES) {
    const params = new URLSearchParams({ query, tags: 'story', numericFilters: `created_at_i>${start}`, hitsPerPage: String(HN_ALGOLIA_HITS_PER_QUERY) });
    try { payloads.push([query, await (await get(`${HN_ALGOLIA_URL}?${params}`, 16, { Accept: 'application/json' })).json()]); }
    catch (error) { errors.push(`${query}: ${error instanceof Error ? error.message : error}`); }
    await sleep(HN_ALGOLIA_QUERY_PAUSE_SECONDS * 1000);
  }
  if (!payloads.length && errors.length) throw new Error(`HN Algolia queries failed: ${errors.slice(0, 3).join('; ')}`);
  return parseHnHits(payloads, now);
}

// ---- github_trending / producthunt (project_sources.py) ----
export function publicUrl(value: unknown, host: string): string {
  try {
    const u = new URL(String(value ?? '').trim());
    if (u.protocol !== 'https:' || ![host, `www.${host}`].includes(u.hostname) || u.username || u.password) return '';
    return `https://${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return ''; }
}
const project = (site_id: string, source: string, name: string, url: string, summary: string, published_at: Date | null): Item =>
  ({ site_id, source, title: summary ? `${name} — ${summary}` : name, url, published_at, summary });

export function parseGithubTrending(html: string): Item[] {
  const rows = [...htmlDoc(html).querySelectorAll('article.Box-row')];
  if (!rows.length) throw new Error('GitHub Trending returned no repository rows');
  const out: Item[] = [], seen = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    const href = String(row.querySelector('h2 a[href]')?.getAttribute('href') ?? '');
    if (!row.querySelector('h2 a[href]')) continue;
    const url = publicUrl(href.startsWith('/') ? `https://github.com${href}` : href, 'github.com');
    const path = url ? new URL(url).pathname.replace(/^\/+|\/+$/g, '') : '';
    if (!url || !/^[\w.-]+\/[\w.-]+$/.test(path) || seen.has(url)) continue;
    seen.add(url);
    const p = row.querySelector('p');
    out.push(project('github_trending', 'GitHub Trending', path, url, cut(cleanText(p ? textOf(p, ' ') : ''), 800), null));
  }
  if (!out.length) throw new Error('GitHub Trending repository links could not be parsed');
  return out;
}

const sourceTimestamp = (value: unknown) => value ? parseDate(String(value), new Date(0)) : null;
export function parseProducthunt(body: string, now: Date): Item[] {
  const entries = feedEntries(body);
  if (!entries.length) throw new Error('Product Hunt returned no feed entries');
  const out: Item[] = [], seen = new Set<string>();
  for (const e of entries.slice(0, 80)) {
    const name = cut(cleanText(e.title), 200), url = publicUrl(e.link, 'producthunt.com');
    if (!name || !url || seen.has(url)) continue;
    // Only a missing update permits a publication fallback (feedparser semantics of project_sources.py).
    const activity = e.updated !== undefined ? sourceTimestamp(e.updated) : sourceTimestamp(e.published);
    if (!activity || activity.getTime() < now.getTime() - 24 * HOUR || activity.getTime() > now.getTime()) continue;
    seen.add(url);
    const doc = htmlDoc(e.summary);
    for (const a of doc.querySelectorAll('a')) a.remove();
    // The time that orders the list is when the reader first saw the product, not the feed's dates.
    out.push(project('producthunt', 'Product Hunt', name, url, cut(cleanText(textOf(doc.body, ' ')).replace(/^[ |]+|[ |]+$/g, ''), 800), now));
  }
  return out;
}

// ---- collect_all ----
const TASKS: [string, string, (now: Date) => Promise<Item[]>][] = [
  ['official_ai', 'Official AI Updates', fetchOfficial],
  ['curated_media', 'Curated Media', fetchCurated],
  ['aibreakfast', 'AI Breakfast', fetchAiBreakfast],
  ['followbuilders', 'Follow Builders', fetchFollowBuilders],
  ['techurls', 'TechURLs', async now => parseTechurls(await (await get('https://techurls.com/', 30)).text(), now)],
  ['zeli', 'Zeli', async now => parseZeli(await (await get('https://zeli.app/api/hacker-news?type=hot24h', 30)).json(), now)],
  ['hackernews', 'Hacker News', fetchHackerNews],
  ['github_trending', 'GitHub Trending', async () => parseGithubTrending(await (await get(GITHUB_TRENDING_URL, 25)).text())],
  // Earlier sources can take minutes; feed updates are compared with the observation time.
  ['producthunt', 'Product Hunt', async now => { const body = await (await get(PRODUCTHUNT_FEED_URL, 25)).text(); return parseProducthunt(body, new Date(Math.max(now.getTime(), Date.now()))); }],
];

/** All sites run side by side; a failing site gives ok:false and never throws. Order follows TASKS. */
export async function collectWeb(now: Date): Promise<{ records: RecordData[]; statuses: WebStatus[] }> {
  const results = await Promise.all(TASKS.map(async ([site_id, site_name, fn]) => {
    const start = performance.now();
    let items: Item[] = [], error: string | null = null;
    try { items = await fn(now); } catch (e) { error = e instanceof Error ? e.message : String(e); }
    return { items, status: { site_id, site_name, ok: error === null, item_count: items.length, duration_ms: Math.trunc(performance.now() - start), error } };
  }));
  return {
    records: results.flatMap(r => r.items.map(i => ({ site_id: i.site_id, source: i.source, title: i.title, url: i.url, published_at: iso(i.published_at), summary: i.summary }))),
    statuses: results.map(r => r.status),
  };
}
