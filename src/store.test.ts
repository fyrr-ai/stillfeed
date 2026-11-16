import {test,expect,afterEach} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,canonical,hash,refreshHours,type Filters} from './store';
import {publicURL} from './media';
const paths:string[]=[];
afterEach(()=>{for(const p of paths.splice(0))rmSync(p,{recursive:true,force:true});});
const prefs:Filters={scope:'all',kind:'all',q:'',hideSeen:false,hours:72};
const records=()=>Array.from({length:75},(_,i)=>({url:`https://example.com/${i}`,title:`Article ${i} about testing`,source:'Test journal',site_id:'test',published_at:'2026-11-14T12:00:00Z',ai_is_related:i===0}));
async function fixture(){const dir=mkdtempSync(join(tmpdir(),'stillfeed-store-'));paths.push(dir);return {dir};}
const load=(store:Store)=>store.ingest(records(),'2026-11-15T04:00:00Z');
test('ingest keeps canonical URLs, seen marks, filters and indexed search',async()=>{
 const {dir}=await fixture();const store=new Store(dir);
 try{
  load(store);load(store);expect(store.feed(prefs).total).toBe(75);store.mark([hash('https://example.com/0')],true);
  expect(store.feed({...prefs,scope:'ai'}).items[0]?.seen).toBe(true);expect(store.feed({...prefs,scope:'ai'}).total).toBe(1);
  expect(store.feed({...prefs,q:'Article 23'}).total).toBe(1);expect(store.feed({...prefs,kind:'x'}).total).toBe(0);
  expect(store.feed({...prefs,hideSeen:true}).total).toBe(74);
  const sources=store.sources() as {id:string}[];store.setSource(sources[0]!.id,false);expect(store.feed(prefs).total).toBe(0);store.setSource(sources[0]!.id,true);expect(store.feed(prefs).total).toBe(75);
 }finally{store.close();}
});
test('batch is stable across seen changes, a new import and pagination',async()=>{
 const {dir}=await fixture(),store=new Store(dir);try{
  load(store);const page=store.feed({...prefs,hideSeen:true});const firstIds=page.items.map(a=>a.id);store.mark(firstIds,true);
  expect(store.feed(prefs,page.batch,0).items.map(a=>a.id)).toEqual(firstIds);
  store.ingest([...records(),{url:'https://example.com/new',title:'New article',source:'Test journal',site_id:'test',published_at:'2026-11-15T04:30:00Z'}],'2026-11-15T05:00:00Z');
  const ids=[...firstIds,...store.feed(prefs,page.batch,30).items.map(a=>a.id),...store.feed(prefs,page.batch,60).items.map(a=>a.id)];expect(new Set(ids).size).toBe(75);expect(ids).not.toContain(hash('https://example.com/new'));expect(store.feed(prefs).total).toBe(76);
  expect(store.feed({...prefs,hideSeen:true}).total).toBe(46);
 }finally{store.close();}
});
test('canonical identity and settings validation',async()=>{
 expect(canonical('https://twitter.com/a/status/1?utm_campaign=a#b')).toBe('https://x.com/a/status/1');expect(()=>canonical('javascript:alert(1)')).toThrow();
 const{dir}=await fixture(),store=new Store(dir);try{expect(()=>store.configure({windowHours:-1,refreshEvery:1})).toThrow();expect(()=>store.configure({windowHours:168,refreshEvery:5})).toThrow();store.configure({windowHours:168,refreshEvery:3,nightPause:false});expect(store.settings()).toEqual({windowHours:168,refreshEvery:3,nightPause:false,retentionDays:30});expect(refreshHours(2,true)).toEqual([5,7,9,11,13,15,17,19,21]);expect(refreshHours(1,false).length).toBe(24);expect(refreshHours(24,true)).toEqual([5]);}finally{store.close();}
});
test('media network boundary rejects loopback and private addresses',async()=>{
 for(const url of ['http://127.0.0.1/','http://10.0.0.1/','http://[::1]/','file:///etc/passwd'])await expect(publicURL(url)).rejects.toThrow();
});

test('marking a whole batch seen returns only the newly seen ids and is idempotent',async()=>{
 const {dir}=await fixture(),store=new Store(dir);try{
  load(store);const feed=store.feed(prefs);const first=feed.items[0]!.id;const before=store.feed({...prefs,hideSeen:true}).total;
  store.mark([first],false);store.mark([first],true);
  const ids=store.markBatch(feed.batch);
  expect(ids).not.toContain(first);expect(ids.length).toBe(before-1);
  expect(store.markBatch(feed.batch)).toEqual([]);
  expect(store.feed({...prefs,hideSeen:true}).total).toBe(0);
 }finally{store.close();}
});
