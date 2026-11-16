import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger } from '@ui-sdk/react/alert-dialog';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@ui-sdk/react/collapsible';
import { DrawerClose, DrawerTitle } from '@ui-sdk/react/drawer';
import { Input, InputClear, InputGroup } from '@ui-sdk/react/input';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/react/segmented-control';
import { Switch, SwitchThumb } from '@ui-sdk/react/switch';
import { Icon, type IconName } from './icons';
import { languageName, t, type Key } from './i18n';
import { api, optional, type Config, type FailedSource, type Preferences, type Settings, type Source, type XAccount } from './lib';

type Suggestion = { id: string; kind: 'x' | 'site'; key: string; name: string; mentions: number; reason: string };
export type SidebarStatus = { updated: string; rss: number; failed: FailedSource[]; preparation: Record<string, number> | null; importError: boolean; stored: number | null; revision: number | null };
export type SettingsSection = 'sources' | 'x' | 'ai';
export type SidebarProps = {
  prefs: Preferences; query: string; setQuery: (q: string) => void;
  change: (next: Partial<Preferences>, newSeenBatch?: boolean) => void;
  settings: Settings; applySettings: (patch: Partial<Settings>) => Promise<void>;
  status: SidebarStatus; refreshing: boolean; refresh: () => void;
  sourcesChanged: () => void; notify: (text: string) => void;
  /** undefined while loading, null when the server has no /api/config yet. */
  config: Config | null | undefined;
  /** The feed view's unseen / total; hidden on Hot and Saved. */
  counts: { unseen: number; total: number } | null;
  markAll: () => void; onConfirmOpen: (open: boolean) => void; onConfirmSettled: () => void;
  sourcesLoaded: (sources: Source[]) => void;
};

const message = (failure: unknown, fallback: Key) => failure instanceof Error ? failure.message : t(fallback);

function Section({ id, title, icon, children }: { id: SettingsSection | 'view' | 'refresh' | 'history' | 'diagnostics'; title: string; icon: IconName; children: ReactNode }) {
  return <section className="side-section" id={`settings-${id}`} aria-labelledby={`settings-${id}-title`}>
    <h3 className="side-label" id={`settings-${id}-title`}><Icon name={icon} size={14} />{title}</h3>
    {children}
  </section>;
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return <label className="side-row"><span><b>{label}</b>{hint && <small>{hint}</small>}</span>
    <Switch id={id} className="switch" checked={checked} onCheckedChange={onChange} aria-label={label}><SwitchThumb className="switch-thumb" /></Switch></label>;
}

function Segmented<T extends string>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <div className="side-field"><span className="side-field-label" id={`${id}Label`}>{label}</span>
    <SegmentedControl id={id} className="segmented" aria-labelledby={`${id}Label`} value={value} onValueChange={next => { if (next && next !== value) onChange(next as T); }}>
      <SegmentedControlIndicator className="segmented-indicator" />
      {options.map(([key, text]) => <SegmentedControlItem key={key} className="segmented-item" value={key}>{text}</SegmentedControlItem>)}
    </SegmentedControl></div>;
}

function Disclosure({ className = '', label, hint, children, defaultOpen = false }: { className?: string; label: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  return <Collapsible className={`side-disclosure ${className}`} defaultOpen={defaultOpen}>
    <CollapsibleTrigger className="side-row side-disclosure-trigger"><span><b>{label}</b>{hint && <small>{hint}</small>}</span><Icon name="chevron" size={18} className="disclosure" /></CollapsibleTrigger>
    <CollapsiblePanel className="side-disclosure-panel">{children}</CollapsiblePanel>
  </Collapsible>;
}

function Suggestions({ notify }: { notify: (text: string) => void }) {
  const [items, setItems] = useState<Suggestion[] | null>(null);
  useEffect(() => { api<{ items: Suggestion[] }>('/api/suggestions').then(r => setItems(r.items)).catch(() => setItems([])); }, []);
  if (!items?.length) return null;
  const decide = async (item: Suggestion, action: 'add' | 'ignore') => {
    setItems(list => list?.filter(s => s.id !== item.id) ?? null);
    try { await api('/api/suggestions', { id: item.id, action }); if (action === 'add') notify(t('toast.sourceAdded', { name: item.kind === 'x' ? '@' + item.key : item.name })); }
    catch (error) { notify(message(error, 'error.suggestion')); }
  };
  return <div id="suggestions" className="suggestions" aria-label={t('settings.suggested')}>
    <span className="side-field-label">{t('settings.suggested')}</span>
    {items.map(item => <div key={item.id} className="suggestion">
      <div><b>{item.kind === 'x' ? <a href={`https://x.com/${encodeURIComponent(item.key)}`} target="_blank" rel="noopener noreferrer">@{item.key}</a> : item.name}</b>
        <small>{item.kind === 'x' ? t('settings.suggested.x') : t('settings.suggested.site')} · {t('settings.suggested.citedBy', { n: item.mentions })}</small>
        <p>{item.reason}</p></div>
      <div className="suggestion-actions"><button className="ghost-button" onClick={() => void decide(item, 'ignore')}>{t('settings.suggested.ignore')}</button><button className="solid-button" onClick={() => void decide(item, 'add')}>{t('settings.suggested.add')}</button></div>
    </div>)}
  </div>;
}

/** Sources that failed on the last refresh, as one row that expands to the errors. */
function Attention({ failed, retry, refreshing }: { failed: FailedSource[]; retry: () => void; refreshing: boolean }) {
  if (!failed.length) return null;
  return <Collapsible className="attention" id="sourcesAttention">
    <CollapsibleTrigger className="side-row attention-trigger"><span><Icon name="alert" size={16} /><b>{failed.length === 1 ? t('settings.sources.attentionOne') : t('settings.sources.attention', { n: failed.length })}</b></span><Icon name="chevron" size={18} className="disclosure" /></CollapsibleTrigger>
    <CollapsiblePanel className="side-disclosure-panel">
      {failed.map(f => <div key={f.id} className="attention-item"><b>{f.name}</b><small>{f.error}</small></div>)}
      <button className="ghost-button" disabled={refreshing} onClick={retry}><Icon name="refresh" size={14} />{t('settings.sources.retry')}</button>
    </CollapsiblePanel>
  </Collapsible>;
}

function AddSource({ added }: { added: (source: Source) => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = url.trim(); if (!value || busy) return;
    setBusy(true); setError('');
    try { const source = await api<Source>('/api/sources/add', { url: value }); setUrl(''); added(source); }
    catch (failure) { setError(message(failure, 'error.addSource')); }
    finally { setBusy(false); }
  };
  return <form className="side-form" onSubmit={e => void submit(e)}>
    <label className="side-field-label" htmlFor="addSourceUrl">{t('settings.sources.add')}</label>
    <div className="side-form-row">
      <Input id="addSourceUrl" className="side-input" type="url" inputMode="url" placeholder={t('settings.sources.add.placeholder')} aria-label={t('settings.sources.add.label')} value={url} onValueChange={value => setUrl(String(value))} required />
      <button className="solid-button" type="submit" disabled={busy || !url.trim()}>{busy ? t('settings.sources.adding') : <><Icon name="plus" size={14} />{t('settings.sources.add')}</>}</button>
    </div>
    {error && <p className="side-error" role="alert">{error}</p>}
  </form>;
}

function SourceList({ sources, setSources, changed, notify }: { sources: Source[] | 'loading' | 'failed'; setSources: (update: (list: Source[]) => Source[]) => void; changed: () => void; notify: (text: string) => void }) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const toggle = async (source: Source, on: boolean) => {
    setSources(list => list.map(s => s.id === source.id ? { ...s, enabled: Number(on) } : s));
    try { await api('/api/sources', { id: source.id, enabled: on }); changed(); }
    catch (failure) {
      setSources(list => list.map(s => s.id === source.id ? { ...s, enabled: source.enabled } : s));
      setError(message(failure, 'error.source'));
    }
  };
  const remove = async (source: Source) => {
    try { await api('/api/sources/remove', { id: source.id }); setSources(list => list.filter(s => s.id !== source.id)); changed(); notify(t('toast.sourceRemoved', { name: source.name })); }
    catch (failure) { setError(message(failure, 'error.removeSource')); }
  };
  const list = Array.isArray(sources) ? sources : [];
  const count = Array.isArray(sources) ? t('settings.sources.count', { on: list.filter(s => s.enabled).length, total: list.length }) : '';
  return <Disclosure className="side-sources" label={t('settings.sources.all')} hint={count}>
    <Input id="sourceSearch" className="side-input" type="search" placeholder={t('settings.sources.find.placeholder')} aria-label={t('settings.sources.find')} value={query} onValueChange={value => setQuery(String(value))} />
    <div id="sources" className="source-list">
      {sources === 'loading' ? <p className="side-hint">{t('settings.sources.loading')}</p> : sources === 'failed' ? <p className="side-error">{t('settings.sources.failed')}</p>
        : list.filter(s => s.name.toLowerCase().includes(query.toLowerCase())).map(s => <div key={s.id} className={`source-row${s.error ? ' source-failed' : ''}`}>
          <span><b>{s.name}</b><small>{s.error ? <><Icon name="alert" size={12} />{s.error}</> : t('settings.sources.updates', { n: s.articles })}</small></span>
          <Switch className="switch" checked={Boolean(s.enabled)} onCheckedChange={on => void toggle(s, on)} aria-label={s.name}><SwitchThumb className="switch-thumb" /></Switch>
          <AlertDialog>
            <AlertDialogTrigger className="icon-button source-remove" aria-label={t('settings.sources.remove', { name: s.name })} title={t('settings.sources.remove', { name: s.name })}><Icon name="trash" size={15} /></AlertDialogTrigger>
            <AlertDialogContent className="sheet confirm-sheet">
              <AlertDialogTitle className="confirm-title">{t('settings.sources.remove.title', { name: s.name })}</AlertDialogTitle>
              <AlertDialogDescription className="field-help">{t('settings.sources.remove.text')}</AlertDialogDescription>
              <div className="confirm-actions"><AlertDialogClose className="secondary-button">{t('settings.markAll.cancel')}</AlertDialogClose><AlertDialogClose className="primary-button" onClick={() => void remove(s)}>{t('settings.sources.remove.confirm')}</AlertDialogClose></div>
            </AlertDialogContent>
          </AlertDialog>
        </div>)}
    </div>
    {error && <p className="side-error" role="alert">{error}</p>}
  </Disclosure>;
}

function XAccounts({ config, changed }: { config: Config | null | undefined; changed: () => void }) {
  const [accounts, setAccounts] = useState<XAccount[] | null | 'loading'>('loading');
  const [handle, setHandle] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { void optional<XAccount[]>('/api/x-accounts').then(list => setAccounts(Array.isArray(list) ? list : null)); }, []);
  const update = async (next: XAccount, previous?: XAccount[]) => {
    setError('');
    try { await api('/api/x-accounts', { handle: next.handle, enabled: next.enabled }); changed(); }
    catch (failure) { setError(message(failure, 'error.account')); if (previous) setAccounts(previous); }
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    const clean = handle.trim().replace(/^@/, ''); if (!clean || !Array.isArray(accounts)) return;
    const previous = accounts;
    setAccounts([...accounts.filter(a => a.handle.toLowerCase() !== clean.toLowerCase()), { handle: clean, enabled: true }]); setHandle('');
    await update({ handle: clean, enabled: true }, previous);
  };
  const connected = config?.x.configured;
  return <>
    <div className="side-row side-status"><span><b>{config === undefined ? t('settings.updated.loading') : connected ? t('settings.x.connected') : t('settings.x.notConnected')}</b>{config && !connected && <small>{t('settings.x.notConnected.hint')}</small>}</span>
      <span className={`status-dot${connected ? ' on' : ''}`} aria-hidden="true" /></div>
    {accounts === null ? <p className="side-hint">{t('settings.x.unavailable')}</p> : <>
      <form className="side-form" onSubmit={e => void add(e)}>
        <div className="side-form-row">
          <Input id="addXHandle" className="side-input" placeholder={t('settings.x.add.placeholder')} aria-label={t('settings.x.add.label')} value={handle} onValueChange={value => setHandle(String(value))} autoCapitalize="none" autoCorrect="off" />
          <button className="solid-button" type="submit" disabled={accounts === 'loading' || !handle.trim()}><Icon name="plus" size={14} />{t('settings.x.add')}</button>
        </div>
      </form>
      <div className="source-list" id="xAccounts">
        {accounts === 'loading' ? <p className="side-hint">{t('settings.updated.loading')}</p> : !accounts.length ? <p className="side-hint">{t('settings.x.none')}</p>
          : accounts.map(a => <label key={a.handle} className="source-row"><span><b>{a.name || `@${a.handle}`}</b>{a.name && <small>@{a.handle}</small>}</span>
            <Switch className="switch" checked={a.enabled} onCheckedChange={on => { const previous = accounts; setAccounts(accounts.map(x => x.handle === a.handle ? { ...x, enabled: on } : x)); void update({ ...a, enabled: on }, previous); }} aria-label={`@${a.handle}`}><SwitchThumb className="switch-thumb" /></Switch></label>)}
      </div>
    </>}
    {error && <p className="side-error" role="alert">{error}</p>}
  </>;
}

function AIStatus({ config }: { config: Config | null | undefined }) {
  if (config === undefined) return <p className="side-hint">{t('settings.updated.loading')}</p>;
  if (config === null) return <p className="side-hint">{t('settings.ai.unavailable')}</p>;
  const provider = config.ai.provider;
  if (!provider) return <div className="side-row side-status"><span><b>{t('settings.ai.notConfigured')}</b><small>{t('settings.ai.notConfigured.hint')}</small></span><span className="status-dot" aria-hidden="true" /></div>;
  const providerName = t(`settings.ai.provider.${provider}` as Key);
  return <dl className="side-facts">
    <div><dt>{t('settings.ai.provider')}</dt><dd><span className="status-dot on" aria-hidden="true" />{providerName}</dd></div>
    {config.ai.model && <div><dt>{t('settings.ai.model')}</dt><dd>{config.ai.model}</dd></div>}
    <div><dt>{t('settings.ai.language')}</dt><dd>{languageName(config.language) || config.language}</dd></div>
  </dl>;
}

/** The sidebar: every control applies at once, so there is nothing to save. */
export function Sidebar({ prefs, query, setQuery, change, settings, applySettings, status, refreshing, refresh, sourcesChanged, notify, config, counts, markAll, onConfirmOpen, onConfirmSettled, sourcesLoaded }: SidebarProps) {
  const [days, setDays] = useState(String(settings.windowHours / 24));
  const [retention, setRetention] = useState(String(settings.retentionDays));
  const [error, setError] = useState('');
  const [sources, setSourcesState] = useState<Source[] | 'loading' | 'failed'>('loading');
  useEffect(() => { setDays(String(settings.windowHours / 24)); setRetention(String(settings.retentionDays)); }, [settings]);
  useEffect(() => { api<Source[]>('/api/sources').then(list => { setSourcesState(list); sourcesLoaded(list); }).catch(() => setSourcesState('failed')); }, []);
  const setSources = (update: (list: Source[]) => Source[]) => setSourcesState(list => { if (!Array.isArray(list)) return list; const next = update(list); sourcesLoaded(next); return next; });
  const apply = async (patch: Partial<Settings>) => { setError(''); try { await applySettings(patch); } catch (failure) { setError(message(failure, 'error.save')); setDays(String(settings.windowHours / 24)); setRetention(String(settings.retentionDays)); } };
  const saved = prefs.view === 'saved';
  // Failing sources: the status endpoint lists them on newer servers; older ones only flag them in the source list.
  const failed: FailedSource[] = status.failed.length ? status.failed : Array.isArray(sources) ? sources.filter(s => s.error).map(s => ({ id: s.id, name: s.name, error: String(s.error) })) : [];
  const preparation = status.preparation;

  return <>
    <header className="side-head"><DrawerTitle className="side-title"><Icon name="radar" size={18} />{t('settings.title')}</DrawerTitle><DrawerClose className="icon-button" aria-label={t('options.close')}><Icon name="close" /></DrawerClose></header>
    <div className="side-body">
      <InputGroup className="side-search">
        <Icon name="search" size={16} />
        <Input id="searchInput" type="search" placeholder={t('settings.search.placeholder')} aria-label={t('settings.search')} value={query} onValueChange={value => setQuery(String(value))} />
        <InputClear className="icon-button" aria-label={t('settings.search.clear')}><Icon name="close" size={15} /></InputClear>
      </InputGroup>

      <Section id="view" title={t('settings.view')} icon="inbox">
        {!saved && <Segmented id="scope" label={t('settings.scope')} value={prefs.scope} options={[['ai', t('settings.scope.ai')], ['all', t('settings.scope.all')]]} onChange={scope => change({ scope }, true)} />}
        <Segmented id="format" label={t('settings.format')} value={prefs.kind} options={[['all', t('settings.format.all')], ['article', t('settings.format.article')], ['x', t('settings.format.x')]]} onChange={kind => change({ kind })} />
        {!saved && <Toggle id="hideSeen" label={t('settings.hideSeen')} hint={t('settings.hideSeen.hint')} checked={prefs.hideSeen} onChange={on => { if (on !== prefs.hideSeen) change({ hideSeen: on }, true); }} />}
        {counts && <div className="side-row"><span><b>{t('settings.unseen')}</b><small><span id="unseenBubble" aria-label={t('settings.unseen.hint', { unseen: counts.unseen, total: counts.total })}>{counts.unseen.toLocaleString('en')} / {counts.total.toLocaleString('en')}</span></small></span>
          <AlertDialog onOpenChange={(open, details) => { onConfirmOpen(open); if (!open && details.returnValue === 'confirm') markAll(); }} onOpenChangeComplete={open => { if (!open) onConfirmSettled(); }}>
            <AlertDialogTrigger id="markAllSeen" className="ghost-button" disabled={!counts.total}><Icon name="checkAll" size={15} />{t('settings.markAll')}</AlertDialogTrigger>
            <AlertDialogContent id="markAllConfirm" className="sheet confirm-sheet">
              <AlertDialogTitle className="confirm-title">{t('settings.markAll.title')}</AlertDialogTitle>
              <AlertDialogDescription className="field-help">{t('settings.markAll.text', { n: counts.total })}</AlertDialogDescription>
              <div className="confirm-actions"><AlertDialogClose className="secondary-button">{t('settings.markAll.cancel')}</AlertDialogClose><AlertDialogClose className="primary-button" value="confirm">{t('settings.markAll.confirm')}</AlertDialogClose></div>
            </AlertDialogContent>
          </AlertDialog></div>}
      </Section>

      <Section id="sources" title={t('settings.sources')} icon="rss">
        <Attention failed={failed} retry={refresh} refreshing={refreshing} />
        <AddSource added={source => { setSources(list => [...list.filter(s => s.id !== source.id), source].sort((a, b) => a.name.localeCompare(b.name))); sourcesChanged(); notify(t('toast.sourceAdded', { name: source.name })); }} />
        <Suggestions notify={notify} />
        <SourceList sources={sources} setSources={setSources} changed={sourcesChanged} notify={notify} />
      </Section>

      <Section id="x" title={t('settings.x')} icon="x">
        <XAccounts config={config} changed={sourcesChanged} />
      </Section>

      <Section id="ai" title={t('settings.ai')} icon="sparkles">
        <AIStatus config={config} />
      </Section>

      <Section id="refresh" title={t('settings.refresh')} icon="refresh">
        <div className="side-row"><span><b id="updated">{status.updated}</b>{status.importError && <small className="side-warn">{t('settings.updated.importFailed')}</small>}</span>
          <button id="refresh" className="ghost-button" disabled={refreshing && !saved} aria-label={saved ? t('settings.refresh.saved') : refreshing ? t('settings.refresh.refreshing') : t('settings.refresh.updates')} onClick={refresh}><Icon name="refresh" size={14} className={refreshing && !saved ? 'spinning' : undefined} />{refreshing && !saved ? t('settings.refresh.running') : t('settings.refresh.now')}</button></div>
        <label className="side-row"><span><b>{t('settings.refresh.every')}</b></span>
          <select id="refreshEvery" className="side-select" value={settings.refreshEvery} onChange={e => void apply({ refreshEvery: Number(e.target.value) })}>
            {[1, 2, 3, 4, 6, 12].map(h => <option key={h} value={h}>{h === 1 ? t('settings.refresh.hour') : t('settings.refresh.hours', { n: h })}</option>)}<option value="24">{t('settings.refresh.daily')}</option>
          </select></label>
        <Toggle id="nightPause" label={t('settings.refresh.night')} hint={t('settings.refresh.night.hint')} checked={settings.nightPause} onChange={on => void apply({ nightPause: on })} />
      </Section>

      <Section id="history" title={t('settings.history')} icon="hourglass">
        <label className="side-row"><span><b>{t('settings.history.days')}</b></span><input id="historyHours" className="side-number" type="number" min="1" max="90" value={days} onChange={e => setDays(e.target.value)} onBlur={() => { if (Number(days) * 24 !== settings.windowHours) void apply({ windowHours: Number(days) * 24 }); }} /></label>
        <label className="side-row"><span><b>{t('settings.history.keep')}</b><small>{t('settings.history.keep.hint')}</small></span><input id="retentionDays" className="side-number" type="number" min="7" max="365" value={retention} onChange={e => setRetention(e.target.value)} onBlur={() => { if (Number(retention) !== settings.retentionDays) void apply({ retentionDays: Number(retention) }); }} /></label>
        {error && <p className="side-error" role="alert">{error}</p>}
      </Section>

      <Section id="diagnostics" title={t('settings.diagnostics')} icon="info">
        <Disclosure label={`${status.rss.toLocaleString('en')} ${t('settings.diagnostics.feeds')} · ${(preparation?.done ?? 0).toLocaleString('en')} ${t('settings.diagnostics.prepared').toLowerCase()}`}>
          <dl className="side-facts" id="collectionNote">
            <div><dt>{t('settings.diagnostics.feeds')}</dt><dd>{status.rss.toLocaleString('en')}</dd></div>
            <div><dt>{t('settings.diagnostics.window')}</dt><dd>{settings.windowHours / 24}</dd></div>
            {status.stored !== null && <div><dt>{t('settings.diagnostics.stored')}</dt><dd>{status.stored.toLocaleString('en')}</dd></div>}
            {preparation && <>
              <div><dt>{t('settings.diagnostics.prepared')}</dt><dd>{(preparation.done ?? 0).toLocaleString('en')}</dd></div>
              <div><dt>{t('settings.diagnostics.queued')}</dt><dd>{(preparation.queued ?? 0).toLocaleString('en')}</dd></div>
              <div><dt>{t('settings.diagnostics.working')}</dt><dd>{(preparation.working ?? 0).toLocaleString('en')}</dd></div>
              {preparation.failed !== undefined && <div><dt>{t('settings.diagnostics.failed')}</dt><dd>{preparation.failed.toLocaleString('en')}</dd></div>}
            </>}
            {status.revision !== null && <div><dt>{t('settings.diagnostics.revision')}</dt><dd>{status.revision}</dd></div>}
          </dl>
        </Disclosure>
      </Section>
    </div>
  </>;
}
