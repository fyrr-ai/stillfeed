/** Explainable AI relevance scoring for news records (keywords and source priors; the model triage comes later). */
import type {RecordData} from './store';

const AI_KEYWORDS=['a.i.','agent view','agent skills','for agents','parallel agent','并行 agent','known agents','hermes-agent','agentmemory','aigc','llm','gpt','claude','gemini','deepseek','qwen','llama','gemma','nemotron','minimax','moonshot ai','zhipu','agentic','fine-tun','openai','anthropic','grok','copilot','codex','mcp','hugging face','huggingface','transformer','prompt','diffusion','多模态','交互模型','变换器','语言模型','视觉语言模型','基础模型','本地模型','具身智能','大模型','人工智能','机器学习','深度学习','智能体','算力','推理','微调'];
const TECH_KEYWORDS=['robot','robotics','embodied','autonomous','vision','chip','semiconductor','cuda','npu','gpu','cloud','developer','benchmark','dataset','eval','evaluation','sandbox','context','开源','技术','编程','软件','沙箱','上下文','芯片','机器人','具身'];
const NOISE_KEYWORDS=['娱乐','明星','八卦','足球','篮球','彩票','情感','旅游','美食'];
const COMMERCE_NOISE_KEYWORDS=['淘宝','天猫','京东','拼多多','券后','热销总榜','促销','优惠','补贴','下单','首发价'];
// Python's \b is Unicode-aware (\w = letters, digits and _ of any script); JS \b is ASCII-only.
const W='[\\p{L}\\p{N}_]',word=(body:string)=>new RegExp(`(?<!${W})(?:${body})(?!${W})`,'iu');
const UNSAFE_HARD_PATTERNS=[word('creampie'),word('blowjob'),word('suck (?:your|my) (?:dick|cock)'),/中出|婊子|吸你的鸡鸡|操虚拟女友/iu];
const UNSAFE_PROMO_PATTERNS=[word('nsfw|nudes?|porn(?:ography)?'),word('uncensored pictures?'),word('virtual girlfriends?'),word('knock her up'),/未经审查的图片|虚拟女友|色情内容|成人内容/iu];
const EN_SIGNAL_RE=/(?<![a-z0-9])(ai|aigc|llm|gpt|openai|anthropic|deepseek|gemini|claude|grok|xai|robot|robotics|embodied|autonomous|machine learning|artificial intelligence|transformer|diffusion|agent)(?![a-z0-9])/iu;
const MEANINGFUL_EN_SIGNAL_RE=/(?<![a-z0-9])(?:(ai|aigc|llm|gpt|openai|anthropic|deepseek|gemini|claude|grok|xai|robot|robotics|embodied|autonomous|machine learning|artificial intelligence|transformer|diffusion)(?![a-z0-9])|(qwen|llama|mistral|kimi|gemma|glm|sora|veo|nemotron|phi|codex|fable)[- ]?\d)/iu;
// Data engineering is part of the reader too, matched on word boundaries so "spark" or "arrow" in ordinary prose
// needs a data context word next to it.
const DATA_SIGNAL_RE=/(?<![a-z0-9])(dbt|duckdb|motherduck|iceberg|lakehouse|data ?lake|data engineer(?:ing|s)?|analytics engineer(?:ing|s)?|data warehouse|data pipelines?|snowflake|databricks|bigquery|clickhouse|redshift|dagster|airflow|airbyte|fivetran|kafka|flink|parquet|polars|pyarrow|apache arrow|apache spark|pyspark|spark sql|delta lake|semantic layer|etl|elt|olap|datafusion|sqlmesh|metabase|superset|data stack|dataframe)(?![a-z0-9])/iu;
// "cursor" is a substring of ordinary words like "precursor", so it needs word boundaries.
const CURSOR_SIGNAL_RE=/(?<![a-z0-9])cursor(?![a-z0-9])/iu;
const BROAD_AI_TERMS=['agent','模型','推理'];
const AI_RELEVANCE_THRESHOLD=0.65;
const SOURCE_PRIORS:Record<string,number>={official_ai:0.35,curated_media:0.18,aibase:0.45,aihot:0.45,aihubtoday:0.45,followbuilders:0.25,opmlrss:0.15,xapi:0.15,socialdata_x:0.15};
const AI_DEFAULT_SOURCES=['aibase','aihot','aihubtoday'];
const CURATED_MEDIA_TRUSTED_SOURCE_KEYWORDS=['the decoder ai news','techcrunch ai','venturebeat ai','artificial intelligence news','claude code releases'];
const CURATED_MEDIA_RESEARCH_SOURCE_KEYWORDS=['marktechpost research'];
const CURATED_MEDIA_RESEARCH_TERMS=['paper','arxiv','research','benchmark','bench','eval','evaluation','dataset','model','llm','agent','diffusion','transformer','multimodal','reasoning','inference','training','open-source','robot','governance'];
const CURATED_MEDIA_BUSINESS_TERMS=['funding','raises','raised','startup','acquire','acquisition','merger','revenue','enterprise','ipo','valuation'];
const LABEL_KEYWORDS:[string,string[]][]=[
  ['model_release',['model','gpt','claude','gemini','deepseek','llm','模型','大模型','发布','release']],
  ['developer_tool',['copilot','codex','mcp','api','sdk','developer','开发者','编程','代码','coding']],
  ['agent_workflow',['agent','智能体','workflow','工作流','tool use','function calling']],
  ['research_paper',['paper','arxiv','research','benchmark','eval','论文','研究','评测','榜单']],
  ['infra_compute',['gpu','npu','cuda','chip','semiconductor','算力','芯片','推理']],
  ['robotics',['robot','robotics','embodied','机器人','具身']],
  ['industry_business',['funding','acquire','融资','收购','估值','营收','公司']],
  ['ai_product_update',['openai','anthropic','google','perplexity','cursor','产品','上线','更新']],
];

/** Python's case-insensitive regexes also match İ and ı to "i", ſ to "s" and K (Kelvin) to "k"; JS folds only some.
 *  Each is one UTF-16 unit, so mapping them before a regex test keeps every match position. */
const fold=(text:string)=>text.replace(/[İıſK]/g,c=>c==='ſ'?'s':c==='K'?'k':'i');
const search=(re:RegExp,text:string)=>re.test(fold(text));
const containsAny=(haystack:string,keywords:string[])=>{const h=haystack.toLowerCase();return keywords.some(k=>h.includes(k));};
const matched=(haystack:string,keywords:string[])=>{const h=haystack.toLowerCase();return [...new Set(keywords.filter(k=>h.includes(k)))].sort();};
const unsafe=(text:string)=>UNSAFE_HARD_PATTERNS.some(p=>search(p,text))||UNSAFE_PROMO_PATTERNS.filter(p=>search(p,text)).length>=2;
function meaningfulAi(haystack:string){
  const h=haystack.toLowerCase();
  return search(MEANINGFUL_EN_SIGNAL_RE,h)||search(CURSOR_SIGNAL_RE,h)||AI_KEYWORDS.some(k=>!BROAD_AI_TERMS.includes(k)&&h.includes(k));
}
const labelFor=(text:string,hasTech:boolean)=>LABEL_KEYWORDS.find(([,keywords])=>containsAny(text,keywords))?.[0]??(hasTech?'ai_tech':'ai_general');
/** Python's round(x, 2): exact binary value, ties (only k/8 can tie at two decimals) to even. */
function round2(x:number){
  if(Number.isInteger(x*8)&&(x*8)%2){const f=Math.floor(x*100);return (f%2?f+1:f)/100;}
  return Number(x.toFixed(2));
}
/** str(value or '') */
const str=(v:unknown)=>v===undefined||v===null||v===false||v===0||v===''?'':String(v);
const PY_STRIP_START=/^[\x00-\x20]+/;
/** urllib.parse.urlparse(url).netloc; null where Python raises ValueError. */
function netloc(url:string):string|null{
  let rest=url.replace(PY_STRIP_START,'').replace(/[\t\r\n]/g,'');
  const colon=rest.indexOf(':');
  if(colon>0&&/^[A-Za-z][A-Za-z0-9+.-]*$/.test(rest.slice(0,colon)))rest=rest.slice(colon+1);
  if(!rest.startsWith('//'))return '';
  const end=rest.slice(2).search(/[/?#]/),host=end<0?rest.slice(2):rest.slice(2,2+end);
  if(host.includes('[')!==host.includes(']'))return null;
  const hostPort=host.slice(host.lastIndexOf('@')+1),open=hostPort.indexOf('[');
  if(host.includes('[')&&open>=0){
    const bracketed=hostPort.slice(open+1),close=bracketed.indexOf(']');
    const inside=close<0?bracketed:bracketed.slice(0,close),port=close<0?'':bracketed.slice(close+1);
    if(open>0||(port&&!port.startsWith(':')))return null;
    // Python validates the address with ipaddress; this checks its shape (IPv6 with an optional zone, or IPvFuture).
    if(inside.startsWith('v')?!/^v[a-fA-F0-9]+\..+$/.test(inside):!/^[0-9a-fA-F:.]*:[0-9a-fA-F:.]*(%.+)?$/.test(inside))return null;
  }
  if(!/^[\x00-\x7f]*$/.test(host)){
    const n=host.replace(/[@:#?]/g,''),nfkc=n.normalize('NFKC');
    if(n!==nfkc&&/[/?#@:]/.test(nfkc))return null;
  }
  return host;
}
type Relevance={is_ai_related:boolean;score:number;label:string;reason:string;signals:string[];noise:string[]};
const result=(is_ai_related:boolean,score:number,label:string,reason:string,signals:string[]=[],noise:string[]=[]):Relevance=>({is_ai_related,score:round2(Math.max(0,Math.min(1,score))),label,reason,signals,noise});

function score(record:RecordData):Relevance{
  const siteId=str(record.site_id),title=str(record.title),source=str(record.source),siteName=str(record.site_name),url=str(record.url);
  // Keyword matching is substring-based, so only the URL host may participate (full URLs randomly contain "llm").
  const urlHost=(netloc(url)??'').toLowerCase();
  const text=`${title} ${source} ${siteName} ${urlHost}`.toLowerCase();
  let aiSignals=matched(text,AI_KEYWORDS);
  if(search(CURSOR_SIGNAL_RE,text)&&!aiSignals.includes('cursor'))aiSignals=[...aiSignals,'cursor'].sort();
  const techSignals=matched(text,TECH_KEYWORDS),noise=[...matched(text,NOISE_KEYWORDS),...matched(text,COMMERCE_NOISE_KEYWORDS)];
  const prior=SOURCE_PRIORS[siteId]??0,signals=[...aiSignals,...techSignals];
  if(unsafe(text))return result(false,0,'unsafe_content','unsafe_promotional_content',[],['unsafe_promotional_content']);
  if(siteId==='curated_media'){
    const sourceL=source.toLowerCase(),titleL=title.toLowerCase();
    const trusted=containsAny(sourceL,CURATED_MEDIA_TRUSTED_SOURCE_KEYWORDS),research=containsAny(sourceL,CURATED_MEDIA_RESEARCH_SOURCE_KEYWORDS);
    const titleAi=meaningfulAi(titleL),titleBroad=containsAny(titleL,BROAD_AI_TERMS)||search(EN_SIGNAL_RE,titleL),titleResearch=containsAny(titleL,CURATED_MEDIA_RESEARCH_TERMS);
    if(research&&!(titleAi||titleResearch))return result(false,0.22,'source_scope_drop','curated_research_source_requires_research_or_ai_title_signal',signals,noise);
    if(!(trusted||research||titleAi||(titleBroad&&techSignals.length)))return result(false,prior+(titleBroad?0.28:0),'source_scope_drop','curated_media_requires_ai_title_or_trusted_ai_feed',signals,noise);
    const label=research||titleResearch?'research_paper':containsAny(titleL,CURATED_MEDIA_BUSINESS_TERMS)?'industry_business':labelFor(text,techSignals.length>0);
    let s=prior+(trusted?0.58:0.5)+Math.min(0.12,0.03*aiSignals.length)+Math.min(0.08,0.02*techSignals.length);
    if(research)s=Math.min(s,0.76);
    if(noise.length&&!titleAi)s-=Math.min(0.16,0.04*noise.length);
    return result(s>=AI_RELEVANCE_THRESHOLD,s,label,'curated_media_source_filter',signals.length?signals:trusted?[sourceL]:[],noise);
  }
  // Python also keeps opmlrss items of TRUSTED_AI_FEEDS here, but the adapter never fills that set.
  if(AI_DEFAULT_SOURCES.includes(siteId))return result(true,Math.max(AI_RELEVANCE_THRESHOLD,0.72+prior),labelFor(text,techSignals.length>0),'trusted_ai_source_default_keep',aiSignals.length?aiSignals:[siteId],noise);
  const hasAi=meaningfulAi(text),hasBroad=containsAny(text,BROAD_AI_TERMS)||search(EN_SIGNAL_RE,text),hasTech=techSignals.length>0;
  if(!(hasAi||(hasBroad&&hasTech)))return result(false,prior+(hasBroad?0.32:0)+(hasTech?0.08:0),'not_ai','missing_meaningful_ai_signal',signals,noise);
  if(containsAny(text,COMMERCE_NOISE_KEYWORDS)&&!hasAi)return result(false,0.25+prior,'commerce_noise','commerce_noise_without_strong_ai_signal',signals,noise);
  if(containsAny(text,NOISE_KEYWORDS)&&!hasAi)return result(false,0.25+prior,'noise','noise_without_strong_ai_signal',signals,noise);
  let s=prior+(hasAi?0.52:0.34)+Math.min(0.18,0.04*aiSignals.length)+Math.min(0.12,0.03*techSignals.length);
  if(noise.length)s-=Math.min(0.18,0.04*noise.length);
  if(hasBroad&&hasTech&&!hasAi)s=Math.max(s,AI_RELEVANCE_THRESHOLD);
  if(hasAi)s=Math.max(s,AI_RELEVANCE_THRESHOLD);
  return result(true,s,labelFor(text,hasTech),hasAi?'matched_ai_signal':'matched_broad_ai_plus_tech_signal',signals,noise);
}

/** The ai_* fields add_ai_relevance_fields puts on a record (site_id, title, source, site_name and url are read). */
export function addAiRelevance(record:RecordData):RecordData{
  const r=score(record);
  return {ai_is_related:r.is_ai_related,ai_score:r.score,ai_label:r.label,ai_relevance_reason:r.reason,ai_signals:r.signals,ai_noise:r.noise};
}
export const hasDataSignal=(text:string)=>search(DATA_SIGNAL_RE,text||'');
