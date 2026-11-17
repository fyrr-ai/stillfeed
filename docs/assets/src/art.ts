// Locally drawn SVG stand-ins for article previews, X avatars and site icons, so the README screenshots need no
// network and show no real person or brand artwork. Every picture is deterministic for its seed.

export type Palette = readonly [string, string, string];

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
