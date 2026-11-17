import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, hash, type Filters } from './store';
import { Reader } from './reader';
import { Chats, chatContext } from './chat';
const filters: Filters = {scope:'all',kind:'all',q:'',hideSeen:false,hours:72};
function fixture() {
 const dir=mkdtempSync(join(tmpdir(),'stillfeed-chat-')),store=new Store(dir),chats=new Chats(store),previous=process.env.STILLFEED_LLM;
 process.env.STILLFEED_LLM='codex';
 store.ingest([{url:'https://example.com/agents',title:'Agent workflows',source:'Test',published_at:new Date().toISOString(),summary:'Simple workflows.'},{url:'https://example.com/tables',title:'Iceberg compaction',source:'Test',published_at:new Date().toISOString(),summary:'Data tables.'}],new Date().toISOString());
 const id=hash('https://example.com/agents');new Reader(store);
 store.db.query('INSERT INTO article_content VALUES(?,?,?)').run(id,JSON.stringify({text:'A unique detail buried in the full article.',title:'Agent workflows'}),Date.now());
 return {store,chats,id,close(){store.close();rmSync(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.STILLFEED_LLM;else process.env.STILLFEED_LLM=previous;}};
}
const message=(n:string)=>hash(n);
test('chat snapshots the exact batch, survives reopen and never changes saved state',async()=>{
 const f=fixture();try{
 f.store.save(f.id,true);const batch=f.store.feed(filters);const v=f.chats.open({kind:'batch',id:batch.batch});
 f.chats.send(v.id,message('one'),'How are these connected?');
 expect(await f.chats.work('worker',async prompt=>{expect(prompt).toContain('Iceberg compaction');expect(prompt).toContain('unique detail');return 'They cover different topics.';})).toBe(true);
 expect(f.chats.open({kind:'batch',id:batch.batch}).messages.at(-1)?.text).toBe('They cover different topics.');
 expect(f.chats.open({kind:'article',id:f.id}).messages).toEqual([]);
 expect(f.store.db.query('SELECT article_id FROM saved').all()).toHaveLength(1);
 expect(new Chats(f.store).view(v.id).messages).toHaveLength(2);
 }finally{f.close()}
});
test('question retries are idempotent and only one answer can be pending per thread',()=>{
 const f=fixture();try{const v=f.chats.open({kind:'article',id:f.id});
 f.chats.send(v.id,message('one'),'Explain');f.chats.send(v.id,message('one'),'Explain');expect(f.chats.view(v.id).messages).toHaveLength(2);
 expect(()=>f.chats.send(v.id,message('one'),'Different')).toThrow('already used');
 expect(()=>f.chats.send(v.id,message('two'),'Another')).toThrow('already pending');
 }finally{f.close()}
});
test('failure can retry, cancellation aborts generation and fences late answers',async()=>{
 const f=fixture();try{const v=f.chats.open({kind:'article',id:f.id});f.chats.send(v.id,message('one'),'Explain');
 await f.chats.work('worker',async()=>{throw Error('Service unavailable')});expect(f.chats.view(v.id).messages.at(-1)?.state).toBe('failed');
 f.chats.retry(v.id);let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
 const working=f.chats.work('worker',async(_prompt,signal)=>{started();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));return 'Late answer';});
 await ready;expect(await f.chats.work('other',async()=> 'Should not run')).toBe(false);f.chats.cancel(v.id);await working;
 expect(f.chats.view(v.id).messages.at(-1)).toMatchObject({state:'cancelled',text:''});
 f.chats.send(v.id,message('two'),'Try another question');await f.chats.work('worker',async()=> 'A fresh answer');expect(f.chats.view(v.id).messages.at(-1)?.text).toBe('A fresh answer');
 }finally{f.close()}
});
test('clearing an in-flight conversation cannot resurrect old answers',async()=>{
 const f=fixture();try{const v=f.chats.open({kind:'article',id:f.id});f.chats.send(v.id,message('one'),'Explain');
 await f.chats.work('worker',async()=>{f.chats.clear(v.id);return 'Discard me'});expect(f.chats.view(v.id).messages).toEqual([]);
 }finally{f.close()}
});
test('expired worker leases are visible failures and can be retried',async()=>{
 const f=fixture();try{const v=f.chats.open({kind:'article',id:f.id});f.chats.send(v.id,message('one'),'Explain');
 f.store.db.query("UPDATE chat_messages SET state='working',token='dead',lease_until=1 WHERE role='assistant'").run();
 expect(await f.chats.work('new',async()=> 'Unused')).toBe(false);expect(f.chats.view(v.id).messages.at(-1)?.state).toBe('failed');
 f.chats.retry(v.id);await f.chats.work('new',async()=> 'Recovered');expect(f.chats.view(v.id).messages.at(-1)?.text).toBe('Recovered');
 }finally{f.close()}
});
test('chat boundary validation rejects malformed contexts, unknown articles and oversized questions',()=>{
 const f=fixture();try{
 expect(()=>chatContext({kind:'article',id:'oops'})).toThrow();expect(()=>chatContext({kind:'hot',ids:[]})).toThrow();
 expect(()=>f.chats.open({kind:'article',id:'0'.repeat(32)})).toThrow('Unknown article');
 const v=f.chats.open({kind:'article',id:f.id});expect(()=>f.chats.send(v.id,message('one'),'x'.repeat(8001))).toThrow();
 process.env.STILLFEED_LLM='none';expect(()=>f.chats.send(v.id,message('one'),'Explain')).toThrow('off');
 }finally{f.close()}
});
