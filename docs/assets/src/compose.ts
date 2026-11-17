// Captured UI in iPhone-style hardware: a dark bento banner, and frames over Raycast's Glaze 2 wallpaper. No interface is redrawn.
import {join} from 'node:path';
export type Composition={name:string;width:number;height:number;html:string;temporary?:boolean};
export function compositions({raw,fonts}:{raw:string;fonts:string}):Composition[]{
  const backdrop=join(fonts,'../../docs/assets/raycast-glaze-2.png');
  const status=`<div class="status"><b>9:41</b><div class="island"></div><span class="radios"><svg width="17" height="12" viewBox="0 0 17 12"><path d="M1 9v3h2V9zm4-3v6h2V6zm4-3v9h2V3zm4-3v12h3V0z" fill="currentColor"/></svg><svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 12L5 9a4.2 4.2 0 0 1 6 0zm-5-5L1.5 5.5a9.2 9.2 0 0 1 13 0L13 7a7.1 7.1 0 0 0-10 0zM5 5L3.5 3.5a6.4 6.4 0 0 1 9 0L11 5a4.2 4.2 0 0 0-6 0z" fill="currentColor"/></svg><svg width="25" height="12" viewBox="0 0 25 12"><rect x=".5" y=".5" width="21" height="11" rx="3" fill="none" stroke="currentColor" opacity=".5"/><rect x="2" y="2" width="18" height="8" rx="2" fill="currentColor"/><path d="M23 4v4q2-2 0-4" fill="currentColor" opacity=".5"/></svg></span></div>`;
  const foundation=`
  @font-face{font-family:Geist;src:url('file://${join(fonts,'geist-latin-wght-normal.woff2')}');font-weight:100 900}
  *{box-sizing:border-box;margin:0}html,body{width:100%;height:100%;overflow:hidden}
  body{font-family:Geist,Arial,sans-serif;background:#08090a url('file://${backdrop}') center/cover;color:#f5f4f7}
  .phone{position:relative;width:414px;padding:12px;border-radius:61px;background:linear-gradient(120deg,#929399 0,#343538 6%,#151618 45%,#56575b 78%,#18191b);box-shadow:0 0 0 1px #96979c,0 0 0 3px #121315,4px 8px 18px #0009,0 35px 70px #000b}
  .phone::before{content:'';position:absolute;inset:4px;border:1px solid #ffffff20;border-radius:57px;pointer-events:none}
  .buttons{position:absolute;left:-5px;top:155px;width:4px;height:48px;background:linear-gradient(90deg,#292a2d,#8c8c92,#26272a);border-radius:2px;box-shadow:0 65px 0 #5d5e62}
  .buttons::after{content:'';position:absolute;left:418px;top:54px;width:4px;height:78px;border-radius:2px;background:linear-gradient(90deg,#3d3e42,#818287,#17181a)}
  .screen{position:relative;width:390px;border-radius:49px;overflow:hidden;background:#000}.screen>img{display:block;width:390px}
  .status{height:48px;position:relative;display:flex;align-items:center;justify-content:space-between;padding:0 27px 0 35px;font-size:15px;line-height:1;color:#f7f7f7}
  .status b{font-weight:600}.island{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:112px;height:29px;border-radius:20px;background:#050506;box-shadow:inset 0 0 0 1px #ffffff06}
  .radios{display:flex;align-items:center;gap:6px}.home{height:23px;position:relative;background:#000}.home::after{content:'';position:absolute;left:50%;bottom:7px;transform:translateX(-50%);width:128px;height:4px;border-radius:8px;background:#f4f4f4}
  `;
  const phone=(shot:string,cls='',scale=1)=>`<div class="device ${cls}"><div class="phone" style="zoom:${scale}"><i class="buttons"></i><div class="screen">${status}<img src="file://${join(raw,shot+'.png')}" alt="Stillfeed screen"><div class="home"></div></div></div></div>`;
  const shell=(body:string,css:string)=>`<!doctype html><html><head><meta charset="utf-8"><style>${foundation}${css}</style></head><body>${body}</body></html>`;
  const bento=()=>{
    const crop=(shot:string,cls:string,index:string,title:string,text:string)=>`<section class="cell ${cls}"><span>${index}</span><b>${title}</b><p>${text}</p><div class="crop"><div><img src="file://${join(raw,shot+'.png')}" alt="Stillfeed ${title} screen"></div></div></section>`;
    const crosses=[[80,120],[980,120],[1420,120],[80,520],[380,520],[680,520],[980,520],[80,940],[380,940],[680,940],[980,940],[1420,940]].map(([x,y])=>`<i class="plus" style="left:${x}px;top:${y}px"></i>`).join('');
    return shell(`
  <div class="brand"><img src="file://${join(fonts,'../logo.svg')}" alt="">Stillfeed</div><div class="meta">OPEN SOURCE <i>/</i> SELF-HOSTED <i>/</i> PWA</div>
  <div class="frame"></div><i class="line v" style="left:980px"></i><i class="line h"></i><i class="line v short" style="left:380px"></i><i class="line v short" style="left:680px"></i>${crosses}
  <section class="hero"><div class="dots"></div><span class="pill"><b></b>Your sources. Your interests.</span><h1>A personal<br>AI news feed.</h1>
  <p class="intro">Collected from the sources you follow, picked for<br>what you care about, summarized in your language.</p>
  <div class="sources"><span>X</span><span>YouTube</span><span>RSS</span><span>Reddit</span><span>Web</span></div></section>
  ${crop('phone-hot','pick','01','Hot','Picked for your interests.')}${crop('phone-reader','read','02','Read','Get the short version.')}${crop('phone-saved','keep','03','Saved','Keep it. Find it later.')}
  <section class="stage">${phone('phone-feed','',.88)}</section>`,`
  @font-face{font-family:Mono;src:url('file://${join(fonts,'geist-mono-latin-wght-normal.woff2')}')}
  body{background:#000;color:#ededed}
  .brand{position:absolute;top:50px;left:80px;display:flex;align-items:center;gap:13px;font-size:25px;font-weight:550;letter-spacing:-.7px}.brand img{width:28px;height:28px;outline:1px solid #333;border-radius:7px}
  .meta{position:absolute;right:80px;top:61px;color:#666;font:12px Mono;letter-spacing:1px}.meta i{font-style:normal;color:#333;margin:0 6px}
  .frame{position:absolute;left:80px;top:120px;width:1340px;height:820px;border:1px solid #1f1f1f}
  .line{position:absolute;background:#1f1f1f}.v{top:120px;height:820px;width:1px}.v.short{top:520px;height:420px}.h{left:80px;top:520px;width:900px;height:1px}
  .plus{position:absolute;width:21px;height:21px;transform:translate(-10px,-10px);z-index:3}
  .plus:before,.plus:after{content:'';position:absolute;background:#555}.plus:before{left:10px;top:0;width:1px;height:21px}.plus:after{top:10px;left:0;height:1px;width:21px}
  section{position:absolute;overflow:hidden}
  .hero{left:81px;top:121px;width:898px;height:398px;padding:46px 56px}
  .dots{position:absolute;inset:0;background-image:radial-gradient(#2a2a2a 1px,transparent 1px);background-size:22px 22px;mask-image:radial-gradient(70% 110% at 100% 0,#000,transparent 70%)}
  .pill{position:relative;display:inline-flex;align-items:center;gap:9px;height:30px;padding:0 13px;border:1px solid #2a2a2a;border-radius:99px;background:#0a0a0a;font:12px Mono;color:#a1a1a1}
  .pill b{width:6px;height:6px;border-radius:50%;background:#3b82f6;box-shadow:0 0 10px #3b82f6}
  h1{position:relative;margin-top:24px;font-size:80px;line-height:1;letter-spacing:-4.4px;font-weight:600;background:linear-gradient(180deg,#fff 30%,#8f8f8f);-webkit-background-clip:text;color:transparent;padding-bottom:6px}
  .intro{position:relative;margin-top:18px;font-size:19px;line-height:1.5;color:#8f8f8f;letter-spacing:-.2px}
  .sources{position:absolute;right:56px;bottom:46px;display:flex;gap:8px}.sources span{font:12px Mono;color:#a1a1a1;border:1px solid #262626;border-radius:6px;padding:6px 10px;background:#0a0a0a}
  .cell{top:521px;width:299px;height:418px;padding:28px 0 0 30px;background:linear-gradient(#050505,#000)}.pick{left:80px}.read{left:380px}.keep{left:680px}
  .cell span{font:12px Mono;color:#555}.cell b{display:block;margin-top:14px;font-size:20px;font-weight:550;letter-spacing:-.5px}.cell p{margin-top:5px;font-size:15px;color:#8f8f8f;letter-spacing:-.1px}
  .crop{position:absolute;left:30px;top:134px;right:0;bottom:0;padding:14px 0 0 14px;border:1px solid #2a2a2a;border-width:1px 0 0 1px;border-top-left-radius:12px;background:#000;mask-image:linear-gradient(#000 50%,transparent)}
  .crop div{position:relative;overflow:hidden;height:100%}.crop img{position:absolute;max-width:none;display:block}
  .pick img{width:328px;left:-45px;top:-124px}.read img{width:292px;left:-12px;top:-162px}.keep img{width:332px;left:-9px;top:-75px}
  .stage{left:981px;top:121px;width:438px;height:818px;background:radial-gradient(75% 55% at 50% 48%,#2563eb66,transparent 70%),radial-gradient(30% 20% at 50% 12%,#60a5fa30,transparent),radial-gradient(90% 60% at 50% 100%,#111,transparent)}
  .stage .device{position:absolute;left:37px;top:86px}.stage .phone{box-shadow:0 0 0 1px #96979c,0 0 0 3px #121315,0 40px 120px #000}
  .stage:after{content:'';position:absolute;left:0;right:0;bottom:0;height:150px;background:linear-gradient(transparent,#000)}
  `);
  };
  const social=()=>shell(`
  <div class="wash"></div><div class="brand"><img src="file://${join(fonts,'../logo.svg')}" alt="">Stillfeed</div>
  <div class="copy"><h1>AI news.<br><span>One feed.</span></h1><p>Follow your sources.<br>Read what interests you.</p><div class="sources">X <i>·</i> YouTube <i>·</i> RSS <i>·</i> Reddit</div></div>
  <div class="stage">${phone('phone-feed','feed',.68)}${phone('phone-reader','reader',.57)}</div>
  <div class="foot">Self-hosted <i>·</i> Open source <i>·</i> Made for your phone</div>`, `
  .wash{position:absolute;inset:0;background:linear-gradient(90deg,#05050838,transparent 58%)}
  .brand{position:absolute;left:76px;top:52px;display:flex;align-items:center;gap:12px;font-size:22px;font-weight:550;letter-spacing:-.6px}.brand img{width:30px;height:30px}
  .copy{position:absolute;left:76px;top:158px;width:600px}h1{font-size:76px;line-height:1.04;font-weight:620;letter-spacing:-5px}
  h1 span{background:linear-gradient(110deg,#ddd7ff,#b8c8ff 80%);background-clip:text;color:transparent}
  .copy p{margin-top:30px;font-size:23px;line-height:1.4;letter-spacing:-.5px;color:#c8c8d1}.sources{margin-top:30px;font-size:16px;color:#a5a7b7}i{font-style:normal;padding:0 9px;color:#6f7488}
  .stage{position:absolute;left:683px;top:45px;width:660px;bottom:0;perspective:1800px}
  .device{position:absolute}.feed{left:0;top:0;transform:rotate(-6deg) rotateY(-5deg);transform-origin:center top}.reader{left:238px;top:160px;transform:rotate(6deg);z-index:2}
  .foot{position:absolute;left:76px;bottom:48px;color:#9297aa;font-size:13px;letter-spacing:.2px}
  `);
  const frame=(shot:string)=>shell(phone(shot),`.device{position:absolute;left:31px;top:31px}`);
  const desktop=()=>shell(`<div class="browser"><div class="bar"><i></i><i></i><i></i><span>Stillfeed · Sources</span></div><img src="file://${join(raw,'sources.png')}" alt="Stillfeed Sources"></div>`,`.browser{position:absolute;left:31px;top:31px;width:1042px;background:#18191c;border:1px solid #ffffff55;border-radius:15px;overflow:hidden;box-shadow:0 25px 60px #0009}.bar{height:32px;display:flex;align-items:center;gap:6px;padding:0 12px}.bar i{width:7px;height:7px;border-radius:50%;background:#74757c}.bar span{margin-left:18px;color:#a3a4ae;font-size:11px}.browser img{display:block;width:1040px}`);
  return [
    {name:'stillfeed-banner',width:1500,height:1000,html:bento()},
    {name:'stillfeed-social',width:1200,height:630,html:social()},
    ...['feed','hot','reader','saved','discuss'].map(name=>({name:'stillfeed-'+name,width:476,height:(name==='discuss'?650:780)+159,html:frame('phone-'+name)})),
    ...['hide-menu','hide-after','hide-undo'].map(name=>({name:'frame-'+name,width:476,height:759,html:frame(name),temporary:true})),
    {name:'stillfeed-sources',width:1104,height:816,html:desktop()},
  ];
}
