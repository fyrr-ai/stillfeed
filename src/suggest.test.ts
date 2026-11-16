import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from './store';
import {Suggestions,parseRatings} from './suggest';

function seeded(){
  const dir=mkdtempSync(join(tmpdir(),'radar-suggest-')),store=new Store(dir),now=Date.now();
  store.db.exec("CREATE TABLE IF NOT EXISTS x_accounts(handle TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1)");
  store.db.query("INSERT INTO x_accounts(handle,name) VALUES('alice','Alice'),('bob','Bob'),('carol','Carol')").run();
  store.db.query("INSERT INTO sources(id,name) VALUES('s1','Known blog')").run();
  store.db.query("INSERT INTO feeds(id,url,title,source_id,ai) VALUES('f1','https://known.example/feed','Known blog','s1',1)").run();
  let n=0;const tweet=(author:string,text:string,quote?:string,href?:string)=>store.db.query('INSERT INTO articles(id,url,title,source,host,kind,sort_at,ai,tweet,created_revision,last_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(String(++n).padStart(32,'0'),`https://x.com/${author}/status/${n}`,text,'X follows','x.com','x',now-3600000,1,JSON.stringify({author,text,quote:quote?{handle:quote,name:quote.toUpperCase()}:null,links:href?[{href}]:[]}),1,1);
  tweet('alice','Look at this @newdev tool','toolmaker','https://newsite.example/post');
  tweet('bob','@newdev shipped again','toolmaker','https://newsite.example/other');
  tweet('bob','@newdev again',undefined,'https://known.example/x');
  tweet('carol','Only one mention of @lonely and @alice','bob','https://github.com/a/b');
  return {dir,store,now};
}

test('candidates count distinct citing sources and skip followed accounts, known feeds and platforms',()=>{
  const {dir,store,now}=seeded();try{
    const c=new Suggestions(store).candidates(now);
    expect(c.map(x=>[x.kind,x.key,x.mentions])).toEqual([['x','newdev',2],['x','toolmaker',2],['site','newsite.example',2]]);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('refresh keeps only rated candidates with a feed; decisions stick and Add follows the source',async()=>{
  const {dir,store,now}=seeded();try{
    const s=new Suggestions(store);
    await s.refresh('agents',async(_,candidates)=>candidates.filter(c=>c.key!=='newdev').map(c=>({key:c.key,reason:'Užitečné.'})),async site=>site==='newsite.example'?'https://newsite.example/feed.xml':null,now);
    const list=s.list();expect(list.map(x=>x.key).sort()).toEqual(['https://newsite.example/feed.xml','toolmaker']);
    s.decide(list.find(x=>x.kind==='x')!.id,'add');s.decide(list.find(x=>x.kind==='site')!.id,'ignore');
    expect((store.db.query("SELECT enabled FROM x_accounts WHERE handle='toolmaker'").get() as {enabled:number}).enabled).toBe(1);
    await s.refresh('agents',async(_,candidates)=>candidates.map(c=>({key:c.key,reason:'Znovu.'})),async site=>`https://${site}/feed.xml`,now);
    expect(s.list().map(x=>x.key)).toEqual(['newdev']);
    expect(()=>s.decide('0'.repeat(32),'add')).toThrow();
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('ratings are parsed defensively',()=>{
  expect(parseRatings('x {"keep":[{"key":"a","reason":"b"},{"key":1}]}')).toEqual([{key:'a',reason:'b'}]);
});
