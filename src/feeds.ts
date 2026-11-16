import Parser from 'rss-parser';
import {XMLParser} from 'fast-xml-parser';
import {canonical,hash,type RecordData} from './store';
const parser=new Parser({customFields:{item:[['media:content','mediaContent',{keepArray:true}],['media:thumbnail','mediaThumbnail',{keepArray:true}],['content:encoded','contentEncoded']]}});
const list=(v:unknown):any[]=>Array.isArray(v)?v:v?[v]:[];
export function subscriptions(xml:string):{url:string;title:string;ai:boolean}[]{
  const parsed=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',processEntities:true}).parse(xml),out:{url:string;title:string;ai:boolean}[]=[];
  function walk(node:any){for(const n of list(node)){if(n.xmlUrl&&/^https?:/.test(n.xmlUrl)&&!/^https?:\/\/127\./.test(n.xmlUrl))out.push({url:canonical(n.xmlUrl),title:String(n.title||n.text||n.xmlUrl),ai:String(n.ai)==='1'});if(n.outline)walk(n.outline);}}
  walk(parsed.opml?.body?.outline);return [...new Map(out.map(f=>[f.url,f])).values()];
}
async function plain(html:string){let text='';await new HTMLRewriter().onDocument({text(t){text+=t.text;}}).transform(new Response(html)).text();return text.replace(/\s+/g,' ').trim();}
async function imageFromHTML(html:string,base:string){let image='';await new HTMLRewriter().on('img',{element(e){if(!image&&e.getAttribute('src'))try{image=canonical(new URL(e.getAttribute('src')!,base).href);}catch{}}}).transform(new Response(html)).text();return image;}
function textValue(value:unknown):string {
  if(typeof value==='string'||typeof value==='number')return String(value);
  if(Array.isArray(value))return value.map(textValue).filter(Boolean).join(', ');
  if(value&&typeof value==='object'){const item=value as RecordData;return textValue(item.name||item._||item['#text']||'');}
  return '';
}
export async function parseFeed(body:string,feed:{id:string;url:string;title:string;ai:number},now=Date.now()):Promise<RecordData[]>{
  let entries:any[];
  if(body.trimStart().startsWith('{')){const json=JSON.parse(body);if(!/^https:\/\/jsonfeed.org\/version\//.test(json.version)||!Array.isArray(json.items))throw new Error('Invalid JSON feed');entries=json.items.map((i:any)=>({...i,link:i.url||i.external_url,guid:i.id,isoDate:i.date_published||i.date_modified,contentEncoded:i.content_html,contentSnippet:i.content_text,creator:i.authors?.map((a:any)=>a.name).join(', '),enclosure:i.attachments?.find((a:any)=>a.mime_type?.startsWith('image/'))&&{url:i.attachments.find((a:any)=>a.mime_type.startsWith('image/')).url},image:i.image||i.banner_image}));}
  else {const result=await parser.parseString(body);entries=result.items;}
  const records:RecordData[]=[];
  for(const entry of entries){
    let url:string;try{url=canonical(new URL(textValue(entry.link||entry.url),feed.url).href);}catch{continue;}
    if(!entry.link&&!entry.url)continue;
    const html=textValue(entry.contentEncoded||entry['content:encoded']||entry.content),text=entry.contentSnippet?textValue(entry.contentSnippet):await plain(html);
    const image=entry.image?.url||entry.image||entry.mediaThumbnail?.[0]?.$?.url||entry.mediaContent?.find((m:any)=>m.$?.medium==='image'||m.$?.type?.startsWith('image/'))?.$?.url||(entry.enclosure?.type?.startsWith('image/')?entry.enclosure.url:'')||await imageFromHTML(html,url);
    const video=/youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)([\w-]{11})/.exec(url)?.[1];
    const thumbnail=video?`https://i.ytimg.com/vi/${video}/hqdefault.jpg`:'';
    const published=Date.parse(entry.isoDate||entry.pubDate||'');
    records.push({id:hash(url),url,title:await plain(textValue(entry.title)||'Untitled update'),source:feed.title,site_id:'opmlrss',feed_id:feed.id,guid:textValue(entry.guid||entry.id)||url,published_at:new Date(Number.isFinite(published)?published:now).toISOString(),content:html,summary:text.slice(0,20000),author:textValue(entry.creator||entry.author),image_url:typeof image==='string'&&image?image:thumbnail,trusted_ai:feed.ai===1});
  }
  return records;
}
