import type { ReactNode } from 'react';
import { link } from './lib';

type Link = { url?: string; href?: string; text?: string };

/** Post text: paragraphs with links, mentions and hashtags; React escapes everything else. */
export function RichText({ text, links, drop }: { text: unknown; links?: unknown; drop?: unknown }) {
  const parts = String(text || '').replace(/\r\n/g, '\n').split(/\n[ \t]*\n+/).filter(Boolean);
  return <>{parts.map((part, index) => <p key={index}>{inline(part, links, drop)}</p>)}</>;
}

function inline(text: string, links: unknown, drop: unknown): ReactNode[] {
  let body = text;
  if (Array.isArray(drop)) for (const d of drop) if (typeof d === 'string') body = body.split(d).join('');
  const known = new Map((Array.isArray(links) ? links as Link[] : []).map(l => [l.url, l]));
  const token = /(https?:\/\/[^\s]+)|((?<![\w@])@\w{1,15})|(#[\p{L}\p{N}_]+)/gu;
  const result: ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(token)) {
    result.push(body.slice(last, match.index));
    let value = match[0], href = '', tail = '';
    if (match[1]) {
      const trimmed = value.replace(/[)\].,;:!?'"”’»]+$/, '');
      tail = value.slice(trimmed.length); value = trimmed;
      const item = known.get(value); href = link(item?.href || value); value = item?.text || value;
    } else if (match[2]) href = `https://x.com/${value.slice(1)}`;
    else href = `https://x.com/hashtag/${encodeURIComponent(value.slice(1))}`;
    result.push(href ? <a key={match.index} href={href} target="_blank" rel="noopener noreferrer">{value}</a> : value, tail);
    last = match.index + match[0].length;
  }
  result.push(body.slice(last));
  return result;
}
