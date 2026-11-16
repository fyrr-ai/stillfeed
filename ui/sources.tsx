import { memo, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, createConfirm } from '@ui-sdk/react/alert-dialog';
import { Input, InputClear, InputGroup } from '@ui-sdk/react/input';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/react/segmented-control';
import { Switch, SwitchThumb } from '@ui-sdk/react/switch';
import { Icon } from './icons';
import { t, type Key } from './i18n';
import { api, optional, type Config, type FailedSource, type Source, type SourceKind, type XAccount } from './lib';
import { attentionText, order, rowsOf, summarize, type Row, type SourcesFocus, type SourcesSummary } from './source-rows';
export type { SourcesFocus, SourcesSummary };

type Suggestion = { id: string; kind: 'x' | 'site'; key: string; name: string; mentions: number; reason: string };
type Filter = 'all' | SourceKind;

const message = (failure: unknown, fallback: Key) => failure instanceof Error ? failure.message : t(fallback);
const FILTERS: Filter[] = ['all', 'rss', 'youtube', 'web', 'x'];





/** A plain row: no per-row popups, so ~600 of them render at once without jank. */
const SourceRow = memo(function SourceRow({ row, toggle, remove }: { row: Row; toggle: (row: Row, on: boolean) => void; remove: (row: Row, button: HTMLButtonElement) => void }) {
  const updates = row.articles === null ? '' : row.articles === 1 ? t('sources.updates.one') : t('sources.updates', { n: row.articles });
  return <li className={`source-item${row.error ? ' failed' : ''}${row.enabled ? '' : ' off'}`} data-kind={row.kind} data-key={row.key}>
    <span className="source-main">
      <b>{row.name}</b>
      <small title={row.title}>{row.detail}</small>
      {row.error && <small className="source-error"><Icon name="alert" size={12} />{row.error}</small>}
    </span>
    <span className="source-facts"><span className="source-type">{t(`sources.type.${row.kind}`)}</span><span className="source-count">{updates}</span></span>
    <span className="source-actions">
      {row.type !== 'collector' && <Switch className="switch" checked={row.enabled} onCheckedChange={on => toggle(row, on)} aria-label={row.type === 'account' ? row.detail : row.name}><SwitchThumb className="switch-thumb" /></Switch>}
      {row.removable && <button className="icon-button source-remove" aria-label={t('sources.remove', { name: row.name })} title={t('sources.remove', { name: row.name })} onClick={event => remove(row, event.currentTarget)}><Icon name="trash" size={15} /></button>}
    </span>
  </li>;
});

function Suggestions({ items, decide }: { items: Suggestion[]; decide: (item: Suggestion, action: 'add' | 'ignore') => void }) {
  return <section id="suggestions" className="sources-panel suggestions" aria-labelledby="suggestionsTitle">
    <h2 className="sources-heading" id="suggestionsTitle"><Icon name="sparkles" size={14} />{t('sources.suggested')}</h2>
    <ul className="suggestion-grid">{items.map(item => <li key={item.id} className="suggestion">
      <div><b>{item.kind === 'x' ? <a href={`https://x.com/${encodeURIComponent(item.key)}`} target="_blank" rel="noopener noreferrer">@{item.key}</a> : item.name}</b>
        <small>{item.kind === 'x' ? t('sources.suggested.x') : t('sources.suggested.site')} · {t('sources.suggested.citedBy', { n: item.mentions })}</small>
        <p>{item.reason}</p></div>
      <div className="suggestion-actions"><button className="ghost-button" onClick={() => decide(item, 'ignore')}>{t('sources.suggested.ignore')}</button><button className="solid-button" onClick={() => decide(item, 'add')}>{t('sources.suggested.add')}</button></div>
    </li>)}</ul>
  </section>;
}


/** The Sources page (/sources): add, find, switch and remove every feed, channel, collector and X account. */
export function SourcesPage({ focus, back, config, failed, refresh, refreshing, notify, changed, loaded }: {
  focus: SourcesFocus; back: () => void; config: Config | null | undefined; failed: FailedSource[];
  refresh: () => void; refreshing: boolean; notify: (text: string) => void;
  /** A source or account changed: the feed rebuilds when the reader goes back. */
  changed: () => void;
  loaded: (sources: Source[], accounts: XAccount[] | null) => void;
}) {
  const [sources, setSources] = useState<Source[] | 'loading' | 'failed'>('loading');
  const [accounts, setAccounts] = useState<XAccount[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [url, setUrl] = useState('');
  const [handle, setHandle] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [error, setError] = useState('');
  const [confirm] = useState(() => createConfirm<{ name: string }>());
  const searchRef = useRef<HTMLInputElement>(null);
  // Async handlers read the latest lists here, so the memoised rows never hold stale closures.
  const latest = useRef({ sources: [] as Source[], accounts: null as XAccount[] | null });
  latest.current = { sources: Array.isArray(sources) ? sources : [], accounts };
  const report = (nextSources: Source[], nextAccounts: XAccount[] | null) => { latest.current = { sources: nextSources, accounts: nextAccounts }; setSources(nextSources); setAccounts(nextAccounts); loaded(nextSources, nextAccounts); };

  useEffect(() => {
    void Promise.all([api<Source[]>('/api/sources'), optional<XAccount[]>('/api/x-accounts')])
      .then(([list, xs]) => report(list, Array.isArray(xs) ? xs : null)).catch(() => setSources('failed'));
    api<{ items: Suggestion[] }>('/api/suggestions').then(r => setSuggestions(r.items)).catch(() => {});
    const target = focus === 'url' ? 'addSourceUrl' : focus === 'x' ? 'addXHandle' : 'sourcesTitle';
    document.getElementById(target)?.focus({ preventScroll: true });
    // "/" finds a source, like it searches the feed.
    const onKey = (event: KeyboardEvent) => { if (event.key === '/' && !(event.target as HTMLElement).closest('input,textarea,[role=dialog],[role=alertdialog]')) { event.preventDefault(); searchRef.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const cache = useMemo(() => new WeakMap<object, Row>(), [failed]);
  const all = useMemo(() => Array.isArray(sources) ? rowsOf(sources, accounts, failed, cache) : [], [sources, accounts, failed, cache]);
  const counts = useMemo(() => { const c: Record<Filter, number> = { all: 0, rss: 0, youtube: 0, web: 0, x: 0 }; for (const r of all) if (r.type !== 'collector') { c.all++; c[r.kind]++; } return c; }, [all]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => all.filter(r => (filter === 'all' || r.kind === filter) && (!q || r.search.includes(q))), [all, filter, q]);
  const attention = useMemo(() => shown.filter(r => r.error).sort((a, b) => a.name.localeCompare(b.name)), [shown]);
  const rest = useMemo(() => shown.filter(r => !r.error).sort(order), [shown]);
  const summary = summarize(latest.current.sources, accounts, failed);

  // Toggles and removals are optimistic and roll back on failure.
  const handlers = useRef({ toggle: async (_row: Row, _on: boolean) => {}, remove: async (_row: Row, _button: HTMLButtonElement) => {} });
  handlers.current.toggle = async (row: Row, on: boolean) => {
    setError('');
    const { sources: list, accounts: xs } = latest.current;
    if (row.type === 'source') {
      report(list.map(s => s.id === row.source.id ? { ...s, enabled: Number(on) } : s), xs);
      try { await api('/api/sources', { id: row.source.id, enabled: on }); changed(); }
      catch (failure) { report(latest.current.sources.map(s => s.id === row.source.id ? { ...s, enabled: row.source.enabled } : s), latest.current.accounts); setError(message(failure, 'error.source')); }
    } else if (row.type === 'account' && xs) {
      report(list, xs.map(a => a.handle === row.account.handle ? { ...a, enabled: on } : a));
      try { await api('/api/x-accounts', { handle: row.account.handle, enabled: on }); changed(); }
      catch (failure) { report(latest.current.sources, (latest.current.accounts ?? []).map(a => a.handle === row.account.handle ? { ...a, enabled: row.account.enabled } : a)); setError(message(failure, 'error.account')); }
    }
  };
  handlers.current.remove = async (row: Row, button: HTMLButtonElement) => {
    if (row.type !== 'source' || !(await confirm({ name: row.name }))) return;
    setError('');
    try {
      await api('/api/sources/remove', { id: row.source.id });
      // The button that opened the question leaves with its row: focus the next row's control instead.
      const item = button.closest('li'), next = (item?.nextElementSibling ?? item?.previousElementSibling)?.querySelector<HTMLElement>('button');
      (next ?? searchRef.current)?.focus();
      report(latest.current.sources.filter(s => s.id !== row.source.id), latest.current.accounts); changed();
      notify(t('toast.sourceRemoved', { name: row.name }));
    } catch (failure) { setError(message(failure, 'error.removeSource')); }
  };
  const stable = useRef({ toggle: (row: Row, on: boolean) => void handlers.current.toggle(row, on), remove: (row: Row, button: HTMLButtonElement) => void handlers.current.remove(row, button) }).current;

  const addSource = async (event: FormEvent) => {
    event.preventDefault();
    const value = url.trim(); if (!value || adding) return;
    setAdding(true); setAddError('');
    try {
      const source = await api<Source>('/api/sources/add', { url: value }); setUrl('');
      report([...latest.current.sources.filter(s => s.id !== source.id), source], latest.current.accounts); changed();
      notify(t('toast.sourceAdded', { name: source.name }));
    } catch (failure) { setAddError(message(failure, 'error.addSource')); }
    finally { setAdding(false); }
  };
  const follow = async (event: FormEvent) => {
    event.preventDefault();
    const clean = handle.trim().replace(/^@/, ''), xs = latest.current.accounts; if (!clean || !xs) return;
    setError('');
    try {
      const saved = await api<XAccount>('/api/x-accounts', { handle: clean, enabled: true }); setHandle('');
      const existing = xs.find(a => a.handle.toLowerCase() === saved.handle.toLowerCase());
      report(latest.current.sources, [...xs.filter(a => a !== existing), { ...existing, handle: saved.handle, enabled: true }]); changed();
      notify(t('toast.accountAdded', { handle: saved.handle }));
    } catch (failure) { setError(message(failure, 'error.account')); }
  };
  const decide = async (item: Suggestion, action: 'add' | 'ignore') => {
    setSuggestions(list => list.filter(s => s.id !== item.id));
    try {
      await api('/api/suggestions', { id: item.id, action });
      if (action === 'add') {
        notify(t('toast.sourceAdded', { name: item.kind === 'x' ? '@' + item.key : item.name })); changed();
        const [list, xs] = await Promise.all([api<Source[]>('/api/sources'), optional<XAccount[]>('/api/x-accounts')]);
        report(list, Array.isArray(xs) ? xs : null);
      }
    } catch (failure) { notify(message(failure, 'error.suggestion')); }
  };

  const connected = config?.x.configured;
  const loading = sources === 'loading';
  const summaryText = loading ? t('sources.loading') : [t('sources.summary', { on: summary.on, total: summary.total }), summary.attention ? attentionText(summary.attention) : ''].filter(Boolean).join(' · ');

  return <section id="sourcesPage" aria-labelledby="sourcesTitle">
    <header className="article-toolbar sources-toolbar">
      <button id="sourcesBack" className="icon-button" aria-label={t('reader.back')} title={t('reader.back')} onClick={back}><Icon name="back" /></button>
      <h1 id="sourcesTitle" className="sources-title" tabIndex={-1}>{t('sources.title')}</h1>
      <span id="sourcesSummary" className="sources-summary">{summaryText}</span>
    </header>
    <div className="sources-layout">
      <aside className="sources-aside sources-panel" aria-labelledby="addTitle">
        <h2 className="sources-heading" id="addTitle"><Icon name="plus" size={14} />{t('sources.add.title')}</h2>
        <form className="sources-form" onSubmit={e => void addSource(e)}>
          <label className="side-field-label" htmlFor="addSourceUrl">{t('sources.add.label')}</label>
          <div className="side-form-row">
            <Input id="addSourceUrl" className="side-input" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder={t('sources.add.placeholder')} value={url} onValueChange={value => setUrl(String(value))} required />
            <button className="solid-button" type="submit" disabled={adding || !url.trim()}>{adding ? t('sources.add.adding') : t('sources.add')}</button>
          </div>
          {addError && <p className="side-error" role="alert">{addError}</p>}
        </form>
        <form className="sources-form" onSubmit={e => void follow(e)}>
          <label className="side-field-label" htmlFor="addXHandle">{t('sources.x.label')}</label>
          {accounts === null && !loading ? <p className="sources-hint">{t('sources.x.unavailable')}</p>
            : <div className="side-form-row">
              <Input id="addXHandle" className="side-input" placeholder={t('sources.x.placeholder')} value={handle} onValueChange={value => setHandle(String(value))} autoCapitalize="none" autoCorrect="off" />
              <button className="solid-button" type="submit" disabled={loading || !handle.trim()}>{t('sources.x.follow')}</button>
            </div>}
          {config && !connected && <p className="sources-hint" id="xStatus">{t('sources.x.notConnected')}</p>}
        </form>
      </aside>

      <div className="sources-main">
        {suggestions.length > 0 && <Suggestions items={suggestions} decide={(item, action) => void decide(item, action)} />}
        <div className="sources-tools">
          <InputGroup className="side-search sources-search">
            <Icon name="search" size={16} />
            <Input id="sourcesSearch" ref={searchRef} type="search" placeholder={t('sources.search.placeholder')} aria-label={t('sources.search')} aria-keyshortcuts="/" value={query} onValueChange={value => setQuery(String(value))} />
            <InputClear className="icon-button" aria-label={t('sources.search.clear')}><Icon name="close" size={15} /></InputClear>
          </InputGroup>
          <SegmentedControl id="sourcesKind" className="segmented sources-kinds" aria-label={t('sources.kind')} value={filter} onValueChange={next => { if (next) setFilter(next as Filter); }}>
            <SegmentedControlIndicator className="segmented-indicator" />
            {FILTERS.map(f => <SegmentedControlItem key={f} className="segmented-item" value={f}>{t(`sources.kind.${f}`)}{' '}<span className="kind-count">{counts[f].toLocaleString('en')}</span></SegmentedControlItem>)}
          </SegmentedControl>
        </div>
        {error && <p className="side-error" role="alert">{error}</p>}

        {loading ? <p className="sources-hint" id="sourcesStatus">{t('sources.loading')}</p>
          : sources === 'failed' ? <p className="side-error" id="sourcesStatus" role="alert">{t('sources.failed')}</p>
          : <>
            {attention.length > 0 && <section id="sourcesAttention" className="sources-group attention-group" aria-labelledby="attentionTitle">
              <header className="sources-group-head"><h2 id="attentionTitle" className="sources-heading"><Icon name="alert" size={14} />{t('sources.attention.title')}<span className="group-count">{attention.length}</span></h2>
                <button className="ghost-button" disabled={refreshing} onClick={refresh}><Icon name="refresh" size={14} className={refreshing ? 'spinning' : undefined} />{t('sources.attention.retry')}</button></header>
              <ul className="source-table">{attention.map(row => <SourceRow key={row.key} row={row} toggle={stable.toggle} remove={stable.remove} />)}</ul>
            </section>}
            <section className="sources-group" aria-labelledby="allSourcesTitle">
              <header className="sources-group-head"><h2 id="allSourcesTitle" className="sources-heading">{t(filter === 'all' ? 'sources.list.all' : `sources.kind.${filter}`)}<span className="group-count">{rest.length.toLocaleString('en')}</span></h2></header>
              <div className="source-columns" aria-hidden="true"><span>{t('sources.col.source')}</span><span>{t('sources.col.type')}</span><span>{t('sources.col.updates')}</span><span>{t('sources.col.on')}</span></div>
              {rest.length ? <ul id="sourcesList" className="source-table">{rest.map(row => <SourceRow key={row.key} row={row} toggle={stable.toggle} remove={stable.remove} />)}</ul>
                : <p className="sources-hint sources-empty">{q ? t('sources.none', { q: query.trim() }) : t('sources.empty')}</p>}
            </section>
          </>}
      </div>
    </div>

    <AlertDialog controller={confirm.controller}>
      <AlertDialogContent<{ name: string }> id="removeConfirm" className="sheet confirm-sheet">
        {state => <>
          <AlertDialogTitle className="confirm-title">{t('sources.remove.title', { name: state.payload?.name ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription className="field-help">{t('sources.remove.text')}</AlertDialogDescription>
          <div className="confirm-actions"><AlertDialogClose className="secondary-button">{t('sources.remove.cancel')}</AlertDialogClose><AlertDialogClose className="primary-button" value="confirm">{t('sources.remove.confirm')}</AlertDialogClose></div>
        </>}
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
