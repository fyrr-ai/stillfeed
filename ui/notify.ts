/** Toasts without loading UI SDK up front: the first one fetches the toast module (prefetched on idle anyway). */
export const loadChrome = () => import('./chrome');
type Options = { action?: { label: string; onAction: () => void | Promise<void> } };
export function toast(text: string, options?: Options) {
  void loadChrome().then(({ toaster }) => { toaster.dismiss(); toaster(text, options); });
}
