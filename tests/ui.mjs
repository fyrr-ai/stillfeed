// Real Bun server on synthetic data (tests/fixture.ts), isolated SQLite and browser state, a stub collection, no network.
// PW=<path to playwright-core> CHROME=<chromium binary> node tests/ui.mjs
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PW);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),bun=process.env.BUN||'bun';
const temp=mkdtempSync(path.join(tmpdir(),'radar-ui-test-')),state=path.join(temp,'state'),collected=path.join(temp,'collected');
// Nothing reads the real home, its .env or an AI/X key; Refresh runs a stub instead of a paid collection.
const env={PATH:process.env.PATH,HOME:temp,RADAR_HOME:temp,RADAR_LLM:'none',RADAR_LANGUAGE:'English',SOCIALDATA_API_KEY:'',RADAR_NO_WORKER:'1',RADAR_DISABLE_SCHEDULE:'1',RADAR_COLLECT_COMMAND:`sleep 1 && : > '${collected}'`};
const fixture=(...args)=>execFileSync(bun,[path.join(root,'tests/fixture.ts'),...args],{encoding:'utf8',env,cwd:temp});
// SQLite reads and test-only writes go straight to the state database through bun:sqlite.
const sql=(query,args=[])=>JSON.parse(execFileSync(bun,['-e','const {Database}=require("bun:sqlite"),d=new Database(Bun.argv[1]);d.exec("PRAGMA busy_timeout=5000");console.log(JSON.stringify(d.query(Bun.argv[2]).values(...JSON.parse(Bun.argv[3]))??[]))',path.join(state,'radar.db'),query,JSON.stringify(args)],{encoding:'utf8',env}));
const created=JSON.parse(fixture('create',state));
const port=21000+Math.floor(Math.random()*20000),base=`http://127.0.0.1:${port}`;
const server=spawn(bun,[path.join(root,'src/server.ts'),'--state-dir',state,'--port',String(port)],{stdio:['ignore','ignore','inherit'],env,cwd:temp});
process.on('exit',()=>server.kill());
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let passed=0;const failures=[];
function check(name,ok,detail=''){console.log(`${ok?'ok':'FAIL'} ${name} ${ok?'':detail}`);if(ok)passed++;else failures.push(name);}
const request=async(url,value)=>{const r=await fetch(base+url,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Radar':'1'},body:JSON.stringify(value)});const result=await r.json();if(!r.ok)throw new Error(result.error);return result;};
const idOf=url=>createHash('sha256').update(url).digest('hex').slice(0,32);
let browser;
try{
 for(let i=0;i<300;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await sleep(100);}
 const expected=new Set(created.urls);
 let first=await request('/api/feed?scope=all'),page=first,actual=[];let pages=0;
 do{actual.push(...page.items.map(a=>a.url));pages++;if(page.next===null)break;page=await request(`/api/feed?batch=${first.batch}&offset=${page.next}`);}while(pages<200);
 check('every collected URL reaches the API exactly once',new Set(actual).size===actual.length&&actual.length===expected.size&&actual.every(u=>expected.has(u)),`${actual.length}/${expected.size}`);
 check('first response is bounded to 30 items',first.items.length===30);
 check('first feed JSON stays below 100 kB',Buffer.byteLength(JSON.stringify(first))<100000);
 const keep=first.items.map(a=>a.id);await request('/api/seen',{ids:keep,seen:true});
 const again=await request('/api/feed?batch='+first.batch);
 check('marking seen does not change the active batch',JSON.stringify(keep)===JSON.stringify(again.items.map(a=>a.id)));
 check('seen persisted in SQLite',sql('SELECT COUNT(*) FROM seen WHERE article_id=?',[keep[0]])[0][0]===1);
 const articles=await request('/api/feed?scope=all&kind=article'),posts=await request('/api/feed?scope=all&kind=x');
 check('format counts partition the complete feed',articles.total+posts.total===first.total);
 check('formats actually match returned records',articles.items.every(a=>a.kind==='article')&&posts.items.every(a=>a.kind==='x'));
 const hidden=await request('/api/feed?scope=all&hideSeen=1');check('a new hidden-seen view excludes persisted seen rows',hidden.items.every(a=>!a.seen)&&hidden.total<first.total);
 const bad=await fetch(base+'/api/seen',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});check('writes require the request header',bad.status===400);
 const foreign=await fetch(base+'/api/seen',{method:'POST',headers:{'Content-Type':'application/json','X-Radar':'1',Origin:'https://foreign.example'},body:JSON.stringify({ids:[],seen:true})});check('foreign origins are rejected',foreign.status===400);
 const proxy=await fetch(base+'/api/seen',{method:'POST',headers:{'Content-Type':'application/json','X-Radar':'1',Origin:`https://127.0.0.1:${port}`},body:JSON.stringify({ids:[],seen:true})});check('same host behind TLS proxy can save seen',proxy.ok);
 check('old bulk JSON API is retired',(await fetch(base+'/data/latest-24h.json')).status===404);
 check('unknown image cannot turn into a proxy',(await fetch(base+'/api/image/00000000000000000000000000000000/preview')).status===404);
 const coldId=articles.items[0].id,started=Date.now();const cold=await fetch(base+`/api/article/${coldId}/content`);check('cold article requests queue preparation without blocking on a model',cold.status===202&&Date.now()-started<1000);check('opened articles get priority in the durable queue',sql('SELECT priority FROM reader_jobs WHERE article_id=?',[coldId])[0][0]===1000);
 const cachedReading={title:'Prepared article',author:'Author',html:'<p>Available immediately</p>',text:'Available immediately',url:articles.items[0].url,fetchedAt:Date.now()};
 sql('INSERT INTO article_content VALUES(?,?,?)',[coldId,JSON.stringify(cachedReading),1]);sql('INSERT INTO article_summaries(article_id,content_hash,points,generated_at,model,language) VALUES(?,?,?,?,?,?)',[coldId,createHash('sha256').update(cachedReading.title+'\n'+cachedReading.text).digest('hex').slice(0,32),JSON.stringify(['Jedna.','Dva.','Tři.']),1,'gpt-6-luna','English']);
 check('prepared content and Luna summary come straight from SQLite',(await request(`/api/article/${coldId}/content`)).title==='Prepared article'&&(await request(`/api/article/${coldId}/summary`)).model==='gpt-6-luna');
 await request(`/api/article/${coldId}/saved`,{saved:true});check('Saved is a separate library backed by SQLite',(await request('/api/feed?saved=1')).items.some(a=>a.id===coldId&&a.saved));await request(`/api/article/${coldId}/saved`,{saved:false});
 const sources=await request('/api/sources'),source=sources.find(s=>s.name===first.items[0].source);await request('/api/sources',{id:source.id,enabled:false});const muted=await request('/api/feed?scope=all');check('source configuration affects a new query',muted.total<first.total);await request('/api/sources',{id:source.id,enabled:true});
 await request('/api/settings',{windowHours:168,refreshEvery:3});check('settings are persisted in SQLite',(await request('/api/settings')).windowHours===168);await request('/api/settings',{windowHours:72,refreshEvery:2,nightPause:true});
 browser=await chromium.launch({executablePath:process.env.CHROME,args:['--no-sandbox']});
 for(const width of [390,1280]){
  const ctx=await browser.newContext({viewport:{width,height:844},isMobile:width<760,hasTouch:true});
  await ctx.route(u=>u.hostname!=='127.0.0.1',r=>r.fulfill({body:'<html>Original page</html>'}));
  await ctx.route('**/api/image/**',r=>r.fulfill({status:404,body:''}));
  const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base);await p.waitForSelector('.feed-card');
  const touch=width===390?await ctx.newCDPSession(p):null;
  const swipe=async(x,y,dx,dy,cancel=false)=>{await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});for(let step=1;step<=10;step++){await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*step/10,y:y+dy*step/10,id:1}]});await sleep(20);}await touch.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});};
  const isSaved=id=>p.evaluate(id=>document.querySelector(`#feed [data-id="${id}"] .bookmark`)?.getAttribute('aria-pressed')==='true',id);
  const toggleSave=async(card,label)=>{await card.scrollIntoViewIfNeeded();await card.getByRole('button',{name:label,exact:true}).click();};
  const reveal=async()=>{if(await p.locator('.topbar-hidden').count()){await p.evaluate(()=>scrollBy(0,-20));await p.locator('.topbar-hidden').waitFor({state:'detached'});await sleep(250);}};
  const open=async()=>{await reveal();await p.getByRole('button',{name:'Feed options',exact:true}).click();await p.locator('#optionsSheet').waitFor({state:'visible'});};
  const close=async()=>{await p.getByRole('button',{name:'Close options',exact:true}).click();await p.locator('#optionsSheet').waitFor({state:'hidden'});};
  const optionLabels={scope:{ai:'AI & data',all:'Everything'},format:{all:'All',article:'Articles',x:'X'}};
  const select=async(id,value)=>{await p.locator(`#${id}`).getByRole('radio',{name:optionLabels[id][value],exact:true}).click();await sleep(250);};
  check(`${width}: English, one responsive feed`,await p.locator('html').getAttribute('lang')==='en'&&await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check(`${width}: React renders ready-made SDK components`,await p.evaluate(()=>['drawer-trigger','segmented-control'].slice(0,1).every(slot=>document.querySelector(`[data-slot="${slot}"]`))&&Boolean(document.querySelector('#root')?.firstElementChild)));
  if(width===390){
    await p.evaluate(()=>{const specimen=document.createElement('p');specimen.id='fontSpecimen';specimen.style.cssText='position:fixed;bottom:0;left:0;z-index:999';specimen.textContent='Příliš žluťoučký kůň';document.body.append(specimen);});
    await p.evaluate(async()=>{await document.fonts.load('16px Geist','Příliš žluťoučký kůň');await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    await touch.send('DOM.enable');await touch.send('CSS.enable');const {root}=await touch.send('DOM.getDocument');const {nodeId}=await touch.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#fontSpecimen'});const {fonts}=await touch.send('CSS.getPlatformFontsForNode',{nodeId});
    check('Czech accents use one consistent font instead of mixed fallback faces',fonts.length===1&&fonts[0].glyphCount>=20,JSON.stringify(fonts));
    await p.locator('#fontSpecimen').evaluate(el=>el.remove());
    await p.evaluate(()=>document.documentElement.style.fontSize='200%');
    for(const size of [320,390,430]){await p.setViewportSize({width:size,height:844});await sleep(100);check(`${size}: 200% text fits without horizontal scrolling`,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    await p.setViewportSize({width:320,height:844});await open();check('options remain usable at 200% text size',await p.locator('#searchInput').isVisible()&&await p.evaluate(()=>document.querySelector('#optionsSheet').scrollWidth<=innerWidth));await close();
    await p.evaluate(()=>document.documentElement.style.fontSize='');await p.setViewportSize({width,height:844});await p.evaluate(()=>scrollTo(0,0));
    check('article title previews are bounded while post text stays complete',await p.evaluate(()=>getComputedStyle(document.querySelector('.article h2')).webkitLineClamp==='4'&&getComputedStyle(document.querySelector('.post-text')).webkitLineClamp==='none'));
  }
  if(width===390){
    const oldFirst=await p.locator('.feed-card').first().getAttribute('data-id');
    // A collection lands while the reader is down the page: one more record, a new revision and generatedAt.
    const nextTime=new Date(Date.parse((await request('/api/status')).generatedAt)+60000).toISOString();
    const addition={url:'https://example.com/new-after-import',title:'A new AI tool &amp; &lt;img src=x onerror=alert(1)&gt;',source:'Test updates',site_id:'test',published_at:new Date(Date.parse(nextTime)-30000).toISOString(),ai_is_related:true};
    fixture('add',state,nextTime,JSON.stringify([addition]));
    await p.evaluate(()=>scrollTo(0,900));await sleep(300);
    await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.locator('#newUpdates').waitFor({state:'visible'});
    check('new data below the top offers a pill instead of moving the feed',await p.locator('.feed-card').first().getAttribute('data-id')===oldFirst);
    await p.locator('#newUpdates').click();await p.waitForFunction(()=>document.querySelector('.feed-card')?.getAttribute('data-url')==='https://example.com/new-after-import');
    check('applying updates switches to the new snapshot',await p.locator('.feed-card').first().getAttribute('data-url')===addition.url);
    check('headline entities decode as text without introducing executable HTML',await p.locator('.feed-card').first().locator('h2').innerText()==='A new AI tool & <img src=x onerror=alert(1)>'&&await p.locator('.feed-card').first().locator('h2 img').count()===0);
    const second={...addition,url:'https://example.com/second-after-import',title:'Second fresh AI update',published_at:new Date(Date.parse(nextTime)+30000).toISOString()};
    const later=new Date(Date.parse(nextTime)+60000).toISOString();fixture('add',state,later,JSON.stringify([second]));
    await p.evaluate(()=>scrollTo(0,0));await sleep(200);await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForFunction(()=>document.querySelector('.feed-card')?.getAttribute('data-url')==='https://example.com/second-after-import');
    check('at the top new data arrives without a tap',await p.locator('#newUpdates').isHidden());
  }

  const post=p.locator('.feed-card.tweet').first();const postURL=await post.getAttribute('data-url');let remoteCalls=0;p.on('request',request=>{if(/socialdata|comments|replies/.test(request.url()))remoteCalls++;});
  const postId=await post.getAttribute('data-id');
  check(`${width}: X bookmark is visible in the card header`,await post.locator('.card-head .bookmark').isVisible());
  if(await isSaved(postId)){await toggleSave(post,'Remove from Saved');await p.waitForFunction(id=>document.querySelector(`#feed [data-id="${id}"] .bookmark`)?.getAttribute('aria-pressed')==='false',postId);}
  if(width===390){await post.scrollIntoViewIfNeeded();const box=await post.boundingBox();await swipe(box.x+box.width-75,Math.max(130,box.y+85),-140,0);await sleep(300);check('left swipe on a card does not save or open it',!(await isSaved(postId))&&new URL(p.url()).pathname==='/');}
  await toggleSave(post,'Save for later');await p.waitForFunction(id=>document.querySelector(`#feed [data-id="${id}"] .bookmark`)?.getAttribute('aria-pressed')==='true',postId);check(`${width}: saving offers Undo`,await p.getByRole('button',{name:'Undo',exact:true}).isVisible());
  check(`${width}: saved X posts enter the same library as articles`,(await request('/api/feed?saved=1')).items.some(item=>item.id===postId&&item.kind==='x'));
  await post.getByRole('link',{name:'Open thread',exact:true}).click();await p.locator('#detailLabel').filter({hasText:'Thread'}).waitFor();check(`${width}: X opens a local thread from existing data`,new URL(p.url()).pathname.startsWith('/post/')&&await p.locator('#readingContent .feed-card.tweet').count()===1);check(`${width}: thread detail does not fetch paid replies`,remoteCalls===0);check(`${width}: conversation remains available on X`,await p.locator('.thread-conversation').getAttribute('href')===postURL);
  await p.locator('#detailSave').click();await p.waitForFunction(()=>document.querySelector('#detailSave').getAttribute('aria-pressed')==='false');
  check(`${width}: removing a bookmark updates both X detail and feed`,!(await isSaved(postId)));
  if(width===390){await swipe(260,240,-150,0);await sleep(300);check('left swipe in a thread neither saves nor navigates',await p.locator('#detailSave').getAttribute('aria-pressed')==='false'&&new URL(p.url()).pathname.startsWith('/post/'));await p.locator('#detailSave').click();await p.waitForFunction(()=>document.querySelector('#detailSave').getAttribute('aria-pressed')==='true');}
  await p.reload();await p.locator('#readingContent .feed-card.tweet').waitFor();check(`${width}: thread address survives reload`,await p.locator('#detailLabel').innerText()==='Thread');
  await p.getByRole('button',{name:'Back to feed',exact:true}).click();await p.locator('#articlePage').waitFor({state:'hidden'});
  check(`${width}: a post you opened leaves the feed when you return`,await p.locator(`#feed [data-id="${postId}"]`).count()===0);
  const tapped=p.locator('.feed-card.tweet').first(),tappedId=await tapped.getAttribute('data-id');await tapped.locator('.post-text').first().click({position:{x:2,y:4}});await p.locator('#readingContent .feed-card.tweet').waitFor();check(`${width}: tapping the X post body opens its detail`,new URL(p.url()).pathname===`/post/${tappedId}`);
  await p.getByRole('button',{name:'Back to feed',exact:true}).click();await p.locator('#articlePage').waitFor({state:'hidden'});
  await open();const before=sql('SELECT COUNT(*) FROM seen')[0][0];await sleep(1500);check(`${width}: options do not mark the background seen`,sql('SELECT COUNT(*) FROM seen')[0][0]===before);
  await select('scope','all');await select('format','article');await p.waitForFunction(()=>document.querySelectorAll('.feed-card.tweet').length===0&&document.querySelectorAll('.feed-card.article').length>0);check(`${width}: articles-only uses a filtered API query`,await p.locator('.feed-card.tweet').count()===0&&await p.locator('.feed-card.article').count()>0);
  await p.locator('#searchInput').fill('zzzznoresultszzzz');await p.waitForSelector('#empty:not([hidden])');check(`${width}: empty search is explained`,(await p.locator('#emptyTitle').innerText())==='No matching results');
  await p.getByRole('button',{name:'Clear search',exact:true}).click();await p.waitForSelector('.feed-card');check(`${width}: SDK clear returns focus`,await p.locator('#searchInput').evaluate(el=>el===document.activeElement));
  await close();const article=p.locator('.feed-card.article').first();await article.scrollIntoViewIfNeeded();check(`${width}: source identity is present and a missing image leaves no empty preview`,await article.locator('.card-row > .avatar').isVisible()&&await article.locator('.preview').count()===0);
  check(`${width}: articles use the compact accessible A badge`,await article.locator('.format-article').getAttribute('aria-label')==='Article');
  const original=await article.getAttribute('data-url');
  await p.route('**/api/article/*/content',route=>route.fulfill({json:{title:'A readable article',author:'Test author',html:'<p>Full article body from the reading endpoint.</p>',url:original}}));
  await p.route('**/api/article/*/summary',route=>route.fulfill({json:{points:['Nový nástroj pomáhá s prací.','Podporuje otevřené modely.','Zatím jde o první verzi.']}}));
  const readerY=await p.evaluate(()=>scrollY);if(width===390)await article.locator('.article-link').tap();else await article.locator('.article-link').click();await p.getByText('Full article body from the reading endpoint.').waitFor();
  check(`${width}: article reader opens full content`,await p.locator('#articlePage').isVisible()&&new URL(p.url()).pathname.startsWith('/article/'));
  await p.getByText('Nový nástroj pomáhá s prací.').waitFor();check(`${width}: Czech summary is separate from the original text`,await p.locator('.ai-summary li').count()===3&&await p.locator('.full-article').isVisible());
  const popup=p.waitForEvent('popup');await p.locator('#articleOriginal').click();const target=await popup;check(`${width}: reader offers the original page`,target.url()===original);await target.close();await p.bringToFront();
  check(`${width}: opening an article removes its unseen dot`,await article.locator('.unseen-dot').isHidden());
  check(`${width}: article is a page, not an overlay`,await p.locator('[data-slot="dialog-content"]').count()===0&&await p.locator('#readerOptions').isHidden());
  const seenDuringReading=sql('SELECT COUNT(*) FROM seen')[0][0];await sleep(1200);check(`${width}: reader pauses background seen tracking`,sql('SELECT COUNT(*) FROM seen')[0][0]===seenDuringReading);
  await p.getByRole('button',{name:'Back to feed',exact:true}).click();await p.locator('#articlePage').waitFor({state:'hidden'});await sleep(250);check(`${width}: reader close returns to the same feed position`,Math.abs((await p.evaluate(()=>scrollY))-readerY)<5);
  if(width===390){
    await p.locator('.article-link').first().click();await p.locator('.reading-prose').waitFor();const detailURL=p.url();
    await p.goBack();await p.locator('#articlePage').waitFor({state:'hidden'});check('browser back returns to the feed',new URL(p.url()).pathname==='/');
    await p.goForward();await p.locator('.reading-prose').waitFor();check('browser forward restores the article',p.url()===detailURL);
    await p.reload();await p.locator('.reading-prose').waitFor();check('article URL survives reload',p.url()===detailURL);
    await p.getByRole('button',{name:'Back to feed',exact:true}).click();await p.locator('#articlePage').waitFor({state:'hidden'});
    await p.route('**/api/article/*/summary',route=>route.fulfill({status:503,json:{error:'Temporarily unavailable'}}));
    await article.locator('.article-link').click();await p.getByText('Summary unavailable.',{exact:true}).waitFor();
    check('summary failure leaves the original article readable',await p.locator('.reading-prose').isVisible()&&await p.getByText('Full article body from the reading endpoint.').isVisible());
    await p.route('**/api/article/*/summary',route=>route.fulfill({json:{points:['Obnovené shrnutí.','Další informace.','Podrobnosti nástroje.']}}));
    await p.getByRole('button',{name:'Try again',exact:true}).click();await p.getByText('Obnovené shrnutí.',{exact:true}).waitFor();check('summary retries without closing the article',await p.locator('.ai-summary li').count()===3);
    await p.getByRole('button',{name:'Back to feed',exact:true}).click();await p.locator('#articlePage').waitFor({state:'hidden'});
  }
  if(width===390){
    await article.locator('.article-link').click();await p.locator('.reading-prose').waitFor();const route=p.url();
    await p.locator('.reading-prose').evaluate(el=>{for(let i=0;i<40;i++){const paragraph=document.createElement('p');paragraph.textContent='A long article must scroll naturally while touch gestures remain available.';el.append(paragraph);}});
    await swipe(150,350,8,-140);check('vertical article scrolling moves the page without navigating',p.url()===route&&await p.evaluate(()=>scrollY>40));
    await swipe(100,250,150,110);check('diagonal dragging does not navigate',p.url()===route);
    await swipe(100,250,45,0);check('short horizontal drag does not navigate',p.url()===route);
    await swipe(260,250,-150,0);await sleep(300);check('left swipe in the article detail does nothing',p.url()===route&&await p.locator('#detailSave').getAttribute('aria-pressed')==='false');await p.locator('#detailSave').click();await p.waitForFunction(()=>document.querySelector('#detailSave').getAttribute('aria-pressed')==='true');
    await swipe(100,250,160,0);await p.locator('#articlePage').waitFor({state:'hidden'});check('right swipe goes back to the feed',new URL(p.url()).pathname==='/');
    let refreshCalls=0;p.on('request',request=>{if(request.url().endsWith('/api/refresh')&&request.method()==='POST')refreshCalls++;});
    await p.evaluate(()=>scrollTo(0,0));await sleep(100);await swipe(160,150,0,45);await sleep(100);check('short pull does not refresh',refreshCalls===0);
    await swipe(160,150,0,150,true);await sleep(100);check('cancelled pull does not refresh',refreshCalls===0&&await p.locator('#gestureHint').isHidden());
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:100,y:150,id:1},{x:240,y:150,id:2}]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:100,y:290,id:1},{x:240,y:290,id:2}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(100);check('two-finger movement does not refresh',refreshCalls===0);
    const seenBeforePull=await p.locator('#feed .feed-card.seen').count();const rebuilt=p.waitForResponse(r=>r.url().includes('/api/feed?')&&r.url().includes('hideSeen=1')&&!r.url().includes('batch='));const refreshed=p.waitForResponse(r=>r.url().endsWith('/api/refresh')&&r.request().method()==='POST');await swipe(160,150,0,150);await refreshed;await rebuilt;await sleep(150);check('pull to refresh rebuilds the feed without what you have seen',seenBeforePull>0&&await p.locator('#feed .feed-card.seen').count()===0,`${seenBeforePull} seen before`);check('pull down refreshes once without opening the underlying link',refreshCalls===1&&new URL(p.url()).pathname==='/');
    await sleep(1600);await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await sleep(300);check('pull to refresh runs the collection command once and it finishes',existsSync(collected)&&(await request('/api/status')).refresh==='idle');
    await p.evaluate(()=>scrollTo(0,600));await swipe(160,180,0,130);await sleep(100);check('scrolling inside the feed moves it without triggering refresh',refreshCalls===1&&await p.evaluate(()=>scrollY<600&&scrollY>0));
  }
  await p.route('**/api/article/*/content',route=>route.fulfill({json:{title:'Another readable article',author:'',html:'<p>Article content</p>',url:original}}));
  await article.scrollIntoViewIfNeeded();const savedId=await article.getAttribute('data-id');if(await isSaved(savedId)){await toggleSave(article,'Remove from Saved');await p.waitForFunction(id=>document.querySelector(`#feed [data-id="${id}"] .bookmark`)?.getAttribute('aria-pressed')==='false',savedId);}
  await toggleSave(article,'Save for later');await p.waitForFunction(id=>document.querySelector(`#feed [data-id="${id}"] .bookmark`)?.getAttribute('aria-pressed')==='true',savedId);
  await reveal();const feedY=await p.evaluate(()=>scrollY);await p.getByRole('button',{name:'Saved',exact:true}).click();await p.waitForSelector(`[data-id="${savedId}"]`);check(`${width}: Saved has its own view`,await p.locator('#viewSaved').getAttribute('aria-pressed')==='true');
  await p.reload();await p.waitForSelector(`[data-id="${savedId}"]`);check(`${width}: Saved survives reload`,await p.locator(`[data-id="${savedId}"] .bookmark`).getAttribute('aria-pressed')==='true');
  if(width===390){let collectionRefreshes=0;p.on('request',request=>{if(request.url().endsWith('/api/refresh')&&request.method()==='POST')collectionRefreshes++;});const reloaded=p.waitForResponse(r=>r.url().includes('/api/feed?')&&r.url().includes('saved=1'));await open();await p.getByRole('button',{name:'Refresh saved',exact:true}).click();await reloaded;await close();check('refreshing Saved does not run paid collection again',collectionRefreshes===0);}

  await reveal();await p.getByRole('button',{name:'Feed',exact:true}).click();await p.waitForSelector('.feed-card');await sleep(200);check(`${width}: returning from Saved restores the feed position`,Math.abs((await p.evaluate(()=>scrollY))-feedY)<8,`${await p.evaluate(()=>scrollY)} vs ${feedY}`);
  if(width===390){
    const another=p.locator('.feed-card.article').nth(1),anotherId=await another.getAttribute('data-id');if(!(await isSaved(anotherId))){await toggleSave(another,'Save for later');}await p.waitForFunction(id=>document.querySelector(`[data-id="${id}"] .bookmark`)?.getAttribute('aria-pressed')==='true',anotherId);
    await reveal();await p.getByRole('button',{name:'Saved',exact:true}).click();await p.waitForSelector(`[data-id="${anotherId}"]`);check('adding another item refreshes the existing Saved view',await p.locator(`[data-id="${savedId}"]`).count()===1&&await p.locator(`[data-id="${anotherId}"]`).count()===1);
    await reveal();await p.getByRole('button',{name:'Feed',exact:true}).click();await p.waitForSelector('.feed-card');
  }
  await p.evaluate(()=>window.scrollTo(0,1800));await sleep(300);await reveal();const y=await p.evaluate(()=>scrollY);await open();await close();check(`${width}: opening options preserves reading position`,Math.abs((await p.evaluate(()=>scrollY))-y)<5,`${y} -> ${await p.evaluate(()=>scrollY)}`);
  const initial=await p.locator('.feed-card').count();await p.locator('.feed-card').first().evaluate(el=>el.dataset.probe='original-node');await p.locator('#loadMore').evaluate(el=>el.click());await p.waitForFunction(n=>document.querySelectorAll('.feed-card').length>n,initial);check(`${width}: pagination appends without rebuilding previous cards`,await p.locator('[data-probe="original-node"]').count()===1);check(`${width}: unseen rows have a dot`,await p.locator('.feed-card:not(.seen) .unseen-dot:not([hidden])').count()>0);
  await p.evaluate(()=>scrollTo(0,2100));await sleep(300);const anchor=await p.evaluate(()=>{const el=[...document.querySelectorAll('.feed-card')].find(el=>el.getBoundingClientRect().bottom>100);return{id:el.dataset.id,y:el.getBoundingClientRect().top}});await p.reload();await p.waitForSelector(`[data-id="${anchor.id}"]`);await sleep(300);check(`${width}: reload restores the same item and offset`,Math.abs((await p.locator(`[data-id="${anchor.id}"]`).boundingBox()).y-anchor.y)<8);
  if(width===390){
    await p.route('**/api/seen',route=>route.abort());
    const offlineCard=p.locator('.feed-card.article:not(.seen)').first();await offlineCard.scrollIntoViewIfNeeded();const offlineId=await offlineCard.getAttribute('data-id');
    await offlineCard.locator('.article-link').click();await p.getByRole('button',{name:'Back to feed',exact:true}).click();await p.locator('#articlePage').waitFor({state:'hidden'});
    await p.waitForFunction(id=>JSON.parse(localStorage.getItem('radar-v2-outbox')||'{}')[id]===true,offlineId);
    check('failed seen save stays on the device',sql('SELECT COUNT(*) FROM seen WHERE article_id=?',[offlineId])[0][0]===0);
    await p.reload();await p.waitForSelector('.feed-card');await sleep(300);
    check('offline seen state survives reload and the opened article stays out of the feed',await p.locator(`[data-id="${offlineId}"]`).count()===0&&await p.evaluate(id=>JSON.parse(localStorage.getItem('radar-v2-outbox')||'{}')[id]===true,offlineId));
    await p.unroute('**/api/seen');await p.evaluate(()=>window.dispatchEvent(new Event('online')));
    await p.waitForFunction(id=>!JSON.parse(localStorage.getItem('radar-v2-outbox')||'{}')[id],offlineId);
    check('reconnection saves seen to the server',sql('SELECT COUNT(*) FROM seen WHERE article_id=?',[offlineId])[0][0]===1);
  }
  await p.evaluate(()=>scrollTo(0,0));await sleep(200);const room=await p.evaluate(()=>document.documentElement.scrollHeight-innerHeight);await p.evaluate(y=>scrollTo(0,y),Math.min(1500,room-200));await sleep(150);await p.evaluate(y=>scrollTo(0,y),Math.min(1600,room-100));await sleep(300);check(`${width}: top bar hides while scrolling down`,room>300&&await p.locator('.topbar-hidden').count()===1,`room ${room}`);
  await p.evaluate(()=>scrollBy(0,-30));await sleep(300);check(`${width}: a small scroll up brings Feed and Saved back`,await p.locator('.topbar-hidden').count()===0&&await p.getByRole('button',{name:'Saved',exact:true}).isVisible());
  if(width===390){
    // Cards that were on screen for a second are marked seen; let that land before counting.
    const seenNow=()=>sql('SELECT COUNT(*) FROM seen')[0][0];await sleep(1200);const unseenBefore=seenNow();await open();await p.getByRole('button',{name:'Mark all as seen',exact:true}).click();await p.locator('#markAllConfirm').waitFor();await p.getByRole('button',{name:'Cancel',exact:true}).click();await p.locator('#markAllConfirm').waitFor({state:'hidden'});await close();await sleep(300);check('mark all asks first and Cancel changes nothing',seenNow()===unseenBefore);
    // Cards on screen after Cancel became seen meanwhile; the baseline is taken while the confirmation covers the feed.
    await open();await p.getByRole('button',{name:'Mark all as seen',exact:true}).click();await p.locator('#markAllConfirm').waitFor();const seenBeforeMarkAll=seenNow();await p.getByRole('button',{name:'Mark as seen',exact:true}).click();await p.locator('#optionsSheet').waitFor({state:'hidden'});await p.getByRole('button',{name:'Undo',exact:true}).waitFor();
    const prefs=await p.evaluate(()=>JSON.parse(localStorage.getItem('radar-v2-preferences')));const remaining=await request(`/api/feed?scope=${prefs.scope}&kind=${prefs.kind}&q=${encodeURIComponent(prefs.q)}&hideSeen=1`);const toastText=await p.locator('.toast-title').innerText();const reported=Number(toastText.replace(/[^0-9]/g,''));
    check('mark all as seen covers the whole view, not just loaded cards',remaining.total===0&&reported>0&&seenNow()-seenBeforeMarkAll>=reported&&await p.locator('#feed .feed-card:not(.seen)').count()===0,`${remaining.total} left, ${toastText}, diff ${seenNow()-seenBeforeMarkAll}, unseen cards ${await p.locator('#feed .feed-card:not(.seen)').count()}`);
    const marked=seenNow();await p.getByRole('button',{name:'Undo',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('#feed .feed-card:not(.seen)').length>0);
    const restored=seenNow();check('Undo restores exactly the rows mark-all changed',restored===seenBeforeMarkAll&&marked>seenBeforeMarkAll,`${seenBeforeMarkAll} before, ${marked} marked, ${restored} after Undo`);
  }
  await p.route('**/api/article/*/content',route=>route.fulfill({json:{title:'Readable',author:'',html:'<p>Body</p>',url:'https://example.com/'}}));
  await p.evaluate(()=>scrollTo(0,0));await sleep(200);const firstCard=p.locator('#feed .feed-card').first(),firstId=await firstCard.getAttribute('data-id'),secondId=await p.locator('#feed .feed-card').nth(1).getAttribute('data-id');
  await firstCard.locator('.card-head time').click();await p.locator('#articlePage').waitFor({state:'visible'});await p.locator('.next-entry').click();await p.waitForFunction(id=>location.pathname.endsWith(id),secondId);
  check(`${width}: Next opens the following feed item`,new URL(p.url()).pathname.endsWith(secondId));
  await p.goBack();await p.locator('#articlePage').waitFor({state:'hidden'});check(`${width}: one Back after Next returns to the feed without both read items`,new URL(p.url()).pathname==='/'&&await p.locator(`#feed [data-id="${firstId}"], #feed [data-id="${secondId}"]`).count()===0);
  await p.unroute('**/api/article/*/content');
  if(width===390){
    const picks=sql('SELECT id FROM articles WHERE ai=1 AND sort_at>? ORDER BY sort_at DESC LIMIT 2',[Date.now()-40*3600000]).map(r=>r[0]);
    const pickedAt=Date.now();for(const [i,a] of picks.entries()){sql('DELETE FROM opened WHERE article_id=?',[a]);sql('INSERT OR REPLACE INTO hot_picks VALUES(?,?,?,?)',[a,'Důvod '+i,pickedAt-i,'test']);}
    await reveal();await p.locator('#viewHot').click();await p.locator('#hot .hot-item').first().waitFor();
    check('Hot shows the picks with their reasons',picks.length===2&&await p.locator('#hot .hot-item').count()===2&&await p.locator('#hot .card-note').first().innerText().then(t=>t.includes('Důvod 0')));
    await sleep(1500);await p.reload();await p.locator('#hot .hot-item').first().waitFor();check('Hot items do not leave by being on screen or after a reload',await p.locator('#hot .hot-item').count()===2&&await p.locator('#viewHot').getAttribute('aria-pressed')==='true');
    const dismissed=p.waitForResponse(r=>/\/api\/article\/[a-f0-9]{32}\/hot$/.test(r.url())&&r.request().method()==='POST');await p.locator('#hot .card-note-dismiss').first().click();await dismissed;await p.waitForFunction(()=>document.querySelectorAll('#hot .hot-item').length===1);check('dismissing removes a Hot item for good',sql('SELECT COUNT(*) FROM hot_dismissed')[0][0]===1);
    await p.getByRole('button',{name:'Undo',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('#hot .hot-item').length===2);check('Undo brings a dismissed Hot item back',sql('SELECT COUNT(*) FROM hot_dismissed')[0][0]===0);
    await p.locator('#hot .feed-card').first().locator('.card-head time').click();await p.locator('#articlePage').waitFor({state:'visible'});await p.getByRole('button',{name:'Back to feed',exact:true}).click();await p.locator('#articlePage').waitFor({state:'hidden'});
    check('opening a Hot item takes it off the list and returns to Hot',await p.locator('#hot .hot-item').count()===1&&await p.locator('#viewHot').getAttribute('aria-pressed')==='true'&&sql('SELECT COUNT(*) FROM opened WHERE article_id=?',[picks[0]])[0][0]===1);
    await p.locator('#viewFeed').click();await p.locator('#feedView').waitFor({state:'visible'});
  }
  await p.evaluate(()=>scrollTo(0,0));await open();await p.locator('.side-sources .side-disclosure-trigger').click();await p.locator('#sourceSearch').fill(source.name);await p.locator('.source-row').first().waitFor();check(`${width}: sources are configurable from the UI`,await p.locator('.source-row').count()>0);await close();
  if(width===390){
    sql('INSERT OR REPLACE INTO suggestions VALUES(?,?,?,?,?,?,?,?,?)',['f'.repeat(32),'x','newtooldev','New Tool Dev',3,'Píše o nástrojích.','[]','new',Date.now()]);
    await p.evaluate(()=>scrollTo(0,0));await open();await p.locator('.side-sources .side-disclosure-trigger').click();await p.locator('#suggestions .suggestion').first().waitFor();
    check('suggested sources show who cites them and why',await p.locator('#suggestions').innerText().then(t=>t.includes('@newtooldev')&&t.includes('cited by 3')&&t.includes('Píše o nástrojích.')));
    const decided=p.waitForResponse(r=>r.url().endsWith('/api/suggestions')&&r.request().method()==='POST');await p.locator('#suggestions .suggestion').first().getByRole('button',{name:'Add',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('#suggestions .suggestion'));await decided;
    check('Add follows the suggested account and the suggestion does not come back',sql("SELECT enabled FROM x_accounts WHERE handle='newtooldev'")[0]?.[0]===1&&sql("SELECT status FROM suggestions WHERE id=?",['f'.repeat(32)])[0][0]==='added');
    await close();
  }
  if(width===390){await p.evaluate(()=>scrollTo(0,0));await sleep(300);await open();const bubble=await p.locator('#unseenBubble').innerText().catch(()=>'');await close();const prefs=await p.evaluate(()=>JSON.parse(localStorage.getItem('radar-v2-preferences')));const live=await request(`/api/feed?scope=${prefs.scope}&kind=${prefs.kind}&q=${encodeURIComponent(prefs.q)}&hideSeen=${prefs.hideSeen?1:0}`);
    check('the top bar shows unseen / all for the current view',/^\d[\d,]*\s*\/\s*\d[\d,]*$/.test(bubble.replace(/\s+/g,' ').trim())&&Number(bubble.split('/')[1].replace(/\D/g,''))>0,bubble);}
  const xArticle=idOf(created.xArticle),quoted=idOf(created.quote);
  await p.goto(`${base}/post/${xArticle}`);await p.locator('#readingContent .feed-card.tweet').waitFor();check(`${width}: an X Article shows as an article card in its post`,await p.locator('#readingContent .x-article b').innerText()==='Agents in production');
  await p.goto(`${base}/post/${quoted}`);await p.locator('#readingContent .feed-card.tweet').waitFor();check(`${width}: a quote shows the quoted post`,(await p.locator('#readingContent .quote').innerText()).includes('Evals are product specs you can run.'));
  await p.goto(base);await p.waitForSelector('.feed-card');
  check(`${width}: no browser errors`,errors.length===0,errors.join(' | '));
  if(width===390){await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(tmpdir(),'radar-ui-phone.png')});await open();await p.screenshot({path:path.join(tmpdir(),'radar-ui-options.png')});await close();}
  await ctx.close();
 }
 console.log(JSON.stringify({passed,failed:failures.length,coverage:{expected:expected.size,actual:actual.length,missing:[...expected].filter(u=>!actual.includes(u)).length},failures},null,2));if(failures.length)process.exitCode=1;
}finally{if(browser)await browser.close();server.kill();if(server.exitCode===null)await new Promise(r=>server.once('exit',r));rmSync(temp,{recursive:true,force:true});}
