import {test,expect} from 'bun:test';
import {Store} from './store';
import {Summaries,parseSummary} from './summary';
import {Unavailable} from './llm';
import {Preparation,prepareBatch} from './preparation';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const reading={title:'Example',author:'',url:'https://example.com/article',html:'<p>Article</p>',text:'Article text',fetchedAt:1};
const points=['Nový model.','Důležité změny.','Otevřený zdroj.'];
function fixture(count=1){const directory=mkdtempSync(join(tmpdir(),'stillfeed-preparation-')),store=new Store(directory);store.ingest(Array.from({length:count},(_,n)=>({url:`https://example.com/${n}`,title:`Example ${n}`,source:'Example',published_at:new Date(Date.now()-n*1000).toISOString(),ai_is_related:true})),new Date(Date.now()+1000).toISOString());return {store,done(){store.close();rmSync(directory,{recursive:true,force:true});}};}
test('summary cache follows article content and records the actual model',()=>{
 const f=fixture();try{const cache=new Summaries(f.store),id=(f.store.db.query('SELECT id FROM articles').get() as {id:string}).id;
 expect(cache.cached(id,reading)).toBeNull();cache.save(id,reading,points,'test-model');expect(cache.cached(id,reading)?.points).toEqual(points);expect(cache.cached(id,reading)?.model).toBe('test-model');expect(cache.cached(id,{...reading,text:'Changed'})).toBeNull();expect(()=>cache.save(id,reading,['Invalid'])).toThrow();expect(cache.cached(id,reading)?.points).toEqual(points);expect(()=>parseSummary('not JSON')).toThrow();
 }finally{f.done();}
});
test('durable queue prioritizes opened articles, leases jobs once and retains retry state',()=>{
 const f=fixture(8);try{const queue=new Preparation(f.store);queue.enqueueCurrent();queue.enqueueCurrent();expect(queue.stats().queued).toBe(8);const id=(f.store.db.query('SELECT id FROM articles ORDER BY sort_at ASC LIMIT 1').get() as {id:string}).id;queue.enqueue(id,1000);const first=queue.claim(1,'one');expect(first[0]?.article_id).toBe(id);const others=new Preparation(f.store).claim(6,'two');expect(others.some(j=>j.article_id===id)).toBe(false);queue.failed(first[0]!,new Error('Unavailable'));expect(queue.job(id)?.state).toBe('failed');expect(queue.claim(8,'three').some(j=>j.article_id===id)).toBe(false);queue.enqueue(id,1000,true);expect(queue.claim(1,'four')[0]?.article_id).toBe(id);queue.release('two');expect(queue.stats().queued).toBe(6);
 }finally{f.done();}
});
test('background preparation batches summaries and never regenerates an existing cached summary',async()=>{
 const f=fixture(7);try{const queue=new Preparation(f.store),cache=new Summaries(f.store);queue.enqueueCurrent();let calls=0,concurrent=0,maximum=0;
 const reader={async get(id:string){concurrent++;maximum=Math.max(maximum,concurrent);await Bun.sleep(2);concurrent--;return {...reading,url:'https://example.com/'+id};}};
 const model=async(items:{id:string}[])=>{calls++;return new Map(items.map(i=>[i.id,points]));};
 expect(await prepareBatch(queue,reader,cache,model)).toBe(6);expect(calls).toBe(1);expect(maximum).toBe(3);expect(queue.stats().done).toBe(6);expect(queue.stats().queued).toBe(1);expect(await prepareBatch(queue,reader,cache,model)).toBe(1);expect(calls).toBe(2);
 const id=(f.store.db.query('SELECT id FROM articles LIMIT 1').get() as {id:string}).id;f.store.db.query('UPDATE reader_jobs SET state="queued" WHERE article_id=?').run(id);await prepareBatch(queue,reader,cache,model);expect(calls).toBe(2);expect(queue.stats().done).toBe(7);
 }finally{f.done();}
});
test('failed downloads and malformed model output stay retryable without a fake ready state',async()=>{
 const f=fixture(2);try{const queue=new Preparation(f.store),cache=new Summaries(f.store);queue.enqueueCurrent();let n=0;await prepareBatch(queue,{async get(){if(!n++)throw new Error('HTTP 403');return reading;}},cache,async()=>new Map());expect(queue.stats().failed).toBe(2);expect(queue.stats().done).toBeUndefined();expect((f.store.db.query('SELECT COUNT(*) AS n FROM article_summaries').get() as {n:number}).n).toBe(0);
 }finally{f.done();}
});
test('a summary belongs to the language it was written in',()=>{
 const f=fixture(),previous=process.env.STILLFEED_LANGUAGE;try{const cache=new Summaries(f.store),id=(f.store.db.query('SELECT id FROM articles').get() as {id:string}).id;
 process.env.STILLFEED_LANGUAGE='Czech';cache.save(id,reading,points,'m');expect(cache.cached(id,reading)?.language).toBe('Czech');
 process.env.STILLFEED_LANGUAGE='German';expect(cache.cached(id,reading)).toBeNull();
 }finally{if(previous===undefined)delete process.env.STILLFEED_LANGUAGE;else process.env.STILLFEED_LANGUAGE=previous;f.done();}
});
test('without an AI provider articles are still prepared, just without summaries',async()=>{
 const f=fixture(2);try{const queue=new Preparation(f.store),cache=new Summaries(f.store);queue.enqueueCurrent();
 expect(await prepareBatch(queue,{async get(){return reading;}},cache,async()=>{throw new Unavailable('off');})).toBe(2);
 expect(queue.stats().done).toBe(2);expect(f.store.meta('summaryBackoffUntil')).toBeFalsy();
 }finally{f.done();}
});
