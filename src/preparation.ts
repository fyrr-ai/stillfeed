import {readable} from './reader';
import type {Store} from './store';
import type {Reader} from './reader';
import type {Summaries,SummaryInput} from './summary';
import {randomUUID} from 'node:crypto';
export type Job={article_id:string;state:'queued'|'working'|'done'|'failed';attempts:number;error:string|null;token:string|null};
export class Preparation {
 constructor(readonly store:Store){store.db.exec(`CREATE TABLE IF NOT EXISTS reader_jobs(article_id TEXT PRIMARY KEY REFERENCES articles(id),state TEXT NOT NULL,priority INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,ready_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,token TEXT,error TEXT,updated_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS reader_jobs_pending ON reader_jobs(state,ready_at,priority);`);}
 job(id:string){return this.store.db.query('SELECT * FROM reader_jobs WHERE article_id=?').get(id) as Job|null;}
 enqueue(id:string,priority=0,retry=false){
  const article=this.store.article(id);if(!readable(article))throw new Error('Unknown article');
  this.store.db.query('INSERT OR IGNORE INTO reader_jobs(article_id,state,priority,updated_at) VALUES(?,"queued",?,?)').run(id,priority,Date.now());
  this.store.db.query('UPDATE reader_jobs SET priority=MAX(priority,?) WHERE article_id=?').run(priority,id);
  if(retry)this.store.db.query('UPDATE reader_jobs SET state="queued",attempts=0,ready_at=0,error=NULL,updated_at=? WHERE article_id=? AND state="failed"').run(Date.now(),id);
 }
 enqueueCurrent(){
  const now=Date.parse(this.store.meta('generatedAt')||new Date().toISOString()),cutoff=now-this.store.settings().windowHours*3600000;
  this.store.db.query(`INSERT OR IGNORE INTO reader_jobs(article_id,state,priority,updated_at) SELECT a.id,'queued',CASE WHEN v.article_id IS NULL THEN 10 ELSE 0 END,? FROM articles a LEFT JOIN seen v ON v.article_id=a.id WHERE (a.kind='article' OR (a.kind='x' AND json_extract(a.tweet,'$.article.title') IS NOT NULL)) AND a.ai=1 AND a.sort_at>=? AND a.sort_at<=? AND EXISTS(SELECT 1 FROM article_sources r JOIN sources s ON s.id=r.source_id WHERE r.article_id=a.id AND s.enabled=1)`).run(Date.now(),cutoff,now);
 }
 claim(limit=6,token:string=randomUUID()):Job[]{
  return this.store.db.transaction(()=>{
   this.store.db.query('UPDATE reader_jobs SET state="queued",token=NULL WHERE state="working" AND lease_until<?').run(Date.now());
   const jobs=this.store.db.query(`SELECT * FROM reader_jobs WHERE state IN ('queued','failed') AND attempts<3 AND ready_at<=? ORDER BY priority DESC,(SELECT sort_at FROM articles WHERE id=article_id) DESC LIMIT ?`).all(Date.now(),limit) as Job[];
   for(const job of jobs){this.store.db.query('UPDATE reader_jobs SET state="working",attempts=attempts+1,token=?,lease_until=?,updated_at=? WHERE article_id=?').run(token,Date.now()+300000,Date.now(),job.article_id);job.token=token;job.attempts++;}
   return jobs;
  })();
 }
 done(job:Job){this.store.db.query('UPDATE reader_jobs SET state="done",error=NULL,token=NULL,updated_at=? WHERE article_id=? AND token=?').run(Date.now(),job.article_id,job.token);}
 failed(job:Job,error:unknown){const message=error instanceof Error?error.message:'Article preparation failed';this.store.db.query('UPDATE reader_jobs SET state="failed",error=?,token=NULL,ready_at=?,updated_at=? WHERE article_id=? AND token=?').run(message.slice(0,400),Date.now()+900000*2**(job.attempts-1),Date.now(),job.article_id,job.token);}
 defer(job:Job,until:number){this.store.db.query('UPDATE reader_jobs SET state="queued",attempts=MAX(0,attempts-1),token=NULL,ready_at=?,updated_at=? WHERE article_id=? AND token=?').run(until,Date.now(),job.article_id,job.token);}
 release(token:string){this.store.db.query('UPDATE reader_jobs SET state="queued",token=NULL WHERE token=?').run(token);}
 stats(){return Object.fromEntries((this.store.db.query('SELECT state,COUNT(*) AS count FROM reader_jobs GROUP BY state').all() as {state:string;count:number}[]).map(r=>[r.state,r.count]));}
}
export async function prepareBatch(queue:Preparation,reader:Pick<Reader,'get'>,summaries:Summaries,generate:(items:SummaryInput[])=>Promise<Map<string,string[]>>,token=randomUUID()){
 const jobs=queue.claim(6,token);if(!jobs.length)return 0;
 const inputs:SummaryInput[]=[];
 // Three independent downloads at once; one batched Luna call afterwards.
 let cursor=0;
 await Promise.all(Array.from({length:3},async()=>{while(cursor<jobs.length){const job=jobs[cursor++]!;try{const reading=await reader.get(job.article_id);if(summaries.cached(job.article_id,reading))queue.done(job);else inputs.push({id:job.article_id,reading});}catch(error){queue.failed(job,error);}}}));
 const backoff=Number(queue.store.meta('summaryBackoffUntil')||0);
 if(inputs.length&&backoff>Date.now()){for(const input of inputs)queue.defer(jobs.find(j=>j.article_id===input.id)!,backoff);return jobs.length;}
 if(inputs.length)try{const results=await generate(inputs);for(const input of inputs){const points=results.get(input.id);if(!points)throw new Error('Missing article summary');summaries.save(input.id,input.reading,points);queue.done(jobs.find(j=>j.article_id===input.id)!);}}catch(error){queue.store.setMeta('summaryBackoffUntil',String(Date.now()+300000));for(const input of inputs)queue.failed(jobs.find(j=>j.article_id===input.id)!,error);}
 return jobs.length;
}
