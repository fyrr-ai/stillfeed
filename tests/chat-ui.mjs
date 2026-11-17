// Real API, SQLite and chat worker with an isolated fake Codex executable. No user state or paid requests.
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PW);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),bun=process.env.BUN||'bun',temp=mkdtempSync(path.join(tmpdir(),'stillfeed-chat-ui-')),state=path.join(temp,'state');
const bin=path.join(temp,'bin');mkdirSync(bin);
const env={PATH:bin+':'+process.env.PATH,HOME:temp,STILLFEED_HOME:temp,STILLFEED_LLM:'codex',STILLFEED_LANGUAGE:'English',STILLFEED_NO_WORKER:'1',STILLFEED_DISABLE_SCHEDULE:'1',SOCIALDATA_API_KEY:''};
execFileSync(bun,[path.join(root,'tests/fixture.ts'),'create',state],{env,cwd:temp});
const sql=(s,args=[])=>JSON.parse(execFileSync(bun,['-e','const {Database}=require("bun:sqlite");const d=new Database(Bun.argv[1]);d.exec("PRAGMA busy_timeout=5000");console.log(JSON.stringify(d.query(Bun.argv[2]).values(...JSON.parse(Bun.argv[3]))||[]))',path.join(state,'stillfeed.db'),s,JSON.stringify(args)],{encoding:'utf8',env}));
const article=sql("SELECT id FROM articles WHERE kind='article' ORDER BY sort_at DESC LIMIT 1 OFFSET 1")[0][0];
writeFileSync(path.join(bin,'codex'),'#!/usr/bin/env bun\nconst prompt=await Bun.stdin.text();if(!prompt.includes("CATALOGUE")||!prompt.includes("CONVERSATION"))process.exit(2);await Bun.write(Bun.argv[Bun.argv.indexOf("-o")+1],'+JSON.stringify('A useful connection. [Read the article](/article/'+article+').')+');\n',{mode:0o755});
const port=24000+Math.floor(Math.random()*15000),base='http://127.0.0.1:'+port;
const server=spawn(bun,[path.join(root,'src/server.ts'),'--state-dir',state,'--port',String(port)],{env,cwd:temp,stdio:['ignore','ignore','inherit']});
let browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const post=async(url,value)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Stillfeed':'1'},body:JSON.stringify(value)});const v=await r.json();if(!r.ok)throw Error(v.error);return v};
const worker=()=>new Promise((resolve,reject)=>{const child=spawn(bun,[path.join(root,'src/chat_worker.ts'),'--state-dir',state,'--once'],{env,cwd:temp,stdio:['ignore','ignore','inherit']});child.on('exit',code=>code?reject(Error('Worker exit '+code)):resolve())});
function check(label,condition){if(!condition)throw Error(label);console.log('ok '+label)}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await sleep(100)}
 browser=await chromium.launch({executablePath:process.env.CHROME,args:['--no-sandbox']});
 for(const width of [390,1280]){
  const ctx=await browser.newContext({viewport:{width,height:844},isMobile:width<760,hasTouch:true});
  await ctx.route(u=>u.hostname!=='127.0.0.1',r=>r.fulfill({body:'Original'}));await ctx.route('**/api/image/**',r=>r.fulfill({status:404,body:''}));
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base);await p.locator('#feed .feed-card').first().waitFor();
  await p.waitForFunction(()=>document.querySelector('#hideViewed')&&!document.querySelector('#hideViewed').disabled);
  const first=await p.locator('#feed .feed-card.seen').first().getAttribute('data-id');await post('/api/article/'+first+'/saved',{saved:true});
  await p.locator('#hideViewed').click();check(width+': explicit hide removes seen cards',await p.locator('#feed .feed-card.seen').count()===0);
  check(width+': hiding does not unsave bookmark',sql('SELECT 1 FROM saved WHERE article_id=?',[first]).length===1);
  await p.getByRole('button',{name:'Undo',exact:true}).click();await p.locator('#feed [data-id="'+first+'"]').waitFor();
  check(width+': Undo restores hidden row',await p.locator('#feed [data-id="'+first+'"]').count()===1);
  await p.locator('#feedDiscuss').click();await p.locator('#chatPanel').waitFor();await p.getByRole('textbox',{name:'Your question',exact:true}).waitFor();
  await p.waitForFunction(()=>!document.querySelector('#chatPanel textarea').disabled);
  await p.getByRole('textbox',{name:'Your question',exact:true}).fill('Which ideas connect?');await p.getByRole('button',{name:'Send question',exact:true}).click();
  await p.getByRole('button',{name:'Stop answer',exact:true}).waitFor();
  await worker();await p.locator('.chat-assistant').first().waitFor();check(width+': real worker answer reaches assistant-ui',await p.locator('.chat-assistant').first().innerText().then(x=>x.includes('A useful connection')));
  await p.getByRole('button',{name:'Close chat',exact:true}).click();await p.locator('#chatPanel').waitFor({state:'hidden'});await p.locator('#feedDiscuss').click();await p.locator('.chat-assistant').first().waitFor();
  check(width+': conversation survives closing and reopening',await p.locator('.chat-user').count()===1);
  await p.getByRole('textbox',{name:'Your question',exact:true}).fill('Stop this one');await p.getByRole('button',{name:'Send question',exact:true}).click();await p.getByRole('button',{name:'Stop answer',exact:true}).click();await p.getByText('Answer stopped.',{exact:true}).waitFor();
  await p.getByRole('button',{name:'Close chat',exact:true}).click();await p.locator('#chatPanel').waitFor({state:'hidden'});
  await p.locator('#feedDiscuss').click();await p.locator('.chat-assistant a').first().click();await p.locator('#articlePage').waitFor({state:'visible'});await p.locator('#chatPanel').waitFor({state:'hidden'});check(width+': source link opens article and closes chat',new URL(p.url()).pathname==='/article/'+article);
  const articleChat=await post('/api/chat',{context:{kind:'article',id:article}});await post('/api/chat/'+articleChat.id+'/clear',{});
  await p.goto(base+'/article/'+article);await p.locator('#detailDiscuss').waitFor();await p.evaluate(()=>scrollTo(0,350));const y=await p.evaluate(()=>scrollY);await p.locator('#detailDiscuss').click();await p.locator('#chatPanel textarea').waitFor();
  check(width+': article has its own empty conversation',await p.locator('.chat-user').count()===0);
  await p.getByRole('textbox',{name:'Your question',exact:true}).fill('Explain the article');await p.getByRole('button',{name:'Send question',exact:true}).click();await p.getByRole('button',{name:'Stop answer',exact:true}).waitFor();await worker();await p.locator('.chat-assistant').waitFor();
  check(width+': panel fits the viewport',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await p.screenshot({path:path.join(tmpdir(),'stillfeed-chat-panel-'+width+'.png'),fullPage:true});
  await p.getByRole('button',{name:'Close chat',exact:true}).click();await p.locator('#chatPanel').waitFor({state:'hidden'});await sleep(300);
  check(width+': closing preserves article scroll position',Math.abs(await p.evaluate(()=>scrollY)-y)<5);
  check(width+': no browser errors',errors.length===0);await ctx.close();
 }
 console.log('Chat UI passed');
}finally{await browser?.close();server.kill();rmSync(temp,{recursive:true,force:true})}
