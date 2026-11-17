export const UNCATEGORIZED = 'uncategorized';
export const DEFAULT_CATEGORIES = Object.freeze([
  { id: UNCATEGORIZED, name: 'Uncategorized' },
  { id: 'groceries', name: 'Groceries' },
  { id: 'transport', name: 'Transport' },
  { id: 'dining', name: 'Dining' },
  { id: 'shopping', name: 'Shopping' },
  { id: 'utilities', name: 'Utilities' },
].map((category) => Object.freeze(category)));

export function isCategoryId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[^A-Za-z0-9_-]/.test(value);
}
