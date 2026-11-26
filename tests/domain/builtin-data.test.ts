import { describe, expect, it } from 'vitest';
import {
  BUILTIN_CARDS,
  BUILTIN_CATALOG,
  BUILTIN_TEMPLATES,
  CATALOG_PROVIDERS,
  STARTER_TEMPLATE_TIERS,
  buildStarterTemplate,
} from '../../src/builtin';
import { checkStageOrdering, resolveTemplateCards, validateTemplateGraph } from '../../src/domain/templates';
import { CATALOG_CATEGORY_VALUES, appCardSchema, catalogEntrySchema, templateSchema } from '../../src/shared/schemas';
import type { AppCard } from '../../src/shared/schemas/card';
import type { TemplateBody } from '../../src/shared/schemas/template';

describe('built-in catalog, starter cards, and 4-tier starter templates', () => {
  it('validates every built-in catalog entry against catalogEntrySchema and verifies provider/parent attribution', () => {
    expect(BUILTIN_CATALOG.length).toBeGreaterThanOrEqual(30);
    const ids = new Set<string>();
    const categoriesSeen = new Set<string>();

    for (const entry of BUILTIN_CATALOG) {
      const parsed = catalogEntrySchema.parse(entry);
      expect(ids.has(parsed.id)).toBe(false);
      ids.add(parsed.id);
      categoriesSeen.add(parsed.category);
      expect(CATALOG_PROVIDERS[parsed.provider]).toBeDefined();
      expect(parsed.sourceUrl).toMatch(/^https:\/\//);
    }

    // All 8 catalog categories are covered
    for (const category of CATALOG_CATEGORY_VALUES) {
      expect(categoriesSeen.has(category)).toBe(true);
    }

    // Every parentId references an existing catalog entry
    for (const entry of BUILTIN_CATALOG) {
      if (entry.parentId) {
        expect(ids.has(entry.parentId)).toBe(true);
      }
    }
  });

  it('validates ~25+ starter app cards against appCardSchema with unique IDs and slugs', () => {
    expect(BUILTIN_CARDS.length).toBeGreaterThanOrEqual(25);
    const ids = new Set<string>();
    const slugs = new Set<string>();
    const categoriesSeen = new Set<string>();

    for (const card of BUILTIN_CARDS) {
      const parsed = appCardSchema.parse(card);
      expect(ids.has(parsed.id)).toBe(false);
      expect(slugs.has(parsed.slug)).toBe(false);
      ids.add(parsed.id);
      slugs.add(parsed.slug);
      categoriesSeen.add(parsed.category);
    }

    for (const category of CATALOG_CATEGORY_VALUES) {
      expect(categoriesSeen.has(category)).toBe(true);
    }
  });

  it.each(STARTER_TEMPLATE_TIERS)(
    'validates %s starter template schema, stage order, and acyclic group graph in both select and fallback modes',
    (tier) => {
      for (const groupMode of ['select', 'fallback'] as const) {
        for (const output of ['full', 'minimal'] as const) {
          const tpl = buildStarterTemplate(tier, { groupMode, output });
          const parsed = templateSchema.parse(tpl);

          expect(parsed.baseBody.groupMode).toBe(groupMode);
          expect(parsed.baseBody.output).toBe(output);

          const graph = validateTemplateGraph(parsed.baseBody, BUILTIN_CARDS);
          expect(graph.cycles).toEqual([]);
          expect(graph.missingRefs).toEqual([]);
          expect(graph.disabledRefs).toEqual([]);
          expect(graph.ok).toBe(true);

          const stageViolations = checkStageOrdering(parsed.baseBody.cards, BUILTIN_CARDS);
          expect(stageViolations).toEqual([]);
        }
      }
    },
  );

  it('applies template-level groupMode toggle to business cards without affecting terminal/direct-first groups', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(4);

    const stdSelect = buildStarterTemplate('standard', { groupMode: 'select' });
    const stdFallback = buildStarterTemplate('standard', { groupMode: 'fallback' });

    const resolvedSelect = resolveTemplateCards(stdSelect.baseBody, BUILTIN_CARDS);
    const resolvedFallback = resolveTemplateCards(stdFallback.baseBody, BUILTIN_CARDS);

    expect(resolvedSelect.cards.find((c) => c.cardId === 'openai')?.effectiveGroupType).toBe('select');
    const openaiFallback = resolvedFallback.cards.find((c) => c.cardId === 'openai');
    expect(openaiFallback?.effectiveGroupType).toBe('fallback');
    expect(openaiFallback?.effective.group.test?.url).toBeTruthy();

    // Terminal / direct-first groups remain `select` even in fallback mode
    expect(resolvedFallback.cards.find((c) => c.cardId === 'ad-block')?.effectiveGroupType).toBe('select');
    expect(resolvedFallback.cards.find((c) => c.cardId === 'lan-direct')?.effectiveGroupType).toBe('select');
    expect(resolvedFallback.cards.find((c) => c.cardId === 'domestic-direct')?.effectiveGroupType).toBe('select');
  });

  it('detects synthetic circular group dependencies, missing references, and disabled references', () => {
    const cyclicCards: AppCard[] = [
      {
        id: 'group-a',
        slug: 'group-a',
        name: 'Group A',
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'card', cardId: 'group-b' }] },
        matchers: [],
      },
      {
        id: 'group-b',
        slug: 'group-b',
        name: 'Group B',
        category: 'other',
        stage: 'app',
        group: {
          type: 'select',
          candidates: [
            { kind: 'card', cardId: 'group-c' },
            { kind: 'card', cardId: 'disabled-card' },
            { kind: 'region', regionGroupId: 'missing-region' },
            { kind: 'slot', slotId: 'missing-slot' },
          ],
        },
        matchers: [],
      },
      {
        id: 'group-c',
        slug: 'group-c',
        name: 'Group C',
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'card', cardId: 'group-a' }] },
        matchers: [],
      },
      {
        id: 'disabled-card',
        slug: 'disabled-card',
        name: 'Disabled',
        category: 'other',
        stage: 'app',
        group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
        matchers: [],
      },
    ];

    const body: TemplateBody = {
      slots: [],
      regionGroups: [],
      cards: [
        { cardId: 'group-a', enabled: true },
        { cardId: 'group-b', enabled: true },
        { cardId: 'group-c', enabled: true },
        { cardId: 'disabled-card', enabled: false },
      ],
      groupMode: 'select',
      final: { kind: 'card', cardId: 'nonexistent-final' },
      output: 'full',
      dns: { mode: 'fake-ip' },
      modules: [],
    };

    const result = validateTemplateGraph(body, cyclicCards);
    expect(result.ok).toBe(false);
    expect(result.cycles).toEqual([['group-a', 'group-b', 'group-c', 'group-a']]);
    expect(result.disabledRefs.map((r) => r.targetId)).toEqual(['disabled-card']);
    expect(result.missingRefs.map((r) => r.targetId)).toEqual(['missing-region', 'missing-slot', 'nonexistent-final']);
  });
});
