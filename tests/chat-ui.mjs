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
const postId=sql("SELECT id FROM articles WHERE kind='x' ORDER BY sort_at DESC LIMIT 1")[0][0];
const longPost='The old way: users are human, you run user interviews, get inspired, mock up user journeys.\nThe new way: users are agents, you run evals, evals inform the software engineering loop. Good read on how we do evals at Vercel.';
sql('UPDATE articles SET title=? WHERE id=?',[longPost,postId]);
writeFileSync(path.join(bin,'codex'),'#!/usr/bin/env bun\nconst prompt=await Bun.stdin.text();if(!prompt.includes("CATALOGUE")||!prompt.includes("CONVERSATION"))process.exit(2);if(prompt.includes("O cem to je?")&&!prompt.includes("Distinct linked article detail."))process.exit(3);await Bun.write(Bun.argv[Bun.argv.indexOf("-o")+1],'+JSON.stringify('A useful connection. [Read the article](/article/'+article+').')+');\n',{mode:0o755});
const port=24000+Math.floor(Math.random()*15000),base='http://127.0.0.1:'+port;
const server=spawn(bun,[path.join(root,'src/server.ts'),'--state-dir',state,'--port',String(port)],{env,cwd:temp,stdio:['ignore','ignore','inherit']});
let browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const post=async(url,value)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-Stillfeed':'1'},body:JSON.stringify(value)});const v=await r.json();if(!r.ok)throw Error(v.error);return v};
const worker=()=>new Promise((resolve,reject)=>{const child=spawn(bun,[path.join(root,'src/chat_worker.ts'),'--state-dir',state,'--once'],{env,cwd:temp,stdio:['ignore','ignore','inherit']});child.on('exit',code=>code?reject(Error('Worker exit '+code)):resolve())});
function check(label,condition){if(!condition)throw Error(label);console.log('ok '+label)}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await sleep(100)}
 const postTweet=JSON.parse(sql('SELECT tweet FROM articles WHERE id=?',[postId])[0][0]);
 for(const link of [...(postTweet.links||[]),...(postTweet.quote?.links||[])]){
  const reading={title:'Linked article',text:'Distinct linked article detail.',html:'<p>Linked article</p>',author:'Publisher',url:link.href};
  sql('INSERT OR REPLACE INTO chat_link_content VALUES(?,?,?)',[postId,link.href,JSON.stringify(reading)]);
 }
 browser=await chromium.launch({executablePath:process.env.CHROME,args:['--no-sandbox']});
 for(const width of [390,1280]){
  const ctx=await browser.newContext({viewport:{width,height:844},isMobile:width<760,hasTouch:true});
  await ctx.route(u=>u.hostname!=='127.0.0.1',r=>r.fulfill({body:'Original'}));await ctx.route('**/api/image/**',r=>r.fulfill({status:404,body:''}));
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base);await p.locator('#feed .feed-card').first().waitFor();
  check(width+': header controls never overlap',await p.evaluate(()=>{const a=document.querySelector('.view-tabs').getBoundingClientRect(),b=document.querySelector('.top-actions').getBoundingClientRect(),c=document.querySelector('#readCount').getBoundingClientRect();return a.right<=b.left+1&&c.top>=a.top-1&&c.bottom<=a.bottom+1}));
  await p.evaluate(()=>scrollTo(0,500));check(width+': counter has one stable position',await p.locator('.read-count').count()===1&&await p.locator('.read-count-corner').count()===0&&(await p.locator('#readCount').boundingBox()).y<60&&await p.locator('.feed-cleanup').count()===0);await p.evaluate(()=>scrollTo(0,0));
  const retained=await p.locator('#feed .feed-card.article').first().getAttribute('data-id');await p.goto(base+'/article/'+retained);await p.locator('#articleBack').click();await p.locator('#feed [data-id="'+retained+'"]').waitFor();check(width+': reading never dismisses its row',await p.locator('#feed [data-id="'+retained+'"]').count()===1);
  await p.reload();await p.locator('#feed [data-id="'+retained+'"]').waitFor();check(width+': reload preserves read rows',await p.locator('#feed [data-id="'+retained+'"]').count()===1);
  const activeBatch=await p.evaluate(()=>JSON.parse(sessionStorage.getItem('stillfeed-session')).batch);
  const hiddenLater=sql('SELECT article_id FROM batch_items WHERE batch_id=? AND ordinal=60',[activeBatch])[0][0];
  await post('/api/seen',{ids:[hiddenLater],seen:true});await p.reload();await p.locator('#feed .feed-card').first().waitFor();
  await p.addInitScript(()=>{const id=sessionStorage.getItem('test-legacy-hide');if(!id)return;const key='stillfeed-session',s=JSON.parse(sessionStorage.getItem(key));s.collapsed=[id];s.dismissalVersion=2;sessionStorage.setItem(key,JSON.stringify(s));sessionStorage.removeItem('test-legacy-hide');});
  await p.evaluate(id=>sessionStorage.setItem('test-legacy-hide',id),retained);
  await p.reload();await p.locator('#feed .feed-card').first().waitFor();
  check(width+': prior explicit hides survive the upgrade',sql('SELECT 1 FROM feed_dismissals WHERE article_id=?',[retained]).length===1&&await p.locator('#feed [data-id="'+retained+'"]').count()===0);
  await post('/api/feed/undo-hide-seen',{action:activeBatch});await p.reload();await p.locator('#feed [data-id="'+retained+'"]').waitFor();
  await p.locator('#readCount').click();
  await p.waitForFunction(()=>document.querySelector('#hideViewed')&&!document.querySelector('#hideViewed').disabled);
  const first=await p.locator('#feed .feed-card.seen').first().getAttribute('data-id');await post('/api/article/'+first+'/saved',{saved:true});
  const totalBeforeHide=Number((await p.locator('#readCount').innerText()).split('/')[1].trim());
  check(width+': counter visibly offers a menu',await p.locator('#readCount svg').count()===1&&await p.locator('.batch-count-label').isVisible());
  await p.locator('#hideViewed').click();await p.locator('.toast-title').filter({hasText:'Hidden'}).waitFor();check(width+': explicit hide removes seen cards',await p.locator('#feed .feed-card.seen').count()===0);
  check(width+': hide includes unloaded pages',sql('SELECT 1 FROM feed_dismissals WHERE article_id=?',[hiddenLater]).length===1);
  const hiddenCount=sql('SELECT COUNT(*) FROM batch_items b JOIN feed_dismissals d ON d.article_id=b.article_id WHERE b.batch_id=?',[activeBatch])[0][0];
  check(width+': hiding reduces the current batch denominator',await p.locator('#readCount').innerText().then(x=>x.trim()==='0/'+(totalBeforeHide-hiddenCount)));
  const fresh=await fetch(base+'/api/feed').then(r=>r.json());
  check(width+': a fresh batch keeps dismissed items hidden',fresh.total===totalBeforeHide-hiddenCount);
  await p.screenshot({path:'/tmp/stillfeed-batch-'+width+'.png'});
  while(await p.evaluate(()=>JSON.parse(sessionStorage.getItem('stillfeed-session')).pages)<3){const response=p.waitForResponse(r=>r.url().includes('/api/feed?')&&r.url().includes('offset='));await p.locator('#loadMore').evaluate(el=>el.click());await response;}
  check(width+': hidden offscreen row does not reappear on pagination',await p.locator('#feed [data-id="'+hiddenLater+'"]').count()===0);
  check(width+': hiding does not unsave bookmark',sql('SELECT 1 FROM saved WHERE article_id=?',[first]).length===1);
  await p.getByRole('button',{name:'Undo',exact:true}).click();await p.locator('#feed [data-id="'+first+'"]').waitFor();
  await p.locator('#feed [data-id="'+hiddenLater+'"]').waitFor();check(width+': Undo also restores newly loaded hidden rows',await p.locator('#feed [data-id="'+hiddenLater+'"]').count()===1);
  check(width+': Undo restores hidden row',await p.locator('#feed [data-id="'+first+'"]').count()===1);
  check(width+': Undo restores the batch size',Number((await p.locator('#readCount').innerText()).split('/')[1].trim())===totalBeforeHide);
  check(width+': Undo restores future batches',(await fetch(base+'/api/feed').then(r=>r.json())).total===totalBeforeHide);
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
  await p.goto(base+'/article/'+article);await p.locator('#detailDiscuss').waitFor();check(width+': detail toolbar matches feed styling',await p.evaluate(()=>{const a=getComputedStyle(document.querySelector('.article-toolbar')),b=getComputedStyle(document.querySelector('.topbar'));return ['minHeight','paddingLeft','paddingRight','backdropFilter','backgroundColor','borderBottom'].every(k=>a[k]===b[k])&&[...document.querySelectorAll('.article-toolbar svg')].every(x=>x.getBoundingClientRect().width===18)&&!document.querySelector('.toolbar-link')}));check(width+': detail chat belongs to the right action group',await p.evaluate(()=>{const chat=document.querySelector('#detailDiscuss'),save=document.querySelector('#detailSave');return parseFloat(getComputedStyle(chat.parentElement).marginLeft)>8&&save.getBoundingClientRect().left-chat.getBoundingClientRect().right===2&&chat.querySelector('svg').getBoundingClientRect().width===18}));await p.evaluate(()=>scrollTo(0,350));const y=await p.evaluate(()=>scrollY);await p.locator('#detailDiscuss').click();await p.locator('#chatPanel textarea').waitFor();
  check(width+': article has its own empty conversation',await p.locator('.chat-user').count()===0);
  await p.getByRole('textbox',{name:'Your question',exact:true}).fill('Explain the article');await p.getByRole('button',{name:'Send question',exact:true}).click();await p.getByRole('button',{name:'Stop answer',exact:true}).waitFor();await worker();await p.locator('.chat-assistant').waitFor();
  check(width+': panel fits the viewport',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await p.screenshot({path:path.join(tmpdir(),'stillfeed-chat-panel-'+width+'.png'),fullPage:true});
  await p.getByRole('button',{name:'Close chat',exact:true}).click();await p.locator('#chatPanel').waitFor({state:'hidden'});await sleep(300);
  check(width+': closing preserves article scroll position',Math.abs(await p.evaluate(()=>scrollY)-y)<5);
  const postChat=await post('/api/chat',{context:{kind:'article',id:postId}});await post('/api/chat/'+postChat.id+'/clear',{});
  await p.goto(base+'/post/'+postId);await p.locator('#detailDiscuss').click();await p.getByText('This post',{exact:true}).waitFor();
  check(width+': long X context stays compact',(await p.locator('.chat-context').boundingBox()).height<=68);
  await p.getByRole('button',{name:'Show chat context',exact:true}).click();await p.locator('.chat-context-popover').waitFor();
  check(width+': full post remains available on demand',await p.locator('.chat-context-popover .popover-text').textContent()===longPost);
  await p.keyboard.press('Escape');await p.getByRole('textbox',{name:'Your question',exact:true}).fill('O cem to je?');await p.getByRole('button',{name:'Send question',exact:true}).click();await p.getByRole('button',{name:'Stop answer',exact:true}).waitFor();await worker();await p.locator('.chat-assistant').waitFor();
  check(width+': short question uses a compact bubble',(await p.locator('.chat-user').boundingBox()).width<250);
  check(width+': model is tucked away from the conversation',await p.locator('.chat-model').count()===0);
  await p.getByRole('button',{name:'Chat options',exact:true}).click();await p.getByRole('button',{name:'Clear conversation',exact:true}).waitFor();await p.keyboard.press('Escape');
  if(width===390){
    await p.getByRole('textbox',{name:'Your question',exact:true}).focus();
    // iOS keeps the layout viewport tall while the keyboard shrinks visualViewport.
    await p.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:innerHeight-330});visualViewport.dispatchEvent(new Event('resize'));});
    await p.waitForFunction(()=>document.querySelector('.chat-composer').getBoundingClientRect().bottom<=visualViewport.height+visualViewport.offsetTop+1);
    check('phone: composer stays above the simulated keyboard',await p.locator('.chat-composer').isVisible());
    await p.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));document.activeElement.blur();});
  }
  await p.screenshot({path:path.join(tmpdir(),'stillfeed-chat-compact-'+width+'.png'),fullPage:true});
  await p.getByRole('button',{name:'Close chat',exact:true}).click();await p.locator('#chatPanel').waitFor({state:'hidden'});
  if(width===1280){
    await p.goto(base);await p.locator('#feed .feed-card').first().waitFor();
    const allBatch=await p.evaluate(()=>JSON.parse(sessionStorage.getItem('stillfeed-session')).batch);await post('/api/seen-batch',{batch:allBatch});
    await p.reload();await p.locator('#readCount').click();await p.locator('#hideViewed').click();
    await p.waitForFunction(()=>document.querySelector('#readCount')?.textContent==='0/0');
    check('empty batch keeps its counter visible',await p.locator('#readCount').isVisible());
    await p.getByRole('button',{name:'Undo',exact:true}).click();await p.locator('#feed .feed-card').first().waitFor();
  }
  check(width+': no browser errors',errors.length===0);await ctx.close();
 }
 console.log('Chat UI passed');
}finally{await browser?.close();server.kill();rmSync(temp,{recursive:true,force:true})}
