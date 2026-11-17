import {config} from './config';
import {Preparation} from './preparation';
import {readInterests} from './interests';
import {Suggestions,modelRater} from './suggest';
import {Store,hash,canonical,type RecordData} from './store';
import {parseFeed} from './feeds';
import {insertFeed,seedAccounts,seedOnce,seedOpml} from './sources';
import {download} from './media';
import {join} from 'node:path';
import {collectWeb,type WebStatus} from './web';
import {addAiRelevance,hasDataSignal} from './relevance';
import {toRecord} from './tweets';
import {triage} from './triage';
import {channelVideos} from './youtube';
type Feed={id:string;url:string;title:string;source_id:string;ai:number;etag:string|null;last_modified:string|null};
/** Default feeds and channels ship with Stillfeed; the reader's own feeds.opml and x-accounts.txt add to them.
 *  Each entry is added once, so removing or switching off a source in the sidebar sticks. */
export async function seed(store:Store,app:string){
  const text=async(path:string)=>{const file=Bun.file(path);return await file.exists()?file.text():'';};
  seedOpml(store,await text(join(app,'feeds/follow.opml')));
  // "ai": false sends a general channel through the relevance filter instead of trusting every video.
  const channels=await text(join(app,'feeds/channels.json'));
  for(const item of channels?JSON.parse(channels) as {title:string;url:string;ai?:boolean}[]:[])seedOnce(store,'feed::'+canonical(item.url),()=>insertFeed(store,canonical(item.url),item.title,item.ai!==false,'channel::'+item.url));
  seedOpml(store,await text(config.feeds),false);
  seedAccounts(store,await text(join(app,'feeds/x-accounts.txt')));
  seedAccounts(store,await text(config.xAccounts));
}
async function parallel<T,R>(items:T[],workers:number,work:(item:T)=>Promise<R>){
  const results:R[]=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(workers,items.length)},async()=>{while(next<items.length){const at=next++;results[at]=await work(items[at]!);}}));return results;
}
export async function collect(store:Store,app:string,options:{noX?:boolean;noWeb?:boolean;noModel?:boolean}={}){
  await seed(store,app);
  const lease=store.claimCollection();
  if(!lease)throw new Error('A collection is already running');
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
    // RSS, YouTube, X and the web sources run side by side.
    const youtube=feeds.filter(f=>/youtube\.com\/feeds\/videos\.xml/.test(f.url));
    const [results,videos,{tweets,xSuccess},web]=await Promise.all([
      timed('rss',parallel(feeds.filter(f=>!youtube.includes(f)),6,fetchFeed)),
      timed('youtube',youtubeChannels(store,youtube,cutoff)),
      timed('x',fetchTweets(store,cutoff,options)),
      timed('web',options.noWeb?Promise.resolve({records:[],statuses:[] as WebStatus[]}):collectWeb(new Date(now)))]);
    const inWindow=(r:RecordData)=>{const ms=Date.parse(String(r.published_at));return !Number.isFinite(ms)||ms>=cutoff&&ms<=now;};
    const first=[...results,...videos];
    const records=(await timed('classify',classify(store,[...first.flatMap(r=>r.records),...web.records],tweets,!options.noModel))).filter(inWindow);
    if(first.every(r=>r.error)&&!records.length)throw new Error('No sources could be collected');
    const result=store.ingest(records,new Date(now).toISOString(),first);
    new Preparation(store).enqueueCurrent();
    console.error(`timing ingest ${((Date.now()-started)/1000).toFixed(1)}s`);
    const payload={statuses:web.statuses};
    if(!options.noModel)await refreshSuggestions(store).catch(error=>console.error('Source suggestions skipped:',error instanceof Error?error.message:error));
    if(xSuccess&&!options.noX&&process.env.SOCIALDATA_API_KEY)store.setMeta('xLastFetch',String(now/1000));
    store.setMeta('collectionStatus',JSON.stringify({rss:first.filter(r=>!r.error).length,failed:first.filter(r=>r.error).length+payload.statuses.filter(s=>!s.ok).length,webs:payload.statuses,x:options.noX?'not_requested':!process.env.SOCIALDATA_API_KEY?'not_configured':xSuccess?'ok':'failed'}));
    if(!xSuccess||payload.statuses.some(s=>!s.ok)||first.some(r=>r.error))console.error('Some sources failed; successful sources were saved and previous articles retained.');
    return result;
  }finally{store.releaseCollection(lease);}
}

export const interestsPath=()=>config.interests;
/** Suggestions change slowly; once a day is enough even with hourly refreshes. */
export async function refreshSuggestions(store:Store,force=false){
  if(!force&&Date.now()-Number(store.meta('suggestionsAt')||0)<20*3600000){console.error('Suggestions: refreshed today, skipped');return [];}
  const kept=await new Suggestions(store).refresh(await readInterests(interestsPath(),store),modelRater);
  store.setMeta('suggestionsAt',String(Date.now()));
  console.error(`Suggestions: ${kept.length} source(s)`);return kept;
}

/** Lists the newest uploads of each channel; only videos never checked before cost a metadata request. */
export async function youtubeChannels(store:Store,feeds:Feed[],cutoff:number){
  if(!feeds.length)return [];
  store.db.exec('CREATE TABLE IF NOT EXISTS youtube_checked(video_id TEXT PRIMARY KEY,at INTEGER NOT NULL)');
  store.db.query('DELETE FROM youtube_checked WHERE at<?').run(Date.now()-60*86400000);
  const known=new Set((store.db.query('SELECT video_id FROM youtube_checked').all() as {video_id:string}[]).map(r=>r.video_id));
  const remember=store.db.query('INSERT OR IGNORE INTO youtube_checked VALUES(?,?)');
  return parallel(feeds,3,async feed=>{
    const channel=new URL(feed.url).searchParams.get('channel_id');
    if(!channel)return {id:feed.id,records:[] as RecordData[],error:'Not a YouTube channel feed'};
    const listing=await channelVideos(channel,known,cutoff);
    store.db.transaction(()=>listing.checked.forEach(id=>remember.run(id,Date.now())))();
    const records=listing.videos.map(v=>({...v,id:hash(canonical(v.url)),url:canonical(v.url),source:feed.title,site_id:'opmlrss',feed_id:feed.id,published_at:new Date(v.published_at*1000).toISOString(),trusted_ai:feed.ai===1,source_id:feed.source_id}));
    return {id:feed.id,records,error:listing.error};
  });
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
    const response=await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`,{signal:AbortSignal.timeout(8000),headers:{'User-Agent':'Mozilla/5.0 (compatible; Stillfeed/1.0)'}});
    if(!response.ok)return;
    const article=(await response.json() as Record<string,any>)?.article;
    if(!article?.title)return;
    shown.stillfeed_article={title:String(article.title).slice(0,300),preview:String(article.preview_text??'').slice(0,600),image:String(article.cover_media?.media_info?.original_img_url??''),url:`https://x.com/i/article/${String(article.rest_id??'')}`};
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

/** Tweets become records, then every record gets its relevance: trusted AI source, the keyword filter, a data
 *  engineering signal, and finally the model triage for what the words alone dropped. */
export async function classify(store:Store,input:RecordData[],tweets:unknown[],useModel:boolean){
  const records=[...input];
  for(const tweet of tweets){
    const record=toRecord(tweet);if(!record)continue;
    const article=(record.article??{}) as {title?:string;preview?:string};
    records.push({site_id:'opmlrss',source:'X follows',title:`${record.text} ${article.title??''} ${article.preview??''}`.trim(),url:`https://x.com/${record.handle}/status/${record.id}`,published_at:new Date(Number(record.published)*1000).toISOString(),tweet:record});
  }
  for(const record of records){
    const original=String(record.title??''),text=`${original} ${String(record.summary||'')}`;
    for(const [key,value] of Object.entries(addAiRelevance({...record,title:text})))if(key.startsWith('ai_'))record[key]=value;
    if(record.trusted_ai){record.ai_is_related=true;record.ai_relevance_reason='ai_source';}
    record.ai_topic=Boolean(record.ai_is_related);
    record.data_is_related=hasDataSignal(text);
    if(!record.ai_is_related&&record.data_is_related){record.ai_is_related=true;record.ai_relevance_reason='data_signal';}
    record.id=String(record.id||hash(String(record.url)));
  }
  await triage(store,records,useModel);
  return records;
}
