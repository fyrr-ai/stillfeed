/** A raw SocialData tweet as the record the page shows: full text, author, counts, photos, links, quote and X Article. */
const MAX_TEXT=5000,MAX_QUOTE_TEXT=800;
type Json=Record<string,any>;
export type Media={type:unknown;src:string;w:unknown;h:unknown};
export type Link={url:string;href:string;text:unknown};
export type Quote={id:string;handle:string;name:string;avatar:string;text:string;links:Link[];drop:string[];media:Media[]};
export type TweetRecord={id:string;handle:string;text:string;published:number;author:string;name:string;avatar:string;kind:'tweet'|'retweet'|'quote';
  likes:unknown;replies:unknown;reposts:unknown;views:unknown;media:Media[];links:Link[];drop:string[];article?:Json;by?:string;quote?:Quote};

const dict=(v:unknown):Json|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Json:null;
/** Python truthiness of JSON values. */
const truthy=(v:unknown)=>Array.isArray(v)?v.length>0:dict(v)?Object.keys(v as Json).length>0:Boolean(v);
const or=(...values:unknown[])=>values.find(truthy)??values.at(-1);
const str=(v:unknown)=>v===null||v===undefined?'None':v===true?'True':v===false?'False':String(v);
const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
/** Python's str.strip() whitespace and code-point slicing. */
const PY_SPACE=String.raw`[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`,strip=(s:string)=>s.replace(new RegExp(`^${PY_SPACE}+|${PY_SPACE}+$`,'g'),'');
const cut=(s:string,n:number)=>s.length<=n?s:Array.from(s).slice(0,n).join('');

// html.unescape: the legacy entities (also matched without ";", as a prefix) and a few common ones X could send.
const LEGACY='Aacute aacute Acirc acirc acute AElig aelig Agrave agrave AMP amp Aring aring Atilde atilde Auml auml brvbar Ccedil ccedil cedil cent COPY copy curren deg divide Eacute eacute Ecirc ecirc Egrave egrave ETH eth Euml euml frac12 frac14 frac34 GT gt Iacute iacute Icirc icirc iexcl Igrave igrave iquest Iuml iuml laquo LT lt macr micro middot nbsp not Ntilde ntilde Oacute oacute Ocirc ocirc Ograve ograve ordf ordm Oslash oslash Otilde otilde Ouml ouml para plusmn pound QUOT quot raquo REG reg sect shy sup1 sup2 sup3 szlig THORN thorn times Uacute uacute Ucirc ucirc Ugrave ugrave uml Uuml uuml Yacute yacute yen yuml'.split(' ');
const LEGACY_CHARS='\xc1\xe1\xc2\xe2\xb4\xc6\xe6\xc0\xe0&&\xc5\xe5\xc3\xe3\xc4\xe4\xa6\xc7\xe7\xb8\xa2\xa9\xa9\xa4\xb0\xf7\xc9\xe9\xca\xea\xc8\xe8\xd0\xf0\xcb\xeb\xbd\xbc\xbe>>\xcd\xed\xce\xee\xa1\xcc\xec\xbf\xcf\xef\xab<<\xaf\xb5\xb7\xa0\xac\xd1\xf1\xd3\xf3\xd4\xf4\xd2\xf2\xaa\xba\xd8\xf8\xd5\xf5\xd6\xf6\xb6\xb1\xa3""\xbb\xae\xae\xa7\xad\xb9\xb2\xb3\xdf\xde\xfe\xd7\xda\xfa\xdb\xfb\xd9\xf9\xa8\xdc\xfc\xdd\xfd\xa5\xff';
const ENTITIES:Record<string,string>={apos:"'",hellip:'…',mdash:'—',ndash:'–',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',bull:'•',trade:'™',euro:'€'};
const NAMED=new Map<string,string>([...LEGACY.flatMap((name,i)=>[[name,LEGACY_CHARS[i]!],[name+';',LEGACY_CHARS[i]!]] as [string,string][]),...Object.entries(ENTITIES).map(([k,v])=>[k+';',v] as [string,string])]);
const WINDOWS_1252='€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f\x90‘’“”•–—˜™š›œ\x9džŸ';
const invalidCodepoint=(n:number)=>n>=0x1&&n<=0x8||n===0xb||n>=0xe&&n<=0x1f||n>=0x7f&&n<=0x9f||n>=0xfdd0&&n<=0xfdef||(n&0xfffe)===0xfffe;
function unescape(s:string){
  if(!s.includes('&'))return s;
  return s.replace(/&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu,(_,ref:string)=>{
    if(ref[0]==='#'){
      const digits=ref.replace(/;$/,''),n=/[xX]/.test(digits[1]!)?parseInt(digits.slice(2),16):parseInt(digits.slice(1),10);
      if(n===0)return '\ufffd';if(n===0xd)return '\r';if(n>=0x80&&n<=0x9f)return WINDOWS_1252[n-0x80]!;
      if(n>=0xd800&&n<=0xdfff||!(n<=0x10ffff))return '\ufffd';
      return invalidCodepoint(n)?'':String.fromCodePoint(n);
    }
    if(NAMED.has(ref))return NAMED.get(ref)!;
    const points=Array.from(ref);
    for(let x=points.length-1;x>1;x--){const prefix=points.slice(0,x).join('');if(NAMED.has(prefix))return NAMED.get(prefix)!+points.slice(x).join('');}
    return '&'+ref;
  });
}

/** datetime.fromisoformat(created.replace('Z', '+00:00')).timestamp(); null where Python raises ValueError. */
function timestamp(created:string):number|null{
  const m=/^(?:(\d{4})-(\d{2})-(\d{2})|(\d{4})(\d{2})(\d{2})|(\d{4})-?W(\d{2})(?:-?(\d))?)(?:.(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?(?:([+-])(\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?)?)?$/su.exec(created.replaceAll('Z','+00:00'));
  if(!m)return null;
  const n=(i:number)=>Number(m[i]??0),us=(i:number)=>Number((m[i]??'').slice(0,6).padEnd(6,'0'));
  let year=n(1)||n(4)||n(7),month=n(2)||n(5),day=n(3)||n(6);
  if(m[7]){ // ISO week date
    const week=n(8),weekday=m[9]?n(9):1,jan4=new Date(0);jan4.setUTCFullYear(year,0,4);
    const longYear=(y:number)=>{const d=new Date(0);d.setUTCFullYear(y,0,1);const w=d.getUTCDay();return w===4||w===3&&(y%4===0&&y%100!==0||y%400===0);};
    if(week<1||week>(longYear(year)?53:52)||weekday<1||weekday>7)return null;
    const d=new Date(jan4.getTime()+((week-1)*7+weekday-1-((jan4.getUTCDay()+6)%7))*86400000);
    [year,month,day]=[d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate()];
  }
  const [hour,minute,second,micro]=[n(10),n(11),n(12),us(13)];
  const days=new Date(Date.UTC(2000,month,0));days.setUTCFullYear(year,month,0);
  if(year<1||month<1||month>12||day<1||day>days.getUTCDate()||hour>23||minute>59||second>59)return null;
  if(!m[14]){const local=new Date(2000,month-1,day,hour,minute,second);local.setFullYear(year,month-1,day);return Math.floor(local.getTime()/1000)+micro/1e6;}
  const utc=new Date(0);utc.setUTCFullYear(year,month-1,day);utc.setUTCHours(hour,minute,second,0);
  const offset=((n(15)*3600+n(16)*60+n(17))*1e6+us(18))*(m[14]==='-'?-1:1);
  if(Math.abs(offset)>=86400e6)return null;
  return (utc.getTime()*1000+micro-offset)/1e6;
}

function photos(tweet:Json):Media[]{
  const entities=dict(or(tweet.extended_entities,tweet.entities,{}))??{},out:Media[]=[];
  for(const media of list(or(entities.media,[]))){
    const src=(media as Json).media_url_https;
    if(!(typeof src==='string'&&src.startsWith('https://')))continue;
    const size=dict(or((media as Json).original_info,{}))??{};
    out.push({type:or((media as Json).type,'photo'),src,w:size.width??null,h:size.height??null});
  }
  return out.slice(0,4);
}
/** The text with HTML entities decoded and its newlines kept, the links to show and the t.co links to remove. */
function textAndLinks(tweet:Json,hidden:string[]=[]){
  const text=cut(strip(unescape(str(or(tweet.full_text,tweet.text,'')))),MAX_TEXT);
  const entities=dict(or(tweet.entities,{}))??{};
  const media=list(or(dict(tweet.extended_entities??{})?.media,entities.media,[]));
  const drop:string[]=media.map(m=>(m as Json).url).filter((url):url is string=>typeof url==='string'),links:Link[]=[];
  for(const link of list(or(entities.urls,[])) as Json[]){
    const url=link.url,href=link.expanded_url;
    if(!(typeof url==='string'&&typeof href==='string'&&(href.startsWith('http://')||href.startsWith('https://'))))continue;
    if(hidden.some(quoted=>quoted&&href.includes(`/status/${quoted}`)))drop.push(url); // the quote box shows the quoted tweet
    else links.push({url,href,text:or(link.display_url,href)});
  }
  return {text,links,drop};
}
function authorFields(value:unknown){
  const user=dict(value)??{},avatar=user.profile_image_url_https;
  return {handle:str(or(user.screen_name,'')).replace(/^@+/,''),name:str(or(user.name,'')),avatar:typeof avatar==='string'&&avatar.startsWith('https://')?avatar:''};
}

export function toRecord(raw:unknown):TweetRecord|null{
  const tweet=dict(raw);if(!tweet)return null;
  const id=str(or(tweet.id_str,tweet.id,'')),user=dict(tweet.user)??{},handle=str(or(user.screen_name,'')).replace(/^@+/,'');
  const published=timestamp(str(or(tweet.tweet_created_at,tweet.created_at,'')));
  if(published===null)return null;
  // A repost shows the original tweet; the record keeps the reposting tweet's id and handle (the feed link).
  const reposted=dict(tweet.retweeted_status),shown=reposted??tweet,quoted=dict(shown.quoted_status);
  const quotedId=str(or((quoted??{}).id_str,shown.quoted_status_id_str,''));
  const {text,links,drop}=textAndLinks(shown,[quotedId]);
  if(!(id&&text&&handle))return null;
  const author=authorFields(shown.user);
  const record:TweetRecord={id,handle,text,published,author:author.handle||handle,name:author.name,avatar:author.avatar,
    kind:reposted?'retweet':quoted?'quote':'tweet',likes:shown.favorite_count??null,replies:shown.reply_count??null,
    reposts:shown.retweet_count??null,views:shown.views_count??null,media:photos(shown),links,drop};
  const article=dict(shown.stillfeed_article);
  if(article&&truthy(article.title)){
    record.article=article;
    // The card replaces the bare https://t.co link to the article.
    for(const link of links.filter(l=>str(l.href).includes('/i/article'))){record.drop=[...record.drop,link.url];record.links=record.links.filter(l=>l!==link);}
  }
  if(reposted)record.by=authorFields(user).name||handle;
  if(quoted){
    const q=textAndLinks(quoted),qAuthor=authorFields(quoted.user);
    record.quote={id:quotedId,handle:qAuthor.handle,name:qAuthor.name,avatar:qAuthor.avatar,text:cut(q.text,MAX_QUOTE_TEXT),links:q.links,drop:q.drop,media:photos(quoted)};
  }
  return record;
}
