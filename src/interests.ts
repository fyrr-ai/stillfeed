import type { Store } from './store';

export const DEFAULT_INTERESTS = 'AI models, coding agents, developer tools and practical data engineering. Prefer useful techniques, substantial releases and concrete changes. Skip marketing, jokes and routine version bumps.';

export async function readInterests(path: string, store?: Store) {
  const override = store?.meta('personalInterests');
  if (override !== undefined) return override;
  const file = Bun.file(path);
  return await file.exists() ? (await file.text()).slice(0, 4000) : DEFAULT_INTERESTS;
}
