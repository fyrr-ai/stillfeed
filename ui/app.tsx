import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { loadChrome, toast } from './notify';
import { Card, type CardActions } from './card';
import type { DetailRoute } from './detail';
import { EmptyState, SetupPanel, type EmptyKind, type SetupStep } from './empty';
import { Icon } from './icons';
import { t } from './i18n';
import type { SidebarStatus } from './sidebar';
import type { ChatContext } from '../src/chat';
import { summarize, type SourcesFocus } from './source-rows';
// The reader (with motion), the settings and the sources page load on first use; the feed needs none of them.
const loadDetail = () => import('./detail'), loadSidebar = () => import('./sidebar'), loadSources = () => import('./sources');
const Detail = lazy(() => loadDetail().then(m => ({ default: m.Detail })));
const Sidebar = lazy(() => loadSidebar().then(m => ({ default: m.Sidebar })));
const SourcesPage = lazy(() => loadSources().then(m => ({ default: m.SourcesPage })));
const SavedTopicsPanel = lazy(() => import('./saved-topics').then(m => ({ default: m.SavedTopicsPanel })));
const SeenCounter = lazy(() => import('./seen-counter').then(m => ({ default: m.SeenCounter })));
const loadChat = () => import('./chat');
const ChatPanel = lazy(() => loadChat().then(m => ({ default: m.ChatPanel })));
// A second after the feed is on screen, when the browser is idle, fetch them anyway, so the first tap never
// waits; earlier, they would compete with the feed itself for a slow phone's bandwidth.
const idle = (work: () => void) => 'requestIdleCallback' in window ? requestIdleCallback(work, { timeout: 4000 }) : setTimeout(work, 1500);
const prefetch = () => Promise.all([loadChrome(), loadDetail(), loadSidebar(), loadSources()]);
import {
  api, COMMIT, defaults, storePreferences, gestureAllowed, loadOutbox, loadPreferences, loadSession, optional, PAGE_SIZE, reducedMotion, resist,
  type Article, type Config, type Feed, type Preferences, type Session, type Settings, type Source, type Status, type XAccount,
} from './lib';

const detailPath = /^\/(article|post)\/([a-f0-9]{32})$/;
const SOURCES_PATH = '/sources';
type Hint = { label: string; opacity: number; mode: 'back' | 'pull' } | null;
const SETUP_DISMISSED = 'stillfeed-setup-dismissed';

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

const OptionsDrawer = lazy(() => loadChrome().then(m => ({ default: m.OptionsDrawer })));
const Toasts = lazy(() => loadChrome().then(m => ({ default: m.Toasts })));

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
  // Server configuration and the source list drive first-run, the empty states and the Sources row; both are optional endpoints.
  const [config, setConfig] = useState<Config | null | undefined>(undefined);
  const [library, setLibrary] = useState<{ sources: Source[]; accounts: XAccount[] | null } | null>(null);
  const [sourcesOpen, setSourcesOpenState] = useState(() => location.pathname === SOURCES_PATH);
  const [sourcesFocus, setSourcesFocus] = useState<SourcesFocus>('heading');
  const [setupDismissed, setSetupDismissed] = useState(() => localStorage.getItem(SETUP_DISMISSED) === '1');
  const [route, setRouteState] = useState<DetailRoute | null>(() => { const m = detailPath.exec(location.pathname); return m ? { kind: m[1] as 'article' | 'post', id: m[2]!, article: null } : null; });
  // The reader (and motion with it) is fetched the first time an article opens, not on start.
  const [readerUsed, setReaderUsed] = useState(() => route !== null);
  if (route && !readerUsed) setReaderUsed(true);
  const [optionsOpen, setOptionsOpenState] = useState(false);
  const [chat, setChat] = useState<{context: ChatContext; returnFocus: string} | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  /** A toast mounts the toast region first if its module has not arrived yet. */
  const notify: typeof toast = (text, options) => { setChromeReady(true); toast(text, options); };
  // Until the drawer's code is here, the menu is a plain button that loads it.
  const menuButton = <button id="optionsButton" className="icon-button" aria-label={t('options.open')} title={t('options.open')} aria-haspopup="dialog" onClick={() => openOptions()}><Icon name="menu" size={18} /></button>;
  // UI SDK's drawer and toasts mount once their module is here (idle prefetch, a toast, or the menu button).
  const [chromeReady, setChromeReady] = useState(false);
  const [settings, setSettingsState] = useState<Settings>({ windowHours: 72, refreshEvery: 2, nightPause: true, retentionDays: 30 });
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState(prefs.q);
  const [counterOpen, setCounterOpen] = useState(false);
  const [hidingViewed, setHidingViewed] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(() => scrollY > 300);
  // Unseen updates in the current snapshot: from the server on every page, then counted down locally.
  const [unseen, setUnseen] = useState(0);

  // Async flows (pagination, restore, polling) read the latest values through these refs.
  const r = useRef({
    prefs, items, feed, loading, failedNewView, route, sourcesOpen, sourcesChanged: false, optionsOpen, chatOpen: false, settings, hidingViewed: false,
    outbox: loadOutbox(), pages: 0, request: 0, restoring: false, sending: false, refreshRequested: false,
    returnTo: (route || sourcesOpen ? { y: history.state?.feedY || 0, anchor: null } : null) as { y: number; anchor: HTMLElement | null } | null,
    timers: new Map<Element, ReturnType<typeof setTimeout>>(), focusSearch: false, focusAI: false, confirmOpen: false, optionsScroll: 0,
    /** Explicitly hidden rows in the active snapshot. */
    collapsed: new Set<string>(),
  }).current;
  const counterOpenRef = useRef(false); counterOpenRef.current = counterOpen;
  const listRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  // Pull to refresh moves the list with a plain transform; motion stays in the lazily loaded reader.
  const pull = (y: number, settle = false) => { const feed = listRef.current; if (!feed) return; feed.style.transition = settle && !reducedMotion.matches ? 'transform .32s cubic-bezier(.2,.9,.3,1.15)' : 'none'; feed.style.transform = y ? `translateY(${y}px)` : ''; };

  const setPrefs = (next: Preferences) => { r.prefs = next; setPrefsState(next); setQuery(next.q); storePreferences(next); };
  const setItems = (next: Article[]) => { r.items = next; setItemsState(next); };
  const setFeed = (next: Feed | null) => { r.feed = next; setFeedState(next); };
  const setLoading = (on: boolean) => { r.loading = on; setLoadingState(on); };
  const setFailed = (on: boolean) => { r.failedNewView = on; setFailedState(on); };
  const setRoute = (next: DetailRoute | null) => { r.route = next; setRouteState(next); };
  const setSourcesOpen = (open: boolean) => { r.sourcesOpen = open; setSourcesOpenState(open); };
  /** The detail or the Sources page covers the feed, which stays mounted underneath. */
  const covered = () => r.route !== null || r.sourcesOpen;
  const setSettings = (next: Settings) => { r.settings = next; setSettingsState(next); };
  const patchArticle = (id: string, patch: Partial<Article>) => {
    if (r.items.some(a => a.id === id)) setItems(r.items.map(a => a.id === id ? { ...a, ...patch } : a));
    if (r.route?.article?.id === id) setRoute({ ...r.route, article: { ...r.route.article, ...patch } });
  };

  // Seen means "was on screen for a second", never while options or the detail cover the feed.
  const unobscured = () => !document.hidden && !r.optionsOpen && !r.chatOpen && !counterOpenRef.current && !r.confirmOpen && !covered();
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

  useEffect(() => { watch(); }, [counterOpen]);

  function mark(id: string, on: boolean) {
    const article = r.items.find(a => a.id === id) ?? (r.route?.article?.id === id ? r.route.article : undefined);
    if (article?.seen === on) return;
    r.outbox[id] = on; localStorage.setItem('stillfeed-outbox', JSON.stringify(r.outbox));
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
        localStorage.setItem('stillfeed-outbox', JSON.stringify(r.outbox));
      }
      setSyncFailed(false);
    } catch { setSyncFailed(true); }
    finally { r.sending = false; if (Object.keys(r.outbox).length) setTimeout(() => void flush(), 5000); }
  }

  /** Remembers the view, batch, page count and the first visible row, so reloads land on the same item. */
  function save() {
    storePreferences(r.prefs);
    if (!r.feed || r.restoring || r.failedNewView || covered()) return;
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>('.feed-card') ?? [])].find(el => el.getBoundingClientRect().bottom > 100);
    const data: Session = { preferences: { ...r.prefs }, batch: r.feed.batch, pages: r.pages, position: row ? { id: row.dataset.id!, offset: row.getBoundingClientRect().top } : null, seenBefore: r.feed.seenBefore, revision: r.feed.revision, at: Date.now(), personalBatch: r.feed.filters.personalBatch };
    sessionStorage.setItem('stillfeed-session', JSON.stringify(data));
    sessionStorage.setItem('stillfeed-session-' + r.prefs.view, JSON.stringify(data));
  }

  async function getPage(append: boolean, restore?: { batch: string; offset: number }, limit=PAGE_SIZE) {
    if (r.loading && append) return;
    const request = append ? r.request : ++r.request;
    setFailed(false); setLoading(true);
    if (!append) setMessage('');
    try {
      const params = new URLSearchParams();
      if(limit>PAGE_SIZE)params.set('limit',String(limit));
      if (restore) { params.set('batch', restore.batch); params.set('offset', String(restore.offset)); }
      else if (append && r.feed) { params.set('batch', r.feed.batch); params.set('offset', String(r.feed.next || 0)); }
      else {
        const p = r.prefs;
        params.set('saved', p.view === 'saved' ? '1' : '0'); params.set('personal', p.view === 'hot' ? '1' : '0'); params.set('scope', p.scope); params.set('kind', p.kind); params.set('q', p.q); params.set('hideSeen', '0');
        if (p.view === 'hot') { const base=loadSession('stillfeed-session-feed'); if(base)params.set('from',base.batch); }
        if (p.view === 'saved' && p.savedTopic) params.set('topic', p.savedTopic);
        // The server applies the configured feed window itself, so the first page need not wait for /api/settings.
        if (r.feed && p.view === 'feed') { params.set('seenBefore', String(r.feed.seenBefore)); params.set('revision', String(r.feed.revision)); }
      }
      const result = await api<Feed>('/api/feed?' + params);
      if (request !== r.request) return;
      if (!Array.isArray(result.items) || !Number.isInteger(result.total) || typeof result.batch !== 'string') throw new Error('Invalid feed response');
      if(r.prefs.view==='hot'&&result.filters.personalBatch&&loadSession('stillfeed-session-feed')?.batch!==result.filters.personalBatch){
        const base=await api<Feed>('/api/feed?batch='+result.filters.personalBatch);
        if(request!==r.request)return;
        const session:Session={preferences:{...defaults,view:'feed',scope:base.filters.scope,kind:base.filters.kind,q:base.filters.q},batch:base.batch,pages:1,position:null,seenBefore:base.seenBefore,revision:base.revision,at:Date.now()};
        sessionStorage.setItem('stillfeed-session-feed',JSON.stringify(session));
      }
      if (!append) { unwatch(); r.pages = 0; }
      // Commit synchronously: restoring a position measures the rows right after this call.
      r.collapsed = new Set(result.dismissed ?? []);
      // Only explicit dismissals leave the current snapshot.
      const visible = r.prefs.view !== 'saved' ? result.items.filter(a => !r.collapsed.has(a.id)) : result.items;
      flushSync(() => { setFeed(result); setUnseen(result.unseen); setItems(append ? [...r.items, ...visible] : visible); setLoading(false); setBooting(false); });
      r.pages+=Math.max(1,Math.ceil(result.items.length/PAGE_SIZE));
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
      if (node && !covered()) { expected = Math.round(node.getBoundingClientRect().top + scrollY - offset); window.scrollTo(0, expected); expected = scrollY; }
    });
    observer.observe(readerRef.current ?? list);
    addEventListener('touchstart', stop, { passive: true }); addEventListener('wheel', stop, { passive: true }); addEventListener('keydown', stop); addEventListener('scroll', onScroll, { passive: true });
    setTimeout(stop, 2500);
  }
  async function loadView(saved: Session | null, fresh = false) {
    if(r.prefs.view==='hot'){
      const base=loadSession('stillfeed-session-feed');
      if(base&&saved?.personalBatch!==base.batch){setPrefs({...base.preferences,view:'hot'});saved=null;}
    }
    r.collapsed = new Set();
    r.restoring = true; if (listRef.current) listRef.current.style.visibility = 'hidden';
    try {
      if (saved && !fresh) {
        try {
          if (saved.legacyDismissals?.length) await api(`/api/feed/${saved.batch}/hide-seen`, {action: saved.batch, ids: saved.legacyDismissals});
          await getPage(false,{batch:saved.batch,offset:0},Math.min(saved.pages,100)*PAGE_SIZE);
        }
        catch { setFeed(null); await getPage(false); }
      } else {
        await getPage(false,undefined,Math.min(saved?.pages??1,100)*PAGE_SIZE);
      }
      const node = saved?.position ? listRef.current?.querySelector<HTMLElement>(`[data-id="${saved.position.id}"]`) : null;
      if (!covered()) window.scrollTo(0, node && saved?.position ? node.getBoundingClientRect().top + scrollY - saved.position.offset : 0);
      if (!covered() && node && saved?.position) pinAnchor(saved.position.id, saved.position.offset);
    } finally { r.restoring = false; if (listRef.current) listRef.current.style.visibility = 'visible'; watch(); save(); }
  }

  async function switchView(view: Preferences['view']) {
    if (view === r.prefs.view) return;
    save();
    const saved = loadSession('stillfeed-session-' + view);
    setPrefs(saved ? { ...saved.preferences, view } : { ...defaults, view }); setFeed(null);
    await loadView(saved, view === 'saved'); await refreshStatus();
  }

  function openTab(tab: Preferences['view']) {
    setCounterOpen(false);
    void switchView(tab);
  }
  /** Sidebar settings save as they change; a new feed window rebuilds the view. */
  async function applySettings(patch: Partial<Settings>) {
    const next = await api<Settings>('/api/settings', { ...r.settings, ...patch });
    const rebuild = next.windowHours !== r.settings.windowHours;
    setSettings(next);
    if (rebuild) { setFeed(null); await getPage(false).catch(() => {}); }
    void refreshStatus();
  }
  /** New data always waits for an explicit tap, including at the top. */
  function applyUpdates() {
    setStatus(s => ({ ...s, newUpdates: false }));
    setFeed(null); void getPage(false).then(() => window.scrollTo(0, 0)).catch(() => {});
  }

  async function refreshStatus() {
    try {
      const data = await api<Status>('/api/status');
      const refreshing = data.refresh === 'running';
      let newUpdates = r.prefs.view === 'feed' && r.feed !== null && r.feed.revision !== data.revision;
      if(r.prefs.view==='hot'&&r.feed&&data.personal)newUpdates ||= r.feed.filters.personalRevision !== data.personal.revision;
      if (r.refreshRequested && !refreshing) { r.refreshRequested = false; newUpdates ||= r.prefs.view === 'feed' && r.feed?.revision !== data.revision; }
      const generated = data.generatedAt ? new Date(data.generatedAt) : null;
      const failed = Array.isArray(data.failedSources) ? data.failedSources.filter(f => f && typeof f.id === 'string') : [];
      // The same failures keep the same array, so the Sources page does not rebuild its rows on every poll.
      setStatus(previous => ({
        updated: generated && !Number.isNaN(generated.getTime()) ? t('settings.updated', { time: new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }).format(generated) }) : t('settings.updated.loading'),
        rss: Number(data.collection.rss) || 0,
        failed: JSON.stringify(failed) === JSON.stringify(previous.failed) ? previous.failed : failed,
        preparation: data.preparation ?? null, importError: Boolean(data.importError),
        stored: typeof data.articles?.total === 'number' ? data.articles.total : null, revision: Number.isFinite(data.revision) ? data.revision : null,
        refreshing, newUpdates,
      }));
      if (data.refresh === 'failed') setMessage(t('error.refresh'));
      else setMessage(current => current === t('error.refresh') ? '' : current);
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
      sessionStorage.removeItem('stillfeed-session-saved');
      patchArticle(article.id, { saved: on });
      // One toast at a time: a newer action replaces the previous Undo.
      if (undoable) notify(on ? t('toast.saved') : t('toast.unsaved'), { action: { label: t('toast.undo'), onAction: () => void latest.current.saveArticle(article, !on, false) } });
      if (!on && r.prefs.view === 'saved') { const y = scrollY; setFeed(null); await getPage(false); if (!covered()) window.scrollTo(0, y); }
    } catch (error) {
      const text = error instanceof Error ? error.message : t('reader.saveFailed');
      if (r.route) setNotice(text); else setMessage(text);
    } finally { setBusy(set => { const next = new Set(set); next.delete(article.id); return next; }); }
  }

  /** Explicitly dismiss only rows already seen, keeping the current snapshot and bookmarks. */
  async function hideViewed() {
    if (!r.feed || r.prefs.view === 'saved' || r.hidingViewed) return;
    const batch = r.feed.batch;
    r.hidingViewed = true; setHidingViewed(true);
    try {
      await flush();
      if (Object.keys(r.outbox).length) throw new Error(t('feed.syncBeforeHide'));
      const action = crypto.randomUUID();
      const result = await api<{ids: string[]}>(`/api/feed/${batch}/hide-seen`, {action});
      if (r.feed?.batch !== batch) return;
      const before = r.items, y = scrollY;
      const ids = result.ids.filter(id => !r.collapsed.has(id));
      if (!ids.length) return;
      const hidden = new Set(ids);
      ids.forEach(id => r.collapsed.add(id));
      flushSync(() => setItems(before.filter(a => !hidden.has(a.id))));
      window.scrollTo(0, 0); save(); watch();
      notify(t('feed.hiddenViewed', { n: ids.length }), { action: { label: t('toast.undo'), onAction: async () => {
        try {
          await api('/api/feed/undo-hide-seen', {action});
          if (r.feed?.batch !== batch) return;
          const snapshot: Session = {preferences: {...r.prefs}, batch, pages: r.pages, position: null, seenBefore: r.feed.seenBefore, revision: r.feed.revision};
          await loadView(snapshot);
          window.scrollTo(0, y); save(); watch();
        } catch (error) { setMessage(error instanceof Error ? error.message : t('error.load')); }
      } } });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('error.load'));
    } finally { r.hidingViewed = false; setHidingViewed(false); }
  }
  async function discuss() {
    const context: ChatContext | null = r.route ? {kind: 'article', id: r.route.id} : r.feed ? {kind: 'batch', id: r.feed.batch} : null;
    if (!context) return;
    try {
      await loadChat();
      r.optionsScroll = scrollY; r.chatOpen = true; unwatch();
      setChat({context, returnFocus: r.route ? 'detailDiscuss' : 'feedDiscuss'});
      requestAnimationFrame(() => setChatOpen(true));
    } catch (e) { notify(e instanceof Error ? e.message : t('chat.failed')); }
  }
  function closeChat() { keepReadingPosition(true); setChatOpen(false); }
  /** Marking the entire batch seen remains a separate, confirmed action in settings. */
  async function markAllSeen() {
    if (!r.feed) return;
    try {
      const { ids } = await api<{ ids: string[] }>('/api/seen-batch', { batch: r.feed.batch });
      const changed = new Set(ids);
      ids.forEach(id => { delete r.outbox[id]; }); localStorage.setItem('stillfeed-outbox', JSON.stringify(r.outbox));
      // Every row of the batch is seen on the server now, including rows this device had not caught up on.
      setItems(r.items.map(a => a.seen ? a : { ...a, seen: true })); setUnseen(0);

      notify(ids.length ? t('toast.markedSeen', { n: ids.length }) : t('toast.alreadySeen'), ids.length ? { action: { label: t('toast.undo'), onAction: async () => {
        for (let i = 0; i < ids.length; i += 2000) await api('/api/seen', { ids: ids.slice(i, i + 2000), seen: false });
        setItems(r.items.map(a => changed.has(a.id) ? { ...a, seen: false } : a)); setUnseen(n => n + ids.length);
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
  }
  /** The next feed item after the open one, so reading can continue without going back. */
  const nextAfter = (id: string | undefined) => { const at = r.items.findIndex(a => a.id === id); return at >= 0 ? r.items[at + 1] ?? null : null; };
  function openNext() {
    const current = r.route, next = nextAfter(current?.id);
    if (!current || !next) return;
    // Replace, not push: Back still returns straight to the feed.
    history.replaceState({ ...history.state }, '', `/${next.kind === 'x' ? 'post' : 'article'}/${next.id}`);
    openDetail(next, null, false);
  }
  /** A user-requested snapshot starts at the top, keeping seen updates visible. */
  async function reloadFresh() {
    if (covered() || r.prefs.view === 'saved') return;
    await flush();
    setFeed(null); await getPage(false).catch(() => {}); window.scrollTo(0, 0);
  }
  /** Sources is a page like the detail: its own URL, the feed kept underneath for Back. */
  function openSources(focus: SourcesFocus = 'heading', navigate = true) {
    if (navigate) {
      // From the drawer, the reading position is the one it opened at; its scroll lock may still hold the page.
      const y = r.optionsOpen ? r.optionsScroll : scrollY;
      save(); r.returnTo = { y, anchor: null };
      history.replaceState({ ...history.state, feedY: y }, '', location.href);
      history.pushState({ fromFeed: true, feedY: y }, '', SOURCES_PATH);
    }
    if (r.optionsOpen) { keepReadingPosition(); setOptionsOpen(false); }
    unwatch(); setSourcesFocus(focus);
    flushSync(() => { setRoute(null); setSourcesOpen(true); });
    document.title = t('sources.title');
    window.scrollTo(0, 0);
  }
  function showFeed() {
    // Returning from reading preserves every row until explicit dismissal.
    const rebuild = r.sourcesOpen && r.sourcesChanged;
    flushSync(() => { setRoute(null); setSourcesOpen(false); });
    document.title = t('app.name');
    // Changed sources change the view: a fresh snapshot from the top instead of a stale place in the old one.
    if (rebuild) { r.sourcesChanged = false; setFeed(null); window.scrollTo(0, 0); void getPage(false).catch(() => {}); return; }
    window.scrollTo(0, history.state?.feedY ?? r.returnTo?.y ?? 0);
    r.returnTo?.anchor?.focus({ preventScroll: true }); watch(); save();
  }
  async function followRoute() {
    if (location.pathname === SOURCES_PATH) { if (!r.sourcesOpen) openSources('heading', false); return; }
    const match = detailPath.exec(location.pathname);
    if (!match) { if (covered()) showFeed(); return; }
    if (r.sourcesOpen) showFeed();
    try {
      const article = r.items.find(a => a.id === match[2]) || await api<Article>(`/api/article/${match[2]}`);
      if (location.pathname === `/${match[1]}/${match[2]}`) openDetail(article, null, false);
    } catch { setRoute({ kind: match[1] as 'article' | 'post', id: match[2]!, article: null, missing: true }); }
  }
  function backToFeed() {
    if (history.state?.fromFeed) history.back();
    else { history.replaceState({ feedY: r.returnTo?.y || 0 }, '', '/'); showFeed(); }
  }

  const latest = useRef({ applyUpdates, reloadFresh, openDetail, saveArticle, mark, setMessage, backToFeed, refresh, getPage, watch, save, flush, refreshStatus, followRoute });
  latest.current = { applyUpdates, reloadFresh, openDetail, saveArticle, mark, setMessage, backToFeed, refresh, getPage, watch, save, flush, refreshStatus, followRoute };
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
    const onVisibility = () => {
      l().watch();
      if (document.hidden) return;
      void l().flush(); void l().refreshStatus();
    };
    const onPop = () => void l().followRoute();
    const onOnline = () => void l().flush();
    let saveTimer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(saveTimer); saveTimer = setTimeout(() => l().save(), 150);
      setShowScrollTop(scrollY > 300);
    };
    const onPageHide = () => l().save();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || (event.target as HTMLElement).closest('input,textarea,button,[role=switch],[role=combobox]') || r.optionsOpen || r.chatOpen || covered()) return;
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
        const settingsLoaded = api<Settings>('/api/settings').then(setSettings);
        void optional<Config>('/api/config').then(value => setConfig(value && typeof value === 'object' && 'ai' in value ? value : null));
        // Restore the batch until it expires on the server; visibility and age never dismiss rows.
        await loadView(loadSession('stillfeed-session', r.prefs), r.prefs.view === 'saved');
        // The feed is on screen: now the rest (sources summary, drawer, reader) without delaying it.
        void loadLibrary();
        setTimeout(() => idle(() => void prefetch().then(() => setChromeReady(true))), 1000);
        await settingsLoaded;
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

  // Lock each touch to one direction: horizontal changes tabs, downward at the top refreshes.
  // Plain touch events keep vertical scrolling native and motion out of the initial bundle.
  const refreshingRef = useRef(false); refreshingRef.current = status.refreshing;
  useEffect(() => {
    const reader = readerRef.current!;
    type Gesture = { x: number; y: number; id: number; mode: 'pending' | 'pull' | 'swipe'; canPull: boolean; dx: number; dy: number };
    let gesture: Gesture | null = null;
    const reset = () => { gesture = null; hint(null); pull(0, true); };
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0]!;
      reset();
      if (event.touches.length !== 1 || covered() || r.optionsOpen || r.chatOpen || r.confirmOpen || r.loading || r.restoring || !gestureAllowed(event.target, touch.clientX)) return;
      gesture = { x: touch.clientX, y: touch.clientY, id: touch.identifier, mode: 'pending', canPull: scrollY <= 0 && unobscured() && !refreshingRef.current, dx: 0, dy: 0 };
    };
    const onMove = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1 || event.touches[0]!.identifier !== gesture.id || covered() || r.optionsOpen || r.chatOpen || r.confirmOpen) { reset(); return; }
      const touch = event.touches[0]!, dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      gesture.dx = dx; gesture.dy = dy;
      if (gesture.mode === 'pending') {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) {
          if (gesture.canPull && dy > 0 && dy > Math.abs(dx) && event.cancelable) event.preventDefault();
          return;
        }
        if (Math.abs(dx) > Math.abs(dy) * 1.5) gesture.mode = 'swipe';
        else if (dy > Math.abs(dx) * 1.5 && gesture.canPull) gesture.mode = 'pull';
        else { reset(); return; }
      }
      if (gesture.mode === 'swipe') {
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (Math.abs(dx) > 65 || dy < 0 || scrollY > 0) { reset(); return; }
      if (event.cancelable) event.preventDefault();
      hint(dy >= COMMIT ? t('gesture.release') : t('gesture.pull'), dy, 'pull');
      if (!reducedMotion.matches) pull(resist(dy) * .6);
    };
    const onEnd = () => {
      const ended = gesture; reset();
      if (!ended || covered() || r.optionsOpen || r.chatOpen || r.confirmOpen) return;
      if (ended.mode === 'pull' && ended.dy >= COMMIT) { void latest.current.reloadFresh(); void latest.current.refresh(); }
      if (ended.mode === 'swipe' && Math.abs(ended.dx) >= COMMIT && Math.abs(ended.dx) > Math.abs(ended.dy) * 1.5) {
        const tabs = ['hot', 'feed', 'saved'] as const;
        const current = r.prefs.view;
        const next = tabs[tabs.indexOf(current) + (ended.dx < 0 ? 1 : -1)];
        if (next) openTab(next);
      }
    };
    const onCancel = () => reset();
    reader.addEventListener('touchstart', onStart, { passive: true });
    reader.addEventListener('touchmove', onMove, { passive: false });
    reader.addEventListener('touchend', onEnd);
    reader.addEventListener('touchcancel', onCancel);
    return () => { reader.removeEventListener('touchstart', onStart); reader.removeEventListener('touchmove', onMove); reader.removeEventListener('touchend', onEnd); reader.removeEventListener('touchcancel', onCancel); };
  }, []);

  function setOptionsOpen(open: boolean) { if (open && !chromeReady) { openOptions(); return; } r.optionsOpen = open; setOptionsOpenState(open); unwatch(); }
  /** The drawer's code arrives on idle; a tap before that loads it, mounts it closed, then opens it so focus moves in. */
  function openOptions() {
    if (chromeReady) { r.optionsScroll = scrollY; setOptionsOpen(true); return; }
    void loadChrome().then(() => { setChromeReady(true); requestAnimationFrame(() => { r.optionsScroll = scrollY; r.optionsOpen = true; setOptionsOpenState(true); unwatch(); }); });
  }
  /** Releasing the drawer's scroll lock (a style change on <html>) can drop the page elsewhere on phones;
   *  for that one release, put the reader back where they were. */
  function keepReadingPosition(inDetail = false) {
    const target = r.optionsScroll, until = Date.now() + 1500, path = location.pathname;
    // A page opened from the drawer (Sources) starts at its top instead.
    const restore = () => { const y = r.sourcesOpen ? 0 : target; if (location.pathname === path && Date.now() < until && (inDetail || !r.route) && Math.abs(scrollY - y) > 2) window.scrollTo(0, y); };
    const observer = new MutationObserver(() => { restore(); requestAnimationFrame(restore); });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    // The popup can restore scroll a frame after releasing its lock.
    const stop = () => {
      observer.disconnect(); removeEventListener('scroll', restore);
      for (const event of ['pointerdown', 'touchstart', 'wheel', 'keydown']) removeEventListener(event, stop);
    };
    addEventListener('scroll', restore, { passive: true });
    for (const event of ['pointerdown', 'touchstart', 'wheel', 'keydown']) addEventListener(event, stop, { passive: true });
    setTimeout(stop, 1500);
  }
  function openSearch() { r.focusSearch = true; setOptionsOpen(true); }
  /** Setup steps: sources and X lead to the Sources page, AI to its drawer section. */
  function openSetup(step: SetupStep) { if (step === 'ai') { r.focusAI = true; setOptionsOpen(true); } else openSources(step === 'x' ? 'x' : 'url'); }
  async function loadLibrary() {
    const [sources, accounts] = await Promise.all([optional<Source[]>('/api/sources'), optional<XAccount[]>('/api/x-accounts')]);
    if (Array.isArray(sources)) setLibrary({ sources, accounts: Array.isArray(accounts) ? accounts : null });
  }
  function dismissSetup() { localStorage.setItem(SETUP_DISMISSED, '1'); setSetupDismissed(true); }

  const view = prefs.view;
  const total = Math.max(0, (feed?.total ?? 0) - r.collapsed.size);
  const viewed = Math.max(0, total - unseen);
  const progress = feed ? t('feed.progress', { shown: items.length, total }) : '';
  const formatLabels = { all: t('format.all'), article: t('format.article'), x: t('format.x') } as const;
  const filterText = [view !== 'saved' && prefs.scope === 'all' ? t('feed.filters.everything') : '', prefs.kind !== 'all' ? formatLabels[prefs.kind] : '', prefs.q ? t('feed.filters.search', { q: prefs.q }) : ''].filter(Boolean).join(' · ');
  const empty = !loading && !booting && feed && !total;
  const feedRefreshing = status.refreshing && view === 'feed';
  const sourceCount = library ? library.sources.length : null;
  const sourcesSummary = useMemo(() => library ? summarize(library.sources, library.accounts, status.failed) : null, [library, status.failed]);
  const emptyKind: EmptyKind | null = !empty ? null : prefs.q || (view === 'saved' && prefs.savedTopic) ? 'noResults' : view === 'saved' ? 'nothingSaved' : sourceCount === 0 ? 'noSources' : status.stored === 0 ? 'collecting' : 'noUpdates';
  // First run: the panel leads the feed until sources, X and AI are set up, or until it is hidden.
  const setupNeeded = sourceCount === 0 || (config ? !config.ai.provider || !config.x.configured : false);
  const showSetup = view === 'feed' && !booting && setupNeeded && !setupDismissed && emptyKind !== 'noSources';

  return <>
    <a className="skip" href="#feed">{t('skip')}</a>
    <div id="readerOptions" hidden={route !== null || sourcesOpen}>
      <header className="topbar">
        <nav className="view-tabs" aria-label={t('tabs.label')}>
          <button id="viewHot" aria-pressed={view === 'hot'} onClick={() => openTab('hot')}>{t('tabs.hot')}</button>
          <button id="viewFeed" aria-pressed={view === 'feed'} onClick={() => openTab('feed')}>{t('tabs.feed')}</button>
          <button id="viewSaved" aria-pressed={view === 'saved'} onClick={() => openTab('saved')}>{t('tabs.saved')}</button>
        </nav>
        <div className="top-actions">
          <button id="feedDiscuss" className="icon-button discuss-button" aria-label={t('chat.title')} disabled={!total} onClick={() => void discuss()}><Icon name="reply" size={18} /></button>
          {view !== 'saved' && feed && <Suspense fallback={<button id="readCount" className="read-count" aria-label={t('feed.readCount', {read: total-unseen,total})} title={t('feed.batchActions')} onClick={() => setCounterOpen(true)}><span>{total-unseen}/{total}</span><Icon name="chevron" size={12} /></button>}><SeenCounter read={total-unseen} total={total} viewed={viewed} busy={hidingViewed} open={counterOpen} setOpen={setCounterOpen} hide={hideViewed} /></Suspense>}
          {!chromeReady ? menuButton : <Suspense fallback={menuButton}><OptionsDrawer open={optionsOpen} trigger={{ label: t('options.open'), icon: <Icon name="menu" /> }} onOpenChange={open => { if (open) r.optionsScroll = scrollY; else keepReadingPosition(); setOptionsOpen(open); }} onOpenChangeComplete={open => {
            if (open && r.focusSearch) { r.focusSearch = false; document.getElementById('searchInput')?.focus(); }
            // Closing the drawer returns focus to its trigger, which a page opened from it (Sources) hides.
            if (!open && r.sourcesOpen) document.getElementById('sourcesTitle')?.focus({ preventScroll: true });
            if (open && r.focusAI) { r.focusAI = false; document.getElementById('settings-ai')?.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' }); }
            watch(); save();
          }}>
              <Suspense fallback={null}><Sidebar prefs={prefs} query={query} setQuery={setQuery} change={(next, fresh) => void change(next, fresh)} settings={settings} applySettings={applySettings}
                status={status} refreshing={feedRefreshing} refresh={() => void refresh()} sources={sourcesSummary} openSources={() => openSources()}
                config={config} interestsChanged={() => void refreshStatus()} counts={view !== 'saved' && feed ? { unseen, total } : null}
                markAll={() => { setOptionsOpen(false); void markAllSeen(); }} onConfirmOpen={open => { r.confirmOpen = open; if (open) unwatch(); }} onConfirmSettled={() => watch()} /></Suspense>
          </OptionsDrawer></Suspense>}
        </div>
      </header>
      <main className="reader" ref={readerRef}>
        <div id="feedView">
        {view === 'hot' && <div className="hot-intro"><span>{t('hot.description')}</span><button className="text-button" onClick={() => openSetup('ai')}>{t('hot.editInterests')}</button>
        </div>}
        {view === 'saved' && <Suspense fallback={null}><SavedTopicsPanel selected={prefs.savedTopic} select={savedTopic => void change({ savedTopic }, true)} active={!route && !sourcesOpen && !optionsOpen && !chatOpen} openAI={() => openSetup('ai')} /></Suspense>}
        <div id="filterSummary" className="filter-summary" hidden={!filterText}><span id="filterText">{filterText}</span><button id="clearFilters" onClick={() => void change({ ...defaults, view, savedTopic: undefined }, true)}>{t('feed.filters.clear')}</button></div>
        <button id="newUpdates" className="new-updates" hidden={!status.newUpdates || view === 'saved'} onClick={applyUpdates}><Icon name="up" size={15} />{t(view === 'hot' ? 'hot.newSelection' : 'feed.newPosts')}</button>
        <p id="syncNote" className="notice" hidden={!syncFailed}>{t('feed.offline')}</p>
        <p id="message" className="notice error" role="alert" hidden={!message}>{message}</p>
        {showSetup && <SetupPanel sources={sourceCount} config={config} open={openSetup} dismiss={dismissSetup} />}
        <div id="loading" className="skeleton" aria-label={t('feed.loading')} hidden={!booting}><div></div><div></div><div></div></div>
        <section id="feed" ref={listRef} aria-label={t('feed.label')}>
          {items.map(article => <Card key={article.id} article={article} seen={article.seen || r.outbox[article.id] === true} busy={busy.has(article.id)} actions={actions} note={view === 'hot' && article.personalReason ? {label:t('hot.why'),text:article.personalReason} : undefined} />)}
        </section>
        {emptyKind === 'noSources' && <SetupPanel sources={sourceCount} config={config} open={openSetup} />}
        {emptyKind && view !== 'hot' && <EmptyState kind={emptyKind} refreshing={status.refreshing} reset={() => void change({ ...defaults, view, savedTopic: undefined }, true)} refresh={() => void refresh()} showSeen={() => void change({ hideSeen: false }, true)} openSettings={openSetup} />}
        <footer className="feed-footer" hidden={Boolean(empty)}>
          {view !== 'saved' && viewed > 0 && <button className="secondary-button" disabled={hidingViewed} onClick={() => void hideViewed()}><Icon name="checkAll" size={16} />{t('feed.hideViewed', {n: viewed})}</button>}
          <p id="progress">{progress}</p>
          <button id="loadMore" ref={moreRef} className="secondary-button" hidden={!failedNewView && (!feed || feed.next === null)} disabled={loading && !failedNewView} onClick={() => void getPage(!failedNewView && Boolean(feed && feed.next !== null)).catch(() => {})}>{failedNewView ? t('feed.retry') : loading ? t('feed.loadingMore') : t('feed.loadMore')}</button>
          <p id="endNote" hidden={!feed || feed.next !== null}>{total ? t('feed.end') : t('feed.none')}</p>
        </footer>
        </div>
      </main>
      <button id="scrollTop" className="icon-button scroll-top" hidden={!showScrollTop || optionsOpen} aria-label={t('feed.scrollTop')} title={t('feed.scrollTop')} onClick={event => {
        // Hiding the focused button during a smooth scroll cancels that scroll in Chromium.
        event.currentTarget.blur();
        window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
      }}><Icon name="up" /></button>
    </div>
    {readerUsed && <Suspense fallback={null}><Detail route={route} busy={route ? busy.has(route.id) : false} notice={notice} actions={actions} back={backToFeed} next={route ? nextAfter(route.id) : null} onNext={openNext} language={config?.language ?? ''} discuss={() => void discuss()} /></Suspense>}
    {chat && <Suspense fallback={null}><ChatPanel open={chatOpen} context={chat.context} returnFocus={chat.returnFocus} close={closeChat} settled={() => { r.chatOpen = false; watch(); save(); }} navigate={id => {
      closeChat();
      void api<Article>(`/api/article/${id}`).then(article => { setChat(null); r.chatOpen = false; openDetail(article, null); }).catch(e => notify(e instanceof Error ? e.message : t('chat.failed')));
    }} /></Suspense>}
    {sourcesOpen && <Suspense fallback={null}><SourcesPage focus={sourcesFocus} back={backToFeed} config={config} failed={status.failed} refresh={() => void refresh()} refreshing={status.refreshing} notify={text => notify(text)}
      changed={() => { r.sourcesChanged = true; }} loaded={(sources, accounts) => setLibrary({ sources, accounts })} /></Suspense>}
    <GestureHint />
    {chromeReady && <Suspense fallback={null}><Toasts /></Suspense>}
  </>;
}
