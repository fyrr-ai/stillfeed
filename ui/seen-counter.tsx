import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@ui-sdk/react/popover';
import { Icon } from './icons';
import { t } from './i18n';

export function SeenCounter({ unseen, total, viewed, busy, open, setOpen, hide }: { unseen: number; total: number; viewed: number; busy: boolean; open: boolean; setOpen: (open: boolean) => void; hide: () => void }) {
  const label = t('feed.readCount', { unseen, read: total - unseen, total });
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger id="readCount" className="read-count" aria-label={label} title={t('feed.batchActions')}><span>{unseen}</span><Icon name="chevron" size={12} /></PopoverTrigger>
    <PopoverContent className="popover seen-actions" side="bottom" align="end" sideOffset={8}>
      <PopoverTitle className="batch-count-label">{label}</PopoverTitle>
      <button id="hideViewed" className="ghost-button" disabled={!viewed || busy} onClick={() => { setOpen(false); hide(); }}><Icon name="checkAll" size={16} />{t('feed.hideViewed', { n: viewed })}</button>
    </PopoverContent>
  </Popover>;
}
