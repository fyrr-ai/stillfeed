import {Readability} from '@mozilla/readability';
import {parseHTML} from 'linkedom';
import sanitize from 'sanitize-html';
import {detect} from 'chardet';
import {download} from './media';
import type {Store} from './store';
import {transcript as captions} from './youtube';
export type Reading={title:string;author:string;html:string;text:string;url:string;fetchedAt:number};
const sanitizeOptions:sanitize.IOptions={allowedTags:[...sanitize.defaults.allowedTags,'img','figure','figcaption'],allowedAttributes:{a:['href','title','target','rel'],img:['src','alt','width','height','loading','referrerpolicy'], '*':['lang','dir']},allowedSchemes:['https','http'],transformTags:{a:(_tag,attrs)=>({tagName:'a',attribs:{...attrs,target:'_blank',rel:'noopener noreferrer'}}),img:(_tag,attrs)=>({tagName:'img',attribs:{...attrs,loading:'lazy',referrerpolicy:'no-referrer'}})}};
/** Articles and X posts that carry an X Article can be read in Radar. */
export function readable(article:Record<string,unknown>|null):boolean{
  if(!article)return false;if(article.kind!=='x')return true;
  try{return Boolean(JSON.parse(String(article.tweet||'{}'))?.article?.title);}catch{return false;}
}
export function youtubeId(url:string){try{const u=new URL(url);if(u.hostname==='youtu.be')return u.pathname.slice(1)||null;if(/(^|\.)youtube\.com$/.test(u.hostname))return u.searchParams.get('v')||/^\/(shorts|live)\/([\w-]{11})/.exec(u.pathname)?.[2]||null;}catch{}return null;}
export const isReddit=(url:string)=>{try{return /(^|\.)reddit\.com$/.test(new URL(url).hostname);}catch{return false;}};
const escapeHTML=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** A video transcript as reading text: paragraphs of about 90 seconds, each linked to its moment in the video. */
export function transcriptReading(video:string,title:string,author:string,url:string,segments:[number,string][]):Omit<Reading,'fetchedAt'>{
  const paragraphs:{at:number;text:string[]}[]=[];
  for(const [at,text] of segments){const clean=text.replace(/\s+/g,' ').trim();if(!clean)continue;const last=paragraphs.at(-1);if(!last||at-last.at>=90)paragraphs.push({at,text:[clean]});else last.text.push(clean);}
  if(!paragraphs.length)throw new Error('This video has no transcript. Open it on YouTube instead.');
  const stamp=(s:number)=>`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  const html=paragraphs.map(p=>`<p><a href="https://www.youtube.com/watch?v=${encodeURIComponent(video)}&amp;t=${p.at}s" target="_blank" rel="noopener noreferrer">${stamp(p.at)}</a> ${escapeHTML(p.text.join(' '))}</p>`).join('');
  return {title,author,html,text:paragraphs.map(p=>p.text.join(' ')).join('\n\n'),url};
}
/** The feed's own content, when the site will not serve the page (Reddit) or the page is not readable. */
export function feedReading(article:Record<string,unknown>):Omit<Reading,'fetchedAt'>|null{
  const html=sanitize(String(article.content||''),sanitizeOptions),text=sanitize(html,{allowedTags:[],allowedAttributes:{}}).replace(/\s+/g,' ').trim();
  return text.length>=80?{title:String(article.title),author:String(article.author||''),html,text,url:String(article.url)}:null;
}
export function extract(html:string,url:string):Omit<Reading,'fetchedAt'> {
  const {document}=parseHTML(html);
  for(const el of document.querySelectorAll('script:not([type="application/ld+json"]),style,iframe,form,object,embed,base'))el.remove();
  for(const el of document.querySelectorAll('[href],[src]'))for(const attr of ['href','src']){
    const raw=el.getAttribute(attr);if(!raw)continue;
    try{const absolute=new URL(raw,url);if(!['http:','https:'].includes(absolute.protocol))el.removeAttribute(attr);else el.setAttribute(attr,absolute.href);}catch{el.removeAttribute(attr);}
  }
  const article=new Readability(document as unknown as Document,{charThreshold:100}).parse();
  if(!article?.content||!article.textContent||article.textContent.trim().length<100)throw new Error('This page does not provide a readable article. Open the original instead.');
  const clean=sanitize(article.content,sanitizeOptions);
  return {title:article.title||'Article',author:article.byline||'',html:clean,text:article.textContent.trim(),url};
}
export class Reader {
  private jobs=new Map<string,Promise<Reading>>();
  constructor(private store:Store){store.db.exec('CREATE TABLE IF NOT EXISTS article_content(article_id TEXT PRIMARY KEY REFERENCES articles(id),payload TEXT NOT NULL,fetched_at INTEGER NOT NULL)');}
  cached(id:string):Reading|null{const row=this.store.db.query('SELECT payload FROM article_content WHERE article_id=?').get(id) as {payload:string}|null;return row?JSON.parse(row.payload):null;}
  async get(id:string):Promise<Reading> {
    const article=this.store.article(id);if(!readable(article))throw new Error('Unknown article');
    const cached=this.store.db.query('SELECT payload,fetched_at FROM article_content WHERE article_id=?').get(id) as {payload:string;fetched_at:number}|null;
    if(cached&&Date.now()-cached.fetched_at<3*86400000)return JSON.parse(cached.payload);
    if(this.jobs.has(id))return this.jobs.get(id)!;
    const job=(async()=>{
      const url=String(article!.url),video=youtubeId(url);
      let reading:Omit<Reading,'fetchedAt'>;
      if(article!.kind==='x')reading=await xArticleReading(String(JSON.parse(String(article!.tweet)).id),url);
      else if(video)reading=await this.transcript(video,String(article!.title),String(article!.source),url);
      else if(isReddit(url)&&feedReading(article!))reading=feedReading(article!)!;
      else try{
        const page=await download(url,4000000);
        if(!['text/html','application/xhtml+xml'].includes(page.type))throw new Error('This link is not an HTML article. Open the original instead.');
        const charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(page.headers.get('content-type')||'')?.[1]||detect(page.bytes)||'utf-8';
        let html:string;try{html=new TextDecoder(charset).decode(page.bytes);}catch{html=new TextDecoder().decode(page.bytes);}
        reading=extract(html,page.url);
      }catch(error){const fallback=feedReading(article!);if(!fallback)throw error;reading=fallback;}
      const result={...reading,fetchedAt:Date.now()};
      this.store.db.query('INSERT OR REPLACE INTO article_content VALUES(?,?,?)').run(id,JSON.stringify(result),result.fetchedAt);
      return result;
    })();
    this.jobs.set(id,job);try{return await job;}finally{this.jobs.delete(id);}
  }
  private async transcript(video:string,title:string,author:string,url:string){
    let segments:[number,string][]|null;
    try{segments=await captions(video);}catch{throw new Error('Could not load the transcript. Open it on YouTube instead.');}
    if(!segments?.length)throw new Error('This video has no transcript. Open it on YouTube instead.');
    return transcriptReading(video,title,author,url,segments);
  }
}

/** The full text of an X Article through SocialData (Markdown), rendered and sanitized like any other article. */
export async function xArticleReading(tweetId:string,url:string):Promise<Omit<Reading,'fetchedAt'>>{
  const key=process.env.SOCIALDATA_API_KEY;
  if(!key)throw new Error('X Articles need the SocialData key. Open it on X instead.');
  if(!/^\d+$/.test(tweetId))throw new Error('Invalid post id');
  const response=await fetch(`https://api.socialdata.tools/v2/twitter/article/${tweetId}`,{headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`X returned ${response.status}. Open the article on X instead.`);
  const data=await response.json() as {markdown?:string;markdown_source?:string;article?:{title?:string}|null;user?:{name?:string}};
  if(data.markdown_source!=='article'||!data.markdown)throw new Error('This post has no X Article. Open it on X instead.');
  const html=sanitize(Bun.markdown.html(data.markdown),sanitizeOptions);
  const text=sanitize(html,{allowedTags:[],allowedAttributes:{}}).replace(/\s+/g,' ').trim();
  return {title:String(data.article?.title||'Article on X'),author:String(data.user?.name||''),html,text,url};
}
