import type { ReactNode } from 'react';
import { Drawer, DrawerBackdrop, DrawerContent } from '@ui-sdk/react/drawer';
import { Toast, ToastAction, ToastRegion, ToastTitle, createToaster } from '@ui-sdk/react/toast';

/** The settings drawer and the toasts: UI SDK's popup machinery, loaded after the feed's first paint
 *  (on idle, or on the first tap that needs it) so the first download stays small. */
export const toaster = createToaster();

export function Toasts() {
  return <ToastRegion toaster={toaster} className="toast-region">{() => <Toast className="toast"><ToastTitle className="toast-title" /><ToastAction className="toast-action" /></Toast>}</ToastRegion>;
}

/** Controlled by the plain menu button in the top bar; closing returns focus to it (the element focused before). */
export function OptionsDrawer({ open, onOpenChange, onOpenChangeComplete, children }: { open: boolean; onOpenChange: (open: boolean) => void; onOpenChangeComplete: (open: boolean) => void; children: ReactNode }) {
  return <Drawer side="right" open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
    <DrawerBackdrop className="side-backdrop" />
    <DrawerContent id="optionsSheet" className="sidebar">{children}</DrawerContent>
  </Drawer>;
}
