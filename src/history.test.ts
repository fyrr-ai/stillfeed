import {test,expect} from 'bun:test';
import {Store} from './store';
import {Reader} from './reader';
import {Summaries} from './summary';
import {Preparation} from './preparation';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('retention keeps Saved content, summaries and active batches, with a complete pre-cleanup backup',()=>{
 const directory=mkdtempSync(join(tmpdir(),'radar-history-')),store=new Store(directory),now=Date.now();
 try{
  store.ingest(['saved','expired','active','recent'].map(name=>({url:'https://example.com/'+name,title:name,source:'Example',ai_is_related:true,published_at:new Date(now-(name==='recent'?0:40)*86400000).toISOString()})),new Date(now).toISOString());
  const rows=store.db.query('SELECT id,title FROM articles').all() as {id:string;title:string}[],ids=Object.fromEntries(rows.map(r=>[r.title,r.id]));
  const reader=new Reader(store),summaries=new Summaries(store),jobs=new Preparation(store);
  const content={title:'Preserved article',author:'Author',url:'https://example.com/saved',text:'Useful tool',html:'<p>Useful tool</p>',fetchedAt:now};
  for(const name of ['saved','expired']){store.db.query('INSERT INTO article_content VALUES(?,?,?)').run(ids[name]!,JSON.stringify(content),now);summaries.save(ids[name]!,content,['Nástroj.','Novinka.','Podrobnosti.']);jobs.enqueue(ids[name]!);}
  store.save(ids.saved!,true);store.mark([ids.saved!,ids.expired!],true);
  store.db.query('INSERT INTO batches VALUES(?,?,?,?,?)').run('active',now,1,'{}',1);store.db.query('INSERT INTO batch_items VALUES(?,?,?)').run('active',0,ids.active!);
  expect(store.prune(now)).toBe(1);expect(store.article(ids.expired!)).toBeNull();expect(store.article(ids.saved!)).not.toBeNull();expect(store.article(ids.active!)).not.toBeNull();expect(reader.cached(ids.saved!)?.text).toBe('Useful tool');expect(summaries.cached(ids.saved!,content)?.points.length).toBe(3);expect(jobs.job(ids.expired!)).toBeNull();expect(jobs.job(ids.saved!)).not.toBeNull();
  const source=store.sources()[0] as {id:string};store.setSource(source.id,false);
  const saved=store.feed({scope:'ai',kind:'all',q:'',hideSeen:false,hours:72,savedOnly:true});expect(saved.total).toBe(1);expect(saved.items[0]?.id).toBe(ids.saved);expect(saved.items[0]?.saved).toBe(true);
  expect(existsSync(join(directory,'before-retention.db'))).toBe(true);const backup=new Database(join(directory,'before-retention.db'),{readonly:true});expect((backup.query('SELECT COUNT(*) AS n FROM articles').get() as {n:number}).n).toBe(4);backup.close();
  expect(store.prune(now)).toBe(0);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
},30000);
