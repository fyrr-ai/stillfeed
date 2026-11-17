import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@ui-sdk/react/popover';
import { Icon } from './icons';
import { t } from './i18n';

export function SeenCounter({ read, total, viewed, open, setOpen, hide }: { read: number; total: number; viewed: number; open: boolean; setOpen: (open: boolean) => void; hide: () => void }) {
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger id="readCount" className="read-count" aria-label={t('feed.readCount', { read, total })}>{read}/{total}</PopoverTrigger>
    <PopoverContent className="popover seen-actions" side="bottom" align="end" sideOffset={8}>
      <PopoverTitle className="sr-only">{t('feed.readCount', { read, total })}</PopoverTitle>
      <button id="hideViewed" className="ghost-button" disabled={!viewed} onClick={() => { setOpen(false); hide(); }}><Icon name="checkAll" size={16} />{t('feed.hideViewed', { n: viewed })}</button>
    </PopoverContent>
  </Popover>;
}
