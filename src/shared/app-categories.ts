/**
 * Strategy-group category vocabulary (design revision r2 §4.2).
 *
 * Deliberately dependency-free: route modules, filters and UI sections can import this vocabulary
 * without pulling the zod schema graph into the first-screen bundle.
 */

/** The 15 current categories, in the order the UI renders its sections. */
export const CATALOG_CATEGORY_VALUES = [
  'base',
  'ai',
  'social',
  'streaming',
  'regional-streaming',
  'music',
  'gaming',
  'developer',
  'cloud-office',
  'apple',
  'finance',
  'shopping',
  'privacy',
  'domestic',
  'other',
] as const;
export type PrimaryCatalogCategory = (typeof CATALOG_CATEGORY_VALUES)[number];

/**
 * Pre-r2 category ids that still exist in old databases, backups and shared URLs.
 * They stay in the `CatalogCategory` union so read paths and legacy comparisons keep
 * type-checking, but they are normalised to a primary category before reaching the UI.
 */
export const LEGACY_CATALOG_CATEGORY_VALUES = ['advertising', 'infrastructure'] as const;
export type LegacyCatalogCategory = (typeof LEGACY_CATALOG_CATEGORY_VALUES)[number];

export type CatalogCategory = PrimaryCatalogCategory | LegacyCatalogCategory;

/** Old id -> new id. Stored rows are never rewritten; only the in-memory value is mapped. */
export const LEGACY_CATEGORY_MAP: Record<LegacyCatalogCategory, PrimaryCatalogCategory> = {
  advertising: 'privacy',
  infrastructure: 'developer',
};

/** Category glyph used by section headers (draft §4.2 table). Kept dependency-free on purpose. */
export const CATEGORY_EMOJI: Record<PrimaryCatalogCategory, string> = {
  base: '🧭',
  ai: '🤖',
  social: '💬',
  streaming: '🎬',
  'regional-streaming': '📺',
  music: '🎵',
  gaming: '🎮',
  developer: '🛠️',
  'cloud-office': '☁️',
  apple: '🍎',
  finance: '💳',
  shopping: '🛒',
  privacy: '🛡️',
  domestic: '🏠',
  other: '⏱️',
};

export function isPrimaryCatalogCategory(value: string): value is PrimaryCatalogCategory {
  return (CATALOG_CATEGORY_VALUES as readonly string[]).includes(value);
}

/** Maps any stored/legacy category id onto one of the 15 current categories. */
export function normalizeCatalogCategory(value: string): PrimaryCatalogCategory | undefined {
  if (isPrimaryCatalogCategory(value)) return value;
  return LEGACY_CATEGORY_MAP[value as LegacyCatalogCategory];
}
