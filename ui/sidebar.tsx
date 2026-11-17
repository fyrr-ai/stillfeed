import { useEffect, useState, type ReactNode } from 'react';
import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger } from '@ui-sdk/react/alert-dialog';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@ui-sdk/react/collapsible';
import { DrawerClose, DrawerTitle } from '@ui-sdk/react/drawer';
import { Input, InputClear, InputGroup } from '@ui-sdk/react/input';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/react/segmented-control';
import { Switch, SwitchThumb } from '@ui-sdk/react/switch';
import { Textarea } from '@ui-sdk/react/textarea';
import { Icon, type IconName } from './icons';
import { languageName, t, type Key } from './i18n';
import type { Config, FailedSource, Preferences, Settings } from './lib';
import { api } from './lib';
import { attentionText, type SourcesSummary } from './source-rows';

export type SidebarStatus = { updated: string; rss: number; failed: FailedSource[]; preparation: Record<string, number> | null; importError: boolean; stored: number | null; revision: number | null };
export type SidebarProps = {
  prefs: Preferences; query: string; setQuery: (q: string) => void;
  change: (next: Partial<Preferences>, newSeenBatch?: boolean) => void;
  settings: Settings; applySettings: (patch: Partial<Settings>) => Promise<void>;
  status: SidebarStatus; refreshing: boolean; refresh: () => void;
  /** Totals for the Sources row; null while loading. */
  sources: SourcesSummary | null; openSources: () => void;
  /** undefined while loading, null when the server has no /api/config yet. */
  config: Config | null | undefined;
  interestsChanged: () => void;
  /** The current feed's unseen / total; hidden on Saved. */
  counts: { unseen: number; total: number } | null;
  markAll: () => void; onConfirmOpen: (open: boolean) => void; onConfirmSettled: () => void;
};

const message = (failure: unknown, fallback: Key) => failure instanceof Error ? failure.message : t(fallback);

function Section({ id, title, icon, children }: { id: 'view' | 'sources' | 'ai' | 'refresh' | 'history' | 'diagnostics'; title: string; icon: IconName; children: ReactNode }) {
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

function Interests({changed}:{changed:()=>void}) {
  const [text,setText]=useState(''),[initial,setInitial]=useState<string|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  useEffect(()=>{let active=true;void api<{interests:string}>('/api/personal').then(data=>{if(active){setText(data.interests);setInitial(data.interests);}}).catch(error=>{if(active)setNotice(message(error,'error.load'));});return()=>{active=false;};},[]);
  async function save(){
    setBusy(true);setNotice('');
    try{const data=await api<{interests:string}>('/api/personal',{interests:text});setText(data.interests);setInitial(data.interests);setNotice(t('hot.interests.saved'));changed();}
    catch(error){setNotice(message(error,'error.save'));}finally{setBusy(false);}
  }
  return <div className="interests-editor">
    <label htmlFor="hotInterests" className="field-help">{t('hot.interests.hint')}</label>
    <Textarea id="hotInterests" aria-label={t('hot.interests')} value={text} onValueChange={setText} maxLength={4000} rows={6} disabled={initial===null||busy} />
    <button id="saveInterests" className="secondary-button" disabled={initial===null||busy||!text.trim()||text===initial} onClick={()=>void save()}>{t(busy?'hot.interests.saving':'hot.interests.save')}</button>
    {notice&&<p className="field-help" role="status">{notice}</p>}
  </div>;
}

/** Filters apply immediately; editing interests uses one explicit save before rerating. */
export function Sidebar({ prefs, query, setQuery, change, settings, applySettings, status, refreshing, refresh, sources, openSources, config, interestsChanged, counts, markAll, onConfirmOpen, onConfirmSettled }: SidebarProps) {
  const [days, setDays] = useState(String(settings.windowHours / 24));
  const [retention, setRetention] = useState(String(settings.retentionDays));
  const [error, setError] = useState('');
  useEffect(() => { setDays(String(settings.windowHours / 24)); setRetention(String(settings.retentionDays)); }, [settings]);
  const apply = async (patch: Partial<Settings>) => { setError(''); try { await applySettings(patch); } catch (failure) { setError(message(failure, 'error.save')); setDays(String(settings.windowHours / 24)); setRetention(String(settings.retentionDays)); } };
  const saved = prefs.view === 'saved';
  const sourcesHint = sources ? [t('settings.sources.count', { n: sources.total }), sources.attention ? attentionText(sources.attention) : ''].filter(Boolean).join(' · ') : t('settings.sources.loading');
  const preparation = status.preparation;

  return <>
    <header className="side-head"><DrawerTitle className="side-title">{t('settings.title')}</DrawerTitle><DrawerClose className="icon-button" aria-label={t('options.close')}><Icon name="close" /></DrawerClose></header>
    <div className="side-body">
      <InputGroup className="side-search">
        <Icon name="search" size={16} />
        <Input id="searchInput" type="search" placeholder={t('settings.search.placeholder')} aria-label={t('settings.search')} value={query} onValueChange={value => setQuery(String(value))} />
        <InputClear className="icon-button" aria-label={t('settings.search.clear')}><Icon name="close" size={15} /></InputClear>
      </InputGroup>

      <Section id="view" title={t('settings.view')} icon="inbox">
        {!saved && <Segmented id="scope" label={t('settings.scope')} value={prefs.scope} options={[['ai', t('settings.scope.ai')], ['all', t('settings.scope.all')]]} onChange={scope => change({ scope }, true)} />}
        <Segmented id="format" label={t('settings.format')} value={prefs.kind} options={[['all', t('settings.format.all')], ['article', t('settings.format.article')], ['x', t('settings.format.x')]]} onChange={kind => change({ kind })} />
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
        <button id="openSources" className="side-row side-link" onClick={openSources}><span><b>{t('settings.sources.open')}</b><small id="sourcesHint">{sourcesHint}</small></span><Icon name="chevronRight" size={18} className="disclosure" /></button>
      </Section>

      <Section id="ai" title={t('settings.ai')} icon="sparkles">
        <AIStatus config={config} />
        <Disclosure label={t('hot.interests')}><Interests changed={interestsChanged} /></Disclosure>
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
        <label className="side-row"><span><b>{t('settings.history.days')}</b><small>{t('settings.history.days.hint')}</small></span><input id="historyHours" className="side-number" type="number" min="1" max="90" value={days} onChange={e => setDays(e.target.value)} onBlur={() => { if (Number(days) * 24 !== settings.windowHours) void apply({ windowHours: Number(days) * 24 }); }} /></label>
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
