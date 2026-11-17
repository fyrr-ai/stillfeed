import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store,type Filters} from './store';
import {Personal,type Rating,type Candidate,personalPrompt} from './personal';

const filters:Filters={scope:'all',kind:'all',q:'',hideSeen:false,hours:72,personalOnly:true};
function fixture(count=75){
  const directory=mkdtempSync(join(tmpdir(),'stillfeed-personal-')),store=new Store(directory),personal=new Personal(store),now=Date.now();
  store.ingest(Array.from({length:count},(_,i)=>({url:`https://example.com/${i}`,title:`Article ${i}`,source:'Journal',published_at:new Date(now-i*60000).toISOString(),ai_is_related:i%2===0,summary:'Practical coding agent technique.'})),new Date(now).toISOString());
  personal.configure('Coding agents, practical data engineering. Skip marketing.');
  return {store,personal,directory,close(){store.close();rmSync(directory,{recursive:true,force:true});}};
}
const accept=async(_:string,candidates:Candidate[]):Promise<Rating[]>=>candidates.map((c,i)=>({id:c.id,score:i===0?3:2,reason:'A concrete technique for coding agents.'}));

test('Hot rates beyond the old top 100, has no accepted-item quota, and paginates a frozen selection',async()=>{
  const {store,personal,close}=fixture(135);try{
    while(await personal.work(accept,randomUUID())){}
    expect(personal.status()).toMatchObject({total:135,rated:135,matched:135,pending:0});
    expect(store.feed({...filters,scope:'ai'}).total).toBe(68);
    const page=store.feed(filters);expect(page.total).toBe(135);expect(page.items).toHaveLength(30);
    expect(page.items[0]?.personalReason).toContain('coding agents');
    expect(page.items.some(a=>!a.ai)).toBe(true);
    const ids=[];for(let offset=0;offset<135;offset+=30)ids.push(...store.feed(filters,page.batch,offset).items.map(a=>a.id));expect(new Set(ids).size).toBe(135);
    store.mark([page.items[0]!.id],true);expect(store.feed(filters,page.batch).total).toBe(135);
    const source=(store.sources() as {id:string}[])[0]!.id;store.setSource(source,false);expect(store.feed(filters).total).toBe(0);
  }finally{close()}
});

test('negative ratings are cached; changing interests rerates without changing an open snapshot',async()=>{
  const {store,personal,close}=fixture(8);try{
    await personal.work(accept,randomUUID());const previous=store.feed(filters),profile=previous.filters.personalProfile;
    personal.configure('Database storage internals');expect(store.feed(filters).total).toBe(0);
    let calls=0;await personal.work(async(_,c)=>{calls++;return c.map(x=>({id:x.id,score:0,reason:''}));},randomUUID());
    expect(await personal.work(async()=>{calls++;return [];},randomUUID())).toBe(0);expect(calls).toBe(1);
    expect(store.feed(filters,previous.batch).items[0]?.personalReason).toBe(previous.items[0]?.personalReason);
    expect(store.feed(filters,previous.batch).filters.personalProfile).toBe(profile);expect(personal.status().matched).toBe(0);
    expect(personalPrompt('untrusted profile',[])).toContain('untrusted data');
  }finally{close()}
});

test('incomplete or malformed ratings never partially publish a selection',async()=>{
  const {store,personal,close}=fixture(3);try{
    for(const kind of ['missing','duplicate','unknown','bad-score','no-reason']){
      store.setMeta('personalRetryAt','0');
      await personal.work(async(_,c)=>{const r=await accept('',c);if(kind==='missing')r.pop();if(kind==='duplicate')r[1]=r[0]!;if(kind==='unknown')r[0]!.id='unknown';if(kind==='bad-score')r[0]!.score=9 as 2;if(kind==='no-reason')r[0]!.reason='';return r;},randomUUID());
      expect(personal.status().rated).toBe(0);expect(personal.status().error).toBeTruthy();
    }
    store.setMeta('personalRetryAt','0');expect(await personal.work(accept,randomUUID())).toBe(3);expect(personal.status().error).toBeNull();
  }finally{close()}
});

test('one worker holds a lease and stale results cannot overwrite a changed profile',async()=>{
  const {store,personal,close}=fixture(3);try{
    let finish!:(ratings:Rating[])=>void,offered:Candidate[]=[];
    const pending=personal.work(async(_,c)=>{offered=c;return new Promise(resolve=>finish=resolve);},'first');
    expect(await personal.work(accept,'second')).toBe(0);personal.configure('New interests');finish(await accept('',offered));expect(await pending).toBe(0);expect(personal.status().rated).toBe(0);
    expect(await personal.work(accept,'second')).toBe(3);
    store.setMeta('personalLease',JSON.stringify({token:'dead',until:Date.now()-1}));personal.configure('Another profile');expect(await personal.work(accept,'third')).toBe(3);
  }finally{close()}
});

test('reading never hides a Hot item; Hide seen and Undo keep bookmarks',async()=>{
  const {store,personal,close}=fixture(3);try{
    await personal.work(accept,randomUUID());const batch=store.feed(filters),a=batch.items[0]!,b=batch.items[1]!;
    store.save(a.id,true);store.mark([a.id],true);expect(store.feed(filters).total).toBe(3);
    const action=randomUUID();expect(store.hideSeen(batch.batch,action)).toEqual([a.id]);expect(store.feed(filters).total).toBe(2);
    expect(store.feed({...filters,personalOnly:false,savedOnly:true}).items[0]?.id).toBe(a.id);
    store.undoHideSeen(action);expect(store.feed(filters).total).toBe(3);
  }finally{close()}
});

test('the real background worker publishes ratings using the configured provider',async()=>{
  const {store,directory,close}=fixture(4),bin=join(directory,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'codex'),`#!/usr/bin/env bun\nconst prompt=await Bun.stdin.text();const c=JSON.parse(prompt.split('Candidates: ')[1]);await Bun.write(Bun.argv[Bun.argv.indexOf('-o')+1],JSON.stringify({ratings:c.map(x=>({id:x.id,score:2,reason:'Useful agent technique.'}))}));\n`,{mode:0o755});
  try{
    const worker=Bun.spawn([process.execPath,resolve('src/personal_worker.ts'),'--state-dir',directory,'--once'],{env:{...process.env,PATH:bin+':'+process.env.PATH,STILLFEED_HOME:directory,STILLFEED_LLM:'codex'},stdout:'pipe',stderr:'pipe'});
    expect(await worker.exited).toBe(0);expect(store.feed(filters).total).toBe(4);expect(store.feed(filters).items[0]?.personalReason).toBe('Useful agent technique.');
  }finally{close()}
});
