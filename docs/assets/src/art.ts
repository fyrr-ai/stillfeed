// Locally drawn SVG stand-ins for article previews, X avatars and site icons, so the README screenshots need no
// network and show no real person or brand artwork. Every picture is deterministic for its seed.

export type Palette = readonly [string, string, string];
export type Motif = 'grid' | 'bars' | 'rings' | 'nodes' | 'waves' | 'code' | 'stack' | 'chart';

export const PALETTES: Record<string, Palette> = {
  blue: ['#3b82f6', '#06b6d4', '#a5b4fc'],
  violet: ['#8b5cf6', '#ec4899', '#c4b5fd'],
  amber: ['#f59e0b', '#ef4444', '#fde68a'],
  green: ['#10b981', '#84cc16', '#a7f3d0'],
  teal: ['#14b8a6', '#3b82f6', '#99f6e4'],
  rose: ['#f43f5e', '#f97316', '#fecdd3'],
  indigo: ['#6366f1', '#22d3ee', '#c7d2fe'],
};

function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

const W = 1200, H = 675;

function motif(kind: Motif, [a, b, c]: Palette, r: () => number): string {
  const line = 'stroke="#fff" stroke-opacity=".10" fill="none"';
  switch (kind) {
    case 'grid': {
      let out = '';
      for (let x = 0; x <= W; x += 60) out += `<path d="M${x} 0V${H}" ${line}/>`;
      for (let y = 15; y <= H; y += 60) out += `<path d="M0 ${y}H${W}" ${line}/>`;
      for (let i = 0; i < 7; i++) { const x = Math.floor(r() * 20) * 60, y = 15 + Math.floor(r() * 11) * 60; out += `<rect x="${x}" y="${y}" width="60" height="60" fill="${[a, b, c][i % 3]}" fill-opacity="${.18 + r() * .3}"/>`; }
      return out;
    }
    case 'bars': {
      let out = '';
      const n = 14, gap = 22, w = (W - 240 - gap * (n - 1)) / n;
      for (let i = 0; i < n; i++) { const h = 120 + (Math.sin(i * .7 + r() * 2) * .5 + .5) * 300 + i * 8; out += `<rect x="${120 + i * (w + gap)}" y="${H - 90 - h}" width="${w}" height="${h}" rx="10" fill="url(#bar)"/>`; }
      return out + `<path d="M100 ${H - 90}H${W - 100}" stroke="#fff" stroke-opacity=".25"/>`;
    }
    case 'rings': {
      let out = '';
      const cx = 760 + r() * 120, cy = 330;
      for (let i = 1; i < 12; i++) out += `<circle cx="${cx}" cy="${cy}" r="${i * 42}" stroke="#fff" stroke-opacity="${(.24 - i * .016).toFixed(3)}" fill="none"/>`;
      return out + `<circle cx="${cx}" cy="${cy}" r="58" fill="${a}" fill-opacity=".9"/><circle cx="${cx}" cy="${cy}" r="58" fill="url(#shine)"/>`;
    }
    case 'nodes': {
      const pts = Array.from({ length: 18 }, () => [80 + r() * (W - 160), 70 + r() * (H - 140)] as const);
      let out = '';
      pts.forEach(([x, y], i) => pts.slice(i + 1).forEach(([x2, y2]) => { if (Math.hypot(x - x2, y - y2) < 260) out += `<path d="M${x} ${y}L${x2} ${y2}" stroke="#fff" stroke-opacity=".16"/>`; }));
      pts.forEach(([x, y], i) => { out += `<circle cx="${x}" cy="${y}" r="${i % 5 ? 7 : 14}" fill="${i % 5 ? '#fff' : [a, b, c][i % 3]}" fill-opacity="${i % 5 ? .55 : 1}"/>`; });
      return out;
    }
    case 'waves': {
      let out = '';
      for (let k = 0; k < 9; k++) {
        const amp = 40 + k * 9, phase = r() * 6, y0 = 170 + k * 42;
        let d = `M0 ${y0}`;
        for (let x = 0; x <= W; x += 20) d += `L${x} ${(y0 + Math.sin(x / 160 + phase) * amp * .6).toFixed(1)}`;
        out += `<path d="${d}" stroke="${k % 3 === 0 ? a : '#fff'}" stroke-opacity="${k % 3 === 0 ? .8 : .18}" stroke-width="${k % 3 === 0 ? 3 : 1.5}" fill="none"/>`;
      }
      return out;
    }
    case 'code': {
      let out = `<rect x="230" y="110" width="740" height="460" rx="18" fill="#0a0a0a" fill-opacity=".72" stroke="#fff" stroke-opacity=".14"/>`;
      out += [0, 1, 2].map(i => `<circle cx="${266 + i * 22}" cy="142" r="6" fill="#fff" fill-opacity=".22"/>`).join('');
      for (let i = 0; i < 10; i++) {
        let x = 270 + (i % 4 === 0 ? 0 : i % 3 === 0 ? 64 : 32); const y = 190 + i * 36;
        for (let j = 0; j < 1 + Math.floor(r() * 3); j++) { const w = 40 + r() * 170; out += `<rect x="${x}" y="${y}" width="${w}" height="14" rx="7" fill="${[a, b, c, '#fff'][Math.floor(r() * 4)]}" fill-opacity="${.45 + r() * .4}"/>`; x += w + 14; }
      }
      return out;
    }
    case 'stack': {
      let out = '';
      for (let i = 0; i < 5; i++) {
        const y = 430 - i * 70, x = 600;
        out += `<path d="M${x} ${y - 70}L${x + 230} ${y}L${x} ${y + 70}L${x - 230} ${y}Z" fill="${[a, b, c][i % 3]}" fill-opacity="${.12 + i * .1}" stroke="#fff" stroke-opacity=".35"/>`;
      }
      return out;
    }
    case 'chart': {
      let d = 'M120 520', area = 'M120 560L120 520', y = 520;
      for (let x = 120; x <= 1080; x += 40) { y = Math.max(140, y - (r() * 46 - 12)); d += `L${x} ${y.toFixed(1)}`; area += `L${x} ${y.toFixed(1)}`; }
      area += 'L1080 560Z';
      let grid = '';
      for (let gy = 160; gy <= 560; gy += 100) grid += `<path d="M120 ${gy}H1080" stroke="#fff" stroke-opacity=".08"/>`;
      return grid + `<path d="${area}" fill="url(#area)"/><path d="${d}" stroke="${a}" stroke-width="4" fill="none" stroke-linejoin="round"/>`;
    }
  }
}

/** An editorial cover: a dark field, two soft colour glows and one quiet geometric motif. */
export function cover(seed: number, kind: Motif, palette: Palette, width = W, height = H): string {
  const r = random(seed), [a, b] = palette;
  const g1 = [200 + r() * 300, 120 + r() * 200], g2 = [700 + r() * 400, 380 + r() * 250];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#121218"/><stop offset="1" stop-color="#07070a"/></linearGradient>
<radialGradient id="g1" cx="${g1[0]}" cy="${g1[1]}" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${a}" stop-opacity=".55"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
<radialGradient id="g2" cx="${g2[0]}" cy="${g2[1]}" r="560" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${b}" stop-opacity=".42"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient>
<linearGradient id="bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}" stop-opacity=".35"/></linearGradient>
<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}" stop-opacity=".45"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></linearGradient>
<radialGradient id="shine" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#g1)"/><rect width="${W}" height="${H}" fill="url(#g2)"/>
${motif(kind, palette, r)}
</svg>`;
}

/** A soft "marble" avatar: overlapping colour fields in a square, cropped to a circle by the app. */
export function avatar(seed: number, palette: Palette): string {
  const r = random(seed * 7919), [a, b, c] = palette;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 80 80">
<defs><filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter></defs>
<rect width="80" height="80" fill="${a}"/>
<g filter="url(#f)"><circle cx="${10 + r() * 60}" cy="${10 + r() * 30}" r="${22 + r() * 10}" fill="${b}"/><circle cx="${20 + r() * 50}" cy="${45 + r() * 30}" r="${18 + r() * 10}" fill="${c}"/><circle cx="${r() * 80}" cy="${r() * 80}" r="12" fill="#0b0b0f" fill-opacity=".5"/></g>
</svg>`;
}

/** A neutral site mark: one letter in a coloured rounded square (no real brand artwork). */
export function mark(letter: string, color: string, ink = '#fff'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="${color}"/>
<text x="32" y="44" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="36" fill="${ink}">${letter}</text>
</svg>`;
}
