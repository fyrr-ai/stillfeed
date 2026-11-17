import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, chmodSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Refresh intervals in hours; 24 means once a day at 05:00. With the night pause, nothing runs 23:00–05:00. */
export const REFRESH_EVERY=[1,2,3,4,6,12,24];
export function refreshHours(every:number,nightPause:boolean){
  if(every===24)return [5];
  const hours:number[]=[];for(let h=nightPause?5:0;h<(nightPause?23:24);h+=every)hours.push(h);return hours;
}
export type RecordData = Record<string, unknown>;
export type Filters = { scope: 'ai'|'all'; kind: 'all'|'article'|'x'; q: string; hideSeen: boolean; hours: number; savedOnly?: boolean; savedTopic?: string; seenBefore?: number; revision?: number };
export type Article = { id: string; url: string; title: string; source: string; host: string; kind: 'article'|'x'; publishedAt: number; ai: boolean; seen: boolean; saved: boolean; tweet: RecordData|null };
export const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0,32);
export function canonical(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Article URL must be a string');
  const u = new URL(value);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw new Error('Invalid article URL');
  if (u.hostname === 'twitter.com' || u.hostname === 'www.twitter.com') u.hostname = 'x.com';
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(k)) u.searchParams.delete(k);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/,'');
  return u.href;
}
const object = (v: unknown): RecordData => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordData : {};
const array = (v: unknown): RecordData[] => Array.isArray(v) ? v.map(object) : [];
const str = (v: unknown, fallback='') => typeof v === 'string' && v.trim() ? v : fallback;
const date = (v: unknown, fallback: number) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : fallback;
export function articleView(r:RecordData):Article{return {id:str(r.id),url:str(r.url),title:str(r.title),source:str(r.source),host:str(r.host),kind:r.kind==='x'?'x':'article',publishedAt:Number(r.sort_at),ai:Boolean(r.ai),seen:Boolean(r.seen_at),saved:Boolean(r.saved_at),tweet:r.tweet?object(JSON.parse(String(r.tweet))):null};}
export class Store {
  db: Database;
  constructor(readonly directory: string) {
    mkdirSync(directory,{recursive:true, mode:0o700});
    // Databases from before the rename (radar.db) move over once, with their WAL files.
    if(!existsSync(join(directory,'stillfeed.db'))&&existsSync(join(directory,'radar.db')))for(const suffix of ['','-wal','-shm'])if(existsSync(join(directory,'radar.db'+suffix)))renameSync(join(directory,'radar.db'+suffix),join(directory,'stillfeed.db'+suffix));
    this.db = new Database(join(directory,'stillfeed.db'),{create:true,strict:true});
    chmodSync(join(directory,'stillfeed.db'),0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,title TEXT NOT NULL,source TEXT NOT NULL,host TEXT NOT NULL,kind TEXT NOT NULL,sort_at INTEGER NOT NULL,ai INTEGER NOT NULL,tweet TEXT,created_revision INTEGER NOT NULL,last_revision INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS articles_order ON articles(sort_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS articles_ai_order ON articles(ai,sort_at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS article_sources(article_id TEXT NOT NULL REFERENCES articles(id),source_id TEXT NOT NULL REFERENCES sources(id),PRIMARY KEY(article_id,source_id));
      CREATE TABLE IF NOT EXISTS seen(article_id TEXT PRIMARY KEY REFERENCES articles(id),at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS saved(article_id TEXT PRIMARY KEY REFERENCES articles(id),at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,created INTEGER NOT NULL,revision INTEGER NOT NULL,filters TEXT NOT NULL,total INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS batch_items(batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,article_id TEXT NOT NULL REFERENCES articles(id),PRIMARY KEY(batch_id,ordinal));
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(article_id UNINDEXED,title,source,body,tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS x_accounts(handle TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS seeded(key TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS feeds(id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,title TEXT NOT NULL,source_id TEXT,ai INTEGER NOT NULL DEFAULT 0,etag TEXT,last_modified TEXT,checked_at INTEGER,error TEXT);
      CREATE TABLE IF NOT EXISTS feed_entries(feed_id TEXT NOT NULL REFERENCES feeds(id),guid TEXT NOT NULL,article_id TEXT NOT NULL REFERENCES articles(id),PRIMARY KEY(feed_id,guid));
      CREATE TABLE IF NOT EXISTS model_decisions(id TEXT PRIMARY KEY,keep INTEGER NOT NULL,at REAL NOT NULL);
      PRAGMA user_version=2;`);
    const columns=new Set((this.db.query('PRAGMA table_info(articles)').all() as {name:string}[]).map(c=>c.name));
    for(const name of ['content','summary','author','image_url','ai_reason'])if(!columns.has(name))this.db.exec(`ALTER TABLE articles ADD COLUMN ${name} TEXT`);
  }
  meta(key: string) { return (this.db.query('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|null)?.value; }
  setMeta(key: string, value: string) { this.db.query('INSERT OR REPLACE INTO meta VALUES(?,?)').run(key,value); }
  settings() {
    const rows=this.db.query('SELECT key,value FROM settings').all() as {key:string,value:string}[];
    const values=Object.fromEntries(rows.map(r=>[r.key,JSON.parse(r.value)]));
    return {windowHours: Number(values.windowHours || 72), refreshEvery: Number(values.refreshEvery ?? 2),nightPause: values.nightPause !== false,retentionDays:Number(values.retentionDays||30)};
  }
  configure(settings: {windowHours:number;refreshEvery:number;nightPause?:boolean;retentionDays?:number}) {
    if (!Number.isInteger(settings.windowHours) || settings.windowHours<24 || settings.windowHours>24*90 || !REFRESH_EVERY.includes(settings.refreshEvery) || (settings.nightPause!==undefined&&typeof settings.nightPause!=='boolean')) throw new Error('Invalid settings');
    const retention=settings.retentionDays??this.settings().retentionDays;if(!Number.isInteger(retention)||retention<7||retention>365||retention*24<settings.windowHours)throw new Error('History must cover your feed window (7–365 days).');
    this.db.transaction(()=> { for (const [key,value] of Object.entries({...settings,nightPause:settings.nightPause??this.settings().nightPause,retentionDays:retention})) this.db.query('INSERT OR REPLACE INTO settings VALUES(?,?)').run(key,JSON.stringify(value)); })();
  }

  ingest(records:RecordData[], generatedAt:string, results:{id:string;etag?:string|null;modified?:string|null;error?:string|null}[]=[]) {
    const revision=Number(this.meta('revision')||0)+1, now=date(generatedAt,Date.now());
    this.db.transaction(()=>{
      for(const r of records){
        let url:string;try{url=canonical(r.url);}catch{continue;}
        const id=hash(url),source=str(r.source,new URL(url).hostname),sourceId=str(r.source_id,hash(str(r.site_id)+'::'+source));
        this.db.query('INSERT INTO sources(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(sourceId,source);
        const tweet=object(r.tweet),isX=/^https?:\/\/x\.com\/[^/]+\/status\//.test(url);
        this.db.query(`INSERT INTO articles(id,url,title,source,host,kind,sort_at,ai,tweet,created_revision,last_revision,content,summary,author,image_url,ai_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,source=excluded.source,ai=MAX(articles.ai,excluded.ai),tweet=COALESCE(excluded.tweet,articles.tweet),last_revision=excluded.last_revision,content=COALESCE(NULLIF(excluded.content,''),articles.content),summary=COALESCE(NULLIF(excluded.summary,''),articles.summary),author=COALESCE(NULLIF(excluded.author,''),articles.author),image_url=COALESCE(NULLIF(excluded.image_url,''),articles.image_url),ai_reason=excluded.ai_reason`).run(id,url,str(r.title,'Untitled update'),source,new URL(url).hostname,isX?'x':'article',date(r.published_at,now),Number(Boolean(r.ai_is_related)),Object.keys(tweet).length?JSON.stringify(tweet):null,revision,revision,str(r.content),str(r.summary),str(r.author),str(r.image_url),str(r.ai_relevance_reason));
        this.db.query('INSERT OR IGNORE INTO article_sources VALUES(?,?)').run(id,sourceId);
        if(typeof r.feed_id==='string'&&typeof r.guid==='string')this.db.query('INSERT INTO feed_entries VALUES(?,?,?) ON CONFLICT(feed_id,guid) DO UPDATE SET article_id=excluded.article_id').run(r.feed_id,r.guid,id);
      }
      for(const result of results)this.db.query('UPDATE feeds SET checked_at=?,error=?,etag=COALESCE(?,etag),last_modified=COALESCE(?,last_modified) WHERE id=?').run(now,result.error||null,result.error?null:result.etag||null,result.error?null:result.modified||null,result.id);
      this.db.exec("DELETE FROM search; INSERT INTO search(article_id,title,source,body) SELECT id,title,source,COALESCE(summary,'')||' '||COALESCE(json_extract(tweet,'$.text'),'') FROM articles;");
      this.setMeta('revision',String(revision));this.setMeta('generatedAt',generatedAt);
      this.setMeta('collectionStatus',JSON.stringify({rss:results.filter(r=>!r.error).length,failed:results.filter(r=>r.error).length,checked:results.length}));
    })();
    return {revision,received:records.length,feeds:results.length,failed:results.filter(r=>r.error).length};
  }
  sources() {return this.db.query(`SELECT s.*,COUNT(a.article_id) AS articles,(SELECT group_concat(f.error,'; ') FROM feeds f WHERE f.source_id=s.id AND f.error IS NOT NULL) AS error FROM sources s LEFT JOIN article_sources a ON s.id=a.source_id GROUP BY s.id ORDER BY s.name COLLATE NOCASE`).all();}
  setSource(id:string,enabled:boolean) { if(!this.db.query('SELECT id FROM sources WHERE id=?').get(id))throw new Error('Unknown source');this.db.query('UPDATE sources SET enabled=? WHERE id=?').run(Number(enabled),id); }
  /** Marks every not-yet-seen article of a feed batch as seen and returns exactly those ids, so Undo can revert them. */
  markBatch(batchId: string): string[] {
    return this.db.transaction(()=> {
      const ids=(this.db.query('SELECT b.article_id AS id FROM batch_items b WHERE b.batch_id=? AND NOT EXISTS(SELECT 1 FROM seen v WHERE v.article_id=b.article_id) ORDER BY b.ordinal').all(batchId) as {id:string}[]).map(r=>r.id);
      const insert=this.db.query('INSERT OR IGNORE INTO seen VALUES(?,?)'),now=Date.now();
      for(const id of ids)insert.run(id,now);
      return ids;
    })();
  }
  seenInBatch(batchId: string): string[] {
    if (!this.db.query('SELECT 1 FROM batches WHERE id=?').get(batchId)) throw new Error('View expired. Refresh to continue.');
    const rows = this.db.query('SELECT i.article_id AS id FROM batch_items i JOIN seen s ON s.article_id=i.article_id WHERE i.batch_id=? ORDER BY i.ordinal').all(batchId) as {id: string}[];
    return rows.map(row => row.id);
  }
  mark(ids: string[], on: boolean) {
    this.db.transaction(()=> {for (const id of ids) {
      if(on)this.db.query('INSERT OR IGNORE INTO seen SELECT id,? FROM articles WHERE id=?').run(Date.now(),id);
      else this.db.query('DELETE FROM seen WHERE article_id=?').run(id);
    }})();
  }
  save(id:string,on:boolean){
    if(!this.article(id))throw new Error('Unknown article');
    if(on)this.db.query('INSERT OR IGNORE INTO saved VALUES(?,?)').run(id,Date.now());else this.db.query('DELETE FROM saved WHERE article_id=?').run(id);
  }
  prune(now=Date.now()){
    const stale=now-this.settings().retentionDays*86400000;
    const candidate=`SELECT a.id FROM articles a WHERE a.sort_at<? AND NOT EXISTS(SELECT 1 FROM saved s WHERE s.article_id=a.id) AND NOT EXISTS(SELECT 1 FROM batch_items i JOIN batches b ON b.id=i.batch_id WHERE i.article_id=a.id AND b.created>=?)`;
    const bindings=[stale,now-7*86400000];
    const count=(this.db.query(`SELECT COUNT(*) AS n FROM articles WHERE id IN (${candidate})`).get(...bindings) as {n:number}).n;
    if(!count)return 0;
    if(!this.meta('retentionBackup')){const path=join(this.directory,'before-retention.db');if(!existsSync(path))writeFileSync(path,this.db.serialize(),{mode:0o600,flag:'wx'});this.setMeta('retentionBackup',path);}
    const tables=new Set((this.db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(t=>t.name));
    this.db.transaction(()=>{
      this.db.query('DELETE FROM batches WHERE created<?').run(now-7*86400000);
      for(const table of ['seen','article_sources','feed_entries','reader_jobs','article_content','article_summaries','search','hot_picks','opened','hot_dismissed'])if(tables.has(table))this.db.query(`DELETE FROM ${table} WHERE article_id IN (${candidate})`).run(...bindings);
      this.db.query(`DELETE FROM articles WHERE id IN (${candidate})`).run(...bindings);
      this.db.query('DELETE FROM model_decisions WHERE at<?').run(stale/1000);
    })();
    return count;
  }
  article(id:string) {return this.db.query('SELECT * FROM articles WHERE id=?').get(id) as RecordData|null;}
  feed(filters:Filters, batchId?:string, offset=0) {
    let batch: {id:string;created:number;revision:number;filters:string;total:number}|null=null;
    if(batchId) {
      batch=this.db.query('SELECT * FROM batches WHERE id=?').get(batchId) as typeof batch;
      if(!batch)throw new Error('View expired. Refresh to continue.');
    } else {
      const revision=filters.revision || Number(this.meta('revision')||0);
      const generated=date(this.meta('generatedAt'),Date.now());
      const cutoff=generated-filters.hours*3600000, before=filters.seenBefore||Date.now();
      const conditions=['a.sort_at>=?','a.sort_at<=?','a.created_revision<=?','EXISTS(SELECT 1 FROM article_sources r JOIN sources s ON s.id=r.source_id WHERE r.article_id=a.id AND s.enabled=1)'];
      const values:(string|number)[]=[cutoff,generated,revision];
      if(filters.savedOnly){conditions.splice(0,conditions.length,'a.created_revision<=?','EXISTS(SELECT 1 FROM saved s WHERE s.article_id=a.id)');values.splice(0,values.length,revision);}
      if(filters.savedOnly && filters.savedTopic){
        if(filters.savedTopic==='ungrouped')conditions.push('NOT EXISTS(SELECT 1 FROM saved_topic_items t WHERE t.article_id=a.id)');
        else {conditions.push('EXISTS(SELECT 1 FROM saved_topic_items t WHERE t.article_id=a.id AND t.topic_id=?)');values.push(filters.savedTopic);}
      }
      if(filters.scope==='ai'&&!filters.savedOnly)conditions.push('a.ai=1');
      if(filters.kind!=='all'){conditions.push('a.kind=?');values.push(filters.kind);}
      if(filters.hideSeen){conditions.push('(v.at IS NULL OR v.at>?)');values.push(before);}
      const tokens=filters.q.match(/[\p{L}\p{N}_]+/gu)?.slice(0,20)||[];
      if(tokens.length){conditions.push('a.id IN (SELECT article_id FROM search WHERE search MATCH ?)');values.push(tokens.map(t=>'"'+t+'"*').join(' AND '));}
      const ids=this.db.query(`SELECT a.id FROM articles a LEFT JOIN seen v ON v.article_id=a.id WHERE ${conditions.join(' AND ')} ORDER BY ${filters.savedOnly?'(SELECT at FROM saved WHERE article_id=a.id)':'a.sort_at'} DESC,a.id DESC`).all(...values) as {id:string}[];
      batch={id:randomUUID(),created:before,revision,filters:JSON.stringify(filters),total:ids.length};
      this.db.transaction(()=> {
        this.db.query('DELETE FROM batches WHERE created<?').run(Date.now()-7*86400000);
        this.db.query('INSERT INTO batches VALUES(?,?,?,?,?)').run(batch!.id,before,revision,batch!.filters,ids.length);
        const insert=this.db.query('INSERT INTO batch_items VALUES(?,?,?)');
        ids.forEach((row,i)=>insert.run(batch!.id,i,row.id));
      })();
    }
    const rows=this.db.query(`SELECT a.*,v.at AS seen_at,(SELECT at FROM saved WHERE article_id=a.id) AS saved_at FROM batch_items b JOIN articles a ON a.id=b.article_id LEFT JOIN seen v ON v.article_id=a.id WHERE b.batch_id=? AND b.ordinal>=? ORDER BY b.ordinal LIMIT 30`).all(batch.id,offset) as RecordData[];
    const items:Article[]=rows.map(articleView);
    const unseen=(this.db.query('SELECT COUNT(*) AS n FROM batch_items b WHERE b.batch_id=? AND NOT EXISTS(SELECT 1 FROM seen v WHERE v.article_id=b.article_id)').get(batch.id) as {n:number}).n;
    return {items,total:batch.total,unseen,batch:batch.id,seenBefore:batch.created,revision:batch.revision,filters:JSON.parse(batch.filters),next:offset+items.length<batch.total?offset+items.length:null,generatedAt:this.meta('generatedAt')};
  }
  close(){this.db.close();}
}
