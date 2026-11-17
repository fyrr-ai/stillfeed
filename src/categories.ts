export const CATEGORIES = ['ai', 'data'] as const;
export type Category = typeof CATEGORIES[number];
/** An empty selection means Everything; selected categories are combined with OR. */
export function parseCategories(value: unknown, legacyScope?: unknown): Category[] {
  if (value === undefined) return legacyScope === 'all' ? [] : [...CATEGORIES];
  if (!Array.isArray(value) || value.some(category => !CATEGORIES.includes(category))) throw new Error('Unknown feed category');
  return CATEGORIES.filter(category => value.includes(category));
}
