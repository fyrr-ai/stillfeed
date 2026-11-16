// The README images as HTML pages: raw app screenshots in phone and browser frames on one dark backdrop, and the
// architecture diagram. shots.ts photographs each page at 2x. Sizes are CSS pixels.
import { join } from 'node:path';

export type Composition = { name: string; width: number; height: number; html: string };

const css = (fonts: string) => `
@font-face { font-family: Geist; src: url('file://${join(fonts, 'geist-latin-wght-normal.woff2')}') format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'Geist Mono'; src: url('file://${join(fonts, 'geist-mono-latin-wght-normal.woff2')}') format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 100%; height: 100%; }
body { font-family: Geist, sans-serif; color: #ededed; background: #000; overflow: hidden; position: relative; -webkit-font-smoothing: antialiased; }
/* Backdrop: black, a faint grid that fades out, and two soft glows. */
.backdrop { position: absolute; inset: 0; pointer-events: none; }
.backdrop::before { content: ''; position: absolute; inset: 0;
  background-image: linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px);
  background-size: 56px 56px; background-position: -1px -1px;
  -webkit-mask-image: radial-gradient(ellipse 70% 75% at var(--gx, 60%) var(--gy, 45%), #000 10%, transparent 75%); }
.backdrop::after { content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse 45% 55% at var(--gx, 60%) var(--gy, 45%), rgba(82,120,255,.20), transparent 70%),
              radial-gradient(ellipse 35% 40% at calc(var(--gx, 60%) + 18%) calc(var(--gy, 45%) + 30%), rgba(190,90,255,.10), transparent 70%); }
.mono { font-family: 'Geist Mono', monospace; }

/* A phone: bezel, status bar, and the top of a 390 × 844 screenshot. Scaled with zoom. */
.phone { position: relative; width: 414px; padding: 12px; border-radius: 64px; background: linear-gradient(160deg, #3a3a3f, #18181b 40%, #0e0e10);
  box-shadow: 0 0 0 1px rgba(255,255,255,.10), 0 60px 120px -30px rgba(0,0,0,.9), 0 30px 60px -20px rgba(0,0,0,.7), 0 0 80px rgba(90,120,255,.08); }
.phone::before { content: ''; position: absolute; inset: 1px; border-radius: 63px; border: 1px solid rgba(255,255,255,.08); pointer-events: none; }
.screen { position: relative; width: 390px; height: 844px; border-radius: 52px; overflow: hidden; background: #000; }
.status { height: 50px; display: flex; align-items: center; justify-content: space-between; padding: 6px 30px 0 44px; font-weight: 600; font-size: 16.5px; color: #fff; }
.island { position: absolute; top: 11px; left: 50%; width: 122px; height: 35px; margin-left: -61px; border-radius: 20px; background: #000; box-shadow: 0 0 0 1px rgba(255,255,255,.06); }
.status svg { display: block; }
.status .icons { display: flex; gap: 6px; align-items: center; }
.screen img { display: block; width: 390px; }

/* A browser window. */
.window { position: relative; border-radius: 14px; overflow: hidden; background: #0a0a0a;
  box-shadow: 0 0 0 1px rgba(255,255,255,.12), 0 50px 120px -30px rgba(0,0,0,.95), 0 0 100px rgba(90,120,255,.07); }
.bar { height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 16px; background: #111113; border-bottom: 1px solid rgba(255,255,255,.08); position: relative; }
.bar i { width: 12px; height: 12px; border-radius: 50%; background: #2e2e33; display: block; }
.url { position: absolute; left: 50%; transform: translateX(-50%); height: 28px; min-width: 340px; padding: 0 16px; border-radius: 8px; background: #1a1a1d; color: #8f8f96;
  font: 13px 'Geist Mono', monospace; display: flex; align-items: center; justify-content: center; gap: 8px; }
.window > img { display: block; }

.caption { text-align: center; margin-top: 30px; }
.caption b { display: block; font-size: 22px; font-weight: 600; letter-spacing: -.01em; color: #fff; }
.caption span { display: block; margin-top: 6px; font-size: 16px; color: #a1a1aa; line-height: 1.45; }
`;

const status = `<div class="status"><span>9:41</span><span class="icons">
<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1" fill="#fff"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="#fff"/><rect x="10" y="3" width="3" height="9" rx="1" fill="#fff"/><rect x="15" y="0" width="3" height="12" rx="1" fill="#fff"/></svg>
<svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0Z" fill="#fff"/><path d="M3.4 6.8a6.5 6.5 0 0 1 9.2 0l-1.4 1.4a4.5 4.5 0 0 0-6.4 0Z" fill="#fff"/><path d="M1.2 4.6a9.6 9.6 0 0 1 13.6 0l-1.4 1.4a7.6 7.6 0 0 0-10.8 0Z" fill="#fff"/></svg>
<svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" stroke="#fff" stroke-opacity=".4" fill="none"/><rect x="2" y="2" width="20" height="9" rx="2" fill="#fff"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="#fff" fill-opacity=".4"/></svg>
</span></div><div class="island"></div>`;

const phone = (src: string, zoom: number, style = '') =>
  `<div class="phone" style="zoom:${zoom};${style}"><div class="screen">${status}<img src="file://${src}" alt=""></div></div>`;
/** The top of a desktop screenshot (CSS width × visible height) in a browser window. */
const browser = (src: string, url: string, width: number, height: number, shotWidth: number, style = '') =>
  `<div class="window" style="width:${width}px;${style}"><div class="bar"><i></i><i></i><i></i><div class="url"><svg width="11" height="12" viewBox="0 0 11 12"><rect x=".5" y="5" width="10" height="6.5" rx="1.5" fill="#8f8f96"/><path d="M2.5 5V3.5a3 3 0 0 1 6 0V5" stroke="#8f8f96" fill="none" stroke-width="1.3"/></svg>${url}</div></div>
<div style="height:${height}px;overflow:hidden"><img src="file://${src}" alt="" style="display:block;width:${shotWidth}px;margin-left:${(width - shotWidth) / 2}px"></div></div>`;

const page = (fonts: string, body: string, extra = '', glow = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css(fonts)}${extra}</style></head><body><div class="backdrop" style="${glow}"></div>${body}</body></html>`;

export function compositions({ raw, fonts }: { raw: string; fonts: string }): Composition[] {
  const shot = (name: string) => join(raw, name + '.png');
  const out: Composition[] = [];

  out.push({ name: 'stillfeed-banner', width: 1600, height: 800, html: page(fonts, `
<div class="copy">
  <p class="eyebrow mono">Self-hosted · Open source · MIT</p>
  <h1>Stillfeed</h1>
  <p class="tagline">Keep up with AI and data engineering<br>in ten minutes a day.</p>
  <ul class="facts"><li>One private feed instead of fifty tabs</li><li>Hot: the few things you should not miss</li><li>AI summaries in your language</li></ul>
</div>
<div class="stage">
  ${phone(shot('phone-hot'), .66, 'position:absolute;left:0;top:150px')}
  ${phone(shot('phone-reader'), .66, 'position:absolute;right:0;top:150px')}
  ${phone(shot('phone-feed'), .74, 'position:absolute;left:50%;top:76px;margin-left:-207px;z-index:2')}
</div>`, `
.copy { position: absolute; left: 104px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; }
.eyebrow { font-size: 14px; letter-spacing: .14em; text-transform: uppercase; color: #8f8f96; }
h1 { margin-top: 22px; font-size: 112px; line-height: 1; font-weight: 650; letter-spacing: -.055em; color: #fff; }
.tagline { margin-top: 26px; font-size: 30px; line-height: 1.3; letter-spacing: -.02em; color: #a1a1aa; }
.facts { margin-top: 40px; padding: 0; list-style: none; display: grid; gap: 14px; }
.facts li { position: relative; padding-left: 26px; font-size: 18px; color: #d4d4d8; }
.facts li::before { content: ''; position: absolute; left: 2px; top: 8px; width: 8px; height: 8px; border-radius: 50%; background: #52a8ff; box-shadow: 0 0 12px rgba(82,168,255,.8); }
.stage { position: absolute; left: 700px; right: 70px; top: 0; bottom: 0; }
`, '--gx:72%;--gy:50%') });

  const tabs: [string, string, string][] = [
    ['phone-hot', 'Hot', 'A few picks you should not miss,<br>each with the reason why.'],
    ['phone-feed', 'Feed', 'Articles, videos and X posts.<br>What you have seen leaves.'],
    ['phone-saved', 'Saved', 'Bookmarks, kept with their text<br>for as long as you want.'],
  ];
  out.push({ name: 'stillfeed-phones', width: 1600, height: 960, html: page(fonts, `
<div class="row">${tabs.map(([name, title, text]) => `<figure>${phone(shot(name), .8)}<figcaption class="caption"><b>${title}</b><span>${text}</span></figcaption></figure>`).join('')}</div>`, `
.row { position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; gap: 88px; padding-top: 6px; }
figure { display: flex; flex-direction: column; align-items: center; }
`, '--gx:50%;--gy:42%') });

  out.push({ name: 'stillfeed-reader', width: 1600, height: 960, html: page(fonts, `
${browser(shot('desktop-reader'), '127.0.0.1:3200/article/8d1f…', 1000, 640, 1440, 'position:absolute;right:96px;top:110px')}
${phone(shot('phone-reader'), .86, 'position:absolute;left:150px;top:80px;z-index:2')}
<div class="note"><b>Reader</b><span>Clean article text, YouTube transcripts and X Articles,<br>with a three-point summary in the language you choose.</span></div>`, `
.note { position: absolute; right: 96px; top: 830px; width: 1000px; padding-left: 300px; }
.note b { display: block; font-size: 22px; font-weight: 600; color: #fff; }
.note span { display: block; margin-top: 6px; font-size: 16px; line-height: 1.45; color: #a1a1aa; }
`, '--gx:55%;--gy:45%') });

  out.push({ name: 'stillfeed-sources', width: 1600, height: 1000, html: page(fonts, `
${browser(shot('desktop-sources'), '127.0.0.1:3200/sources', 1280, 830, 1280, 'position:absolute;left:160px;top:90px')}`, '', '--gx:50%;--gy:40%') });

  out.push({ name: 'stillfeed-architecture', width: 1600, height: 1000, html: architecture(fonts) });
  return out;
}

/** How it works: sources → collection → SQLite ↔ reader worker, the web app on top, models optional. */
function architecture(fonts: string) {
  const box = (x: number, y: number, w: number, h: number, title: string, text: string, cls = '') =>
    `<div class="box ${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"><b>${title}</b><span>${text}</span></div>`;
  const sources = [['Feeds', 'RSS, Atom and JSON · ~70 blogs'], ['YouTube', '~50 channels, with transcripts'], ['X', '410 accounts by default, via SocialData'], ['News aggregators', 'Hacker News, GitHub Trending and 7 more']];
  const line = 'stroke="#7c7c86" stroke-width="1.6" fill="none"';
  const paths = [
    ...[300, 420, 540, 660].map(y => `<path d="M370 ${y}H400" ${line}/>`),
    `<path d="M400 300V660" ${line}/>`, `<path d="M400 350H458" ${line} marker-end="url(#a)"/>`,
    `<path d="M600 400V432" ${line} marker-end="url(#a)"/>`, `<path d="M600 540V572" ${line} marker-end="url(#a)"/>`,
    `<path d="M770 365H832" ${line} marker-end="url(#a)"/>`,
    `<path d="M1108 365H1162" ${line} marker-end="url(#a)" marker-start="url(#b)"/>`,
    `<path d="M970 438V512" ${line} marker-end="url(#a)" marker-start="url(#b)"/>`,
    `<path d="M600 710V782" ${line} marker-end="url(#a)" stroke-dasharray="5 5"/>`,
    `<path d="M970 650V782" ${line} marker-end="url(#a)" stroke-dasharray="5 5"/>`,
  ].join('');
  return page(fonts, `
<header><h1>How Stillfeed works</h1><p>One Bun process and one SQLite file. Models run in the background, never inside a request.</p></header>
<p class="label mono" style="left:80px;top:218px">Sources</p>
${sources.map(([t, s], i) => box(80, 250 + i * 120, 290, 100, t, s)).join('')}
<div class="group" style="left:430px;top:230px;width:340px;height:480px"><p class="mono">Collection · every 2 h</p></div>
${box(460, 300, 280, 100, 'Relevance filter', 'Keeps AI and data-engineering items')}
${box(460, 440, 280, 100, 'AI second look', 'A fast model catches what keywords miss')}
${box(460, 580, 280, 100, 'Hot and suggestions', 'Picked against your own interests')}
${box(840, 300, 268, 138, 'SQLite', 'Articles, what you have read, Saved, Hot, texts and summaries', 'focus')}
${box(840, 520, 268, 130, 'Background reader', 'Clean text, transcripts, X Articles and summaries')}
${box(1170, 300, 350, 138, 'Web app', 'Feed, Hot, Saved, Reader and Sources, on your phone or desktop')}
${box(430, 790, 678, 100, 'Your AI provider <em>optional</em>', 'Anthropic · any OpenAI-compatible API (OpenRouter, Ollama, vLLM) · Codex CLI', 'models')}
<div class="aside" style="left:1170px;top:520px;width:350px"><p class="mono">Private by default</p><span>No account and no telemetry. Reach it through Tailscale, an SSH tunnel or your own reverse proxy.</span></div>
<svg class="wires" width="1600" height="1000"><defs>
<marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#9a9aa3"/></marker>
<marker id="b" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M10 0L0 5L10 10Z" fill="#9a9aa3"/></marker>
</defs>${paths}</svg>
<p class="foot">Without a provider Stillfeed still collects, filters by keywords and reads articles; summaries, Hot and suggestions stay off.</p>`, `
header { position: absolute; left: 80px; top: 68px; }
h1 { font-size: 52px; font-weight: 650; letter-spacing: -.045em; color: #fff; }
header p { margin-top: 14px; font-size: 21px; color: #a1a1aa; }
.label { position: absolute; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #8f8f96; }
.box { position: absolute; padding: 20px 22px; border-radius: 12px; background: #0f0f11; border: 1px solid rgba(255,255,255,.13); z-index: 2; }
.box b { display: block; font-size: 20px; font-weight: 600; letter-spacing: -.01em; color: #fff; }
.box span { display: block; margin-top: 7px; font-size: 15px; line-height: 1.4; color: #a1a1aa; }
.box em { font-style: normal; font: 12px 'Geist Mono', monospace; letter-spacing: .08em; text-transform: uppercase; color: #8f8f96; margin-left: 10px; vertical-align: 3px; }
.box.focus { background: #08111f; border-color: #3b82f6; box-shadow: 0 0 0 1px rgba(59,130,246,.35), 0 0 60px rgba(59,130,246,.25); }
.box.models { border-style: dashed; background: #0b0b0d; }
.group { position: absolute; border-radius: 16px; border: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.02); }
.group p { position: absolute; left: 22px; top: 18px; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #8f8f96; }
.aside { position: absolute; padding: 20px 22px; border-radius: 12px; border: 1px dashed rgba(255,255,255,.12); }
.aside p { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: #8f8f96; }
.aside span { display: block; margin-top: 10px; font-size: 15px; line-height: 1.45; color: #a1a1aa; }
.wires { position: absolute; left: 0; top: 0; z-index: 1; }
.foot { position: absolute; left: 80px; bottom: 44px; font-size: 16px; color: #8f8f96; }
.backdrop::after { opacity: .6; }
`, '--gx:58%;--gy:45%');
}
