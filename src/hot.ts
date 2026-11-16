import { join } from 'node:path';
import { articleView, type Article, type Store } from './store';

/** Hot: a handful of must-not-miss items, picked by the model against the user's interests file.
 *  A pick stays until it is opened or dismissed (scrolling past never removes it) or ages out. */
export const HOT_MODEL = 'gpt-6-luna';
export const HOT_WINDOW = 48 * 3600000;
const CANDIDATES = 100, MAX_ACTIVE = 10, MAX_NEW = 5;

export type HotItem = Article & { reason: string };
export type Candidate = { id: string; title: string; source: string; kind: 'article' | 'x'; text: string; sources: number; likes: number; age_hours: number };
export type Pick = { id: string; reason: string };
export type Picker = (interests: string, candidates: Candidate[], slots: number) => Promise<Pick[]>;

export class Hot {
  constructor(private store: Store) {
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS hot_picks(article_id TEXT PRIMARY KEY REFERENCES articles(id),reason TEXT NOT NULL,picked_at INTEGER NOT NULL,model TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS opened(article_id TEXT PRIMARY KEY REFERENCES articles(id),at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS hot_dismissed(article_id TEXT PRIMARY KEY REFERENCES articles(id),at INTEGER NOT NULL);`);
  }
  opened(id: string) { this.store.db.query('INSERT OR IGNORE INTO opened VALUES(?,?)').run(id, Date.now()); }
  dismiss(id: string, on = true) {
    if (on) this.store.db.query('INSERT OR IGNORE INTO hot_dismissed VALUES(?,?)').run(id, Date.now());
    else this.store.db.query('DELETE FROM hot_dismissed WHERE article_id=?').run(id);
  }
  /** Active picks: recent, not opened, not dismissed; newest pick first. */
  list(now = Date.now()): HotItem[] {
    const rows = this.store.db.query(`SELECT a.*,h.reason,v.at AS seen_at,(SELECT at FROM saved WHERE article_id=a.id) AS saved_at FROM hot_picks h JOIN articles a ON a.id=h.article_id
      LEFT JOIN seen v ON v.article_id=a.id
      WHERE a.sort_at>=? AND NOT EXISTS(SELECT 1 FROM opened o WHERE o.article_id=a.id) AND NOT EXISTS(SELECT 1 FROM hot_dismissed d WHERE d.article_id=a.id)
      ORDER BY h.picked_at DESC,a.sort_at DESC LIMIT ?`).all(now - HOT_WINDOW, MAX_ACTIVE) as Record<string, unknown>[];
    return rows.map(r => ({ ...articleView(r), reason: String(r.reason) }));
  }
  /** Cheap pre-ranking (how many sources carry it, X engagement, recency) keeps the model prompt small. */
  candidates(now = Date.now()): Candidate[] {
    const rows = this.store.db.query(`SELECT a.id,a.title,a.source,a.kind,a.sort_at,a.tweet,substr(coalesce(a.summary,a.content,''),1,300) AS text,
        (SELECT COUNT(*) FROM article_sources s WHERE s.article_id=a.id) AS sources
      FROM articles a JOIN article_sources src ON src.article_id=a.id JOIN sources s ON s.id=src.source_id AND s.enabled=1
      WHERE a.ai=1 AND a.sort_at>=? AND NOT EXISTS(SELECT 1 FROM hot_picks h WHERE h.article_id=a.id)
        AND NOT EXISTS(SELECT 1 FROM opened o WHERE o.article_id=a.id) AND NOT EXISTS(SELECT 1 FROM hot_dismissed d WHERE d.article_id=a.id)
      GROUP BY a.id`).all(now - HOT_WINDOW) as Record<string, unknown>[];
    return rows.map(r => {
      const tweet = r.tweet ? JSON.parse(String(r.tweet)) as Record<string, unknown> : null;
      return { id: String(r.id), title: String(r.title).slice(0, 300), source: String(r.source), kind: r.kind === 'x' ? 'x' as const : 'article' as const,
        text: String(tweet?.text ?? r.text ?? '').slice(0, 300), sources: Number(r.sources) || 1, likes: Number(tweet?.likes) || 0, age_hours: Math.round((now - Number(r.sort_at)) / 3600000) };
    }).sort((a, b) => score(b) - score(a)).slice(0, CANDIDATES);
  }
  /** One model call per collection; failures leave the current picks untouched. */
  async refresh(interests: string, pick: Picker, now = Date.now()) {
    const slots = Math.min(MAX_NEW, MAX_ACTIVE - this.list(now).length);
    const candidates = this.candidates(now);
    if (slots <= 0 || !candidates.length) return [];
    const known = new Set(candidates.map(c => c.id));
    const picks = (await pick(interests, candidates, slots)).filter(p => known.has(p.id) && p.reason.trim()).slice(0, slots);
    const insert = this.store.db.query('INSERT OR IGNORE INTO hot_picks VALUES(?,?,?,?)');
    this.store.db.transaction(() => picks.forEach((p, i) => insert.run(p.id, p.reason.trim().slice(0, 240), now - i, HOT_MODEL)))();
    return picks;
  }
}

const score = (c: Candidate) => c.sources * 3 + Math.log10(1 + c.likes) * 2 - c.age_hours / 24;

export function parsePicks(raw: string): Pick[] {
  const value = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  if (!Array.isArray(value.hot)) throw new Error('Invalid hot response');
  return value.hot.filter((p: unknown): p is Pick => typeof p === 'object' && p !== null && typeof (p as Pick).id === 'string' && typeof (p as Pick).reason === 'string');
}

/** Runs scripts/hot.py (Luna through codex), the same way summaries do. */
export function modelPicker(app: string, python: string): Picker {
  return async (interests, candidates, slots) => {
    const child = Bun.spawn([python, join(app, 'scripts/hot.py')], { stdin: new Blob([JSON.stringify({ interests, slots, candidates })]), stdout: 'pipe', stderr: 'inherit' });
    const output = await new Response(child.stdout).text();
    if (await child.exited !== 0) throw new Error('Hot selection failed');
    return parsePicks(String(JSON.parse(output).response));
  };
}

export async function readInterests(path: string) {
  const file = Bun.file(path);
  return await file.exists() ? (await file.text()).slice(0, 4000) : '';
}
