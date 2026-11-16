import {Preparation} from './preparation';
import {Hot,modelPicker,readInterests} from './hot';
import {Suggestions,modelRater} from './suggest';
import {Store,hash,canonical,type RecordData} from './store';
import {subscriptions,parseFeed} from './feeds';
import {download} from './media';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
type Feed={id:string;url:string;title:string;source_id:string;ai:number;etag:string|null;last_modified:string|null};
export async function seed(store:Store,app:string,data:string){
  if(!store.meta('feedsSeeded')){
    for(const item of subscriptions(await Bun.file(join(app,'feeds/follow.opml')).text())){
      const existing=store.db.query('SELECT id FROM sources WHERE name=? COLLATE NOCASE LIMIT 1').get(item.title) as {id:string}|null;
      const sourceId=existing?.id||hash('opmlrss::'+item.title);
      store.db.query('INSERT OR IGNORE INTO sources(id,name) VALUES(?,?)').run(sourceId,item.title);
      store.db.query('INSERT OR IGNORE INTO feeds(id,url,title,source_id,ai) VALUES(?,?,?,?,?)').run(hash(item.url),item.url,item.title,sourceId,Number(item.ai));
    }
    store.setMeta('feedsSeeded','1');
  }
  // YouTube channels and subreddits: added once each, later enabling or disabling in Sources is kept.
  const channels=Bun.file(join(app,'feeds/channels.json'));
  // "ai": false sends a general channel through the relevance filter instead of trusting every video.
  if(await channels.exists())for(const item of await channels.json() as {title:string;url:string;ai?:boolean}[]){
    const sourceId=hash('channel::'+item.url);
    store.db.query('INSERT OR IGNORE INTO sources(id,name) VALUES(?,?)').run(sourceId,item.title);
    store.db.query('INSERT OR IGNORE INTO feeds(id,url,title,source_id,ai) VALUES(?,?,?,?,?)').run(hash(item.url),item.url,item.title,sourceId,item.ai===false?0:1);
  }
  store.db.exec('CREATE TABLE IF NOT EXISTS x_accounts(handle TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1)');
  if(!store.meta('accountsSeeded')){
    const file=Bun.file(join(data,'../x-following.json'));
    if(await file.exists()){const rows=await file.json();if(Array.isArray(rows))for(const row of rows)if(typeof row.handle==='string'&&/^@?\w{1,15}$/.test(row.handle))store.db.query('INSERT OR IGNORE INTO x_accounts(handle,name) VALUES(?,?)').run(row.handle.replace(/^@/,''),String(row.name||row.handle));}
    const legacy=Bun.file(join(data,'follows-state.json'));if(await legacy.exists()){const state=await legacy.json();if(typeof state.last_run==='number')store.setMeta('xLastFetch',String(state.last_run));}
    store.setMeta('accountsSeeded','1');
  }
}
const REDDIT_GAP=12000;
async function parallel<T,R>(items:T[],workers:number,work:(item:T)=>Promise<R>){
  const results:R[]=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(workers,items.length)},async()=>{while(next<items.length){const at=next++;results[at]=await work(items[at]!);}}));return results;
}
export async function collect(store:Store,app:string,data:string,options:{noX?:boolean;noWeb?:boolean;noModel?:boolean}={}){
  await seed(store,app,data);
  const lease=String(Date.now());
  const acquired=store.db.query("INSERT INTO meta(key,value) VALUES('collectionLease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(meta.value AS INTEGER)<? RETURNING value").get(lease,Date.now()-20*60000);
  if(!acquired)throw new Error('A collection is already running');
  try{
    const now=Date.now(),cutoff=now-store.settings().windowHours*3600000;
    const feeds=store.db.query('SELECT f.* FROM feeds f JOIN sources s ON s.id=f.source_id WHERE s.enabled=1').all() as Feed[];
    // Phase timings go to the journal so slow refreshes can be explained.
    const started=Date.now(),timed=<T,>(phase:string,work:Promise<T>)=>work.finally(()=>console.error(`timing ${phase} ${((Date.now()-started)/1000).toFixed(1)}s`));
    const fetchFeed=async(feed:Feed)=>{
      try{
        const headers:Record<string,string>={};if(feed.etag)headers['If-None-Match']=feed.etag;if(feed.last_modified)headers['If-Modified-Since']=feed.last_modified;
        const response=await download(feed.url,16000000,headers);
        const declared=/encoding=["']([^"']+)/i.exec(new TextDecoder().decode(response.bytes.slice(0,160)))?.[1];
        const charset=/charset=([^;\s]+)/i.exec(response.headers.get('content-type')||'')?.[1]||declared||'utf-8';
        const entries=response.status===304?[]:await parseFeed(new TextDecoder(charset).decode(response.bytes),feed,now);
        const records=entries.filter(r=>Date.parse(String(r.published_at))>=cutoff&&Date.parse(String(r.published_at))<=now).map(r=>({...r,source_id:feed.source_id}));
        return {id:feed.id,records,etag:response.headers.get('etag'),modified:response.headers.get('last-modified'),error:null};
      }catch(error){return {id:feed.id,records:[],error:error instanceof Error?error.message:'Fetch failed'};}
    };
    const python=process.env.RADAR_PYTHON||join(data,'../venv/bin/python');
    // YouTube's channel RSS stopped answering (404), so channels are listed through yt-dlp instead.
    const youtube=feeds.filter(f=>/youtube\.com\/feeds\/videos\.xml/.test(f.url));
    // Reddit answers 429 to quick successive requests, so its feeds go one at a time, 12 s apart; a refused
    // subreddit is simply taken next time (its top-of-day list does not go away).
    const reddit=feeds.filter(f=>/(^|\.)reddit\.com$/.test(new URL(f.url).hostname));
    // X, RSS and YouTube run side by side; Reddit (slow, rate limited) starts too but does not hold up the first save.
    const redditTask=timed('reddit',(async()=>{const out=[];for(const [i,feed] of reddit.entries()){if(i)await Bun.sleep(REDDIT_GAP);out.push(await fetchFeed(feed));}return out;})());
    const xTask=timed('x',fetchTweets(store,cutoff,options));
    const [others,videos,{tweets,xSuccess}]=await Promise.all([timed('rss',parallel(feeds.filter(f=>!reddit.includes(f)&&!youtube.includes(f)),6,fetchFeed)),timed('youtube',youtubeChannels(store,app,python,youtube,cutoff)),xTask]);
    if(!existsSync(python))throw new Error('Collector Python environment missing. Run rmt-radar install.');
    const inWindow=(r:RecordData)=>{const ms=Date.parse(String(r.published_at));return !Number.isFinite(ms)||ms>=cutoff&&ms<=now;};
    const first=[...others,...videos];
    const payload=await timed('adapter',adapter(app,python,store,{records:first.flatMap(r=>r.records),tweets,webs:!options.noWeb,no_model:Boolean(options.noModel)}));
    const records=payload.records.filter(inWindow);
    if(first.every(r=>r.error)&&!records.length)throw new Error('No sources could be collected');
    // The first save makes everything except Reddit visible right away (a new revision the open app picks up).
    const result=store.ingest(records,new Date(now).toISOString(),first);
    new Preparation(store).enqueueCurrent();
    console.error(`timing ingest ${((Date.now()-started)/1000).toFixed(1)}s`);
    const slow=await redditTask;
    if(slow.some(r=>r.records.length)){
      const later=await adapter(app,python,store,{records:slow.flatMap(r=>r.records),tweets:[],webs:false,no_model:Boolean(options.noModel)});
      store.ingest(later.records.filter(inWindow),new Date(now).toISOString(),slow);new Preparation(store).enqueueCurrent();
    }else for(const r of slow)store.db.query('UPDATE feeds SET checked_at=?,error=? WHERE id=?').run(now,r.error||null,r.id);
    console.error(`timing reddit-ingest ${((Date.now()-started)/1000).toFixed(1)}s`);
    const results=[...first,...slow];
    // Hot is a bonus: a failed pick never fails the collection, the previous picks stay.
    if(!options.noModel)await refreshHot(store,app,python,false,result.revision).catch(error=>console.error('Hot selection skipped:',error instanceof Error?error.message:error));
    if(!options.noModel)await refreshSuggestions(store,app,python).catch(error=>console.error('Source suggestions skipped:',error instanceof Error?error.message:error));
    if(xSuccess&&!options.noX&&process.env.SOCIALDATA_API_KEY)store.setMeta('xLastFetch',String(now/1000));
    store.setMeta('collectionStatus',JSON.stringify({rss:results.filter(r=>!r.error).length,failed:results.filter(r=>r.error).length+payload.statuses.filter((s:any)=>!s.ok).length,webs:payload.statuses,x:options.noX?'not_requested':!process.env.SOCIALDATA_API_KEY?'not_configured':xSuccess?'ok':'failed'}));
    if(!xSuccess||payload.statuses.some((s:any)=>!s.ok)||results.some(r=>r.error))console.error('Some sources failed; successful sources were saved and previous articles retained.');
    return result;
  }finally{store.db.query("UPDATE meta SET value='0' WHERE key='collectionLease' AND value=?").run(lease);}
}

export const interestsPath=()=>process.env.RADAR_INTERESTS||join(process.env.HOME!,'.config/rmt/radar-interests.md');
/** Hourly refreshes would otherwise spend a model call on an unchanged archive: pick only after new data. */
export async function refreshHot(store:Store,app:string,python:string,force=false,sinceRevision=Number(store.meta('revision')||0)){
  // created_revision marks articles first seen by the latest collection; no new AI article, no new pick.
  const fresh=(store.db.query('SELECT COUNT(*) AS n FROM articles WHERE ai=1 AND created_revision>=?').get(sinceRevision) as {n:number}).n;
  if(!force&&!fresh){console.error('Hot: no new AI updates, skipped');return [];}
  const picks=await new Hot(store).refresh(await readInterests(interestsPath()),modelPicker(app,python));
  console.error(`Hot: ${picks.length} new pick(s)`);return picks;
}
/** Suggestions change slowly; once a day is enough even with hourly refreshes. */
export async function refreshSuggestions(store:Store,app:string,python:string,force=false){
  if(!force&&Date.now()-Number(store.meta('suggestionsAt')||0)<20*3600000){console.error('Suggestions: refreshed today, skipped');return [];}
  const kept=await new Suggestions(store).refresh(await readInterests(interestsPath()),modelRater(app,python));
  store.setMeta('suggestionsAt',String(Date.now()));
  console.error(`Suggestions: ${kept.length} source(s)`);return kept;
}

/** Lists the newest uploads of each channel with yt-dlp; only videos never checked before cost a metadata request. */
export async function youtubeChannels(store:Store,app:string,python:string,feeds:Feed[],cutoff:number){
  if(!feeds.length)return [];
  store.db.exec('CREATE TABLE IF NOT EXISTS youtube_checked(video_id TEXT PRIMARY KEY,at INTEGER NOT NULL)');
  store.db.query('DELETE FROM youtube_checked WHERE at<?').run(Date.now()-60*86400000);
  const known=(store.db.query('SELECT video_id FROM youtube_checked').all() as {video_id:string}[]).map(r=>r.video_id);
  const channels=feeds.map(f=>({feed_id:f.id,channel_id:new URL(f.url).searchParams.get('channel_id')}));
  const failed=(error:string)=>feeds.map(f=>({id:f.id,records:[] as RecordData[],error}));
  try{
    const child=Bun.spawn([python,join(app,'scripts/youtube.py')],{stdin:new Blob([JSON.stringify({channels,known,cutoff:Math.floor(cutoff/1000)})]),stdout:'pipe',stderr:'inherit'});
    const output=await new Response(child.stdout).text();
    if(await child.exited!==0)return failed('YouTube listing failed');
    const answer=JSON.parse(output) as {channels:{feed_id:string;videos:Record<string,unknown>[];checked:string[];error:string|null}[]};
    const remember=store.db.query('INSERT OR IGNORE INTO youtube_checked VALUES(?,?)');
    store.db.transaction(()=>answer.channels.forEach(c=>c.checked.forEach(id=>remember.run(id,Date.now()))))();
    return feeds.map(feed=>{
      const entry=answer.channels.find(c=>c.feed_id===feed.id);
      const records=(entry?.videos??[]).map(v=>({...v,id:hash(canonical(String(v.url))),url:canonical(String(v.url)),source:feed.title,site_id:'opmlrss',feed_id:feed.id,published_at:new Date(Number(v.published_at)*1000).toISOString(),trusted_ai:feed.ai===1,source_id:feed.source_id}));
      return {id:feed.id,records,error:entry?.error??(entry?null:'Channel missing from listing')};
    });
  }catch(error){return failed(error instanceof Error?error.message:'YouTube listing failed');}
}

/** X Articles arrive from SocialData as a bare link; the public embed API (no key, no cost) has their title,
 *  preview text and cover image. The full text needs a login, so the reader keeps the link to X. */
export async function xArticle(raw:unknown){
  const tweet=raw as Record<string,any>, shown=(tweet?.retweeted_status??tweet) as Record<string,any>;
  const linked=(shown?.entities?.urls??[]).some((u:any)=>/x\.com\/i\/articles?\/\d+/.test(String(u?.expanded_url??'')));
  const id=String(shown?.id_str??'');
  if(!linked||!/^\d+$/.test(id))return;
  try{
    const token=((Number(id)/1e15)*Math.PI).toString(36).replace(/(0+|\.)/g,'');
    const response=await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`,{signal:AbortSignal.timeout(8000),headers:{'User-Agent':'Mozilla/5.0 (compatible; Radar/2.0)'}});
    if(!response.ok)return;
    const article=(await response.json() as Record<string,any>)?.article;
    if(!article?.title)return;
    shown.radar_article={title:String(article.title).slice(0,300),preview:String(article.preview_text??'').slice(0,600),image:String(article.cover_media?.media_info?.original_img_url??''),url:`https://x.com/i/article/${String(article.rest_id??'')}`};
  }catch{/* the tweet still shows its link */}
}

/** Tweets of the followed accounts since the last fetch, grouped into a few search queries; X Articles get their card. */
async function fetchTweets(store:Store,cutoff:number,options:{noX?:boolean}){
  const tweets:unknown[]=[];let xSuccess=true;
  if(options.noX||!process.env.SOCIALDATA_API_KEY)return {tweets,xSuccess};
  const accounts=store.db.query('SELECT handle FROM x_accounts WHERE enabled=1').all() as {handle:string}[];
  const since=Math.floor(Number(store.meta('xLastFetch')||cutoff/1000)-600),suffix=` -filter:replies since_time:${since}`,queries:string[]=[];let group:string[]=[];
  for(const {handle} of accounts){const term=`from:${handle}`;if(('('+[...group,term].join(' OR ')+')'+suffix).length>480&&group.length){queries.push('('+group.join(' OR ')+')'+suffix);group=[];}group.push(term);}if(group.length)queries.push('('+group.join(' OR ')+')'+suffix);
  await parallel(queries,4,async query=>{
    let cursor='';try{for(let page=0;page<5&&tweets.length<1000;page++){
      const url=new URL('https://api.socialdata.tools/twitter/search');url.searchParams.set('query',query);url.searchParams.set('type','Latest');if(cursor)url.searchParams.set('cursor',cursor);
      const response=await fetch(url,{headers:{Authorization:`Bearer ${process.env.SOCIALDATA_API_KEY}`},signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`X returned ${response.status}`);
      const payload=await response.json() as {tweets?:unknown[];next_cursor?:string};if(!Array.isArray(payload.tweets))throw new Error('Invalid X response');tweets.push(...payload.tweets);cursor=payload.next_cursor||'';if(!cursor||!payload.tweets.length)break;
    }}catch(error){xSuccess=false;console.error(error instanceof Error?error.message:'X request failed');}
  });
  await parallel(tweets,4,xArticle);
  return {tweets,xSuccess};
}

/** Web scrapers, tweet records and the relevance filter (keywords, then the model) live in the Python adapter. */
async function adapter(app:string,python:string,store:Store,input:{records:RecordData[];tweets:unknown[];webs:boolean;no_model:boolean}){
  const child=Bun.spawn([python,join(app,'scripts/collect_adapter.py'),join(store.directory,'radar.db')],{stdin:new Blob([JSON.stringify(input)]),stdout:'pipe',stderr:'inherit',env:{...process.env,SOCIALDATA_ENABLED:'0'}});
  const output=await new Response(child.stdout).text();if(await child.exited!==0)throw new Error('Source adapter failed; previous articles were kept');
  const payload=JSON.parse(output) as {records:RecordData[];statuses:{ok:boolean}[]};
  if(!Array.isArray(payload.records)||!Array.isArray(payload.statuses))throw new Error('Invalid source adapter response');
  return payload;
}
