import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS, BUILTIN_CATALOG } from '../../src/builtin';
import {
  buildDefaultIconPack,
  categoryIcon,
  recognizeGroupIcon,
  VERIFIED_PACK_ICON_NAME_SET,
} from '../../src/domain/templates/icons';
import {
  CATALOG_CATEGORY_VALUES,
  CATEGORY_EMOJI,
  LEGACY_CATALOG_CATEGORY_VALUES,
  LEGACY_CATEGORY_MAP,
  appCardSchema,
  catalogCategorySchema,
  normalizeCatalogCategory,
  type CatalogCategory,
} from '../../src/shared/schemas/card';

/** Design revision r2 §4.2 example services: label -> semantic icon key. */
const SERVICE_SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ['OpenAI', 'openai'],
  ['ChatGPT', 'openai'],
  ['Claude', 'claude'],
  ['Gemini', 'gemini'],
  ['Copilot', 'ai'],
  ['WhatsApp', 'whatsapp'],
  ['Line', 'line'],
  ['Instagram', 'instagram'],
  ['Facebook', 'facebook'],
  ['HBO Max', 'hbo'],
  ['Prime Video', 'prime-video'],
  ['巴哈姆特', 'bahamut'],
  ['TVB', 'tvb'],
  ['Apple Music', 'apple-music'],
  ['YouTube Music', 'youtube-music'],
  ['Epic', 'epic'],
  ['PlayStation', 'playstation'],
  ['Xbox', 'xbox'],
  ['Nintendo', 'nintendo'],
  ['GitLab', 'gitlab'],
  ['Docker Hub', 'docker'],
  ['npm', 'package-registry'],
  ['PyPI', 'package-registry'],
  ['Dropbox', 'dropbox'],
  ['Notion', 'notion'],
  ['iCloud', 'icloud'],
  ['App Store', 'app-store'],
  ['PayPal', 'paypal'],
  ['Stripe', 'stripe'],
  ['Amazon', 'amazon'],
  ['eBay', 'ebay'],
  ['BT', 'bt'],
  ['加密货币', 'crypto'],
];

const CATEGORY_LABELS: ReadonlyArray<readonly [CatalogCategory, string]> = [
  ['base', '基础'],
  ['ai', 'AI'],
  ['social', '社交通讯'],
  ['streaming', '国际流媒体'],
  ['regional-streaming', '港澳台流媒体'],
  ['music', '音乐'],
  ['gaming', '游戏'],
  ['developer', '开发者'],
  ['cloud-office', '云与办公'],
  ['apple', 'Apple'],
  ['finance', '金融支付'],
  ['shopping', '购物'],
  ['privacy', '隐私与广告'],
  ['domestic', '国内'],
  ['other', '其他'],
];

describe('policy-group taxonomy (design revision r2 §4.2)', () => {
  it('defines exactly the 15 current categories in the designed order', () => {
    expect(CATALOG_CATEGORY_VALUES).toEqual([
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
    ]);
    expect(CATEGORY_LABELS.map(([category]) => category)).toEqual([...CATALOG_CATEGORY_VALUES]);
  });

  it('maps the two pre-r2 ids to current categories without touching stored data', () => {
    expect(LEGACY_CATALOG_CATEGORY_VALUES).toEqual(['advertising', 'infrastructure']);
    expect(LEGACY_CATEGORY_MAP).toEqual({ advertising: 'privacy', infrastructure: 'developer' });
    expect(normalizeCatalogCategory('advertising')).toBe('privacy');
    expect(normalizeCatalogCategory('infrastructure')).toBe('developer');
    expect(normalizeCatalogCategory('regional-streaming')).toBe('regional-streaming');
    expect(normalizeCatalogCategory('smart-fridge')).toBeUndefined();

    // Schemas accept legacy ids on input (old backups / API clients) and emit current ids.
    expect(catalogCategorySchema.parse('advertising')).toBe('privacy');
    expect(catalogCategorySchema.parse('infrastructure')).toBe('developer');
    expect(catalogCategorySchema.parse('music')).toBe('music');
    expect(catalogCategorySchema.safeParse('smart-fridge').success).toBe(false);

    const card = BUILTIN_CARDS[0];
    expect(appCardSchema.parse({ ...card, category: 'advertising' }).category).toBe('privacy');
  });

  it('re-categorises built-in cards and catalog entries onto current ids only', () => {
    const primary = new Set<string>(CATALOG_CATEGORY_VALUES);
    const legacy = new Set<string>(LEGACY_CATALOG_CATEGORY_VALUES);

    for (const card of BUILTIN_CARDS) {
      expect(primary.has(card.category)).toBe(true);
      expect(legacy.has(card.category)).toBe(false);
    }
    for (const entry of BUILTIN_CATALOG) {
      expect(primary.has(entry.category)).toBe(true);
      expect(legacy.has(entry.category)).toBe(false);
    }

    // Spot-check the re-categorisation decisions from the r2 table.
    const byId = new Map(BUILTIN_CARDS.map((card) => [card.id, card]));
    expect(byId.get('ad-block')?.category).toBe('privacy');
    expect(byId.get('bilibili-hkmt')?.category).toBe('regional-streaming');
    expect(byId.get('spotify')?.category).toBe('music');
    expect(byId.get('github')?.category).toBe('developer');
    expect(byId.get('apple')?.category).toBe('apple');
    expect(byId.get('google')?.category).toBe('cloud-office');
    expect(byId.get('proxy-select')?.category).toBe('base');
    expect(byId.get('final-fallback')?.category).toBe('base');
  });
});

describe('policy-group icon coverage (design revision r2 §4.3)', () => {
  const pack = buildDefaultIconPack();

  it('only references Qure pack names that this repository can verify offline', () => {
    for (const entry of pack) expect(VERIFIED_PACK_ICON_NAME_SET.has(entry.name)).toBe(true);
    for (const [label] of SERVICE_SAMPLES) {
      const result = recognizeGroupIcon({ name: label });
      for (const alias of result.packAliases) expect(VERIFIED_PACK_ICON_NAME_SET.has(alias)).toBe(true);
    }
  });

  it('recognizes every example service with its own semantic icon key', () => {
    for (const [label, key] of SERVICE_SAMPLES) {
      const result = recognizeGroupIcon({ name: label }, pack);
      expect(result.key, label).toBe(key);
      expect(result.emoji.length, label).toBeGreaterThan(0);
      expect(result.source, label).toBe('service');
    }
  });

  it('gives every service a fallback icon through its category when the pack has no brand icon', () => {
    // Services without a verified Qure name fall back to the category icon (e.g. WhatsApp -> social).
    const whatsapp = recognizeGroupIcon({ name: 'WhatsApp', category: 'social' }, pack);
    expect(whatsapp.key).toBe('whatsapp');
    expect(whatsapp.packIcon?.name).toBe('Telegram');

    const stripe = recognizeGroupIcon({ name: 'Stripe', category: 'finance' }, pack);
    expect(stripe.packIcon?.name).toBe('PayPal');
  });

  it('resolves a pack icon for all 15 category fallbacks', () => {
    for (const [category, label] of CATEGORY_LABELS) {
      const meta = categoryIcon(category);
      // The dependency-free vocabulary used by the page must agree with the icon module.
      expect(CATEGORY_EMOJI[category as keyof typeof CATEGORY_EMOJI], category).toBe(meta.emoji);
      expect(meta.emoji.length, category).toBeGreaterThan(0);

      const result = recognizeGroupIcon({ name: '自定义分组', category }, pack);
      expect(result.source, `${label}: ${result.source}`).toBe('category');
      expect(result.key, label).toBe(meta.key);
      expect(result.emoji, label).toBe(meta.emoji);
      expect(result.packIcon, label).toBeDefined();
    }
  });

  it('keeps the emoji-first chain and legacy categories working', () => {
    const emoji = recognizeGroupIcon({ name: '🎵 Spotify Premium' }, pack);
    expect(emoji.source).toBe('emoji');
    expect(emoji.packIcon?.name).toBe('Spotify');

    // Legacy ids still resolve (used by pre-r2 imports before normalisation).
    expect(recognizeGroupIcon({ name: '自定义分组', category: 'advertising' }, pack).key).toBe('privacy');
    expect(recognizeGroupIcon({ name: '自定义分组', category: 'infrastructure' }, pack).key).toBe('developer');
  });
});
