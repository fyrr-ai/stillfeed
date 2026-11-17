import type { Article, Filters } from '../src/store';
import { t } from './i18n';

export type { Article };
export type Feed = { items: Article[]; total: number; unseen: number; dismissed: string[]; batch: string; next: number | null; seenBefore: number; revision: number; generatedAt: string; filters: Filters };
export type Preferences = { view: 'feed' | 'saved'; scope: 'ai' | 'all'; kind: 'all' | 'article' | 'x'; q: string; hideSeen: boolean; savedTopic?: string };
export type Position = { id: string; offset: number };
export type Session = { preferences: Preferences; batch: string; pages: number; position: Position | null; seenBefore: number; revision: number; at?: number; legacyDismissals?: string[] };
export type Settings = { windowHours: number; refreshEvery: number; nightPause: boolean; retentionDays: number };
export type SourceKind = 'rss' | 'youtube' | 'web' | 'x';
export type Source = { id: string; name: string; enabled: number; articles: number; error?: string | null; url?: string; kind?: SourceKind };
export type FailedSource = { id: string; name: string; error: string };
export type XAccount = { handle: string; name?: string; enabled: boolean };
/** Server configuration as reported by GET /api/config: status only, never secrets. */
export type Config = { language: string; ai: { provider: 'anthropic' | 'openai' | 'codex' | null; model: string | null }; x: { configured: boolean } };
export type Summary = { points: string[]; model?: string; language?: string };
export type Status = { generatedAt: string; revision: number; refresh: string; importError: string | null; collection: { failed?: number | unknown[]; rss?: number }; preparation?: Record<string, number>; articles?: { total: number }; failedSources?: FailedSource[] };
export type HotItem = Article & { reason: string };
export type Reading = { title: string; author: string; html: string; url: string };

// Visibility records seen state; dismissing rows is always an explicit action.
export const defaults: Preferences = { view: 'feed', scope: 'ai', kind: 'all', q: '', hideSeen: true };
export const PAGE_SIZE = 30;

export async function api<T>(path: string, value?: unknown): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...(value !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Stillfeed': '1' }, body: JSON.stringify(value) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}

/** Polls an endpoint that answers {state:'pending'} while the background worker prepares the result. */
export async function prepared<T>(path: string, cancelled: () => boolean, body?: unknown): Promise<T> {
  const started = Date.now();
  let result = await api<T | { state: 'pending' }>(path, body);
  while (result && typeof result === 'object' && 'state' in result && result.state === 'pending') {
    if (cancelled()) throw new Error('Reading cancelled');
    if (Date.now() - started > 180000) throw new Error('Still preparing this article. Please try again shortly.');
    await new Promise(resolve => setTimeout(resolve, 1000));
    result = await api<T | { state: 'pending' }>(path);
  }
  return result as T;
}

export const link = (value: unknown) => { try { const u = new URL(String(value)); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
export const relative = (ms: number) => { const n = Math.max(0, (Date.now() - ms) / 1000); return n < 60 ? t('time.now') : n < 3600 ? t('time.minutes', { n: Math.floor(n / 60) }) : n < 86400 ? t('time.hours', { n: Math.floor(n / 3600) }) : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(ms); };
export const count = (n: unknown) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0);
/** Feed titles arrive HTML-escaped; decode entities to plain text, never to markup. */
export function headline(value: string) { const text = document.createElement('textarea'); text.innerHTML = value.replace(/</g, '&lt;').replace(/>/g, '&gt;'); return text.value; }

export function loadPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem('stillfeed-preferences') || 'null');
    if (saved) return { view: saved.view === 'saved' ? 'saved' : 'feed', scope: saved.scope === 'all' ? 'all' : 'ai', kind: ['article', 'x'].includes(saved.kind) ? saved.kind : 'all', q: typeof saved.q === 'string' ? saved.q.slice(0, 300) : '', hideSeen: saved.autoSeen === true ? saved.hideSeen !== false : true,
      ...(typeof saved.savedTopic === 'string' && /^([a-f0-9]{32}|ungrouped)$/.test(saved.savedTopic) ? { savedTopic: saved.savedTopic } : {}) };
  } catch {}
  return { ...defaults };
}
export function storePreferences(preferences: Preferences) { localStorage.setItem('stillfeed-preferences', JSON.stringify({ ...preferences, autoSeen: true })); }
export function loadSession(key: string, preferences?: Preferences, maxAge = Infinity): Session | null {
  try {
    const session = JSON.parse(sessionStorage.getItem(key) || 'null') as (Session & {dismissalVersion?:number;collapsed?:unknown}) | null;
    if (!session || !session.preferences || typeof session.batch !== 'string' || !Number.isInteger(session.pages) || session.pages < 1) return null;
    session.preferences.view ??= 'feed';
    if (preferences && JSON.stringify(session.preferences) !== JSON.stringify(preferences)) return null;
    if (Date.now() - (session.at ?? 0) > maxAge) return null;
    // Preserve explicit hides made by the previous UI; the next save writes only the batch ID.
    if(session.dismissalVersion===2&&Array.isArray(session.collapsed))session.legacyDismissals=session.collapsed.filter((id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id));
    return session;
  } catch { return null; }
}
export function loadOutbox(): Record<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem('stillfeed-outbox') || '{}');
    if (saved && typeof saved === 'object') return Object.fromEntries(Object.entries(saved).filter(([id, on]) => /^[a-f0-9]{32}$/.test(id) && typeof on === 'boolean')) as Record<string, boolean>;
  } catch {}
  return {};
}

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
/** Past the 90 px commit point a drag resists like a rubber band. */
export const COMMIT = 90;
export const resist = (distance: number) => distance <= COMMIT ? distance : COMMIT + (distance - COMMIT) * .3;
/** Gestures never start on controls, near the screen edges (system back) or while text is selected. */
export function gestureAllowed(target: EventTarget | null, x: number) {
  if (window.getSelection()?.toString() || x < 20 || x > innerWidth - 20 || !(target instanceof Element)) return false;
  if (document.querySelector('[data-slot$="dialog-content"][data-open], [data-slot="drawer-content"][data-open], dialog[open]')) return false;
  return !target.closest('button,input,textarea,select,summary,[role=switch],[role=combobox],video,audio,iframe,pre,table,[contenteditable]');
}

/** Videos and Reddit posts are articles with their own badge and reader extras. */
export function youtubeId(url: string) { try { const u = new URL(url); if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null; if (/(^|\.)youtube\.com$/.test(u.hostname)) return u.searchParams.get('v') || /^\/(shorts|live)\/([\w-]{11})/.exec(u.pathname)?.[2] || null; } catch {} return null; }
export const isReddit = (url: string) => { try { return /(^|\.)reddit\.com$/.test(new URL(url).hostname); } catch { return false; } };
export type Format = 'article' | 'video' | 'reddit';
export function articleFormat(url: string): { kind: Format; label: string } {
  if (youtubeId(url)) return { kind: 'video', label: t('card.video') };
  if (isReddit(url)) return { kind: 'reddit', label: t('card.reddit') };
  return { kind: 'article', label: t('card.article') };
}

/** Optional endpoints: a 404 from an older server means "not available", not an error. */
export async function optional<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (response.status === 404) return null;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data as T;
  } catch { return null; }
}
