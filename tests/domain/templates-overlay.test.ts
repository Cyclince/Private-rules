import { describe, expect, it } from 'vitest';
import { buildStarterTemplate } from '../../src/builtin';
import { applyOverlay, rebaseOverlay, resolveOverlayConflicts } from '../../src/domain/templates';
import type { TemplateBody, TemplateOverlayOp } from '../../src/shared/schemas/template';

function cloneLightBase(): TemplateBody {
  return structuredClone(buildStarterTemplate('light').baseBody);
}

describe('template overlay replay and upstream rebase', () => {
  it('deterministically replays overlay operations without mutating baseBody', () => {
    const base = cloneLightBase();
    const snapshot = structuredClone(base);

    const overlay: TemplateOverlayOp[] = [
      { op: 'addCard', cardId: 'discord', afterCardId: 'telegram' },
      { op: 'moveCard', cardId: 'github', beforeCardId: 'ai-services' },
      { op: 'setCardEnabled', cardId: 'ad-block', enabled: false },
      { op: 'setCardOverride', cardId: 'youtube', overrides: { name: '▶️ My YouTube', group: { type: 'fallback' } } },
      {
        op: 'addRegionGroup',
        regionGroup: { id: 'region-gb', name: '🇬🇧 英国节点', region: 'GB', type: 'url-test', slotId: 'slot-main' },
      },
      { op: 'updateRegionGroup', regionGroupId: 'region-hk', patch: { type: 'fallback', extraInclude: 'IPLC' } },
      { op: 'addSlot', slot: { id: 'slot-backup', name: '备用订阅', excludeInfo: true } },
      { op: 'updateSlot', slotId: 'slot-main', patch: { udp: false } },
      { op: 'setGroupMode', groupMode: 'fallback' },
      { op: 'setOutput', output: 'minimal' },
      { op: 'setModule', moduleId: 'dns-leak-guard', enabled: true },
      { op: 'setPatch', client: 'mihomo', patch: 'geodata-mode: true' },
    ];

    const result = applyOverlay(base, overlay);

    // Input immutability
    expect(base).toEqual(snapshot);
    expect(result.conflicts).toEqual([]);
    expect(result.appliedCount).toBe(overlay.length);

    const cardIds = result.resolved.cards.map((c) => c.cardId);
    expect(cardIds.indexOf('discord')).toBe(cardIds.indexOf('telegram') + 1);
    expect(cardIds.indexOf('github')).toBe(cardIds.indexOf('ai-services') - 1);
    expect(result.resolved.cards.find((c) => c.cardId === 'ad-block')?.enabled).toBe(false);
    expect(result.resolved.cards.find((c) => c.cardId === 'youtube')?.overrides?.name).toBe('▶️ My YouTube');
    expect(result.resolved.regionGroups.map((g) => g.id)).toContain('region-gb');
    expect(result.resolved.regionGroups.find((g) => g.id === 'region-hk')?.extraInclude).toBe('IPLC');
    expect(result.resolved.slots.map((s) => s.id)).toContain('slot-backup');
    expect(result.resolved.slots.find((s) => s.id === 'slot-main')?.udp).toBe(false);
    expect(result.resolved.groupMode).toBe('fallback');
    expect(result.resolved.output).toBe('minimal');
    expect(result.resolved.modules.find((m) => m.id === 'dns-leak-guard')?.enabled).toBe(true);
    expect(result.resolved.clientPatches?.mihomo).toBe('geodata-mode: true');
  });

  it('rebases cleanly when upstream changes unrelated cards and computes accurate diff', () => {
    const prevBase = cloneLightBase();
    const nextBase = cloneLightBase();
    // Upstream adds spotify after netflix and adds a GB region group
    const netflixIdx = nextBase.cards.findIndex((c) => c.cardId === 'netflix');
    nextBase.cards.splice(netflixIdx + 1, 0, { cardId: 'spotify', enabled: true });
    nextBase.regionGroups.push({
      id: 'region-gb',
      name: '🇬🇧 英国节点',
      region: 'GB',
      type: 'url-test',
      slotId: 'slot-main',
    });

    const overlay: TemplateOverlayOp[] = [
      { op: 'setCardEnabled', cardId: 'ad-block', enabled: false },
      { op: 'setGroupMode', groupMode: 'fallback' },
    ];

    const rebased = rebaseOverlay(prevBase, nextBase, overlay);
    expect(rebased.hasConflicts).toBe(false);
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.diff.addedCards).toEqual(['spotify']);
    expect(rebased.diff.addedRegionGroups).toEqual(['region-gb']);
    expect(rebased.resolved.cards.find((c) => c.cardId === 'ad-block')?.enabled).toBe(false);
    expect(rebased.resolved.groupMode).toBe('fallback');
  });

  it('lists structured conflicts on rebase when upstream deletes, adds, or modifies targeted items', () => {
    const prevBase = cloneLightBase();
    const nextBase = cloneLightBase();

    // Upstream deletes `netflix`, adds `discord`, modifies `youtube`, removes `region-kr`, and changes `final`
    nextBase.cards = nextBase.cards.filter((c) => c.cardId !== 'netflix');
    nextBase.cards.push({ cardId: 'discord', enabled: true });
    const yt = nextBase.cards.find((c) => c.cardId === 'youtube')!;
    yt.overrides = { name: '▶️ Upstream YouTube' };
    nextBase.regionGroups = nextBase.regionGroups.filter((g) => g.id !== 'region-kr');
    nextBase.final = { kind: 'builtin', id: 'DIRECT' };

    const overlay: TemplateOverlayOp[] = [
      // 0: target missing (netflix removed by upstream)
      { op: 'setCardOverride', cardId: 'netflix', overrides: { name: 'My Netflix' } },
      // 1: duplicate add (discord now added by upstream)
      { op: 'addCard', cardId: 'discord' },
      // 2: 3-way upstream modified (both upstream & user modified youtube)
      { op: 'setCardOverride', cardId: 'youtube', overrides: { name: 'My YouTube' } },
      // 3: target missing on region group (region-kr removed by upstream)
      { op: 'updateRegionGroup', regionGroupId: 'region-kr', patch: { type: 'fallback' } },
      // 4: 3-way upstream modified on final + invalid reference to deleted card
      { op: 'setFinal', final: { kind: 'card', cardId: 'netflix' } },
    ];

    const rebased = rebaseOverlay(prevBase, nextBase, overlay);
    expect(rebased.hasConflicts).toBe(true);
    expect(rebased.conflicts.map((c) => [c.opIndex, c.reason, c.targetId])).toEqual([
      [0, 'TARGET_MISSING', 'netflix'],
      [1, 'DUPLICATE_ADD', 'discord'],
      [2, 'UPSTREAM_MODIFIED', 'youtube'],
      [3, 'TARGET_MISSING', 'region-kr'],
      [4, 'INVALID_REFERENCE', 'netflix'],
    ]);

    // User resolves conflicts: drop 0, 1, 3; keep 2; retarget 4 to final-fallback
    const cleanedOverlay = resolveOverlayConflicts(overlay, [
      { opIndex: 0, action: 'drop' },
      { opIndex: 1, action: 'drop' },
      { opIndex: 2, action: 'keep' },
      { opIndex: 3, action: 'drop' },
      {
        opIndex: 4,
        action: 'retarget',
        replacement: { op: 'setFinal', final: { kind: 'card', cardId: 'final-fallback' } },
      },
    ]);

    const afterResolution = applyOverlay(nextBase, cleanedOverlay);
    expect(afterResolution.conflicts).toEqual([]);
    expect(afterResolution.resolved.cards.find((c) => c.cardId === 'youtube')?.overrides?.name).toBe('My YouTube');
    expect(afterResolution.resolved.final).toEqual({ kind: 'card', cardId: 'final-fallback' });
  });

  it('reports anchor-missing conflicts when moveCard or addCard references a removed anchor', () => {
    const prevBase = cloneLightBase();
    const nextBase = cloneLightBase();
    nextBase.cards = nextBase.cards.filter((c) => c.cardId !== 'telegram');

    const overlay: TemplateOverlayOp[] = [
      { op: 'moveCard', cardId: 'github', afterCardId: 'telegram' },
      { op: 'addCard', cardId: 'discord', beforeCardId: 'telegram' },
    ];

    const rebased = rebaseOverlay(prevBase, nextBase, overlay);
    expect(rebased.conflicts.map((c) => c.reason)).toEqual(['ANCHOR_MISSING', 'ANCHOR_MISSING']);
    // addCard still appends at end so user data isn't silently lost
    expect(rebased.resolved.cards.at(-1)?.cardId).toBe('discord');
  });
});
