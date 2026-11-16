import {hash,type Store} from './store';
import {youtubeId,type Reading} from './reader';
import {join} from 'node:path';
export const SUMMARY_MODEL='gpt-6-luna';
export type Summary={points:string[];language:'cs';generatedAt:number;model:string};
export type SummaryInput={id:string;reading:Reading};
export function parseSummary(raw:string):string[]{
 const value=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
 if(!Array.isArray(value.points)||value.points.length!==3||!value.points.every((p:unknown)=>typeof p==='string'&&p.trim().length>0&&p.length<=320))throw new Error('The summary could not be generated. Please try again.');
 return value.points.map((p:string)=>p.trim());
}
export class Summaries {
 constructor(private store:Store){
  store.db.exec('CREATE TABLE IF NOT EXISTS article_summaries(article_id TEXT PRIMARY KEY REFERENCES articles(id),content_hash TEXT NOT NULL,points TEXT NOT NULL,generated_at INTEGER NOT NULL,model TEXT NOT NULL DEFAULT "legacy")');
  if(!(store.db.query('PRAGMA table_info(article_summaries)').all() as {name:string}[]).some(c=>c.name==='model'))store.db.exec('ALTER TABLE article_summaries ADD COLUMN model TEXT NOT NULL DEFAULT "legacy"');
 }
 cached(id:string,reading:Reading):Summary|null{
  const row=this.store.db.query('SELECT * FROM article_summaries WHERE article_id=? AND content_hash=?').get(id,hash(reading.title+'\n'+reading.text)) as {points:string;generated_at:number;model:string}|null;
  return row?{points:JSON.parse(row.points),generatedAt:row.generated_at,language:'cs',model:row.model}:null;
 }
 save(id:string,reading:Reading,points:string[],model=SUMMARY_MODEL){
  const checked=parseSummary(JSON.stringify({points}));
  this.store.db.query('INSERT OR REPLACE INTO article_summaries(article_id,content_hash,points,generated_at,model) VALUES(?,?,?,?,?)').run(id,hash(reading.title+'\n'+reading.text),JSON.stringify(checked),Date.now(),model);
 }
}
export function generateSummaries(app:string,python:string){return async(items:SummaryInput[]):Promise<Map<string,string[]>>=>{
 const child=Bun.spawn([python,join(app,'scripts/summarize.py')],{stdin:new Blob([JSON.stringify(items.map(({id,reading})=>({id,title:reading.title,text:reading.text.slice(0,youtubeId(reading.url)?24000:12000)})))]),stdout:'pipe',stderr:'inherit'});
 const output=await new Response(child.stdout).text();if(await child.exited!==0)throw new Error('Could not generate the Czech summary. Please try again.');
 const raw=String(JSON.parse(output).response),value=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
 if(!Array.isArray(value.summaries)||value.summaries.length!==items.length)throw new Error('Incomplete summary batch');
 const expected=new Set(items.map(i=>i.id)),result=new Map<string,string[]>();
 for(const entry of value.summaries){if(!expected.has(entry.id)||result.has(entry.id))throw new Error('Invalid summary identity');result.set(entry.id,parseSummary(JSON.stringify(entry)));}
 return result;
};}
