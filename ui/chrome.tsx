import type { ReactNode } from 'react';
import { Drawer, DrawerBackdrop, DrawerContent, DrawerTrigger } from '@ui-sdk/react/drawer';
import { Toast, ToastAction, ToastRegion, ToastTitle, createToaster } from '@ui-sdk/react/toast';

/** The settings drawer and the toasts: UI SDK's popup machinery, loaded after the feed's first paint
 *  (on idle, or on the first tap that needs it) so the first download stays small. */
export const toaster = createToaster();

export function Toasts() {
  return <ToastRegion toaster={toaster} className="toast-region">{() => <Toast className="toast"><ToastTitle className="toast-title" /><ToastAction className="toast-action" /></Toast>}</ToastRegion>;
}

/** Once loaded, the drawer brings its own trigger in place of the plain menu button, so a tap while it is still
 *  closing reopens it (the page is inert then, and only the drawer's trigger stays usable). */
export function OptionsDrawer({ open, onOpenChange, onOpenChangeComplete, trigger, children }: { open: boolean; onOpenChange: (open: boolean) => void; onOpenChangeComplete: (open: boolean) => void; trigger: { label: string; icon: ReactNode }; children: ReactNode }) {
  return <Drawer side="right" open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
    <DrawerTrigger id="optionsButton" className="icon-button" aria-label={trigger.label} title={trigger.label}>{trigger.icon}</DrawerTrigger>
    <DrawerBackdrop className="side-backdrop" />
    <DrawerContent id="optionsSheet" className="sidebar">{children}</DrawerContent>
  </Drawer>;
}
