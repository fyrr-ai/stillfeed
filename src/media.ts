import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const blocked=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)blocked.addSubnet(ip,bits,'ipv4');
for(const [ip,bits] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32]] as const)blocked.addSubnet(ip,bits,'ipv6');
export async function publicURL(value:string) {
  const u=new URL(value);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('URL not allowed');
  const addresses=await lookup(u.hostname.replace(/^\[|\]$/g,''),{all:true});
  if(!addresses.length||addresses.some(a=> {
    const address=a.address.replace(/^::ffff:/,'');
    return !isIP(address)||blocked.check(address,isIP(address)===4?'ipv4':'ipv6');
  }))throw new Error('Host not allowed');
  return u;
}
export async function download(value:string,limit:number,conditional:Record<string,string>={}):Promise<{url:string;type:string;bytes:Uint8Array;status:number;headers:Headers}> {
  let url=value;
  for(let hop=0;hop<5;hop++) {
    await publicURL(url);
    const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'User-Agent':'Mozilla/5.0 (compatible; Radar/2.0)',...conditional}});
    if([301,302,303,307,308].includes(response.status)&&response.headers.has('location')) {await response.body?.cancel();url=new URL(response.headers.get('location')!,url).href;continue;}
    if(response.status===304)return {url,type:'',bytes:new Uint8Array(),status:304,headers:response.headers};
    if(!response.ok){await response.body?.cancel();throw new Error(`Source returned HTTP ${response.status}`);}
    const reader=response.body!.getReader(), chunks:Uint8Array[]=[];let size=0;
    try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('Response too large');chunks.push(value);}}finally{await reader.cancel();}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    return {url,type:response.headers.get('content-type')?.split(';')[0]?.trim()||'',bytes,status:response.status,headers:response.headers};
  }
  throw new Error('Too many redirects');
}
export async function candidates(url:string,icon:boolean) {
  const base=icon?new URL('/',url).href:url;
  const page=await download(base,4000000);
  if(!['text/html','application/xhtml+xml'].includes(page.type))return [];
  const images:{url:string;rank:number}[]=[];
  const rewriter=new HTMLRewriter().on(icon?'link':'meta',{element(e){
    const rel=e.getAttribute('rel')||'', name=(e.getAttribute('property')||e.getAttribute('name')||'').toLowerCase();
    const value=e.getAttribute(icon?'href':'content');
    if(value&&(icon?/icon/i.test(rel):['og:image','og:image:url','twitter:image','twitter:image:src'].includes(name))) images.push({url:new URL(value,page.url).href,rank:icon?(rel.includes('apple')?0:1):(name.startsWith('og:')?0:1)});
  }});
  await rewriter.transform(new Response(page.bytes.buffer as ArrayBuffer)).text();
  return [...new Set([...images.sort((a,b)=>a.rank-b.rank).map(i=>i.url),...(icon?[new URL('/favicon.ico',url).href]:[])])];
}
export class Media {
  private jobs=new Map<string,Promise<Response>>();
  constructor(readonly directory:string){mkdirSync(directory,{recursive:true});}
  async get(url:string,icon:boolean,declaredImage?:string):Promise<Response> {
    const key=createHash('sha1').update(icon?new URL(url).hostname:url).digest('hex');
    const dir=join(this.directory,icon?'favicons':'previews');mkdirSync(dir,{recursive:true});
    const path=join(dir,key), image=Bun.file(path+'.img'),type=Bun.file(path+'.type'),miss=Bun.file(path+'.miss');
    const headers={'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'};
    if(await image.exists()&&await type.exists()&&Date.now()-image.lastModified<30*86400000)return new Response(image,{headers:{...headers,'Content-Type':await type.text()}});
    if(await miss.exists()&&Date.now()-miss.lastModified<86400000)return new Response(null,{status:404});
    if(this.jobs.has(path))return (await this.jobs.get(path)!).clone();
    const task=(async()=> {
      try {
        let urls:string[]=[];
        if(!icon&&declaredImage)urls=[declaredImage];else try{urls=await candidates(url,icon);}catch{if(icon)urls=[new URL('/favicon.ico',url).href];}
        for(const candidate of urls.slice(0,5)){
          try{
            const result=await download(candidate,icon?200000:2000000);
            if(!['image/jpeg','image/png','image/webp','image/gif','image/x-icon','image/vnd.microsoft.icon','image/avif'].includes(result.type)||result.bytes.length<100)continue;
            await Bun.write(path+'.img',result.bytes);await Bun.write(path+'.type',result.type);
            return new Response(result.bytes.buffer as ArrayBuffer,{headers:{...headers,'Content-Type':result.type}});
          }catch{/* try next declared image */}
        }
      }finally{this.jobs.delete(path);}
      await Bun.write(path+'.miss','');return new Response(null,{status:404});
    })();
    this.jobs.set(path,task);
    return (await task).clone();
  }
}
