import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogTitle } from '@ui-sdk/react/dialog';
import type { MouseEvent } from 'react';
import { Icon } from './icons';
import { t } from './i18n';

/** The full-size photo, loaded with the dialog code on the first tap; its clicks stay out of the card underneath. */
export default function Lightbox({ src, close }: { src: string; close: () => void }) {
  const stop = (event: MouseEvent) => event.stopPropagation();
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogBackdrop className="lightbox-backdrop" onClick={stop} />
    <DialogContent className="lightbox" onClick={stop}>
      <DialogTitle className="sr-only">{t('card.imageTitle')}</DialogTitle>
      <img src={src} alt="" referrerPolicy="no-referrer" />
      <DialogClose className="icon-button lightbox-close" aria-label={t('card.closeImage')}><Icon name="close" /></DialogClose>
    </DialogContent>
  </Dialog>;
}
