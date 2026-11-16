import { useEffect, useState } from 'react';
import { Button } from '@ui-sdk/react/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui-sdk/react/select';
import type { SavedTopics } from '../src/saved-topics';
import { api } from './lib';
import { t } from './i18n';
import { Icon } from './icons';

type TopicState = ReturnType<SavedTopics['list']> & { enabled: boolean };

export function SavedTopicsPanel({ selected, select, active, openAI }: {
  selected?: string;
  select: (id?: string) => void;
  active: boolean;
  openAI: () => void;
}) {
  const [data, setData] = useState<TopicState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (data && selected && selected !== 'ungrouped' && !data.topics.some(topic => topic.id === selected)) select();
  }, [data, selected, select]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false, fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const next = await api<TopicState>('/api/saved/topics');
        if (!cancelled) { setData(next); setFailed(false); }
      } catch { if (!cancelled) setFailed(true); }
      finally { fetching = false; }
    };
    void load();
    // Topic creation can add rows. Update the overview only at the top, keeping articles still while reading.
    const timer = setInterval(() => { if (!document.hidden && scrollY < 80) void load(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active]);

  async function retry() {
    try {
      await api('/api/saved/topics/retry', {});
      setData(await api<TopicState>('/api/saved/topics')); setFailed(false);
    } catch { setFailed(true); }
  }

  if (!data) return failed ? <p className="notice error" role="status">{t('saved.topics.loadFailed')}</p> : null;
  if (!data.total && !selected) return null;
  const options = [
    { value: 'all', label: t('saved.topics.all'), count: data.total },
    ...data.topics.map(topic => ({ value: topic.id, label: topic.name, count: topic.count })),
    ...(data.ungrouped > 0 || selected === 'ungrouped' ? [{ value: 'ungrouped', label: t('saved.topics.ungrouped'), count: data.ungrouped }] : []),
  ];
  const current = options.find(option => option.value === selected) ?? options[0]!;
  return <section id="savedTopics" className="saved-topics" aria-label={t('saved.topics.title')}>
    <div className="saved-topic-toolbar">
      <Select items={options} value={current.value} onValueChange={value => { if (value) select(value === 'all' ? undefined : value); }}>
        <SelectTrigger id="savedTopicSelect" className="saved-topic-trigger" aria-label={t('saved.topics.title')}>
          <SelectValue /><Icon name="chevron" size={15} />
        </SelectTrigger>
        <SelectContent className="popover saved-topic-menu" sideOffset={4} alignItemWithTrigger={false}>
          {options.map(option => <SelectItem key={option.value} value={option.value} label={option.label} aria-label={option.label} className="saved-topic-option" data-topic={option.value}><span>{option.label}</span><span className="saved-topic-count">{option.count}</span></SelectItem>)}
        </SelectContent>
      </Select>
      <div className="saved-topic-meta">
        <span role="status">
          {data.enabled && data.pending > 0 && <span aria-label={t('saved.topics.pending', { count: data.pending })} title={t('saved.topics.pending', { count: data.pending })}><Icon name="refresh" size={14} className="spinning" /></span>}
          {!data.enabled && <Button className="icon-button saved-topic-status-action" aria-label={t('saved.topics.enable')} title={t('saved.topics.enable')} onClick={openAI}><Icon name="info" size={15} /></Button>}
          {data.enabled && (data.failed > 0 || failed) && <Button className="icon-button saved-topic-status-action" aria-label={t('feed.retry')} title={failed ? t('saved.topics.loadFailed') : t('saved.topics.failed', { count: data.failed })} onClick={retry}><Icon name="refresh" size={15} /></Button>}
        </span>
        <span className="saved-topic-count">{current.count}</span>
      </div>
    </div>
  </section>;
}
