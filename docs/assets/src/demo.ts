// Example content for documentation. Isolated SQLite, fictional stories and people, local SVG artwork.
// No accounts, source fetches or model calls are involved.
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Store,hash,canonical,type RecordData} from '../../../src/store';
import {Reader,type Reading} from '../../../src/reader';
import {Summaries} from '../../../src/summary';
import {Personal} from '../../../src/personal';
import {SavedTopics} from '../../../src/saved-topics';
import {Chats} from '../../../src/chat';
import {toRecord} from '../../../src/tweets';
import {avatar,mark,PALETTES} from './art';

const stories=[
  {key:'local-coder',title:'A small coding model you can run locally',source:'Open Model Notes',host:'models.example.org',age:10,topic:'Models',cover:['LOCAL','CODING'],color:'#9dacf7'},
  {key:'agents',title:'What breaks when coding agents run for hours',source:'Agent Sessions',url:'https://www.youtube.com/watch?v=DemoAgents1',age:28,topic:'Coding agents',cover:['AGENTS','AT WORK'],color:'#e5a478'},
  {key:'reddit',title:'What are you using local models for?',source:'r/LocalLLaMA',url:'https://www.reddit.com/r/LocalLLaMA/comments/demo123/local_models/',age:37,topic:'Models'},
  {key:'evals',title:'Build a small eval before changing your prompt',source:'Practical Evals',host:'evals.example.org',age:48,topic:'Evaluations'},
  {key:'tools',title:'Giving a coding agent tools without giving it your whole machine',source:'Agent Engineering',host:'agents.example.org',age:76,topic:'Coding agents',cover:['TOOLS &','BOUNDARIES'],color:'#8bbfae'},
  {key:'reasoning',title:'When reasoning models help, and when they just take longer',source:'Model Journal',host:'journal.example.org',age:110,topic:'Models'},
  {key:'context',title:'Keeping useful context across long coding sessions',source:'Build with AI',host:'build.example.org',age:145,topic:'Coding agents'},
  {key:'benchmarks',title:'A benchmark score is a starting point for your own evaluation',source:'Practical Evals',host:'evals.example.org',age:180,topic:'Evaluations'},
];
const urlOf=(story:typeof stories[number])=>canonical(story.url??`https://${story.host}/${story.key}`);
const sha1=(text:string)=>createHash('sha1').update(text).digest('hex');
const readerURL=urlOf(stories[0]!);
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function editorialCover(lines:string[],color:string,source:string,video=false){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#111216"/><path d="M900 0V675M0 560H1200" stroke="#34363d"/><circle cx="1035" cy="180" r="160" fill="none" stroke="${color}" stroke-width="2"/><circle cx="1035" cy="180" r="110" fill="none" stroke="${color}" stroke-opacity=".35" stroke-width="26"/><rect x="60" y="60" width="74" height="7" rx="3" fill="${color}"/><g font-family="Arial,sans-serif" font-size="118" font-weight="700" letter-spacing="-4" fill="#f2efe9">${lines.map((line,i)=>`<text x="60" y="${245+i*130}">${escape(line)}</text>`).join('')}</g><text x="64" y="620" font-family="Arial,sans-serif" font-size="25" letter-spacing="5" fill="#a8a8ad">${escape(source.toUpperCase())}</text>${video?'<rect x="970" y="535" width="155" height="94" rx="22" fill="#db3434"/><path d="M1030 555L1077 582L1030 609Z" fill="white"/>':''}</svg>`;
}
export function createDemo(dir:string){
  const now=Date.now(),remote:Record<string,string>={},images=new Map<string,string>();
  const serve=(url:string,svg:string)=>{const file=join(dir,'remote',sha1(url)+'.svg');writeFileSync(file,svg);remote[url]=file;return url;};
  mkdirSync(join(dir,'remote'),{recursive:true});
  const records:RecordData[]=stories.map(story=>{
    const url=urlOf(story);if(story.cover)images.set(url,editorialCover(story.cover,story.color!,story.source,story.key==='agents'));
    return {url,title:story.title,source:story.source,site_id:'opmlrss',published_at:new Date(now-story.age*60000).toISOString(),ai_is_related:true};
  });
  const posts=[
    {name:'Lucy Park',handle:'lucy_builds',age:18,text:'I ask a coding agent to show the commands it ran, the test results and the diff.\n\nThat makes a quick review much easier.',topic:'Coding agents'},
    {name:'Mateo Reed',handle:'mateo_evals',age:65,text:'Before changing the model, collect ten examples where the current one fails.\n\nThose examples will tell you more than another leaderboard.',topic:'Evaluations'},
    {name:'Nora Chen',handle:'nora_models',age:125,text:'Local models make it easy to try an idea on a small private repo. Start with one task you can check yourself.',topic:'Models'},
  ];
  posts.forEach((post,i)=>{
    const id=String(1990000000000000000n+BigInt(i));
    const tweet=toRecord({id_str:id,tweet_created_at:new Date(now-post.age*60000).toISOString(),full_text:post.text,user:{screen_name:post.handle,name:post.name,profile_image_url_https:serve(`https://avatars.example.org/${post.handle}.svg`,avatar(i+1,PALETTES[['violet','teal','amber'][i]!]!))},favorite_count:128+i*47,reply_count:12+i*3,retweet_count:24+i*7,entities:{urls:[]}});
    if(!tweet)throw new Error('Invalid demo post');
    records.push({url:`https://x.com/${post.handle}/status/${id}`,title:post.text,source:'X follows',site_id:'opmlrss',tweet,published_at:new Date(now-post.age*60000).toISOString(),ai_is_related:true});
  });
  const store=new Store(dir);store.ingest(records,new Date(now).toISOString());
  const personal=new Personal(store);personal.configure('Coding agents, practical evaluations and open models I can run locally.');
  const reasons:Record<string,string>={
    'agents':'You use coding agents for longer tasks. This talk focuses on failures and checks during real work.',
    'local-coder':'These notes show what to check before using a local coding model on your own projects.',
    'evals':'A practical way to check whether a prompt change actually improves the answers you need.',
  };
  for(const story of stories)store.db.query('INSERT INTO personal_ratings VALUES(?,?,?,?,?,?)').run(hash(urlOf(story)),store.meta('personalProfile')!,reasons[story.key]?3:1,reasons[story.key]||'Outside the current interests.',now,'demo-cache');
  const reader=hash(readerURL);new Reader(store);
  const reading:Reading={title:stories[0]!.title,author:'Maya Ellis',url:readerURL,fetchedAt:now,
    html:'<p>A small coding model can be useful when you want to keep a repository on your own machine. This example walks through local setup and a small evaluation before using the model for daily work.</p><h2>Try it on your own code</h2><p>Pick ten small tasks from a repository you know. Include a bug fix, a test and a change across several files. Run the same tasks with the same tools and record which changes pass your tests.</p><h2>Give the agent clear boundaries</h2><p>Keep secrets outside its workspace. Ask it to run checks and report what it changed. Inspect the diff before accepting the result.</p>',
    text:'A small coding model can run on your own machine. Test it on ten small tasks from a repository you know, including bug fixes, tests and changes across files. Compare results with the same tools and tests. Keep secrets outside the workspace, run checks and inspect the diff.'};
  store.db.query('INSERT OR REPLACE INTO article_content VALUES(?,?,?)').run(reader,JSON.stringify(reading),now);
  new Summaries(store).save(reader,reading,['Run a coding model locally to keep your repository on your own machine.','Try it on small tasks from your own code before relying on benchmark scores.','Keep tools and secrets separate, run tests, and inspect the diff.'],'demo-cache');
  new SavedTopics(store);
  for(const story of stories.filter(story=>['local-coder','evals','tools','context','reasoning'].includes(story.key))){
    const id=hash(urlOf(story)),topic=hash(story.topic.toLowerCase());store.save(id,true);
    store.db.query('INSERT OR IGNORE INTO saved_topics VALUES(?,?,?)').run(topic,story.topic,story.topic.toLowerCase());
    store.db.query('INSERT INTO saved_topic_items VALUES(?,?)').run(id,topic);
  }
  store.db.exec('DELETE FROM saved_topic_jobs');
  const chat=new Chats(store).open({kind:'article',id:reader});
  for(const [role,text] of [
    ['user','What should I check before using it on my own projects?'],
    ['assistant','Start with a small evaluation on a repository you know.\n\n- Pick ten real tasks, including a bug fix and a change across files.\n- Check whether the changes pass your tests.\n- Inspect the diffs and record failures.\n\nKeep secrets outside the agent workspace. The article recommends testing on your own code before relying on benchmark scores.'],
  ])store.db.query("INSERT INTO chat_messages(id,thread_id,role,text,state) VALUES(?,?,?,?,'done')").run(hash(role+text),chat.id,role!,text!);
  mkdirSync(join(dir,'previews'),{recursive:true});mkdirSync(join(dir,'favicons'),{recursive:true});
  for(const record of records){
    const url=String(record.url),path=join(dir,'previews',sha1(url)),svg=images.get(url);
    if(svg){writeFileSync(path+'.img',svg);writeFileSync(path+'.type','image/svg+xml');}else writeFileSync(path+'.miss','');
    const host=new URL(url).hostname,icon=join(dir,'favicons',sha1(host));
    writeFileSync(icon+'.img',mark(host==='www.youtube.com'?'▶':host==='www.reddit.com'?'r':String(record.source)[0]!,host==='www.youtube.com'?'#d93636':'#30323a'));
    writeFileSync(icon+'.type','image/svg+xml');
  }
  store.close();return {reader,remote};
}
if(import.meta.main){if(!Bun.argv[2])throw new Error('Usage: bun docs/assets/src/demo.ts <isolated-state>');console.log(JSON.stringify(createDemo(Bun.argv[2])));}
