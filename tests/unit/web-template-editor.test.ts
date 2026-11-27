import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_CARDS, buildStarterTemplate } from '../../src/builtin';
import type { OverlayConflict } from '../../src/domain/templates/overlay';
import type { TemplateOverlay } from '../../src/shared/schemas/template';
import {
  appendOverlayOp,
  buildAddCardOp,
  buildMoveCardOp,
  buildRetargetResolution,
  buildSortByStageOps,
  checkModuleToggleConflict,
  diffTemplateBodies,
  formatOverlayOpSummary,
  resolveDraftBody,
} from '../../src/web/components/templates/template-editor-helpers';
import {
  deleteTemplateDraft,
  isDraftDifferentFromServer,
  loadTemplateDraft,
  saveTemplateDraft,
  type TemplateDraftRecord,
} from '../../src/web/lib/template-drafts';

const cardMap = new Map(BUILTIN_CARDS.map((card) => [card.id, card]));

describe('template-editor-helpers', () => {
  it('buildMoveCardOp moves cards and synthesizes anchor-based moveCard ops', () => {
    const starter = buildStarterTemplate('all');
    const cards = starter.baseBody.cards;
    const result = buildMoveCardOp(cards, 'domestic-direct', 'microsoft');
    expect(result).not.toBeNull();
    expect(result!.op.op).toBe('moveCard');
    if (result!.op.op === 'moveCard') {
      expect(result!.op.cardId).toBe('domestic-direct');
      expect(result!.op.afterCardId ?? result!.op.beforeCardId).toBeTruthy();
    }
    const domIdx = result!.nextCards.findIndex((c) => c.cardId === 'domestic-direct');
    const msIdx = result!.nextCards.findIndex((c) => c.cardId === 'microsoft');
    expect(domIdx).toBeLessThan(msIdx);

    // Same card returns null
    expect(buildMoveCardOp(cards, 'microsoft', 'microsoft')).toBeNull();
  });

  it('buildAddCardOp places a new card inside its canonical 7-layer stage', () => {
    const starter = buildStarterTemplate('minimal');
    const aiCard = cardMap.get('ai-services')!;
    const addOp = buildAddCardOp(starter.baseBody.cards, cardMap, aiCard);
    expect(addOp.op).toBe('addCard');
    if (addOp.op === 'addCard') {
      expect(addOp.cardId).toBe('ai-services');
      expect(addOp.enabled).toBe(true);
    }

    const resolved = resolveDraftBody(starter.baseBody, [addOp]);
    const lanIdx = resolved.cards.findIndex((c) => c.cardId === 'lan-direct');
    const aiIdx = resolved.cards.findIndex((c) => c.cardId === 'ai-services');
    const domIdx = resolved.cards.findIndex((c) => c.cardId === 'domestic-direct');
    expect(aiIdx).toBeGreaterThan(lanIdx);
    expect(aiIdx).toBeLessThan(domIdx);
  });

  it('buildSortByStageOps restores out-of-order cards back to 7-layer stage order', () => {
    const starter = buildStarterTemplate('light');
    const moved = buildMoveCardOp(starter.baseBody.cards, 'domestic-direct', 'ai-services')!;
    const sortOps = buildSortByStageOps(moved.nextCards, cardMap);
    expect(sortOps.length).toBeGreaterThan(0);

    const restored = resolveDraftBody(starter.baseBody, [moved.op, ...sortOps]);
    const aiIdx = restored.cards.findIndex((c) => c.cardId === 'ai-services');
    const domIdx = restored.cards.findIndex((c) => c.cardId === 'domestic-direct');
    expect(domIdx).toBeGreaterThan(aiIdx);

    // Already sorted returns empty ops
    expect(buildSortByStageOps(restored.cards, cardMap)).toEqual([]);
  });

  it('appendOverlayOp compacts singleton scalar ops while preserving card sequences', () => {
    let overlay: TemplateOverlay = [];
    overlay = appendOverlayOp(overlay, { op: 'setGroupMode', groupMode: 'fallback' });
    overlay = appendOverlayOp(overlay, { op: 'setGroupMode', groupMode: 'select' });
    overlay = appendOverlayOp(overlay, { op: 'setModule', moduleId: 'dns-leak-guard', enabled: true });
    overlay = appendOverlayOp(overlay, { op: 'setModule', moduleId: 'dns-leak-guard', enabled: false });
    overlay = appendOverlayOp(overlay, { op: 'setPatch', client: 'mihomo', patch: 'tun:\n  enable: true' });
    overlay = appendOverlayOp(overlay, { op: 'setPatch', client: 'mihomo', patch: 'tun:\n  enable: false' });

    expect(overlay).toHaveLength(3);
    expect(overlay[0]).toEqual({ op: 'setGroupMode', groupMode: 'select' });
    expect(overlay[1]).toEqual({ op: 'setModule', moduleId: 'dns-leak-guard', enabled: false });
    expect(overlay[2]).toEqual({ op: 'setPatch', client: 'mihomo', patch: 'tun:\n  enable: false' });
  });

  it('checkModuleToggleConflict blocks mutually exclusive DNS enhancement modules', () => {
    const withDnsLeak = [{ id: 'dns-leak-guard', enabled: true }];
    const blockResult = checkModuleToggleConflict(withDnsLeak, 'block-encrypted-dns', true);
    expect(blockResult.allowed).toBe(false);
    expect(blockResult.conflictWith).toBe('dns-leak-guard');
    expect(blockResult.reason).toBeTruthy();

    // Reverse direction
    const withBlockDoH = [{ id: 'block-encrypted-dns', enabled: true }];
    const reverseResult = checkModuleToggleConflict(withBlockDoH, 'dns-leak-guard', true);
    expect(reverseResult.allowed).toBe(false);
    expect(reverseResult.conflictWith).toBe('block-encrypted-dns');

    // Disabling is always allowed
    expect(checkModuleToggleConflict(withDnsLeak, 'dns-leak-guard', false).allowed).toBe(true);

    // Compatible module combination is allowed
    expect(checkModuleToggleConflict(withDnsLeak, 'game-download-direct', true).allowed).toBe(true);
  });

  it('diffTemplateBodies summarizes card, mode, module, and patch differences', () => {
    const before = buildStarterTemplate('all').baseBody;
    const after = resolveDraftBody(before, [
      { op: 'setGroupMode', groupMode: 'fallback' },
      { op: 'setModule', moduleId: 'dns-leak-guard', enabled: true },
      { op: 'setPatch', client: 'mihomo', patch: 'ipv6: true' },
      { op: 'removeCard', cardId: 'netflix' },
    ]);

    const diff = diffTemplateBodies(before, after);
    expect(diff.removedCards).toContain('netflix');
    expect(diff.groupModeChanged).toBe(true);
    expect(diff.modulesChanged).toBe(true);
    expect(diff.patchesChanged).toBe(true);
    expect(diff.lines.some((line) => line.kind === 'removed' && line.text.includes('netflix'))).toBe(true);
  });

  it('buildRetargetResolution builds valid replacement ops for rebase conflicts', () => {
    const anchorConflict: OverlayConflict = {
      opIndex: 0,
      op: { op: 'moveCard', cardId: 'ai-services', afterCardId: 'removed-card' },
      reason: 'ANCHOR_MISSING',
      message: 'Anchor missing',
    };
    const res1 = buildRetargetResolution(anchorConflict, 'google');
    expect(res1.action).toBe('retarget');
    expect(res1.replacement).toEqual({ op: 'moveCard', cardId: 'ai-services', afterCardId: 'google' });

    const cardConflict: OverlayConflict = {
      opIndex: 1,
      op: { op: 'setCardEnabled', cardId: 'old-card', enabled: false },
      reason: 'CARD_NOT_FOUND',
      message: 'Card missing',
    };
    const res2 = buildRetargetResolution(cardConflict, 'youtube');
    expect(res2.replacement).toEqual({ op: 'setCardEnabled', cardId: 'youtube', enabled: false });

    expect(formatOverlayOpSummary(res1.replacement!)).toContain('moveCard(ai-services');
  });
});

describe('template-drafts storage fallback & diffing', () => {
  const originalLocalStorage = globalThis.localStorage;

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
  });

  it('saves, loads, diffs, and deletes drafts via storage fallback when IndexedDB is unavailable', async () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      writable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
    });

    const starter = buildStarterTemplate('minimal');
    const draft: TemplateDraftRecord = {
      templateId: 'tpl-draft-1',
      baseVersion: 1,
      updatedAt: '2026-11-27T00:00:00.000Z',
      name: starter.name,
      slug: starter.slug,
      description: 'Updated local description',
      baseBody: starter.baseBody,
      overlay: [{ op: 'setOutput', output: 'minimal' }],
      note: 'WIP',
    };

    expect(isDraftDifferentFromServer(draft, starter)).toBe(true);
    expect(
      isDraftDifferentFromServer(
        {
          ...draft,
          description: starter.description,
          overlay: starter.overlay,
        },
        starter,
      ),
    ).toBe(false);

    await saveTemplateDraft(draft);
    const loaded = await loadTemplateDraft('tpl-draft-1');
    expect(loaded).toEqual(draft);

    await deleteTemplateDraft('tpl-draft-1');
    expect(await loadTemplateDraft('tpl-draft-1')).toBeNull();
  });
});
