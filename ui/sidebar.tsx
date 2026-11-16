import { useEffect, useState } from 'react';
import { DrawerClose, DrawerTitle } from '@ui-sdk/react/drawer';
import { Input, InputClear, InputGroup } from '@ui-sdk/react/input';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/react/segmented-control';
import { Switch, SwitchThumb } from '@ui-sdk/react/switch';
import { api, type Preferences, type Settings, type Source } from './lib';

type Suggestion = { id: string; kind: 'x' | 'site'; key: string; name: string; mentions: number; reason: string };
export type SidebarProps = {
  prefs: Preferences; query: string; setQuery: (q: string) => void;
  change: (next: Partial<Preferences>, newSeenBatch?: boolean) => void;
  settings: Settings; applySettings: (patch: Partial<Settings>) => Promise<void>;
  status: { updated: string; note: string }; refreshing: boolean; refresh: () => void;
  sourcesChanged: () => void; notify: (text: string) => void;
};

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return <label className="side-row"><span><b>{label}</b>{hint && <small>{hint}</small>}</span>
    <Switch id={id} className="switch" checked={checked} onCheckedChange={onChange} aria-label={label}><SwitchThumb className="switch-thumb" /></Switch></label>;
}

function Segmented<T extends string>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return <div className="side-field"><span className="side-label" id={`${id}Label`}>{label}</span>
    <SegmentedControl id={id} className="segmented" aria-labelledby={`${id}Label`} value={value} onValueChange={next => { if (next && next !== value) onChange(next as T); }}>
      <SegmentedControlIndicator className="segmented-indicator" />
      {options.map(([key, text]) => <SegmentedControlItem key={key} className="segmented-item" value={key}>{text}</SegmentedControlItem>)}
    </SegmentedControl></div>;
}

function Suggestions({ notify }: { notify: (text: string) => void }) {
  const [items, setItems] = useState<Suggestion[] | null>(null);
  useEffect(() => { api<{ items: Suggestion[] }>('/api/suggestions').then(r => setItems(r.items)).catch(() => setItems([])); }, []);
  if (!items?.length) return null;
  const decide = async (item: Suggestion, action: 'add' | 'ignore') => {
    setItems(list => list?.filter(s => s.id !== item.id) ?? null);
    try { await api('/api/suggestions', { id: item.id, action }); if (action === 'add') notify(`Added ${item.kind === 'x' ? '@' + item.key : item.name}. New posts arrive with the next refresh.`); }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not update the suggestion'); }
  };
  return <div id="suggestions" className="suggestions" aria-label="Suggested sources">
    <span className="side-label">Suggested</span>
    {items.map(item => <div key={item.id} className="suggestion">
      <div><b>{item.kind === 'x' ? <a href={`https://x.com/${encodeURIComponent(item.key)}`} target="_blank" rel="noopener noreferrer">@{item.key}</a> : item.name}</b>
        <small>{item.kind === 'x' ? 'X account' : 'Website'} · cited by {item.mentions} of your sources</small>
        <p lang="cs">{item.reason}</p></div>
      <div className="suggestion-actions"><button className="ghost-button" onClick={() => void decide(item, 'ignore')}>Ignore</button><button className="solid-button" onClick={() => void decide(item, 'add')}>Add</button></div>
    </div>)}
  </div>;
}

function SourceList({ changed }: { changed: () => void }) {
  const [sources, setSources] = useState<Source[] | 'loading' | 'failed'>('loading');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api<Source[]>('/api/sources').then(setSources).catch(() => setSources('failed')); }, []);
  const toggle = async (source: Source, on: boolean) => {
    setSources(list => Array.isArray(list) ? list.map(s => s.id === source.id ? { ...s, enabled: Number(on) } : s) : list);
    try { await api('/api/sources', { id: source.id, enabled: on }); changed(); }
    catch (failure) {
      setSources(list => Array.isArray(list) ? list.map(s => s.id === source.id ? { ...s, enabled: source.enabled } : s) : list);
      setError(failure instanceof Error ? failure.message : 'Could not change this source');
    }
  };
  const count = Array.isArray(sources) ? `${sources.filter(s => s.enabled).length} of ${sources.length} on` : '';
  return <>
    <Input id="sourceSearch" className="side-input" type="search" placeholder="Find a source…" aria-label="Find a source" value={query} onValueChange={value => setQuery(String(value))} />
    <p className="side-hint">{count}</p>
    <div id="sources" className="source-list">
      {sources === 'loading' ? 'Loading sources…' : sources === 'failed' ? 'Could not load sources. Close and reopen to retry.'
        : sources.filter(s => s.name.toLowerCase().includes(query.toLowerCase())).map(s => <label key={s.id} className="source-row">
          <span><b>{s.name}</b><small>{s.error || `${s.articles} updates`}</small></span>
          <Switch className="switch" checked={Boolean(s.enabled)} onCheckedChange={on => void toggle(s, on)} aria-label={s.name}><SwitchThumb className="switch-thumb" /></Switch>
        </label>)}
    </div>
    {error && <p className="side-error" role="alert">{error}</p>}
  </>;
}

/** The sidebar: every control applies at once, so there is nothing to save. */
export function Sidebar({ prefs, query, setQuery, change, settings, applySettings, status, refreshing, refresh, sourcesChanged, notify }: SidebarProps) {
  const [days, setDays] = useState(String(settings.windowHours / 24));
  const [retention, setRetention] = useState(String(settings.retentionDays));
  const [error, setError] = useState('');
  useEffect(() => { setDays(String(settings.windowHours / 24)); setRetention(String(settings.retentionDays)); }, [settings]);
  const apply = async (patch: Partial<Settings>) => { setError(''); try { await applySettings(patch); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save'); setDays(String(settings.windowHours / 24)); setRetention(String(settings.retentionDays)); } };
  const saved = prefs.view === 'saved';
  return <>
    <header className="side-head"><DrawerTitle className="side-title">Radar</DrawerTitle><DrawerClose className="icon-button" aria-label="Close options">✕</DrawerClose></header>
    <div className="side-body">
      <InputGroup className="side-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
        <Input id="searchInput" type="search" placeholder="Search" aria-label="Search updates" value={query} onValueChange={value => setQuery(String(value))} />
        <InputClear className="icon-button" aria-label="Clear search">✕</InputClear>
      </InputGroup>

      <section className="side-section" aria-label="View">
        {!saved && <Segmented id="scope" label="Feed" value={prefs.scope} options={[['ai', 'AI & data'], ['all', 'Everything']]} onChange={scope => change({ scope }, true)} />}
        <Segmented id="format" label="Format" value={prefs.kind} options={[['all', 'All'], ['article', 'Articles'], ['x', 'X']]} onChange={kind => change({ kind })} />
        {!saved && <Toggle id="hideSeen" label="Hide seen" hint="Seen updates leave on the next load." checked={prefs.hideSeen} onChange={on => { if (on !== prefs.hideSeen) change({ hideSeen: on }, true); }} />}
      </section>

      <section className="side-section" aria-label="Refresh">
        <div className="side-row"><span><b id="updated">{status.updated}</b><small id="collectionNote">{status.note}</small></span>
          <button id="refresh" className="ghost-button" disabled={refreshing && !saved} aria-label={saved ? 'Refresh saved' : refreshing ? 'Refreshing updates' : 'Refresh updates'} onClick={refresh}>{refreshing && !saved ? 'Refreshing…' : 'Refresh'}</button></div>
        <label className="side-row"><span><b>Refresh every</b></span>
          <select id="refreshEvery" className="side-select" value={settings.refreshEvery} onChange={e => void apply({ refreshEvery: Number(e.target.value) })}>
            {[1, 2, 3, 4, 6, 12].map(h => <option key={h} value={h}>{h === 1 ? 'hour' : `${h} hours`}</option>)}<option value="24">day, 05:00</option>
          </select></label>
        <Toggle id="nightPause" label="Pause at night" hint="Nothing runs 23:00–05:00." checked={settings.nightPause} onChange={on => void apply({ nightPause: on })} />
      </section>

      <section className="side-section" aria-label="History">
        <label className="side-row"><span><b>Days in feed</b></span><input id="historyHours" className="side-number" type="number" min="1" max="90" value={days} onChange={e => setDays(e.target.value)} onBlur={() => { if (Number(days) * 24 !== settings.windowHours) void apply({ windowHours: Number(days) * 24 }); }} /></label>
        <label className="side-row"><span><b>Keep history</b><small>Days; Saved is kept forever.</small></span><input id="retentionDays" className="side-number" type="number" min="7" max="365" value={retention} onChange={e => setRetention(e.target.value)} onBlur={() => { if (Number(retention) !== settings.retentionDays) void apply({ retentionDays: Number(retention) }); }} /></label>
        {error && <p className="side-error" role="alert">{error}</p>}
      </section>

      <details className="side-section side-sources">
        <summary>Sources</summary>
        <Suggestions notify={notify} />
        <SourceList changed={sourcesChanged} />
      </details>
    </div>
  </>;
}
