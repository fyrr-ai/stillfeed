import { t } from './i18n';
import type { FailedSource, Source, SourceKind, XAccount } from './lib';

/** The sources list as data: rows, their order and the drawer's summary. Kept apart from the page so the feed
 *  can show the summary without loading the page and its controls. */
/** One line of the page: a feed source from /api/sources, an X account, or a failing collector without a switch. */
export type Row = { key: string; kind: SourceKind; name: string; detail: string; title?: string; articles: number | null; enabled: boolean; error: string | null; removable: boolean; search: string }
  & ({ type: 'source'; source: Source } | { type: 'account'; account: XAccount } | { type: 'collector' });

export type SourcesSummary = { total: number; on: number; attention: number };

/** "example.com/feed" or "youtube.com/channel/UC…": enough to tell two sources apart, without the scheme. */
export function address(url: string | null | undefined) {
  if (!url) return '';
  try {
    const u = new URL(url), host = u.hostname.replace(/^www\./, '');
    const channel = u.searchParams.get('channel_id');
    if (channel) return `${host}/channel/${channel}`;
    return host + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''));
  } catch { return url; }
}

/** Every row of the page; failing sources come from the source list and the last collection's status.
 *  `cache` keeps a row while its source or account object is unchanged, so a toggle re-renders one row, not 600. */
export function rowsOf(sources: Source[], accounts: XAccount[] | null, failed: FailedSource[], cache = new WeakMap<object, Row>()): Row[] {
  const failures = new Map(failed.map(f => [f.id, f.error]));
  const cached = <T extends object>(item: T, make: (item: T) => Row) => { let row = cache.get(item); if (!row) cache.set(item, row = make(item)); return row; };
  const rows: Row[] = sources.map(item => cached(item, source => {
    const kind = source.kind ?? 'rss', detail = kind === 'x' ? t('sources.detail.xFollows') : address(source.url) || t('sources.detail.collector');
    const error = (source.enabled ? source.error || failures.get(source.id) : null) || null;
    return { type: 'source', source, key: 's:' + source.id, kind, name: source.name, detail, title: source.url ?? undefined, articles: source.articles, enabled: Boolean(source.enabled), error, removable: kind === 'rss' || kind === 'youtube', search: `${source.name} ${source.url ?? ''}`.toLowerCase() };
  }));
  const known = new Set(sources.map(s => s.id));
  // Web collectors report failures under their own ids; they have no switch of their own here.
  for (const f of failed) if (!known.has(f.id)) rows.push({ type: 'collector', key: 'c:' + f.id, kind: 'web', name: f.name, detail: t('sources.detail.collector'), articles: null, enabled: true, error: f.error, removable: false, search: f.name.toLowerCase() });
  for (const item of accounts ?? []) rows.push(cached(item, account => ({ type: 'account', account, key: 'x:' + account.handle.toLowerCase(), kind: 'x', name: account.name && account.name !== account.handle ? account.name : '@' + account.handle, detail: '@' + account.handle, articles: null, enabled: account.enabled, error: null, removable: false, search: `${account.name ?? ''} @${account.handle}`.toLowerCase() })));
  return rows;
}

export function summarize(sources: Source[], accounts: XAccount[] | null, failed: FailedSource[]): SourcesSummary {
  const rows = rowsOf(sources, accounts, failed), switchable = rows.filter(r => r.type !== 'collector');
  return { total: switchable.length, on: switchable.filter(r => r.enabled).length, attention: rows.filter(r => r.error).length };
}
export const attentionText = (n: number) => n === 1 ? t('sources.attentionOne') : t('sources.attention', { n });

/** Needs attention keeps its own group; the rest is enabled by updates, then disabled, each by name. */
export const order = (a: Row, b: Row) => Number(b.enabled) - Number(a.enabled) || (b.articles ?? -1) - (a.articles ?? -1) || a.name.localeCompare(b.name);

export type SourcesFocus = 'heading' | 'url' | 'x';
