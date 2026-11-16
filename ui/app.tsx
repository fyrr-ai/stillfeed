import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { animate, motion, useMotionValue } from 'motion/react';
import { Drawer, DrawerBackdrop, DrawerContent, DrawerTrigger } from '@ui-sdk/react/drawer';
import { Toast, ToastAction, ToastRegion, ToastTitle, createToaster } from '@ui-sdk/react/toast';
import { Card, type CardActions } from './card';
import { Detail, type DetailRoute } from './detail';
import { EmptyState, SetupPanel, type EmptyKind } from './empty';
import { Icon } from './icons';
import { t } from './i18n';
import { Sidebar, type SettingsSection, type SidebarStatus } from './sidebar';
import {
  api, COMMIT, defaults, FRESH_AFTER, storePreferences, gestureAllowed, loadOutbox, loadPreferences, loadSession, optional, PAGE_SIZE, reducedMotion, resist,
  type Article, type Config, type Feed, type HotItem, type Preferences, type Session, type Settings, type Source, type Status,
} from './lib';

const detailPath = /^\/(article|post)\/([a-f0-9]{32})$/;
type Hint = { label: string; opacity: number; mode: 'back' | 'pull' } | null;
const SETUP_DISMISSED = 'radar-v2-setup-dismissed';

/** The gesture pill re-renders on every touch move, so it owns its state instead of the whole app. */
let showHint: (hint: Hint) => void = () => {};
function GestureHint() {
  const [hint, setHint] = useState<Hint>(null);
  useEffect(() => { showHint = setHint; return () => { showHint = () => {}; }; }, []);
  return <div id="gestureHint" className="gesture-hint" role="status" aria-live="polite" hidden={!hint} data-gesture={hint?.mode} style={{ opacity: hint?.opacity }}>{hint?.label}</div>;
}
let shownHint: string | null = null;
function hint(label: string | null, distance = 0, mode: 'back' | 'pull' = 'pull') {
  // Only re-render the pill when its text changes, not on every pointer move.
  if (label === shownHint) return;
  shownHint = label;
  if (!label) return showHint(null);
  showHint({ label, mode, opacity: Math.min(1, .4 + distance / 150) });
}

let sourcesChanged = false;
const toaster = createToaster();

/** Hot: a few must-not-miss picks with the reason; they leave only when opened or dismissed. */
function HotList({ items, loading, actions, dismiss }: { items: HotItem[]; loading: boolean; actions: CardActions; dismiss: (item: HotItem) => void }) {
  if (!items.length) return loading ? <p className="field-help hot-note">{t('hot.loading')}</p> : <section className="empty" id="hotEmpty"><span className="empty-glyph" aria-hidden="true"><Icon name="flame" size={26} /></span><h2>{t('hot.empty.title')}</h2>
    <p>{t('hot.empty.text')}</p></section>;
  return <section id="hot" aria-label={t('hot.label')}>{items.map(item => <div key={item.id} className="hot-item">
    <Card article={item} seen={item.seen} busy={false} actions={actions} note={{ label: t('hot.why'), text: item.reason, onDismiss: () => dismiss(item) }} />
  </div>)}</section>;
}

export function App() {
  const [prefs, setPrefsState] = useState(loadPreferences);
  const [items, setItemsState] = useState<Article[]>([]);
  const [feed, setFeedState] = useState<Feed | null>(null);
  const [loading, setLoadingState] = useState(false);
  const [booting, setBooting] = useState(true);
  const [failedNewView, setFailedState] = useState(false);
  const [message, setMessage] = useState('');
  const [syncFailed, setSyncFailed] = useState(false);
  const [status, setStatus] = useState<SidebarStatus & { refreshing: boolean; newUpdates: boolean }>({ updated: t('settings.updated.loading'), rss: 0, failed: [], preparation: null, importError: false, stored: null, revision: null, refreshing: false, newUpdates: false });
  // Server configuration and the source count drive first-run and the empty states; both are optional endpoints.
  const [config, setConfig] = useState<Config | null | undefined>(undefined);
  const [sourceCount, setSourceCount] = useState<number | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(() => localStorage.getItem(SETUP_DISMISSED) === '1');
  const [route, setRouteState] = useState<DetailRoute | null>(() => { const m = detailPath.exec(location.pathname); return m ? { kind: m[1] as 'article' | 'post', id: m[2]!, article: null } : null; });
  const [optionsOpen, setOptionsOpenState] = useState(false);
  const [settings, setSettingsState] = useState<Settings>({ windowHours: 72, refreshEvery: 2, nightPause: true, retentionDays: 30 });
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState(prefs.q);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [hotOpen, setHotOpenState] = useState(() => sessionStorage.getItem('radar-v2-tab') === 'hot' && !detailPath.test(location.pathname));
  const [hot, setHot] = useState<HotItem[]>([]);
  const [hotLoading, setHotLoading] = useState(true);
  // Unseen updates in the current snapshot: from the server on every page, then counted down locally.
  const [unseen, setUnseen] = useState(0);

  // Async flows (pagination, restore, polling) read the latest values through these refs.
  const r = useRef({
    prefs, items, feed, loading, failedNewView, route, optionsOpen, settings, pendingUpdates: false,
    outbox: loadOutbox(), pages: 0, request: 0, restoring: false, sending: false, refreshRequested: false,
    returnTo: (route ? { y: history.state?.feedY || 0, anchor: null } : null) as { y: number; anchor: HTMLElement | null } | null,
    timers: new Map<Element, ReturnType<typeof setTimeout>>(), focusSearch: false, focusSection: null as SettingsSection | null, confirmOpen: false, optionsScroll: 0, hotOpen, feedScroll: 0,
    /** Articles opened in the current snapshot: they stay out of it, also after a restore. */
    collapsed: new Set<string>(),
  }).current;
  const listRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const pullY = useMotionValue(0);

  const setPrefs = (next: Preferences) => { r.prefs = next; setPrefsState(next); setQuery(next.q); storePreferences(next); };
  const setItems = (next: Article[]) => { r.items = next; setItemsState(next); };
  const setFeed = (next: Feed | null) => { r.feed = next; setFeedState(next); };
  const setLoading = (on: boolean) => { r.loading = on; setLoadingState(on); };
  const setFailed = (on: boolean) => { r.failedNewView = on; setFailedState(on); };
  const setRoute = (next: DetailRoute | null) => { r.route = next; setRouteState(next); };
  const setSettings = (next: Settings) => { r.settings = next; setSettingsState(next); };
  const patchArticle = (id: string, patch: Partial<Article>) => {
    if (r.items.some(a => a.id === id)) setItems(r.items.map(a => a.id === id ? { ...a, ...patch } : a));
    if (r.route?.article?.id === id) setRoute({ ...r.route, article: { ...r.route.article, ...patch } });
  };

  // Seen means "was on screen for a second", never while options or the detail cover the feed.
  const unobscured = () => !document.hidden && !r.optionsOpen && !r.confirmOpen && !r.hotOpen && r.route === null;
  const observer = useMemo(() => new IntersectionObserver(entries => {
    for (const entry of entries) {
      const node = entry.target as HTMLElement, id = node.dataset.id!;
      const visible = entry.isIntersecting && (entry.intersectionRatio >= .5 || entry.intersectionRect.height >= (innerHeight - 100) * .5);
      if (visible && unobscured()) { if (!r.timers.has(node)) r.timers.set(node, setTimeout(() => { r.timers.delete(node); if (unobscured()) mark(id, true); }, 1000)); }
      else { clearTimeout(r.timers.get(node)); r.timers.delete(node); }
    }
  }, { rootMargin: '-100px 0px 0px', threshold: Array.from({ length: 21 }, (_, i) => i / 20) }), []);
  const unwatch = () => { observer.disconnect(); r.timers.forEach(clearTimeout); r.timers.clear(); };
  const watch = () => { unwatch(); if (!unobscured() || r.restoring) return; listRef.current?.querySelectorAll<HTMLElement>('.feed-card:not(.seen)').forEach(node => observer.observe(node)); };

  function mark(id: string, on: boolean) {
    const article = r.items.find(a => a.id === id) ?? (r.route?.article?.id === id ? r.route.article : undefined);
    if (article?.seen === on) return;
    r.outbox[id] = on; localStorage.setItem('radar-v2-outbox', JSON.stringify(r.outbox));
    if (article && r.items.some(a => a.id === id)) setUnseen(n => Math.max(0, n + (on ? -1 : 1)));
    patchArticle(id, { seen: on }); void flush();
  }
  async function flush() {
    if (r.sending || !Object.keys(r.outbox).length) return;
    r.sending = true;
    try {
      for (const on of [true, false]) {
        const ids = Object.keys(r.outbox).filter(id => r.outbox[id] === on).slice(0, 500);
        if (!ids.length) continue;
        await api('/api/seen', { ids, seen: on });
        ids.forEach(id => { if (r.outbox[id] === on) delete r.outbox[id]; });
        localStorage.setItem('radar-v2-outbox', JSON.stringify(r.outbox));
      }
      setSyncFailed(false);
    } catch { setSyncFailed(true); }
    finally { r.sending = false; if (Object.keys(r.outbox).length) setTimeout(() => void flush(), 5000); }
  }

  /** Remembers the view, batch, page count and the first visible row, so reloads land on the same item. */
  function save() {
    storePreferences(r.prefs);
    if (!r.feed || r.restoring || r.failedNewView || r.route) return;
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>('.feed-card') ?? [])].find(el => el.getBoundingClientRect().bottom > 100);
    const data: Session = { preferences: { ...r.prefs }, batch: r.feed.batch, pages: r.pages, position: row ? { id: row.dataset.id!, offset: row.getBoundingClientRect().top } : null, seenBefore: r.feed.seenBefore, revision: r.feed.revision, at: Date.now(), collapsed: [...r.collapsed] };
    sessionStorage.setItem('radar-v2-session', JSON.stringify(data));
    sessionStorage.setItem('radar-v2-session-' + r.prefs.view, JSON.stringify(data));
  }

  async function getPage(append: boolean, restore?: { batch: string; offset: number }) {
    if (r.loading && append) return;
    const request = append ? r.request : ++r.request;
    setFailed(false); setLoading(true);
    if (!append) setMessage('');
    try {
      const params = new URLSearchParams();
      if (restore) { params.set('batch', restore.batch); params.set('offset', String(restore.offset)); }
      else if (append && r.feed) { params.set('batch', r.feed.batch); params.set('offset', String(r.feed.next || 0)); }
      else {
        const p = r.prefs;
        params.set('saved', p.view === 'saved' ? '1' : '0'); params.set('scope', p.scope); params.set('kind', p.kind); params.set('q', p.q); params.set('hideSeen', p.hideSeen && p.view === 'feed' ? '1' : '0'); params.set('hours', String(r.settings.windowHours));
        if (r.feed && p.hideSeen && p.view === 'feed') { params.set('seenBefore', String(r.feed.seenBefore)); params.set('revision', String(r.feed.revision)); }
      }
      const result = await api<Feed>('/api/feed?' + params);
      if (request !== r.request) return;
      if (!Array.isArray(result.items) || !Number.isInteger(result.total) || typeof result.batch !== 'string') throw new Error('Invalid feed response');
      if (!append) { unwatch(); r.pages = 0; }
      // Commit synchronously: restoring a position measures the rows right after this call.
      if (!append && !restore) r.collapsed = new Set();
      // Seen marks still queued on this device count too, so a fresh snapshot never shows them.
      const visible = r.prefs.hideSeen && r.prefs.view === 'feed' ? result.items.filter(a => !r.collapsed.has(a.id) && !(!restore && !append && r.outbox[a.id] === true)) : result.items;
      flushSync(() => { setFeed(result); setUnseen(result.unseen); setItems(append ? [...r.items, ...visible] : visible); setLoading(false); setBooting(false); });
      r.pages++;
      watch(); save();
    } catch (error) {
      if (request !== r.request) return;
      flushSync(() => { setFailed(!append); if (!append) setItems([]); setLoading(false); setBooting(false); setMessage(error instanceof Error ? error.message : t('error.load')); });
      throw error;
    }
  }

  async function change(next: Partial<Preferences>, newSeenBatch = false) {
    setPrefs({ ...r.prefs, ...next });
    if (newSeenBatch) setFeed(null);
    await getPage(false).catch(() => {});
    window.scrollTo({ top: 0 });
  }

  /** Images settling above the restored card would push it away (Safari has no scroll anchoring), so keep it
   *  in place for a moment, until the reader touches, wheels or types. */
  function pinAnchor(id: string, offset: number) {
    const list = listRef.current; if (!list) return;
    let done = false, expected = scrollY;
    // Any scroll this pin did not make (finger, wheel, keys, code) ends it.
    const onScroll = () => { if (Math.abs(scrollY - expected) > 4) stop(); };
    const stop = () => { done = true; observer.disconnect(); removeEventListener('touchstart', stop); removeEventListener('wheel', stop); removeEventListener('keydown', stop); removeEventListener('scroll', onScroll); };
    const observer = new ResizeObserver(() => {
      if (done) return;
      const node = list.querySelector<HTMLElement>(`[data-id="${id}"]`);
      if (node && !r.route) { expected = Math.round(node.getBoundingClientRect().top + scrollY - offset); window.scrollTo(0, expected); expected = scrollY; }
    });
    observer.observe(list);
    addEventListener('touchstart', stop, { passive: true }); addEventListener('wheel', stop, { passive: true }); addEventListener('keydown', stop); addEventListener('scroll', onScroll, { passive: true });
    setTimeout(stop, 2500);
  }
  async function loadView(saved: Session | null, fresh = false) {
    r.collapsed = new Set(saved && !fresh ? saved.collapsed ?? [] : []);
    r.restoring = true; if (listRef.current) listRef.current.style.visibility = 'hidden';
    try {
      if (saved && !fresh) {
        try { for (let i = 0; i < Math.min(saved.pages, 100); i++) { await getPage(i > 0, { batch: saved.batch, offset: i * PAGE_SIZE }); if (r.feed?.next === null) break; } }
        catch { setFeed(null); await getPage(false); }
      } else {
        await getPage(false);
        if (saved) for (let i = 1; i < Math.min(saved.pages, 100) && r.feed?.next !== null; i++) await getPage(true);
      }
      const node = saved?.position ? listRef.current?.querySelector<HTMLElement>(`[data-id="${saved.position.id}"]`) : null;
      if (!r.route) window.scrollTo(0, node && saved?.position ? node.getBoundingClientRect().top + scrollY - saved.position.offset : 0);
      if (!r.route && node && saved?.position) pinAnchor(saved.position.id, saved.position.offset);
    } finally { r.restoring = false; if (listRef.current) listRef.current.style.visibility = 'visible'; watch(); save(); }
  }

  async function switchView(view: 'feed' | 'saved') {
    if (view === r.prefs.view) return;
    save();
    const saved = loadSession('radar-v2-session-' + view);
    setPrefs(saved ? { ...saved.preferences, view } : { ...defaults, view }); setFeed(null);
    await loadView(saved, view === 'saved'); await refreshStatus();
  }

  async function loadHot() {
    try { const { items } = await api<{ items: HotItem[] }>('/api/hot'); setHot(items); } catch { /* the badge simply stays as it was */ }
    finally { setHotLoading(false); }
  }
  /** Switching tabs keeps the feed mounted underneath, so its cards and scroll position survive a visit to Hot. */
  function setHotOpen(open: boolean) {
    if (open === r.hotOpen) return;
    if (open) { save(); r.feedScroll = scrollY; unwatch(); }
    r.hotOpen = open; sessionStorage.setItem('radar-v2-tab', open ? 'hot' : 'feed');
    flushSync(() => setHotOpenState(open));
    if (open) { window.scrollTo(0, 0); void loadHot(); } else { window.scrollTo(0, r.feedScroll); watch(); }
  }
  function openTab(tab: 'hot' | 'feed' | 'saved') {
    if (tab === 'hot') return setHotOpen(true);
    const same = tab === r.prefs.view;
    setHotOpen(false);
    if (!same) void switchView(tab);
  }
  async function dismissHot(item: HotItem) {
    setHot(list => list.filter(h => h.id !== item.id));
    try {
      await api(`/api/article/${item.id}/hot`, { dismissed: true });
      toaster.dismiss();
      toaster(t('hot.removed'), { action: { label: t('hot.undo'), onAction: async () => { await api(`/api/article/${item.id}/hot`, { dismissed: false }); await loadHot(); } } });
    } catch (error) { setMessage(error instanceof Error ? error.message : t('hot.error')); void loadHot(); }
  }

  /** Sidebar settings save as they change; a new feed window rebuilds the view. */
  async function applySettings(patch: Partial<Settings>) {
    const next = await api<Settings>('/api/settings', { ...r.settings, ...patch });
    const rebuild = next.windowHours !== r.settings.windowHours;
    setSettings(next);
    if (rebuild) { setFeed(null); await getPage(false).catch(() => {}); }
    void refreshStatus();
  }
  /** New data replaces the snapshot only while the reader is at the top; further down a small pill offers it. */
  function applyUpdates() {
    r.pendingUpdates = false; setStatus(s => ({ ...s, newUpdates: false }));
    setFeed(null); void getPage(false).then(() => window.scrollTo(0, 0)).catch(() => {});
  }
  const atTop = () => scrollY < 80 && unobscured() && r.prefs.view === 'feed';

  async function refreshStatus() {
    try {
      const data = await api<Status>('/api/status');
      const refreshing = data.refresh === 'running';
      let newUpdates = r.prefs.view !== 'saved' && r.feed !== null && r.feed.revision !== data.revision;
      if (r.refreshRequested && !refreshing) { r.refreshRequested = false; newUpdates ||= r.prefs.view === 'feed' && r.feed?.revision !== data.revision; }
      r.pendingUpdates = newUpdates;
      const generated = data.generatedAt ? new Date(data.generatedAt) : null;
      setStatus({
        updated: generated && !Number.isNaN(generated.getTime()) ? t('settings.updated', { time: new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }).format(generated) }) : t('settings.updated.loading'),
        rss: Number(data.collection.rss) || 0,
        failed: Array.isArray(data.failedSources) ? data.failedSources.filter(f => f && typeof f.id === 'string') : [],
        preparation: data.preparation ?? null, importError: Boolean(data.importError),
        stored: typeof data.articles?.total === 'number' ? data.articles.total : null, revision: Number.isFinite(data.revision) ? data.revision : null,
        refreshing, newUpdates,
      });
      if (newUpdates && atTop() && !r.loading) applyUpdates();
      if (data.refresh === 'failed') setMessage(t('error.refresh'));
    } catch { setMessage(t('error.status')); }
  }
  async function refresh() {
    try {
      if (r.prefs.view === 'saved') { setFeed(null); await getPage(false); return; }
      await api('/api/refresh', {}); r.refreshRequested = true; await refreshStatus();
    } catch (error) { setMessage(String(error)); }
  }

  async function saveArticle(article: Article, on: boolean, undoable = true) {
    setBusy(set => new Set(set).add(article.id)); setNotice('');
    try {
      await api(`/api/article/${article.id}/saved`, { saved: on });
      sessionStorage.removeItem('radar-v2-session-saved');
      patchArticle(article.id, { saved: on });
      // One toast at a time: a newer action replaces the previous Undo.
      toaster.dismiss();
      if (undoable) toaster(on ? t('toast.saved') : t('toast.unsaved'), { action: { label: t('toast.undo'), onAction: () => void latest.current.saveArticle(article, !on, false) } });
      if (!on && r.prefs.view === 'saved') { const y = scrollY; setFeed(null); await getPage(false); if (!r.route) window.scrollTo(0, y); }
    } catch (error) {
      const text = error instanceof Error ? error.message : t('reader.saveFailed');
      if (r.route) setNotice(text); else setMessage(text);
    } finally { setBusy(set => { const next = new Set(set); next.delete(article.id); return next; }); }
  }

  /** Marks the whole current view seen on the server (its batch), with Undo for exactly the rows that changed. */
  async function markAllSeen() {
    if (!r.feed) return;
    try {
      const { ids } = await api<{ ids: string[] }>('/api/seen-batch', { batch: r.feed.batch });
      const changed = new Set(ids);
      ids.forEach(id => { delete r.outbox[id]; }); localStorage.setItem('radar-v2-outbox', JSON.stringify(r.outbox));
      // Every row of the batch is seen on the server now, including rows this device had not caught up on.
      setItems(r.items.map(a => a.seen ? a : { ...a, seen: true })); setUnseen(0);
      if (r.prefs.hideSeen) { setFeed(null); await getPage(false).catch(() => {}); }
      toaster.dismiss();
      toaster(ids.length ? t('toast.markedSeen', { n: ids.length }) : t('toast.alreadySeen'), ids.length ? { action: { label: t('toast.undo'), onAction: async () => {
        for (let i = 0; i < ids.length; i += 2000) await api('/api/seen', { ids: ids.slice(i, i + 2000), seen: false });
        setItems(r.items.map(a => changed.has(a.id) ? { ...a, seen: false } : a)); setUnseen(n => n + ids.length);
        if (r.prefs.hideSeen) { setFeed(null); await getPage(false).catch(() => {}); }
        watch();
      } } } : undefined);
    } catch (error) { setMessage(error instanceof Error ? error.message : t('error.markSeen')); }
  }

  // Detail routing: the feed stays mounted underneath, so returning keeps every card and the scroll position.
  function openDetail(article: Article, from: HTMLElement | null, navigate = true) {
    const kind = article.kind === 'x' ? 'post' : 'article';
    if (navigate) {
      save(); r.returnTo = { y: scrollY, anchor: from };
      history.replaceState({ ...history.state, feedY: scrollY }, '', location.href);
      history.pushState({ fromFeed: true, feedY: scrollY }, '', `/${kind}/${article.id}`);
    }
    unwatch(); setNotice('');
    flushSync(() => setRoute({ kind, id: article.id, article }));
    document.title = kind === 'post' ? t('app.title.thread') : t('app.title.article', { title: article.title });
    window.scrollTo(0, 0); mark(article.id, true);
    setHot(list => list.filter(h => h.id !== article.id));
    void api(`/api/article/${article.id}/opened`, {}).catch(() => {});
  }
  /** The next feed item after the open one, so reading can continue without going back. */
  const nextAfter = (id: string | undefined) => { const at = r.items.findIndex(a => a.id === id); return at >= 0 ? r.items[at + 1] ?? null : null; };
  function openNext() {
    const current = r.route, next = nextAfter(current?.id);
    if (!current || !next) return;
    if (r.prefs.hideSeen && r.prefs.view === 'feed') { r.collapsed.add(current.id); setItems(r.items.filter(a => a.id !== current.id)); }
    // Replace, not push: Back still returns straight to the feed.
    history.replaceState({ ...history.state }, '', `/${next.kind === 'x' ? 'post' : 'article'}/${next.id}`);
    openDetail(next, null, false);
  }
  /** A new snapshot of the current view: seen updates are gone, the list starts at the top. */
  async function reloadFresh() {
    if (r.hotOpen) return void loadHot();
    if (r.route || r.prefs.view !== 'feed') return;
    await flush();
    setFeed(null); await getPage(false).catch(() => {}); window.scrollTo(0, 0);
  }
  function showFeed() {
    // The article just read leaves the feed right away; the rest of the list keeps its place.
    const opened = r.route?.id;
    flushSync(() => { setRoute(null); if (opened && r.prefs.hideSeen && r.prefs.view === 'feed') { r.collapsed.add(opened); setItems(r.items.filter(a => a.id !== opened)); } });
    document.title = t('app.name');
    window.scrollTo(0, history.state?.feedY ?? r.returnTo?.y ?? 0);
    r.returnTo?.anchor?.focus({ preventScroll: true }); watch(); save();
  }
  async function followRoute() {
    const match = detailPath.exec(location.pathname);
    if (!match) { if (r.route) showFeed(); return; }
    try {
      const article = r.items.find(a => a.id === match[2]) || await api<Article>(`/api/article/${match[2]}`);
      if (location.pathname === `/${match[1]}/${match[2]}`) openDetail(article, null, false);
    } catch { setRoute({ kind: match[1] as 'article' | 'post', id: match[2]!, article: null, missing: true }); }
  }
  function backToFeed() {
    if (history.state?.fromFeed) history.back();
    else { history.replaceState({ feedY: r.returnTo?.y || 0 }, '', '/'); showFeed(); }
  }

  const latest = useRef({ applyUpdates, atTop, reloadFresh, openDetail, saveArticle, mark, setMessage, backToFeed, refresh, getPage, watch, save, flush, refreshStatus, followRoute });
  latest.current = { applyUpdates, atTop, reloadFresh, openDetail, saveArticle, mark, setMessage, backToFeed, refresh, getPage, watch, save, flush, refreshStatus, followRoute };
  const actions = useMemo<CardActions>(() => ({
    open: (article, from) => latest.current.openDetail(article, from),
    save: (article, on) => void latest.current.saveArticle(article, on),
    opened: id => latest.current.mark(id, true),
    hint,
    error: text => latest.current.setMessage(text),
  }), []);

  useEffect(() => {
    history.scrollRestoration = 'manual';
    const l = () => latest.current;
    let hiddenAt = 0;
    const onVisibility = () => {
      l().watch();
      if (document.hidden) { hiddenAt = Date.now(); return; }
      void l().flush(); void l().refreshStatus();
      if (hiddenAt && Date.now() - hiddenAt > FRESH_AFTER) void l().reloadFresh();
    };
    const onPop = () => void l().followRoute();
    const onOnline = () => void l().flush();
    let saveTimer: ReturnType<typeof setTimeout>;
    let lastY = scrollY;
    const onScroll = () => {
      clearTimeout(saveTimer); saveTimer = setTimeout(() => l().save(), 150);
      // Like X: the bar slides away while reading down and returns on the first move up.
      const y = scrollY, delta = y - lastY; lastY = y;
      if (y < 60) setHeaderHidden(false); else if (delta > 6) setHeaderHidden(true); else if (delta < -6) setHeaderHidden(false);
      // Coming back to the top takes in waiting updates without a tap.
      if (r.pendingUpdates && l().atTop() && !r.loading) l().applyUpdates();
    };
    const onPageHide = () => l().save();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || (event.target as HTMLElement).closest('input,textarea,button,[role=switch],[role=combobox]') || r.optionsOpen || r.route) return;
      if (event.key === '/') { event.preventDefault(); openSearch(); }
      if (event.key === 'r') void l().refresh();
    };
    document.addEventListener('visibilitychange', onVisibility); addEventListener('popstate', onPop); addEventListener('online', onOnline);
    addEventListener('scroll', onScroll, { passive: true }); addEventListener('pagehide', onPageHide); document.addEventListener('keydown', onKey);
    const poll = setInterval(() => void l().refreshStatus(), 15000);
    // Infinite scroll: the Load more button doubles as the sentinel.
    const sentinel = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && !r.loading && !r.restoring && r.feed?.next != null && !r.failedNewView) void l().getPage(true).catch(() => {});
    }, { rootMargin: '300px' });
    if (moreRef.current) sentinel.observe(moreRef.current);
    void (async () => {
      try {
        setSettings(await api<Settings>('/api/settings'));
        void optional<Config>('/api/config').then(value => setConfig(value && typeof value === 'object' && 'ai' in value ? value : null));
        void optional<Source[]>('/api/sources').then(list => { if (Array.isArray(list)) setSourceCount(list.length); });
        // A session older than FRESH_AFTER starts over, so what was seen last time is gone.
        await loadView(loadSession('radar-v2-session', r.prefs, FRESH_AFTER), r.prefs.view === 'saved');
        void loadHot();
        await refreshStatus(); void flush(); save(); await followRoute();
      } catch (error) { setMessage(error instanceof Error ? error.message : t('error.open')); setBooting(false); }
    })();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility); removeEventListener('popstate', onPop); removeEventListener('online', onOnline);
      removeEventListener('scroll', onScroll); removeEventListener('pagehide', onPageHide); document.removeEventListener('keydown', onKey);
      clearInterval(poll); sentinel.disconnect(); unwatch();
    };
  }, []);

  // Debounced search keeps typing responsive.
  useEffect(() => {
    if (query === r.prefs.q) return;
    const timer = setTimeout(() => void change({ q: query.slice(0, 300) }), 180);
    return () => clearTimeout(timer);
  }, [query]);

  // Pull to refresh at the top of the feed: the list follows the finger, then springs back.
  // Plain touch events: a drag library would fight native scrolling here, and only touch can pull.
  const refreshingRef = useRef(false); refreshingRef.current = status.refreshing;
  useEffect(() => {
    const reader = readerRef.current!;
    let start: { x: number; y: number } | null = null, pulling = false, distance = 0;
    const reset = () => { start = null; pulling = false; hint(null); animate(pullY, 0, reducedMotion.matches ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }); };
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0]!;
      start = event.touches.length === 1 && scrollY <= 0 && unobscured() && !refreshingRef.current && gestureAllowed(event.target, touch.clientX) ? { x: touch.clientX, y: touch.clientY } : null;
      pulling = false; distance = 0;
    };
    const onMove = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.touches[0]!, dx = touch.clientX - start.x, dy = touch.clientY - start.y;
      if (event.touches.length > 1 || Math.abs(dx) > 65 || (!pulling && dy < 0) || (pulling && scrollY > 0)) { reset(); return; }
      // Claim the gesture before Safari starts its own overscroll bounce.
      if (!pulling && dy < 12) { if (dy > 0 && event.cancelable) event.preventDefault(); return; }
      pulling = true; distance = dy;
      if (event.cancelable) event.preventDefault();
      hint(dy >= COMMIT ? t('gesture.release') : t('gesture.pull'), dy, 'pull');
      if (!reducedMotion.matches) pullY.set(resist(dy) * .6);
    };
    const onEnd = () => { const go = pulling && distance >= COMMIT; if (start || pulling) reset(); if (go) { void latest.current.reloadFresh(); void latest.current.refresh(); } };
    const onCancel = () => { if (start || pulling) reset(); };
    reader.addEventListener('touchstart', onStart, { passive: true });
    reader.addEventListener('touchmove', onMove, { passive: false });
    reader.addEventListener('touchend', onEnd);
    reader.addEventListener('touchcancel', onCancel);
    return () => { reader.removeEventListener('touchstart', onStart); reader.removeEventListener('touchmove', onMove); reader.removeEventListener('touchend', onEnd); reader.removeEventListener('touchcancel', onCancel); };
  }, []);

  function setOptionsOpen(open: boolean) { r.optionsOpen = open; setOptionsOpenState(open); unwatch(); }
  /** Releasing the drawer's scroll lock (a style change on <html>) can drop the page elsewhere on phones;
   *  for that one release, put the reader back where they were. */
  function keepReadingPosition() {
    const target = r.optionsScroll, until = Date.now() + 1500;
    const restore = () => { if (Date.now() < until && !r.route && Math.abs(scrollY - target) > 2) window.scrollTo(0, target); };
    const observer = new MutationObserver(() => { restore(); requestAnimationFrame(restore); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    setTimeout(() => observer.disconnect(), 1500);
  }
  function openSearch() { r.focusSearch = true; setOptionsOpen(true); }
  function openSettings(section: SettingsSection) { r.focusSection = section; setOptionsOpen(true); }
  function dismissSetup() { localStorage.setItem(SETUP_DISMISSED, '1'); setSetupDismissed(true); }

  const view = prefs.view;
  const total = feed?.total ?? 0;
  const progress = feed ? t('feed.progress', { shown: items.length, total }) : '';
  const formatLabels = { all: t('format.all'), article: t('format.article'), x: t('format.x') } as const;
  const filterText = [view !== 'saved' && prefs.scope === 'all' ? t('feed.filters.everything') : '', prefs.kind !== 'all' ? formatLabels[prefs.kind] : '', view === 'feed' && !prefs.hideSeen ? t('feed.filters.showingSeen') : '', prefs.q ? t('feed.filters.search', { q: prefs.q }) : ''].filter(Boolean).join(' · ');
  const empty = !loading && !booting && feed && !total;
  const feedRefreshing = status.refreshing && view === 'feed';
  const emptyKind: EmptyKind | null = !empty ? null : prefs.q ? 'noResults' : view === 'saved' ? 'nothingSaved' : sourceCount === 0 ? 'noSources' : status.stored === 0 ? 'collecting' : prefs.hideSeen ? 'caughtUp' : 'noUpdates';
  // First run: the panel leads the feed until sources, X and AI are set up, or until it is hidden.
  const setupNeeded = sourceCount === 0 || (config ? !config.ai.provider || !config.x.configured : false);
  const showSetup = view === 'feed' && !hotOpen && !booting && setupNeeded && !setupDismissed && emptyKind !== 'noSources';

  return <>
    <a className="skip" href="#feed">{t('skip')}</a>
    <div id="readerOptions" hidden={route !== null}>
      <header className={`topbar${headerHidden ? ' topbar-hidden' : ''}`}>
        <a className="brand" href="/" aria-label={t('app.name')} onClick={event => { event.preventDefault(); openTab('feed'); window.scrollTo({ top: 0 }); }}><Icon name="radar" size={20} /><span>{t('app.name')}</span></a>
        <nav className="view-tabs" aria-label={t('tabs.label')}>
          <button id="viewHot" aria-pressed={hotOpen} onClick={() => openTab('hot')}>{t('tabs.hot')}{hot.length > 0 && <span className="tab-count" aria-label={t('tabs.count', { n: hot.length })}>{hot.length}</span>}</button>
          <button id="viewFeed" aria-pressed={!hotOpen && view === 'feed'} onClick={() => openTab('feed')}>{t('tabs.feed')}</button>
          <button id="viewSaved" aria-pressed={!hotOpen && view === 'saved'} onClick={() => openTab('saved')}>{t('tabs.saved')}</button>
        </nav>
        <div className="top-actions">
          <Drawer side="right" open={optionsOpen} onOpenChange={open => { if (open) r.optionsScroll = scrollY; else keepReadingPosition(); setOptionsOpen(open); }} onOpenChangeComplete={open => {
            if (open && r.focusSearch) { r.focusSearch = false; document.getElementById('searchInput')?.focus(); }
            if (open && r.focusSection) {
              const section = r.focusSection; r.focusSection = null;
              document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
              if (section === 'sources') document.getElementById('addSourceUrl')?.focus({ preventScroll: true });
            }
            if (!open && sourcesChanged) { sourcesChanged = false; setFeed(null); void getPage(false).catch(() => {}); void optional<Source[]>('/api/sources').then(list => { if (Array.isArray(list)) setSourceCount(list.length); }); }
            watch(); save();
          }}>
            <DrawerTrigger className="icon-button" aria-label={t('options.open')} title={t('options.open')}><Icon name="menu" /></DrawerTrigger>
            <DrawerBackdrop className="side-backdrop" />
            <DrawerContent id="optionsSheet" className="sidebar">
              <Sidebar prefs={prefs} query={query} setQuery={setQuery} change={(next, fresh) => void change(next, fresh)} settings={settings} applySettings={applySettings}
                status={status} refreshing={feedRefreshing} refresh={() => void refresh()} sourcesChanged={() => { sourcesChanged = true; }} notify={text => toaster(text)}
                config={config} counts={!hotOpen && view === 'feed' && feed ? { unseen, total } : null}
                markAll={() => void markAllSeen()} onConfirmOpen={open => { r.confirmOpen = open; if (open) unwatch(); }} onConfirmSettled={() => watch()}
                sourcesLoaded={list => setSourceCount(list.length)} />
            </DrawerContent>
          </Drawer>
        </div>
      </header>
      <main className="reader" ref={readerRef}>
        {hotOpen && <HotList items={hot} loading={hotLoading} actions={actions} dismiss={item => void dismissHot(item)} />}
        <div id="feedView" hidden={hotOpen}>
        <div id="filterSummary" className="filter-summary" hidden={!filterText}><span id="filterText">{filterText}</span><button id="clearFilters" onClick={() => void change({ ...defaults, view }, true)}>{t('feed.filters.clear')}</button></div>
        <button id="newUpdates" className="new-updates" hidden={!status.newUpdates || view === 'saved'} onClick={applyUpdates}><Icon name="up" size={15} />{t('feed.newPosts')}</button>
        <p id="syncNote" className="notice" hidden={!syncFailed}>{t('feed.offline')}</p>
        <p id="message" className="notice error" role="alert" hidden={!message}>{message}</p>
        {showSetup && <SetupPanel sources={sourceCount} config={config} open={openSettings} dismiss={dismissSetup} />}
        <div id="loading" className="skeleton" aria-label={t('feed.loading')} hidden={!booting}><div></div><div></div><div></div></div>
        <motion.section id="feed" ref={listRef} aria-label={t('feed.label')} style={{ y: pullY }}>
          {items.map(article => <Card key={article.id} article={article} seen={article.seen || r.outbox[article.id] === true} busy={busy.has(article.id)} actions={actions} />)}
        </motion.section>
        {emptyKind === 'noSources' && <SetupPanel sources={sourceCount} config={config} open={openSettings} />}
        {emptyKind && <EmptyState kind={emptyKind} refreshing={status.refreshing} reset={() => void change({ ...defaults, view }, true)} refresh={() => void refresh()} showSeen={() => void change({ hideSeen: false }, true)} openSettings={openSettings} />}
        <footer className="feed-footer" hidden={Boolean(empty)}>
          <p id="progress">{progress}</p>
          <button id="loadMore" ref={moreRef} className="secondary-button" hidden={!failedNewView && (!feed || feed.next === null)} disabled={loading && !failedNewView} onClick={() => void getPage(!failedNewView && Boolean(feed && feed.next !== null)).catch(() => {})}>{failedNewView ? t('feed.retry') : loading ? t('feed.loadingMore') : t('feed.loadMore')}</button>
          <p id="endNote" hidden={!feed || feed.next !== null}>{total ? t('feed.end') : t('feed.none')}</p>
        </footer>
        </div>
      </main>
    </div>
    <Detail route={route} busy={route ? busy.has(route.id) : false} notice={notice} actions={actions} back={backToFeed} next={route ? nextAfter(route.id) : null} onNext={openNext} language={config?.language ?? ''} />
    <GestureHint />
    <ToastRegion toaster={toaster} className="toast-region">{() => <Toast className="toast"><ToastTitle className="toast-title" /><ToastAction className="toast-action" /></Toast>}</ToastRegion>
  </>;
}
