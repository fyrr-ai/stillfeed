// Captured UI in iPhone-style hardware, over Raycast's Glaze 2 wallpaper. No interface is redrawn.
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
  const hero=(social:boolean)=>shell(`
  <div class="wash"></div><div class="brand"><img src="file://${join(fonts,'../logo.svg')}" alt="">Stillfeed</div>
  <div class="copy"><h1>AI news.<br><span>One feed.</span></h1><p>Follow your sources.<br>Read what interests you.</p><div class="sources">X <i>·</i> YouTube <i>·</i> RSS <i>·</i> Reddit</div></div>
  <div class="stage">${phone('phone-feed','feed',social?.68:.89)}${phone('phone-reader','reader',social?.57:.73)}</div>
  <div class="foot">Self-hosted <i>·</i> Open source <i>·</i> Made for your phone</div>`, `
  .wash{position:absolute;inset:0;background:linear-gradient(90deg,#05050838,transparent 58%)}
  .brand{position:absolute;left:76px;top:${social?52:68}px;display:flex;align-items:center;gap:12px;font-size:22px;font-weight:550;letter-spacing:-.6px}.brand img{width:30px;height:30px}
  .copy{position:absolute;left:76px;top:${social?158:214}px;width:600px}h1{font-size:${social?76:94}px;line-height:1.04;font-weight:620;letter-spacing:-5px}
  h1 span{background:linear-gradient(110deg,#ddd7ff,#b8c8ff 80%);background-clip:text;color:transparent}
  .copy p{margin-top:30px;font-size:${social?23:27}px;line-height:1.4;letter-spacing:-.5px;color:#c8c8d1}.sources{margin-top:30px;font-size:16px;color:#a5a7b7}i{font-style:normal;padding:0 9px;color:#6f7488}
  .stage{position:absolute;left:${social?683:770}px;top:${social?45:72}px;width:660px;bottom:0;perspective:1800px}
  .device{position:absolute}.feed{left:0;top:0;transform:rotate(-6deg) rotateY(-5deg);transform-origin:center top}.reader{left:${social?238:305}px;top:${social?160:245}px;transform:rotate(6deg);z-index:2}
  .foot{position:absolute;left:76px;bottom:${social?48:64}px;color:#9297aa;font-size:13px;letter-spacing:.2px}
  `);
  const frame=(shot:string)=>shell(phone(shot),`.device{position:absolute;left:31px;top:31px}`);
  const desktop=()=>shell(`<div class="browser"><div class="bar"><i></i><i></i><i></i><span>Stillfeed · Sources</span></div><img src="file://${join(raw,'sources.png')}" alt="Stillfeed Sources"></div>`,`.browser{position:absolute;left:31px;top:31px;width:1042px;background:#18191c;border:1px solid #ffffff55;border-radius:15px;overflow:hidden;box-shadow:0 25px 60px #0009}.bar{height:32px;display:flex;align-items:center;gap:6px;padding:0 12px}.bar i{width:7px;height:7px;border-radius:50%;background:#74757c}.bar span{margin-left:18px;color:#a3a4ae;font-size:11px}.browser img{display:block;width:1040px}`);
  return [
    {name:'stillfeed-banner',width:1500,height:1000,html:hero(false)},
    {name:'stillfeed-social',width:1200,height:630,html:hero(true)},
    ...['feed','hot','reader','saved','discuss'].map(name=>({name:'stillfeed-'+name,width:476,height:(name==='discuss'?650:780)+159,html:frame('phone-'+name)})),
    ...['hide-menu','hide-after','hide-undo'].map(name=>({name:'frame-'+name,width:476,height:759,html:frame(name),temporary:true})),
    {name:'stillfeed-sources',width:1104,height:816,html:desktop()},
  ];
}
