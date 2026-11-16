// Synthetic Stillfeed state for the browser suite (tests/ui.mjs): no network, no real Stillfeed home.
//   bun tests/fixture.ts create <state-dir>                      fresh stillfeed.db; prints {generatedAt,urls,xArticle,quote}
//   bun tests/fixture.ts add <state-dir> <generatedAt> <records>  ingests more records (a JSON array), like a collection
import { Store, canonical, type RecordData } from '../src/store';
import { Reader } from '../src/reader';
import { Summaries } from '../src/summary';
import { toRecord } from '../src/tweets';

const MINUTE = 60000;
const BLOGS = [
  { source: 'Example AI Blog', host: 'ai-blog.example.com' },
  { source: 'Data Weekly', host: 'dataweekly.example.org' },
  { source: 'Tool Notes', host: 'toolnotes.example.net' },
];
const PEOPLE = [['ada_ai', 'Ada Builder'], ['data_dan', 'Dan Pipelines'], ['toolsmith', 'Tool Smith']] as const;

/** A raw SocialData tweet, turned into the stored record exactly as the collector does (src/collect.ts classify). */
function post(i: number, at: number, extra: Record<string, unknown> = {}): RecordData {
  const [handle, name] = PEOPLE[i % PEOPLE.length]!;
  const raw = {
    id_str: String(1900000000000000000n + BigInt(i)), tweet_created_at: new Date(at).toISOString(),
    full_text: `Post ${i}: trying a new AI coding agent on a real data pipeline &amp; it held up.\nSecond line stays.`,
    user: { screen_name: handle, name, profile_image_url_https: `https://pbs.twimg.com/profile_images/${handle}.jpg` },
    favorite_count: 10 + i, reply_count: i % 7, retweet_count: i % 5, views_count: 1000 + i * 10,
    entities: { urls: [{ url: `https://t.co/l${i}`, expanded_url: `https://toolnotes.example.net/posts/${i}`, display_url: `toolnotes.example.net/posts/${i}` }] },
    ...extra,
  };
  const record = toRecord(raw);
  if (!record) throw new Error(`Fixture tweet ${i} is invalid`);
  const article = (record.article ?? {}) as { title?: string; preview?: string };
  return { site_id: 'opmlrss', source: 'X follows', title: `${record.text} ${article.title ?? ''} ${article.preview ?? ''}`.trim(),
    url: `https://x.com/${record.handle}/status/${record.id}`, published_at: new Date(Number(record.published) * 1000).toISOString(), tweet: record };
}

/** 200 items, one every 20 minutes back from generatedAt: two articles then one X post, every fifth item outside AI. */
function records(generatedAt: number): RecordData[] {
  const out: RecordData[] = [];
  for (let i = 0; i < 200; i++) {
    const at = generatedAt - MINUTE - i * 20 * MINUTE, ai = i % 5 !== 4;
    let record: RecordData;
    if (i % 3 === 2) {
      // Post 50 carries an X Article, post 59 quotes another account; the rest are plain posts with a link.
      record = i === 50 ? post(i, at, { full_text: `Wrote up how we run agents in production https://t.co/art${i}`,
        entities: { urls: [{ url: `https://t.co/art${i}`, expanded_url: `https://x.com/i/article/77${i}`, display_url: `x.com/i/article/77${i}` }] },
        stillfeed_article: { title: 'Agents in production', preview: 'What broke, what held, and what we would do again.', image: '', url: `https://x.com/i/article/77${i}` } })
        : i === 59 ? post(i, at, { full_text: 'This is the clearest take on evals I have read.', quoted_status_id_str: '1800000000000000059',
          quoted_status: { id_str: '1800000000000000059', full_text: 'Evals are product specs you can run.', user: { screen_name: 'evalqueen', name: 'Eval Queen' } } })
        : post(i, at);
    } else if (i % 10 === 3) {
      record = { site_id: 'opmlrss', source: 'Example AI Channel', url: `https://www.youtube.com/watch?v=vid${String(i).padStart(8, '0')}`,
        title: `Video ${i}: building an AI agent from scratch`, published_at: new Date(at).toISOString() };
    } else {
      const blog = BLOGS[i % BLOGS.length]!;
      record = { site_id: 'opmlrss', source: blog.source, url: `https://${blog.host}/posts/${i}?utm_source=rss`,
        title: `Article ${i}: ${ai ? 'a new open model for coding agents' : 'notes on team rituals'}`, published_at: new Date(at).toISOString(),
        summary: `Summary of article ${i}.`, author: 'Fixture Author', image_url: i % 2 ? `https://${blog.host}/images/${i}.jpg` : '' };
    }
    record.ai_is_related = ai;
    out.push(record);
  }
  return out;
}

/** Every article but the newest (kept cold for the preparation queue check) has a prepared reading and summary,
 *  so opening one never needs the network. */
function prepare(store: Store) {
  new Reader(store); const summaries = new Summaries(store);
  const rows = store.db.query("SELECT id,url,title FROM articles WHERE kind='article' ORDER BY sort_at DESC LIMIT -1 OFFSET 1").all() as { id: string; url: string; title: string }[];
  for (const row of rows) {
    const text = `${row.title}. This prepared body is stored by the test fixture so the reader opens offline.`;
    const reading = { title: row.title, author: 'Fixture Author', html: `<p>${text}</p>`, text, url: row.url, fetchedAt: Date.now() };
    store.db.query('INSERT OR REPLACE INTO article_content VALUES(?,?,?)').run(row.id, JSON.stringify(reading), reading.fetchedAt);
    summaries.save(row.id, reading, ['First point.', 'Second point.', 'Third point.'], 'fixture-model');
  }
}

const [command, dir, ...rest] = Bun.argv.slice(2);
if (!dir) throw new Error('Usage: bun tests/fixture.ts create|add <state-dir> ...');
if (command === 'create') {
  const generatedAt = new Date(Math.floor((Date.now() - 2 * MINUTE) / 1000) * 1000).toISOString();
  const input = records(Date.parse(generatedAt)), store = new Store(dir);
  store.ingest(input, generatedAt); prepare(store); store.close();
  const urls = input.map(r => canonical(r.url));
  console.log(JSON.stringify({ generatedAt, urls, xArticle: urls[50], quote: urls[59] }));
} else if (command === 'add') {
  const store = new Store(dir);
  console.log(JSON.stringify(store.ingest(JSON.parse(rest[1]!), rest[0]!))); store.close();
} else throw new Error(`Unknown command ${command}`);
