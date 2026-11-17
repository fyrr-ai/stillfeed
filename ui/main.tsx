import { createRoot } from 'react-dom/client';
import { App } from './app';
import {takeReadyInitialFeed} from './feed-state';

// Preferences, unsent seen marks and the setup flag saved before the rename (radar-v2-*) carry over once.
for (const store of [localStorage, sessionStorage]) for (const key of Object.keys(store)) {
  if (!key.startsWith('radar-v2-')) continue;
  const next = 'stillfeed-' + key.slice('radar-v2-'.length);
  if (store.getItem(next) === null) store.setItem(next, store.getItem(key)!);
  store.removeItem(key);
}

createRoot(document.getElementById('root')!).render(<App initialFeed={takeReadyInitialFeed()} />);
