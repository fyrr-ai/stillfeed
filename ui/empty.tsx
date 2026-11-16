import { Icon, type IconName } from './icons';
import { t } from './i18n';
import type { Config } from './lib';

/** Where a setup step leads: the Sources page (feeds, X accounts) or the drawer's AI section. */
export type SetupStep = 'sources' | 'x' | 'ai';
export type EmptyKind = 'noSources' | 'collecting' | 'caughtUp' | 'noResults' | 'nothingSaved' | 'noUpdates';
const icons: Record<EmptyKind, IconName> = { noSources: 'rss', collecting: 'hourglass', caughtUp: 'done', noResults: 'search', nothingSaved: 'saved', noUpdates: 'inbox' };

/** One empty state per situation, each with its own next action. Ids stay stable for the test suite. */
export function EmptyState({ kind, reset, refresh, showSeen, openSettings, refreshing }: { kind: EmptyKind; reset: () => void; refresh: () => void; showSeen: () => void; openSettings: (section: SetupStep) => void; refreshing: boolean }) {
  const action = kind === 'noSources' ? <button id="emptyReset" className="primary-button" onClick={() => openSettings('sources')}><Icon name="plus" size={16} />{t('setup.sources')}</button>
    : kind === 'collecting' ? <button id="emptyReset" className="secondary-button" disabled={refreshing} onClick={refresh}><Icon name="refresh" size={15} className={refreshing ? 'spinning' : undefined} />{t('empty.refresh')}</button>
    : kind === 'caughtUp' ? <button id="emptyReset" className="secondary-button" onClick={showSeen}>{t('empty.showSeen')}</button>
    : kind === 'nothingSaved' ? null
    : <button id="emptyReset" className="secondary-button" onClick={reset}>{t('empty.reset')}</button>;
  return <section id="empty" className="empty" data-kind={kind}>
    <span className="empty-glyph" aria-hidden="true"><Icon name={icons[kind]} size={26} /></span>
    <h2 id="emptyTitle">{t(`empty.${kind}.title`)}</h2>
    <p id="emptyText">{t(`empty.${kind}.text`)}</p>
    {action}
  </section>;
}

/** First run: three short steps, each opening its page or settings section; done steps show a check. */
export function SetupPanel({ sources, config, open, dismiss }: { sources: number | null; config: Config | null | undefined; open: (section: SetupStep) => void; dismiss?: () => void }) {
  const steps: { section: SetupStep; icon: IconName; label: string; hint: string; done: boolean }[] = [
    { section: 'sources', icon: 'rss', label: t('setup.sources'), hint: t('setup.sources.hint'), done: (sources ?? 0) > 0 },
    { section: 'x', icon: 'x', label: t('setup.x'), hint: t('setup.x.hint'), done: Boolean(config?.x.configured) },
    { section: 'ai', icon: 'sparkles', label: t('setup.ai'), hint: t('setup.ai.hint'), done: Boolean(config?.ai.provider) },
  ];
  return <section id="setup" className="setup" aria-labelledby="setupTitle">
    <header><h2 id="setupTitle">{t('setup.title')}</h2>{dismiss && <button className="icon-button" aria-label={t('setup.dismiss')} title={t('setup.dismiss')} onClick={dismiss}><Icon name="close" size={16} /></button>}</header>
    <p>{t('setup.text')}</p>
    <ol>{steps.map(step => <li key={step.section}>
      <button className={`setup-step${step.done ? ' done' : ''}`} onClick={() => open(step.section)}>
        <span className="setup-icon"><Icon name={step.done ? 'check' : step.icon} size={16} /></span>
        <span className="setup-text"><b>{step.label}</b><small>{step.done ? t('setup.done') : step.hint}</small></span>
        <Icon name="chevronRight" size={16} className="setup-chevron" />
      </button>
    </li>)}</ol>
  </section>;
}
