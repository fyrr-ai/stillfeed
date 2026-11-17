import type { ReactNode, SVGProps } from 'react';

/** One icon family for the whole interface: 24-unit grid, 1.75 stroke, round joins (Lucide-style outlines).
 *  Filled glyphs (the X logo) set their own fill. */
const glyphs = {
  menu: <><path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" /></>,
  close: <><path d="M18 6 6 18M6 6l12 12" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  back: <><path d="m12 19-7-7 7-7M19 12H5" /></>,
  up: <><path d="m5 12 7-7 7 7M12 19V5" /></>,
  next: <><path d="M5 12h14m-7-7 7 7-7 7" /></>,
  chevron: <><path d="m6 9 6 6 6-6" /></>,
  chevronRight: <><path d="m9 18 6-6-6-6" /></>,
  bookmark: <><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></>,
  article: <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8m8 4H8m8 4H8" /></>,
  video: <><path d="M6 3.5v17L20 12z" /></>,
  reddit: <><circle cx="12" cy="13" r="7" /><path d="M9 14h.01M15 14h.01M9.5 17a4 4 0 0 0 5 0M12 6l1-4 4 1.5" /><circle cx="18" cy="3.5" r="1" /></>,
  x: <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="currentColor" stroke="none" />,
  check: <><path d="M20 6 9 17l-5-5" /></>,
  checkAll: <><path d="M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4m0-4h.01" /></>,
  alert: <><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  external: <><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  refresh: <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" /></>,
  image: <><rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>,
  expand: <><path d="M15 3h6v6M9 21H3v-15M21 3l-7 7M3 21l7-7" /></>,
  reply: <><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" /></>,
  repost: <><path d="m2 9 3-3 3 3M13 18H7a2 2 0 0 1-2-2V6m17 9-3 3-3-3M11 6h6a2 2 0 0 1 2 2v10" /></>,
  like: <><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z" /></>,
  plus: <><path d="M5 12h14M12 5v14" /></>,
  trash: <><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6m4-6v6" /></>,
  sparkles: <><path d="M9.9 15.5a2 2 0 0 0-1.4-1.4L2.4 12.5a.5.5 0 0 1 0-1l6.1-1.6A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z" /></>,
  rss: <><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" /></>,
  globe: <><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" /></>,
  done: <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  hourglass: <><path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4A2 2 0 0 0 7 17.8V22M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4A2 2 0 0 0 17 6.2V2" /></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  flame: <><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.04 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.37 1.1-3.1.33 1.2 1.4 2.6 2.4 2.6z" /></>,
  saved: <><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /><path d="m9.5 11 2 2 3.5-4" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof glyphs;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>{glyphs[name]}</svg>;
}
