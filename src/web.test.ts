import { expect, test } from 'bun:test';
import { cleanText, curatedFeedItems, feedEntries, fixMojibake, hnKeywordScore, iso, normalizeUrl, officialFeedItems, parseAiBreakfast, parseAnthropicNews, parseCodexChangelog, parseDate, parseFollowBuilders, parseGithubTrending, parseHnHits, parseProducthunt, parseRelativeZh, parseTechurls, parseZeli, publicUrl } from './web';

const now = new Date('2026-11-16T12:00:00Z');

test('dates follow parse_date_any', () => {
  expect(iso(parseDate('1794830400', now))).toBe('2026-11-16T12:00:00Z');
  expect(iso(parseDate('1794830400000', now))).toBe('2026-11-16T12:00:00Z');
  expect(iso(parseDate('$D2026-11-16T10:00:00Z', now))).toBe('2026-11-16T10:00:00Z');
  expect(iso(parseDate('Nov 14, 2026', now))).toBe('2026-11-14T00:00:00Z');
  expect(iso(parseDate('2026-11-14T10:00:00', now))).toBe('2026-11-14T10:00:00Z');
  expect(iso(parseDate('Sat, 15 Nov 2026 12:00:00 CET', now))).toBe('2026-11-15T11:00:00Z');
  expect(iso(parseDate('Sat, 15 Nov 2026 12:00:00 EST', now))).toBe('2026-11-15T17:00:00Z');
  expect(iso(parseDate('Sat, 15 Nov 2026 12:00:00 GMT', now))).toBe('2026-11-15T12:00:00Z');
  expect(iso(parseDate('2026-02-19 11:54:21PM UTC', now))).toBe('2026-02-19T23:54:21Z');
  expect(parseDate('not a date', now)).toBeNull();
  expect(iso(new Date('2026-11-16T12:00:00.123Z'))).toBe('2026-11-16T12:00:00.123000Z');
});

test('relative Chinese times', () => {
  expect(iso(parseRelativeZh('5分钟前', now))).toBe('2026-11-16T11:55:00Z');
  expect(iso(parseRelativeZh('3 小时前', now))).toBe('2026-11-16T09:00:00Z');
  expect(iso(parseRelativeZh('2天前', now))).toBe('2026-11-14T12:00:00Z');
  expect(iso(parseRelativeZh('刚刚', now))).toBe('2026-11-16T12:00:00Z');
  expect(iso(parseRelativeZh('今天 13:30', now))).toBe('2026-11-15T13:30:00Z');
  expect(iso(parseRelativeZh('09:15', now))).toBe('2026-11-16T09:15:00Z');
  expect(iso(parseRelativeZh('12月25日', now))).toBe('2025-12-25T00:00:00Z');
  expect(iso(parseRelativeZh('2026年11月1日', now))).toBe('2026-11-01T00:00:00Z');
});

test('url, text and mojibake helpers', () => {
  expect(normalizeUrl('HTTPS://Example.COM/a/?utm_source=x&id=1&ref=y#frag')).toBe('https://example.com/a/?id=1');
  expect(normalizeUrl('/relative')).toBe('/relative');
  expect(fixMojibake('Itâ€™s cafÃ©')).toBe('It’s café');
  expect(fixMojibake('café')).toBe('café');
  expect(publicUrl('https://www.producthunt.com/products/x/?a=1', 'producthunt.com')).toBe('https://www.producthunt.com/products/x');
  expect(publicUrl('http://github.com/a/b', 'github.com')).toBe('');
  expect(cleanText('  <b>Cook&#39;s</b>   AMA ')).toBe("Cook's AMA");
});

const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><atom:link rel="self" href="https://f/feed"/>
<item><title><![CDATA[OpenAI ships GPT &amp; agents]]></title><link>https://a.com/1?utm_source=rss</link><pubDate>Sat, 14 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>OpenAI ships GPT &amp; agents dup</title><link>https://a.com/1</link><pubDate>Sat, 14 Nov 2026 11:00:00 GMT</pubDate></item>
<item><title>Phones are back</title><guid>https://a.com/2</guid><pubDate>Sat, 14 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Old AI news</title><link>https://a.com/3</link><pubDate>Sat, 01 Aug 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Add hatch skill</title><link rel="alternate" href="https://github.com/openai/skills/commit/1"/><updated>2026-11-15T08:00:00Z</updated></entry>
<entry><title>Fix typo</title><link href="https://github.com/openai/skills/commit/2"/><updated>2026-11-15T08:00:00Z</updated></entry></feed>`;

test('feed entries: RSS, Atom, guid fallback', () => {
  const e = feedEntries(rss);
  expect(e.map(x => x.link)).toEqual(['https://a.com/1?utm_source=rss', 'https://a.com/1', 'https://a.com/2', 'https://a.com/3']);
  // feedparser keeps CDATA literally and decodes escaped markup once.
  expect(e[0].title).toBe('OpenAI ships GPT &amp; agents');
  expect(e[1].title).toBe('OpenAI ships GPT & agents dup');
  expect(feedEntries(atom)[0]).toMatchObject({ title: 'Add hatch skill', link: 'https://github.com/openai/skills/commit/1', updated: '2026-11-15T08:00:00Z' });
  expect(feedEntries('<html>not xml')).toEqual([]);
});

test('official feeds keep 45 days and apply keyword allow-lists', () => {
  expect(officialFeedItems(rss, { title: 'T', xml_url: '', html_url: '' }, now).map(i => i.url)).toEqual(['https://a.com/1?utm_source=rss', 'https://a.com/1', 'https://a.com/2']);
  const skills = officialFeedItems(atom, { title: 'OpenAI Skills', xml_url: '', html_url: '', include_keywords: 'hatch,pet' }, now);
  expect(skills).toEqual([{ site_id: 'official_ai', source: 'OpenAI Skills', title: 'Add hatch skill', url: 'https://github.com/openai/skills/commit/1', published_at: new Date('2026-11-15T08:00:00Z'), summary: '' }]);
});

test('curated feeds dedupe normalized URLs, filter titles strictly, cap entries', () => {
  const feed = { title: 'The Verge', xml_url: '', html_url: '', include_keywords: 'ai,openai', strict_title_filter: true, max_entries: 6 };
  expect(curatedFeedItems(rss, feed, now).map(i => [i.title, i.url])).toEqual([['OpenAI ships GPT &amp; agents', 'https://a.com/1?utm_source=rss']]);
  expect(curatedFeedItems(rss, { title: 'X', xml_url: '', html_url: '', max_entries: 1 }, now)).toHaveLength(1);
});

test('Anthropic news and Codex changelog pages', () => {
  const news = `<a href="/news/claude-5"><h3>Claude 5</h3><time datetime="2026-11-10">Nov 10</time></a><a href="/news/claude-5"><h3>Claude 5</h3><time datetime="2026-11-10"></time></a><a href="/news"><h3>News</h3></a><a href="/news/old"><h2>Old</h2><time>Jan 1, 2026</time></a>`;
  expect(parseAnthropicNews(news, now)).toEqual([{ site_id: 'official_ai', source: 'Anthropic News', title: 'Claude 5', url: 'https://www.anthropic.com/news/claude-5', published_at: new Date('2026-11-10T00:00:00Z'), summary: '' }]);
  const codex = `<ul id="codex-changelog-content"><li id="v1"><time datetime="2026-11-12">x</time><h3>Codex  <span>CLI 1.0</span></h3></li><li id="v2"><h3>no time</h3></li></ul>`;
  expect(parseCodexChangelog(codex, now).map(i => [i.title, i.url])).toEqual([['Codex CLI 1.0', 'https://developers.openai.com/codex/changelog#v1']]);
});

test('AI Breakfast markdown from r.jina.ai', () => {
  const md = `[![Image](https://img/x.png) Nov 13, 2026 • 5 min read ### **Jensen Out,\n Claude Outage** ![Image 3](https://img/y.png) AI Breakfast](https://aibreakfast.beehiiv.com/p/jensen-out)
[![Image](https://img/z.png) Jan 1, 2026 • 5 min read ### **Too old** x](https://aibreakfast.beehiiv.com/p/old)`;
  expect(parseAiBreakfast(md, now)).toEqual([{ site_id: 'aibreakfast', source: 'AI Breakfast', title: 'Jensen Out, Claude Outage', url: 'https://aibreakfast.beehiiv.com/p/jensen-out', published_at: new Date('2026-11-13T00:00:00Z'), summary: '' }]);
});

test('Follow Builders JSON feeds', () => {
  const long = 'word '.repeat(60);
  const items = parseFollowBuilders({
    x: { x: [{ name: 'Andrej', handle: 'karpathy', tweets: [{ text: 'Hello\n  world', url: 'https://x.com/k/status/1', createdAt: '2026-11-15T10:00:00.000Z' }, { text: long, url: 'https://x.com/k/status/2', createdAt: '2026-11-15T10:00:00Z' }, { text: 'no date', url: 'https://x.com/k/status/3' }] }] },
    blogs: { generatedAt: '2026-11-16T00:00:00Z', blogs: [{ title: 'Post', url: 'https://b.com/p', name: 'Lab' }] },
    podcasts: { podcasts: [{ title: 'Ep', url: 'https://p.com/e', publishedAt: '2026-11-14T00:00:00Z' }] },
  }, now);
  expect(items.map(i => [i.source, i.title.length, i.url, iso(i.published_at)])).toEqual([
    ['Follow Builders · X · Andrej', 11, 'https://x.com/k/status/1', '2026-11-15T10:00:00Z'],
    ['Follow Builders · X · Andrej', 220, 'https://x.com/k/status/2', '2026-11-15T10:00:00Z'],
    ['Follow Builders · Blog · Lab', 4, 'https://b.com/p', '2026-11-16T00:00:00Z'],
    ['Follow Builders · Podcast · Podcast', 2, 'https://p.com/e', '2026-11-14T00:00:00Z'],
  ]);
  expect(items[1].title.endsWith('wo...')).toBe(true);
});

test('TechURLs publisher blocks', () => {
  const html = `<div class="publisher-block" data-publisher="hn"><div class="publisher-text"><span class="primary">Hacker News</span><span class="secondary">Front</span></div>
  <div class="publisher-link"><a class="article-link" href=" https://a.com/x ">Cook&#39;s  <b>AMA</b></a><div class="aside"><span class="text" title="2026-11-16 09:30:00AM UTC">2h</span></div></div>
  <div class="publisher-link"><a class="article-link">no href</a></div></div>
  <div class="publisher-block" data-publisher="lobsters"><div class="publisher-link"><a class="article-link" href="https://b.com">B</a><div class="aside"><span class="text">3小时前</span></div></div></div>`;
  expect(parseTechurls(html, now).map(i => [i.source, i.title, i.url, iso(i.published_at)])).toEqual([
    ['Hacker News · Front', "Cook's AMA", 'https://a.com/x', '2026-11-16T09:30:00Z'],
    ['lobsters', 'B', 'https://b.com', '2026-11-16T09:00:00Z'],
  ]);
});

test('Zeli hot posts', () => {
  expect(parseZeli({ posts: [{ title: 'A', url: 'https://a', time: 1794830000 }, { title: 'B', url: 'https://b' }, { title: '', url: 'https://c' }] }, now).map(i => [i.source, i.url, iso(i.published_at)]))
    .toEqual([['Hacker News · 24h最热', 'https://a', '2026-11-16T11:53:20Z'], ['Hacker News · 24h最热', 'https://b', '2026-11-16T12:00:00Z']]);
});

test('HN Algolia: keyword score, engagement floor, dedupe, sort', () => {
  expect(hnKeywordScore('OpenAI and Anthropic')).toBeCloseTo(2 / 3);
  expect(hnKeywordScore('Claude Code release')).toBeCloseTo(2 / 3);
  expect(hnKeywordScore('GPTs everywhere')).toBe(0);
  const hits = [
    { objectID: '1', title: 'OpenAI model eval', points: 50, num_comments: 3, created_at: '2026-11-16T08:00:00Z', url: 'https://a.com' },
    { objectID: '2', title: 'Claude Code agent', points: 1, num_comments: 9, created_at: '2026-11-16T09:00:00Z' },
    { objectID: '3', title: 'Just OpenAI', points: 500, num_comments: 500 },
    { objectID: '4', title: 'OpenAI LLM', points: 5, num_comments: 1 },
    { objectID: '1', title: 'OpenAI model eval', points: 50, num_comments: 3 },
  ];
  expect(parseHnHits([['OpenAI', { hits }], ['Claude', { hits: 'bad' }]], now).map(i => [i.url, i.source])).toEqual([
    ['https://news.ycombinator.com/item?id=2', 'HN Algolia · AI 24h'], ['https://a.com', 'HN Algolia · AI 24h'],
  ]);
});

test('GitHub Trending rows', () => {
  const html = `<article class="Box-row"><h2><a href="/owner/repo">owner / repo</a></h2><p>  A &lt;fast&gt;   agent  </p><span>1,234 stars today</span></article>
  <article class="Box-row"><h2><a href="/owner/repo">dup</a></h2></article><article class="Box-row"><h2><a href="/sponsors/x/y/z">bad</a></h2></article>
  <article class="Box-row"><h2><a href="/a/b">a / b</a></h2></article>`;
  expect(parseGithubTrending(html)).toEqual([
    { site_id: 'github_trending', source: 'GitHub Trending', title: 'owner/repo — A agent', url: 'https://github.com/owner/repo', published_at: null, summary: 'A agent' },
    { site_id: 'github_trending', source: 'GitHub Trending', title: 'a/b', url: 'https://github.com/a/b', published_at: null, summary: '' },
  ]);
  expect(() => parseGithubTrending('<p>nothing</p>')).toThrow('no repository rows');
});

test('Product Hunt feed: 24 h activity window, footer links removed', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><published>2026-11-12T15:32:53-08:00</published><updated>2026-11-16T02:18:57-08:00</updated><link rel="alternate" type="text/html" href="https://www.producthunt.com/products/emayler"/><title>Emayler</title>
  <content type="html">&lt;p&gt; Custom email on your domain &lt;/p&gt;&lt;p&gt;&lt;a href="x"&gt;Discussion&lt;/a&gt; | &lt;a href="y"&gt;Link&lt;/a&gt;&lt;/p&gt;</content></entry>
  <entry><published>2026-11-16T01:00:00Z</published><link href="https://www.producthunt.com/products/fresh"/><title>Fresh</title><content type="html">Tagline</content></entry>
  <entry><published>2026-11-16T01:00:00Z</published><updated>2026-11-10T01:00:00Z</updated><link href="https://www.producthunt.com/products/stale"/><title>Stale</title></entry>
  <entry><updated>2026-11-16T01:00:00Z</updated><link href="https://evil.com/products/x"/><title>Elsewhere</title></entry></feed>`;
  expect(parseProducthunt(xml, now)).toEqual([
    { site_id: 'producthunt', source: 'Product Hunt', title: 'Emayler — Custom email on your domain', url: 'https://www.producthunt.com/products/emayler', published_at: now, summary: 'Custom email on your domain' },
    { site_id: 'producthunt', source: 'Product Hunt', title: 'Fresh — Tagline', url: 'https://www.producthunt.com/products/fresh', published_at: now, summary: 'Tagline' },
  ]);
  expect(() => parseProducthunt('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', now)).toThrow('no feed entries');
});
