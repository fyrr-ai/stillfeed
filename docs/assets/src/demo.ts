// A demo Stillfeed state for the README screenshots: invented, neutral AI and data-engineering news from
// well-known public sources, a few posts by fictional X accounts, Hot picks, saved items, cached readings and
// summaries, and locally drawn images. Nothing here comes from a real Stillfeed home or the network.
//   bun docs/assets/src/demo.ts <state-dir>    prints {"reader": <article id>, "remote": <url → file map>}
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store, canonical, hash, type RecordData } from '../../../src/store';
import { Reader, type Reading } from '../../../src/reader';
import { Summaries } from '../../../src/summary';
import { toRecord } from '../../../src/tweets';
import { Hot } from '../../../src/hot';
import { Suggestions } from '../../../src/suggest';
import { avatar, cover, mark, PALETTES, type Motif, type Palette } from './art';

const MINUTE = 60_000, DAY = 86_400_000;
type Art = [Motif, keyof typeof PALETTES];
type Post = { ago: number; handle: string; name: string; tone: keyof typeof PALETTES; text: string; likes: number; replies: number; reposts: number; views: number;
  photo?: Art; article?: { title: string; preview: string; art: Art }; quote?: { handle: string; name: string; text: string } };
type Story = { ago: number; source: string; url: string; title: string; art?: Art; author?: string };

const stories: Story[] = [
  { ago: 12, source: 'Hugging Face Blog', url: 'https://huggingface.co/blog/open-coder-14b', title: 'A 14B open-weight coding model that keeps up with much larger ones', art: ['code', 'violet'] },
  { ago: 41, source: 'Simon Willison', url: 'https://simonwillison.net/2026/Nov/16/local-coding-agent/', title: 'Notes on a week with a local model as my coding agent' },
  { ago: 58, source: 'Latent Space', url: 'https://www.youtube.com/watch?v=Lsp8Agents01', title: 'What actually breaks when agents run for hours', art: ['waves', 'indigo'] },
  { ago: 74, source: 'DuckDB Blog', url: 'https://duckdb.org/2026/11/16/writing-iceberg-tables', title: 'DuckDB can now write Iceberg tables', art: ['stack', 'amber'], author: 'The DuckDB team' },
  { ago: 120, source: 'ClickHouse Blog', url: 'https://clickhouse.com/blog/lazy-materialization-top-n', title: 'Lazy materialization: how we halved top-N query latency', art: ['chart', 'teal'] },
  { ago: 180, source: 'LangChain Blog', url: 'https://blog.langchain.dev/trajectory-tests-for-agents/', title: 'Trajectory tests: evaluating long-running agents step by step', art: ['nodes', 'blue'] },
  { ago: 214, source: 'Hacker News', url: 'https://news.ycombinator.com/item?id=46012345', title: 'Show HN: Vector search in 300 lines of SQLite' },
  { ago: 250, source: 'dbt Developer Blog', url: 'https://docs.getdbt.com/blog/semantic-layer-in-practice', title: 'Define a metric once: the semantic layer in practice', art: ['grid', 'green'] },
  { ago: 330, source: 'PyTorch Blog', url: 'https://pytorch.org/blog/compiled-attention-kernels/', title: 'Faster inference with compiled attention kernels', art: ['bars', 'rose'] },
  { ago: 380, source: 'Sebastian Raschka', url: 'https://magazine.sebastianraschka.com/p/reasoning-models-from-scratch', title: 'Understanding reasoning models from the ground up', art: ['rings', 'violet'] },
  { ago: 420, source: 'AI Explained', url: 'https://www.youtube.com/watch?v=AiExBench002', title: 'Benchmarks are saturating. What should we measure next?', art: ['bars', 'amber'] },
  { ago: 470, source: 'Martin Fowler', url: 'https://martinfowler.com/articles/rag-patterns.html', title: 'Patterns for retrieval-augmented generation in production' },
  { ago: 520, source: 'Polars Blog', url: 'https://pola.rs/posts/streaming-engine-default/', title: 'The new streaming engine is now the default in Polars', art: ['waves', 'teal'] },
  { ago: 600, source: 'Ai2 Blog', url: 'https://allenai.org/blog/open-small-lm-dataset', title: 'A fully open dataset for training small language models', art: ['grid', 'indigo'] },
  { ago: 680, source: 'The Pragmatic Engineer', url: 'https://newsletter.pragmaticengineer.com/p/ai-coding-tools-in-practice', title: 'How engineering teams actually use AI coding tools', art: ['chart', 'blue'] },
  { ago: 760, source: 'Cloudflare Blog', url: 'https://blog.cloudflare.com/embeddings-at-the-edge/', title: 'Running embedding models at the edge', art: ['nodes', 'amber'] },
  { ago: 840, source: 'Google Research Blog', url: 'https://research.google/blog/compact-on-device-translation/', title: 'A compact model for on-device translation', art: ['rings', 'teal'] },
  { ago: 900, source: 'Interconnects', url: 'https://www.interconnects.ai/p/post-training-progress', title: 'Why post-training is where the progress is' },
  { ago: 1010, source: 'MIT Technology Review AI', url: 'https://www.technologyreview.com/2026/11/15/ai-data-centers-power/', title: 'The quiet race to make AI data centers use less power', art: ['grid', 'rose'] },
];

const posts: Post[] = [
  { ago: 26, handle: 'priyaraman_data', name: 'Priya Raman', tone: 'green', likes: 1240, replies: 86, reposts: 173, views: 98000, photo: ['chart', 'green'],
    text: 'Moved our nightly dbt build from 41 minutes to 7.\n\nNothing clever: incremental models for the three biggest marts, DuckDB for the local dev loop, and dropping two models nobody had queried since March.' },
  { ago: 95, handle: 'tomas_ortega', name: 'Tomás Ortega', tone: 'amber', likes: 2310, replies: 141, reposts: 402, views: 210000,
    text: 'Most RAG problems are search problems.\n\nBefore you swap the embedding model: check your chunking, add BM25 next to the vectors, and read the twenty queries that fail most often.' },
  { ago: 150, handle: 'meilin_evals', name: 'Mei Lin', tone: 'violet', likes: 512, replies: 23, reposts: 64, views: 41000,
    text: 'The most useful framing of evals I have read this year.', quote: { handle: 'arjun_builds', name: 'Arjun Mehta', text: 'Evals are product specs you can run. If you cannot write the test, you do not yet know what you want the model to do.' } },
  { ago: 290, handle: 'jonasweber', name: 'Jonas Weber', tone: 'blue', likes: 876, replies: 58, reposts: 121, views: 67000,
    text: 'Wrote up six months of running agents on our data platform.',
    article: { title: 'Six months of agents on our data platform', preview: 'What we automated, what we rolled back, and the one guardrail we would add on day one.', art: ['nodes', 'indigo'] } },
  { ago: 560, handle: 'saraokafor', name: 'Sara Okafor', tone: 'rose', likes: 689, replies: 34, reposts: 77, views: 52000,
    text: 'Small change that made our on-call calmer: every alert links to the dashboard and to the query behind it.\n\nNobody has to guess what "error rate" means at 3 a.m.' },
];

const hot: [string, string][] = [
  ['https://duckdb.org/2026/11/16/writing-iceberg-tables', 'You run DuckDB and Iceberg at work: this removes the Spark step from your local pipeline tests.'],
  ['https://x.com/jonasweber/status/1990000000000000003', 'A first-hand account of agents on a data platform, including what had to be rolled back.'],
  ['https://huggingface.co/blog/open-coder-14b', 'An open coding model small enough to run on your own machine, close to the hosted agents you use.'],
  ['https://www.youtube.com/watch?v=Lsp8Agents01', 'Three of your sources point to this talk on failure modes of long-running agents.'],
];
const saved = ['https://magazine.sebastianraschka.com/p/reasoning-models-from-scratch', 'https://martinfowler.com/articles/rag-patterns.html',
  'https://x.com/priyaraman_data/status/1990000000000000000', 'https://newsletter.pragmaticengineer.com/p/ai-coding-tools-in-practice',
  'https://x.com/tomas_ortega/status/1990000000000000001', 'https://pola.rs/posts/streaming-engine-default/'];

const READER = 'https://duckdb.org/2026/11/16/writing-iceberg-tables';
const readings: Record<string, { html: string; points: string[] }> = {
  [READER]: {
    points: [
      'DuckDB can now create Iceberg tables and append, update and delete rows in them, not only read them.',
      'Writes go through a REST catalog or plain object storage, and every commit is a regular Iceberg snapshot other engines can read.',
      'Local tests of lakehouse pipelines no longer need a Spark or Trino cluster; one process on a laptop is enough.',
    ],
    html: `<p>Since the first release of the <code>iceberg</code> extension, DuckDB could read Apache Iceberg tables. Starting today it can also write them: create a table, insert, update and delete rows, and commit the result as a new snapshot that any other Iceberg engine can read.</p>
<figure><img src="https://duckdb.org/images/blog/iceberg-writes.png" alt="" width="1200" height="675"><figcaption>Every write is a regular Iceberg snapshot.</figcaption></figure>
<h2>Writing to a catalog</h2>
<p>Attach a REST catalog the same way you attach any other database, then use plain SQL. Transactions span several statements, and a failed commit leaves the table untouched.</p>
<pre><code>ATTACH 'warehouse' AS lake (TYPE iceberg, ENDPOINT 'https://catalog.example.com');
CREATE TABLE lake.events AS SELECT * FROM 'events/*.parquet';
DELETE FROM lake.events WHERE event_date &lt; DATE '2026-01-01';</code></pre>
<h2>What it is for</h2>
<p>The most common request was simple: test lakehouse pipelines on a laptop. With writes in DuckDB, a dbt project or a small Python job can produce the same tables locally that production produces in the cluster, and compare the two.</p>
<p>Partitioned writes, schema evolution and position deletes are supported in this release; equality deletes and table maintenance follow in the next one.</p>`,
  },
  'https://huggingface.co/blog/open-coder-14b': {
    points: [
      'A new 14-billion-parameter open-weight model scores close to much larger models on repository-level coding tasks.',
      'It was trained on permissively licensed code with long-context agent traces and runs on a single 24 GB GPU when quantized.',
      'Weights, the evaluation harness and the data recipe are released under Apache 2.0.',
    ],
    html: '<p>Today we are releasing a 14B open-weight model for coding agents, together with its evaluation harness and data recipe.</p><p>On repository-level tasks it scores within a few points of models several times its size, and it fits on a single 24 GB GPU when quantized.</p>',
  },
};

const at = (ago: number, now: number) => new Date(now - ago * MINUTE).toISOString();
const tweetId = (i: number) => String(1990000000000000000n + BigInt(i));
const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');

export function createDemo(dir: string) {
  const now = Math.floor(Date.now() / 1000) * 1000, generatedAt = new Date(now).toISOString();
  const media = dir, remote: Record<string, string> = {};
  mkdirSync(join(dir, 'remote'), { recursive: true });
  /** A picture the browser would fetch from elsewhere; the screenshot script serves it from this file. */
  const serve = (url: string, svg: string) => { const file = join(dir, 'remote', sha1(url) + '.svg'); writeFileSync(file, svg); remote[url] = file; return url; };
  const pal = (key: keyof typeof PALETTES): Palette => PALETTES[key]!;

  const records: RecordData[] = [], images = new Map<string, string>();
  stories.forEach((s, i) => {
    records.push({ site_id: s.source === 'Hacker News' ? 'hackernews' : 'opmlrss', source: s.source, url: s.url, title: s.title, published_at: at(s.ago, now),
      summary: '', author: s.author ?? '', ai_is_related: true });
    if (s.art) images.set(canonical(s.url), cover(101 + i * 37, s.art[0], pal(s.art[1])));
  });
  posts.forEach((p, i) => {
    const raw: Record<string, unknown> = {
      id_str: tweetId(i), tweet_created_at: at(p.ago, now), full_text: p.text,
      user: { screen_name: p.handle, name: p.name, profile_image_url_https: serve(`https://pbs.twimg.com/profile_images/demo/${p.handle}_400x400.jpg`, avatar(i + 3, pal(p.tone))) },
      favorite_count: p.likes, reply_count: p.replies, retweet_count: p.reposts, views_count: p.views, entities: { urls: [] },
    };
    if (p.photo) raw.extended_entities = { media: [{ type: 'photo', url: `https://t.co/demo${i}`, media_url_https: serve(`https://pbs.twimg.com/media/demo-${p.handle}.jpg`, cover(500 + i, p.photo[0], pal(p.photo[1]), 1200, 750)), original_info: { width: 1200, height: 750 } }] };
    if (p.article) {
      const url = `https://x.com/i/article/88${i}`;
      raw.full_text = `${p.text} https://t.co/art${i}`;
      raw.entities = { urls: [{ url: `https://t.co/art${i}`, expanded_url: url, display_url: `x.com/i/article/88${i}` }] };
      raw.stillfeed_article = { title: p.article.title, preview: p.article.preview, url, image: serve(`https://pbs.twimg.com/media/demo-article-${p.handle}.jpg`, cover(700 + i, p.article.art[0], pal(p.article.art[1]))) };
    }
    if (p.quote) { raw.quoted_status_id_str = tweetId(100 + i); raw.quoted_status = { id_str: tweetId(100 + i), full_text: p.quote.text, user: { screen_name: p.quote.handle, name: p.quote.name } }; }
    const tweet = toRecord(raw);
    if (!tweet) throw new Error(`Demo post ${p.handle} is invalid`);
    const article = (tweet.article ?? {}) as { title?: string; preview?: string };
    records.push({ site_id: 'opmlrss', source: 'X follows', title: `${tweet.text} ${article.title ?? ''} ${article.preview ?? ''}`.trim(),
      url: `https://x.com/${tweet.handle}/status/${tweet.id}`, published_at: new Date(Number(tweet.published) * 1000).toISOString(), tweet, ai_is_related: true });
  });
  // Older, already seen updates give the Sources page realistic counts; they are outside the feed's 72-hour window.
  const busy = ['Hugging Face Blog', 'Simon Willison', 'Latent Space', 'OpenAI News', 'Google DeepMind Blog', 'LangChain Blog', 'Anthropic Engineering',
    'Sebastian Raschka', 'Interconnects', 'Import AI', 'PyTorch Blog', 'Hacker News', 'Cloudflare Blog', 'Ai2 Blog', 'Mistral AI News', 'The Batch (DeepLearning.AI)',
    'Martin Fowler', 'Google Research Blog', 'One Useful Thing', 'Ollama Releases', 'Cursor Changelog', 'MIT Technology Review AI', 'Hamel Husain', 'Philipp Schmid'];
  const older: RecordData[] = [];
  busy.forEach((source, s) => { for (let i = 0; i < 38 - s; i++) older.push({ site_id: source === 'Hacker News' ? 'hackernews' : 'opmlrss', source, ai_is_related: true,
    url: `https://archive.example.com/${s}/${i}`, title: `${source}: earlier update ${i + 1}`, published_at: new Date(now - (4 + ((i * 7 + s) % 22)) * DAY).toISOString() }); });

  const store = new Store(dir);
  store.ingest([...older, ...records], generatedAt);
  for (const r of older) store.db.query('INSERT OR IGNORE INTO seen VALUES(?,?)').run(hash(canonical(r.url)), now - DAY);

  // Readings and summaries, written the way the reader worker writes them.
  new Reader(store); const summaries = new Summaries(store);
  for (const [url, { html, points }] of Object.entries(readings)) {
    const id = hash(canonical(url)), row = store.db.query('SELECT title,author FROM articles WHERE id=?').get(id) as { title: string; author: string | null };
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const reading: Reading = { title: row.title, author: row.author ?? '', html, text, url: canonical(url), fetchedAt: now };
    store.db.query('INSERT OR REPLACE INTO article_content VALUES(?,?,?)').run(id, JSON.stringify(reading), now);
    summaries.save(id, reading, points, 'claude-opus-5-5');
  }
  serve('https://duckdb.org/images/blog/iceberg-writes.png', cover(42, 'stack', pal('amber')));

  new Hot(store); new Suggestions(store);
  hot.forEach(([url, reason], i) => store.db.query('INSERT OR REPLACE INTO hot_picks VALUES(?,?,?,?)').run(hash(canonical(url)), reason, now - i * MINUTE, 'claude-opus-5-5'));
  saved.forEach((url, i) => store.db.query('INSERT OR REPLACE INTO saved VALUES(?,?)').run(hash(canonical(url)), now - (i + 1) * 3 * 3600_000));
  store.db.query("UPDATE feeds SET checked_at=?").run(now);

  // Two source suggestions, as the suggestion job would leave them.
  for (const [kind, key, name, mentions, reason] of [
    ['site', 'motherduck.com', 'MotherDuck Blog', 6, 'Practical DuckDB and lakehouse posts; your data sources cite it every week.'],
    ['x', 'priyaraman_data', 'Priya Raman', 4, 'Concrete dbt and warehouse cost write-ups, often shared by people you follow.'],
  ] as const) store.db.query("INSERT OR REPLACE INTO suggestions VALUES(?,?,?,?,?,?,?, 'new', ?)").run(hash(kind + key), kind, key, name, mentions, reason, '[]', now);

  // The image cache (src/media.ts): drawn previews and site marks, a remembered miss for everything else, so the
  // server never goes to the network for a picture.
  const articles = store.db.query('SELECT url FROM articles').all() as { url: string }[];
  mkdirSync(join(media, 'previews'), { recursive: true }); mkdirSync(join(media, 'favicons'), { recursive: true });
  for (const { url } of articles) {
    const path = join(media, 'previews', sha1(url)), svg = images.get(url);
    if (svg) { writeFileSync(path + '.img', svg); writeFileSync(path + '.type', 'image/svg+xml'); } else writeFileSync(path + '.miss', '');
  }
  const marks: Record<string, [string, string, string?]> = {
    'huggingface.co': ['H', '#f5b800', '#111'], 'simonwillison.net': ['S', '#2b6cb0'], 'www.youtube.com': ['▶', '#e5322d'], 'duckdb.org': ['D', '#fff100', '#111'],
    'clickhouse.com': ['C', '#faff69', '#111'], 'blog.langchain.dev': ['L', '#1c3c3c'], 'news.ycombinator.com': ['Y', '#ff6600'], 'docs.getdbt.com': ['d', '#ff694a'],
    'pytorch.org': ['P', '#ee4c2c'], 'magazine.sebastianraschka.com': ['R', '#4f46e5'], 'martinfowler.com': ['M', '#334155'], 'pola.rs': ['P', '#0075ff'],
    'allenai.org': ['A', '#f0529c'], 'newsletter.pragmaticengineer.com': ['P', '#d97706'], 'blog.cloudflare.com': ['C', '#f38020'], 'research.google': ['G', '#4285f4'],
    'www.interconnects.ai': ['I', '#0f766e'], 'www.technologyreview.com': ['T', '#e11d48'],
  };
  for (const host of new Set(articles.map(a => new URL(a.url).hostname))) {
    const path = join(media, 'favicons', sha1(host)), m = marks[host];
    if (m) { writeFileSync(path + '.img', mark(m[0], m[1], m[2])); writeFileSync(path + '.type', 'image/svg+xml'); } else writeFileSync(path + '.miss', '');
  }
  store.close();
  return { reader: hash(canonical(READER)), remote };
}

if (import.meta.main) {
  const dir = Bun.argv[2];
  if (!dir) throw new Error('Usage: bun docs/assets/src/demo.ts <state-dir>');
  console.log(JSON.stringify(createDemo(dir)));
}
