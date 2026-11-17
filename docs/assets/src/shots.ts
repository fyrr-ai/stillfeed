// Reproduce all README screenshots with an isolated demo DB and the real app. No live sources or AI calls.
// PW=<playwright-core> CHROME=<chromium binary> bun run docs:shots
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,copyFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {compositions} from './compose';
import {animate} from './animate';

const root=resolve(import.meta.dir,'../../..'),out=join(root,'docs/assets');
const home=mkdtempSync(join(tmpdir(),'stillfeed-shots-')),state=join(home,'state'),raw=join(home,'raw');mkdirSync(raw,{recursive:true});
// A named provider makes the UI look connected. Workers are off, and the server's fetch is fenced below.
let server:ReturnType<typeof spawn>|undefined;
process.on('exit',()=>{server?.kill();rmSync(home,{recursive:true,force:true});});
const env={PATH:process.env.PATH!,HOME:home,STILLFEED_HOME:home,STILLFEED_LLM:'codex',STILLFEED_LANGUAGE:'English',SOCIALDATA_API_KEY:'demo-only',STILLFEED_NO_WORKER:'1',STILLFEED_DISABLE_SCHEDULE:'1',STILLFEED_COLLECT_COMMAND:'true',TZ:'UTC'};
const demo=spawnSync(process.execPath,[join(import.meta.dir,'demo.ts'),state],{env,cwd:home,encoding:'utf8'});if(demo.status!==0)throw new Error(demo.stderr);
const {reader,remote}=JSON.parse(demo.stdout) as {reader:string;remote:Record<string,string>};
const fence=join(home,'offline.ts');writeFileSync(fence,`const original=globalThis.fetch;globalThis.fetch=((input,options)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Documentation server blocks outside requests');return original(input,options);}) as typeof fetch;`);
const port=23000+Math.floor(Math.random()*2000),base=`http://127.0.0.1:${port}`;
server=spawn(process.execPath,['--preload',fence,join(root,'src/server.ts'),'--state-dir',state,'--port',String(port)],{env,cwd:home,stdio:['ignore','ignore','inherit']});
const require=createRequire(import.meta.url),{chromium}=require(process.env.PW||join(process.env.HOME!,'.bun/install/cache/playwright-core@1.65.0@@@1/index.js')) as typeof import('playwright-core');
const fallbackChrome=join(process.env.HOME!,'.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell');
const chrome=process.env.CHROME||fallbackChrome;
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
async function api(path:string,value?:unknown){const response=await fetch(base+path,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Stillfeed':'1'},body:JSON.stringify(value)});const data=await response.json();if(!response.ok)throw new Error(JSON.stringify(data));return data;}
try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await Bun.sleep(100);}
  browser=await chromium.launch({executablePath:existsSync(chrome)?chrome:undefined,args:['--no-sandbox']});
  type Page=import('playwright-core').Page;
  async function app(width=390,height=780){
    const context=await browser!.newContext({viewport:{width,height},deviceScaleFactor:2,isMobile:width<760,hasTouch:true,colorScheme:'dark',reducedMotion:'reduce',locale:'en-US',timezoneId:'UTC'});
    await context.route(url=>url.hostname!=='127.0.0.1',route=>{const file=remote[route.request().url()];return file?route.fulfill({body:readFileSync(file),contentType:'image/svg+xml'}):route.abort();});
    // Keep visibility from changing the demo. Explicit Hide seen / Undo still use the real API.
    await context.route(/\/api\/seen$/,route=>route.fulfill({json:{ok:true}}));
    await context.addInitScript(()=>localStorage.setItem('stillfeed-setup-dismissed','1'));
    const page=await context.newPage();return {context,page};
  }
  async function settle(page:Page){
    await page.evaluate(async()=>{await document.fonts.ready;for(let i=0;i<30;i++){if(![...document.images].some(img=>{const r=img.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&!img.complete;}))break;await new Promise(r=>setTimeout(r,80));}});
    await page.waitForTimeout(300);
  }
  async function shot(page:Page,name:string){await settle(page);const path=join(raw,name+'.png');await page.screenshot({path});return path;}
  {
    const {context,page}=await app();await page.goto(base);await page.locator('#feed .feed-card').first().waitFor();
    await shot(page,'phone-feed');copyFileSync(join(raw,'phone-feed.png'),join(out,'stillfeed-feed.png'));
    await page.locator('#viewHot').click();await page.locator('#feed .card-note').first().waitFor();
    await shot(page,'phone-hot');copyFileSync(join(raw,'phone-hot.png'),join(out,'stillfeed-hot.png'));
    await page.locator('#viewSaved').click();await page.locator('#savedTopicSelect').waitFor();await page.locator('#savedTopicSelect').click();await page.getByRole('option',{name:'Coding agents',exact:true}).waitFor();
    await shot(page,'phone-saved');copyFileSync(join(raw,'phone-saved.png'),join(out,'stillfeed-saved.png'));
    await page.keyboard.press('Escape');await page.goto(base+`/article/${reader}`);await page.locator('.ai-summary li').first().waitFor();
    await shot(page,'phone-reader');copyFileSync(join(raw,'phone-reader.png'),join(out,'stillfeed-reader.png'));
    await page.setViewportSize({width:390,height:650});await page.locator('#detailDiscuss').click();await page.locator('.chat-assistant').first().waitFor();
    await shot(page,'phone-discuss');copyFileSync(join(raw,'phone-discuss.png'),join(out,'stillfeed-discuss.png'));
    await context.close();
  }
  {
    const {context,page}=await app(390,600);await page.goto(base);await page.locator('#feed .feed-card').first().waitFor();
    const batch=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('stillfeed-session')!).batch);
    const feed=await api('/api/feed?batch='+batch);await api('/api/seen',{ids:feed.items.slice(0,3).map((a:{id:string})=>a.id),seen:true});
    await page.reload();await page.locator('#readCount').filter({hasText:'3/'}).waitFor();await page.locator('#readCount').click();await page.locator('#hideViewed').waitFor();
    const before=await shot(page,'hide-menu');await page.locator('#hideViewed').click();await page.getByRole('button',{name:'Undo',exact:true}).waitFor();
    const after=await shot(page,'hide-after');await page.getByRole('button',{name:'Undo',exact:true}).click();await page.locator('#readCount').filter({hasText:'3/'}).waitFor();
    await page.locator('#readCount').click();await page.locator('#hideViewed').waitFor();const undo=await shot(page,'hide-undo');

    await context.close();
  }
  {
    const {context,page}=await app(1040,720);await page.goto(base+'/sources');await page.locator('#sourcesPage .source-item').first().waitFor();
    const path=await shot(page,'sources');copyFileSync(path,join(out,'stillfeed-sources.png'));await context.close();
  }
  for(const composition of compositions({raw,fonts:join(root,'assets/fonts')})){
    const file=join(raw,composition.name+'.html');await Bun.write(file,composition.html);
    const context=await browser.newContext({viewport:{width:composition.width,height:composition.height},deviceScaleFactor:composition.name==='stillfeed-banner'||composition.name==='stillfeed-social'?1:2});
    await context.route(url=>url.protocol!=='file:',route=>route.abort());const page=await context.newPage();await page.goto('file://'+file);await settle(page);
    if(await page.locator('img').evaluateAll(images=>images.some(img=>!(img as HTMLImageElement).naturalWidth)))throw new Error('Broken banner image');
    if(composition.name==='stillfeed-banner'&&(await page.locator('.cell .crop img').count()!==3||await page.locator('.stage > .device').count()!==1))throw new Error('Invalid banner composition');
    if(composition.name==='stillfeed-social'&&(await page.locator('.stage > .device').count()!==2||!await page.locator('.foot').evaluate(node=>node.parentElement===document.body)))throw new Error('Invalid social composition');
    await page.screenshot({path:join(composition.temporary?raw:out,composition.name+'.png')});await context.close();
  }
  animate([{path:join(raw,'frame-hide-menu.png'),milliseconds:2400},{path:join(raw,'frame-hide-after.png'),milliseconds:2000},{path:join(raw,'frame-hide-undo.png'),milliseconds:1600}],join(out,'stillfeed-hide-seen.png'));
  if(process.env.KEEP_RAW){mkdirSync(process.env.KEEP_RAW,{recursive:true});for(const name of ['phone-feed','phone-hot','phone-reader','phone-saved','phone-discuss'])copyFileSync(join(raw,name+'.png'),join(process.env.KEEP_RAW,name+'.png'));}
  for(const name of ['feed','hot','reader','saved','discuss','hide-seen','sources','banner','social'])console.log(`stillfeed-${name}.png ${Math.round(statSync(join(out,'stillfeed-'+name+'.png')).size/1024)} KB`);
}finally{await browser?.close();server?.kill();rmSync(home,{recursive:true,force:true});}
