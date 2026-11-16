import { Store, articleView, REFRESH_EVERY, refreshHours, type Filters } from './store';
import { Media } from './media';
import {Reader,readable} from './reader';
import {Summaries} from './summary';
import {Preparation} from './preparation';
import {collect,seed,refreshHot,refreshSuggestions} from './collect';
import {Suggestions} from './suggest';
import {Hot} from './hot';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { app, config } from './config';
import { describe, language } from './llm';
import * as sources from './sources';
const args=Bun.argv.slice(2);
const option=(key:string,fallback:string)=>args.includes(key)?args[args.indexOf(key)+1]!:fallback;
const directory=option('--state-dir',config.state);
const store=new Store(directory);
if(args.includes('--is-empty')){console.log(Number((store.db.query('SELECT COUNT(*) AS n FROM articles').get() as {n:number}).n)===0?'yes':'no');store.close();process.exit(0);}
if(args.includes('--window-hours')){console.log(store.settings().windowHours);store.close();process.exit(0);}
if(!store.meta('generatedAt')){store.setMeta('generatedAt',new Date().toISOString());store.setMeta('revision','0');}
await seed(store,app);
if(args.includes('--collect')){try{console.log(JSON.stringify(await collect(store,app,{noX:args.includes('--no-x'),noWeb:args.includes('--no-web'),noModel:args.includes('--no-model')})));}finally{store.close();}process.exit(0);}
if(args.includes('--hot')){try{console.log(JSON.stringify(await refreshHot(store,true)));}finally{store.close();}process.exit(0);}
if(args.includes('--suggest')){try{console.log(JSON.stringify(await refreshSuggestions(store,true)));}finally{store.close();}process.exit(0);}
const media=new Media(directory);
const reader=new Reader(store);
const summaries=new Summaries(store);
const preparation=new Preparation(store);
const hot=new Hot(store);
const suggestions=new Suggestions(store);
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const integer=(value:string|null,fallback:number,min:number,max:number)=>{
  if(value===null)return fallback;
  const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new Error('Invalid number');return n;
};
// Collections run as child processes ("--collect"), started by the scheduler or the Refresh button.
let collecting:Subprocess|null=null,lastCollection:'idle'|'failed'='idle';
function startCollection(){
  if(collecting)return;
  const command=process.env.RADAR_COLLECT_COMMAND?['sh','-c',process.env.RADAR_COLLECT_COMMAND]:[process.execPath,join(app,'src/server.ts'),'--state-dir',directory,'--collect'];
  collecting=Bun.spawn(command,{stdout:'inherit',stderr:'inherit',env:process.env});
  void collecting.exited.then(code=>{lastCollection=code===0?'idle':'failed';collecting=null;});
}
const refreshState=async()=>collecting?'running':lastCollection;
async function body(request:Request) {
  if(request.headers.get('X-Radar')!=='1'||!request.headers.get('Content-Type')?.startsWith('application/json'))throw new Error('Write requires JSON and X-Radar');
  const origin=request.headers.get('Origin');if(origin&&new URL(origin).host!==new URL(request.url).host)throw new Error('Foreign origin');
  const text=await request.text();if(text.length>256000)throw new Error('Request too large');
  const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected object');return value;
}
/** The next refresh: the next listed hour (every N hours, or 05:00 daily; none 23:00–05:00 with the night pause). */
export function nextRefresh(every:number,nightPause:boolean,now=new Date()){
  const hours=refreshHours(every,nightPause),next=new Date(now);next.setMinutes(0,0,0);
  for(let i=0;i<48;i++){next.setHours(next.getHours()+1);if(hours.includes(next.getHours()))return next;}
  return next;
}
let timer:ReturnType<typeof setTimeout>|undefined;
function schedule(){
  if(process.env.RADAR_DISABLE_SCHEDULE==='1')return;
  clearTimeout(timer);
  const {refreshEvery,nightPause}=store.settings(),at=nextRefresh(refreshEvery,nightPause);
  timer=setTimeout(()=>{startCollection();schedule();},Math.max(1000,at.getTime()-Date.now()));
}
/** Enabled sources whose last fetch failed: feeds by their error, web sources from the last collection. */
function failedSources(){
  const feeds=store.db.query('SELECT s.id,s.name,f.error FROM feeds f JOIN sources s ON s.id=f.source_id WHERE s.enabled=1 AND f.error IS NOT NULL').all() as {id:string;name:string;error:string}[];
  const webs=(JSON.parse(store.meta('collectionStatus')||'{}').webs??[]) as {site_id:string;site_name?:string;ok:boolean;error?:string|null}[];
  return [...feeds,...webs.filter(w=>!w.ok).map(w=>({id:w.site_id,name:w.site_name||w.site_id,error:w.error||'Failed'}))];
}
function pendingArticle(id:string,retry=false){
  preparation.enqueue(id,1000,retry);
  const job=preparation.job(id)!;
  return job.state==='failed'?json({error:job.error||'Article preparation failed'},422):json({state:'pending'},202);
}
function articleSummary(id:string,retry=false){
  const article=store.article(id);if(!readable(article))return json({error:'Unknown article'},404);
  const reading=reader.cached(id),cached=reading?summaries.cached(id,reading):null;
  if(cached)return json(cached);
  if(!describe())return json({error:'AI summaries are off. Set an AI provider to turn them on.',off:true},409);
  if(Number(store.meta('summaryBackoffUntil')||0)>Date.now()){preparation.enqueue(id,1000,retry);return json({error:'Summary service is temporarily unavailable. The article text remains available.'},503);}
  return pendingArticle(id,retry);
}
const server=Bun.serve({hostname:option('--hostname',config.hostname),port:integer(option('--port',String(config.port)),3200,1,65535),idleTimeout:30,maxRequestBodySize:256000,
  async fetch(request) {
    const response=await (async()=> {
    const url=new URL(request.url),path=url.pathname;
    try {
      if(request.method==='GET') {
        if(path==='/health')return json({ok:true,version:2});
        if(path==='/api/status')return json({generatedAt:store.meta('generatedAt'),revision:Number(store.meta('revision')),collection:JSON.parse(store.meta('collectionStatus')||'{}'),importError:null,refresh:await refreshState(),preparation:preparation.stats(),articles:store.db.query('SELECT COUNT(*) AS total FROM articles').get(),failedSources:failedSources()});
        if(path==='/api/settings')return json(store.settings());
        if(path==='/api/hot')return json({items:hot.list()});
        if(path==='/api/suggestions')return json({items:suggestions.list()});
        if(path==='/api/sources')return json(sources.list(store));
        if(path==='/api/x-accounts')return json(sources.accounts(store));
        // Status only, never secrets.
        if(path==='/api/config')return json({language:language(),ai:describe()??{provider:null,model:null},x:{configured:Boolean(process.env.SOCIALDATA_API_KEY)}});
        if(path==='/api/feed') {
          const p=url.searchParams,scope=p.get('scope')||'ai',kind=p.get('kind')||'all';
          if(!['ai','all'].includes(scope)||!['all','article','x'].includes(kind))throw new Error('Unknown feed filter');
          const filters:Filters={scope:scope as Filters['scope'],kind:kind as Filters['kind'],q:(p.get('q')||'').slice(0,300),savedOnly:p.get('saved')==='1',hideSeen:p.get('hideSeen')==='1',hours:integer(p.get('hours'),store.settings().windowHours,24,2160),seenBefore:p.has('seenBefore')?integer(p.get('seenBefore'),0,1,Date.now()+60000):undefined,revision:p.has('revision')?integer(p.get('revision'),0,1,Number(store.meta('revision'))):undefined};
          return json(store.feed(filters,p.get('batch')||undefined,integer(p.get('offset'),0,0,100000)));
        }
        const entry=/^\/api\/article\/([a-f0-9]{32})$/.exec(path);
        if(entry){const article=store.article(entry[1]!);return article?json(articleView({...article,saved_at:store.db.query('SELECT at FROM saved WHERE article_id=?').get(String(article.id))?1:0})):json({error:'Unknown article'},404);}
        const content=/^\/api\/article\/([a-f0-9]{32})\/content$/.exec(path);
        if(content){const article=store.article(content[1]!);if(!readable(article))return json({error:'Unknown article'},404);const cached=reader.cached(content[1]!);return cached?json(cached):pendingArticle(content[1]!);}
        const summary=/^\/api\/article\/([a-f0-9]{32})\/summary$/.exec(path);
        if(summary)return articleSummary(summary[1]!);
        const image=/^\/api\/image\/([a-f0-9]{32})\/(icon|preview)$/.exec(path);
        if(image){const article=store.article(image[1]!);if(!article)return json({error:'Unknown article'},404);return await media.get(String(article.url),image[2]==='icon',typeof article.image_url==='string'?article.image_url:undefined);}
        const file=path==='/'||/^\/(article|post)\/[a-f0-9]{32}$/.test(path)?'index.html':path.startsWith('/assets/')?decodeURIComponent(path.slice(1)):null;
        if(!file||file.includes('..')||file.includes('\\')||file.includes('\0'))return json({error:'Not found'},404);
        const asset=Bun.file(join(app,file));if(!await asset.exists())return json({error:'Not found'},404);
        return new Response(asset,{headers:{'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
      }
      if(request.method==='POST') {
        const value=await body(request);
        const summary=/^\/api\/article\/([a-f0-9]{32})\/summary$/.exec(path);
        if(summary)return articleSummary(summary[1]!,value.retry===true);
        const save=/^\/api\/article\/([a-f0-9]{32})\/saved$/.exec(path);
        if(save){if(typeof value.saved!=='boolean')throw new Error('Invalid saved state');store.save(save[1]!,value.saved);if(value.saved&&store.article(save[1]!)?.kind==='article')preparation.enqueue(save[1]!,500);return json({saved:value.saved});}
        const opened=/^\/api\/article\/([a-f0-9]{32})\/opened$/.exec(path);
        if(opened){if(!store.article(opened[1]!))return json({error:'Unknown article'},404);hot.opened(opened[1]!);return json({ok:true});}
        const hotState=/^\/api\/article\/([a-f0-9]{32})\/hot$/.exec(path);
        if(hotState){if(typeof value.dismissed!=='boolean')throw new Error('Invalid hot state');if(!store.article(hotState[1]!))return json({error:'Unknown article'},404);hot.dismiss(hotState[1]!,value.dismissed);return json({dismissed:value.dismissed});}
        if(path==='/api/suggestions'){
          if(typeof value.id!=='string'||!/^[a-f0-9]{32}$/.test(value.id)||!['add','ignore'].includes(value.action))throw new Error('Invalid suggestion decision');
          suggestions.decide(value.id,value.action);return json({ok:true});
        }
        if(path==='/api/seen-batch'){
          if(typeof value.batch!=='string'||!/^[0-9a-f-]{36}$/.test(value.batch))throw new Error('Invalid batch');
          return json({ids:store.markBatch(value.batch)});
        }
        if(path==='/api/seen') {
          if(!Array.isArray(value.ids)||value.ids.length>2000||!value.ids.every((id:unknown)=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id))||typeof value.seen!=='boolean')throw new Error('Invalid seen update');
          store.mark(value.ids,value.seen);return json({ok:true});
        }
        if(path==='/api/refresh'){
          startCollection();
          return json({state:'running'});
        }
        if(path==='/api/settings'){
          const previous=store.settings();const next={windowHours:Number(value.windowHours),refreshEvery:Number(value.refreshEvery),nightPause:value.nightPause??previous.nightPause,retentionDays:Number(value.retentionDays??previous.retentionDays)};
          if(!Number.isInteger(next.windowHours)||next.windowHours<24||next.windowHours>2160||!REFRESH_EVERY.includes(next.refreshEvery))throw new Error('Invalid settings');
          store.configure(next);if(next.refreshEvery!==previous.refreshEvery||next.nightPause!==previous.nightPause)schedule();return json(store.settings());
        }
        if(path==='/api/sources/add'){
          if(typeof value.url!=='string'||value.url.length>2000)throw new Error('Invalid source address');
          return json(await sources.addSource(store,value.url,typeof value.name==='string'?value.name:undefined));
        }
        if(path==='/api/sources/remove'){
          if(typeof value.id!=='string')throw new Error('Invalid source');
          sources.removeSource(store,value.id);return json({ok:true});
        }
        if(path==='/api/x-accounts')return json(sources.setAccount(store,value.handle,value.enabled));
        if(path==='/api/sources'){
          if(typeof value.id!=='string'||typeof value.enabled!=='boolean')throw new Error('Invalid source');
          store.setSource(value.id,value.enabled);return json({ok:true});
        }
      }
      return json({error:'Not found'},404);
    }catch(error){return json({error:error instanceof Error?error.message:'Request failed'},400);}
    })();
    const type=response.headers.get('Content-Type')||'';
    if(response.ok&&request.headers.get('Accept-Encoding')?.includes('gzip')&&/json|javascript|text\//.test(type)) {
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength>1024){const headers=new Headers(response.headers);headers.set('Content-Encoding','gzip');headers.set('Vary','Accept-Encoding');headers.delete('Content-Length');return new Response(Bun.gzipSync(bytes),{status:response.status,headers});}
      return new Response(bytes,{status:response.status,headers:response.headers});
    }
    return response;
  }});
console.log(`Radar ready on http://${server.hostname}:${server.port}`);
// The reader worker prepares articles and summaries in the background; it is restarted if it stops.
let worker:Subprocess|null=null,stopping=false;
function startWorker(){
  if(process.env.RADAR_NO_WORKER==='1'||stopping)return;
  worker=Bun.spawn([process.execPath,join(app,'src/reader_worker.ts'),'--state-dir',directory],{stdout:'inherit',stderr:'inherit',env:process.env});
  void worker.exited.then(()=>{worker=null;if(!stopping)setTimeout(startWorker,5000);});
}
startWorker();
schedule();
// A refresh missed while Radar was not running (the last one is older than the interval) happens now.
if(process.env.RADAR_DISABLE_SCHEDULE!=='1'&&Date.now()-Date.parse(store.meta('generatedAt')||'0')>store.settings().refreshEvery*3600000)startCollection();
function stop(){stopping=true;clearTimeout(timer);worker?.kill();collecting?.kill();server.stop(true);store.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
