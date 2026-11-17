import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, hash, type Filters } from './store';
import { Reader } from './reader';
import { Chats, chatContext, chatPrompt, linkedArticleURLs } from './chat';
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

test('existing post conversations load the quoted post and its linked article, then reuse cached full text',async()=>{
 const f=fixture();try{
 const url='https://vercel.example.com/blog/agent-evals',post='https://x.com/builder/status/123';
 f.store.ingest([{url:post,title:'Users are agents',source:'X',published_at:new Date().toISOString(),tweet:{text:'The old way: users are human.',links:[],quote:{name:'Vercel',text:'How to evaluate agents with realistic tasks.',links:[{href:url},{href:url+'?utm_source=x'}]}}}],new Date().toISOString());
 const id=hash(post),v=f.chats.open({kind:'article',id});f.store.save(id,true);
 // The thread already contains an answer from before linked-source support.
 f.chats.send(v.id,message('old'),'What is this?');await f.chats.work('worker',async()=> 'The linked article is unavailable.',async()=>{throw Error('Old missing source')});
 let downloads=0;
 const load=async()=>{downloads++;return {title:'Agent evals',text:'ORCHID-42 is the concrete evaluation method from the linked article.',html:'<p>Method</p>',author:'Vercel',url};};
 f.chats.send(v.id,message('new'),'Tell me about the actual article');
 await f.chats.work('worker',async prompt=>{
 expect(prompt).toContain('How to evaluate agents with realistic tasks.');expect(prompt).toContain('ORCHID-42');expect(prompt).toContain('takes precedence over access claims');
 const sources=JSON.parse(prompt.split('SOURCE TEXT\n')[1]!.split('\nCONVERSATION')[0]!);
 expect(sources.find((s:{kind:string})=>s.kind==='external')).toMatchObject({title:'Agent evals',coverage:'full',link:url});
 return 'Here is the method from the full article.';
 },load);
 f.chats.send(v.id,message('followup'),'More detail');await f.chats.work('worker',async prompt=>{expect(prompt).toContain('ORCHID-42');return 'More detail.'},load);
 expect(downloads).toBe(1);expect(f.chats.view(v.id).messages).toHaveLength(6);
 expect(f.store.db.query('SELECT 1 FROM saved WHERE article_id=?').all(id)).toHaveLength(1);
 f.store.db.query('UPDATE articles SET sort_at=? WHERE id=?').run(Date.now()-90*86400000,id);
 expect(f.store.prune()).toBe(0);expect(f.store.db.query('SELECT 1 FROM chat_link_content').all()).toHaveLength(1);
 f.store.save(id,false);expect(f.store.prune()).toBe(1);expect(f.store.db.query('SELECT 1 FROM chat_link_content').all()).toHaveLength(0);
 }finally{f.close()}
});

test('native X Articles contribute their cached reader text as well as the post',async()=>{
 const f=fixture();try{
 const url='https://x.com/writer/status/456',id=hash(url);
 f.store.ingest([{url,title:'X Article',source:'X',published_at:new Date().toISOString(),tweet:{text:'Read my full article.',article:{title:'Long form'},links:[]}}],new Date().toISOString());
 f.store.db.query('INSERT INTO article_content VALUES(?,?,?)').run(id,JSON.stringify({title:'Long form',text:'NATIVE-FULL-TEXT: a detailed argument.',url,html:'<p>Argument</p>',author:'Writer',fetchedAt:Date.now()}),Date.now());
 const v=f.chats.open({kind:'article',id});f.chats.send(v.id,message('native'),'Explain');
 await f.chats.work('worker',async prompt=>{expect(prompt).toContain('NATIVE-FULL-TEXT');expect(prompt).toContain('Read my full article.');expect(prompt).toContain('"coverage":"full"');return 'Explanation'});
 }finally{f.close()}
});

test('an unreadable linked article reports its specific failure and can load on the next question',async()=>{
 const f=fixture();try{
 const url='https://publisher.example.com/paywall',post='https://x.com/writer/status/789',id=hash(post);
 f.store.ingest([{url:post,title:'A linked article',source:'X',published_at:new Date().toISOString(),tweet:{text:'Read this report.',links:[{href:url}]}}],new Date().toISOString());
 const v=f.chats.open({kind:'article',id});f.chats.send(v.id,message('failure'),'Explain');
 await f.chats.work('worker',async prompt=>{const sources=JSON.parse(prompt.split('SOURCE TEXT\n')[1]!.split('\nCONVERSATION')[0]!);expect(sources.find((s:{kind:string})=>s.kind==='external')).toMatchObject({coverage:'unavailable',error:'Source returned HTTP 403'});return 'Publisher blocked the article.'},async()=>{throw Error('Source returned HTTP 403')});
 expect(f.store.db.query('SELECT 1 FROM chat_link_content').all()).toHaveLength(0);
 f.chats.send(v.id,message('retry'),'Try again');await f.chats.work('worker',async prompt=>{expect(prompt).toContain('Now available full text');return 'Found it'},async()=>({title:'Report',text:'Now available full text',html:'<p>Report</p>',author:'Writer',url}));
 expect(f.store.db.query('SELECT 1 FROM chat_link_content').all()).toHaveLength(1);
 }finally{f.close()}
});

test('cancelling during linked-source download prevents both generation and caching',async()=>{
 const f=fixture();try{
 const post='https://x.com/writer/status/900',id=hash(post);f.store.ingest([{url:post,title:'Report',source:'X',published_at:new Date().toISOString(),tweet:{text:'Report',links:[{href:'https://publisher.example.com/report'}]}}],new Date().toISOString());
 const v=f.chats.open({kind:'article',id});f.chats.send(v.id,message('cancel-download'),'Read');let ready!:()=>void;const started=new Promise<void>(r=>ready=r);let generated=false;
 const work=f.chats.work('worker',async()=>{generated=true;return 'Wrong'},async(_url,signal)=>{ready();await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('Aborted')),{once:true}));throw Error('Unreachable')});
 await started;f.chats.cancel(v.id);await work;expect(generated).toBe(false);expect(f.chats.view(v.id).messages.at(-1)?.state).toBe('cancelled');expect(f.store.db.query('SELECT 1 FROM chat_link_content').all()).toHaveLength(0);
 }finally{f.close()}
});

test('post and quote link metadata is validated, canonicalized and deduplicated',()=>{
 expect(linkedArticleURLs({links:[null,{href:'javascript:alert(1)'},{href:'https://user:password@example.com/secret'},{href:'https://x.com/a/status/1'},{href:'https://example.com/article?utm_source=x#part'}],quote:{links:[{href:'https://example.com/article'},{href:'https://publisher.com/report'}]}})).toEqual(['https://example.com/article','https://publisher.com/report']);
 expect(linkedArticleURLs({links:'invalid',quote:{links:null}})).toEqual([]);
});

test('long prepared article excerpts retain their text budget instead of becoming feed snippets',()=>{
 const text='A'.repeat(50000)+'DETAIL-NEAR-THE-END';
 const prompt=chatPrompt([{id:message('long'),kind:'external',url:'https://example.com/long',title:'Long article',text,coverage:'excerpt'}],[]);
 const sources=JSON.parse(prompt.split('SOURCE TEXT\n')[1]!.split('\nCONVERSATION')[0]!);
 expect(sources[0].text).toBe(text);expect(sources[0].coverage).toBe('excerpt');
});
