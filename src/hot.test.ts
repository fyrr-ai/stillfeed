import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from './store';
import {Hot,parsePicks,type Candidate} from './hot';

function seeded(){
  const dir=mkdtempSync(join(tmpdir(),'radar-hot-')),store=new Store(dir),now=Date.now();
  store.db.query("INSERT INTO sources(id,name) VALUES('s1','Feed one'),('s2','Feed two')").run();
  const add=(id:string,ai:number,age:number,sources:string[])=>{
    store.db.query('INSERT INTO articles(id,url,title,source,host,kind,sort_at,ai,tweet,created_revision,last_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,`https://example.com/${id}`,`Title ${id}`,'Feed one','example.com','article',now-age*3600000,ai,null,1,1);
    for(const s of sources)store.db.query('INSERT INTO article_sources VALUES(?,?)').run(id,s);
  };
  add('a'.repeat(32),1,2,['s1','s2']);add('b'.repeat(32),1,3,['s1']);add('c'.repeat(32),0,1,['s1']);add('d'.repeat(32),1,60,['s1']);
  return {dir,store,now};
}

test('candidates are recent AI items, ranked by how many sources carry them',()=>{
  const {dir,store,now}=seeded();try{
    const ids=new Hot(store).candidates(now).map(c=>c.id);
    expect(ids).toEqual(['a'.repeat(32),'b'.repeat(32)]);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('picks stay until opened or dismissed, ignore unknown ids and respect the slots',async()=>{
  const {dir,store,now}=seeded();try{
    const hot=new Hot(store);let offered:Candidate[]=[];
    const picks=await hot.refresh('coding agents',async(_,candidates,slots)=>{offered=candidates;expect(slots).toBe(5);return [{id:'a'.repeat(32),reason:'Velká verze.'},{id:'x'.repeat(32),reason:'Neznámé.'},{id:'b'.repeat(32),reason:'Nástroj.'}];},now);
    expect(picks.map(p=>p.id)).toEqual(['a'.repeat(32),'b'.repeat(32)]);expect(offered.length).toBe(2);
    expect(hot.list(now).map(h=>h.reason)).toEqual(['Velká verze.','Nástroj.']);
    hot.opened('a'.repeat(32));hot.dismiss('b'.repeat(32));expect(hot.list(now)).toEqual([]);
    hot.dismiss('b'.repeat(32),false);expect(hot.list(now).map(h=>h.id)).toEqual(['b'.repeat(32)]);
    expect(hot.candidates(now)).toEqual([]);
    expect(hot.list(now+49*3600000)).toEqual([]);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('model answers are parsed defensively',()=>{
  expect(parsePicks('noise {"hot":[{"id":"x","reason":"r"},{"id":3}]} tail')).toEqual([{id:'x',reason:'r'}]);
  expect(()=>parsePicks('{"nope":1}')).toThrow();
});

test('retention removes hot state with its articles',()=>{
  const {dir,store,now}=seeded();try{
    const hot=new Hot(store);hot.opened('d'.repeat(32));
    store.db.query("INSERT INTO settings(key,value) VALUES('retentionDays','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    expect(store.prune(now)).toBeGreaterThan(0);
    expect((store.db.query('SELECT COUNT(*) AS n FROM opened').get() as {n:number}).n).toBe(0);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
