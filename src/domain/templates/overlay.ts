import type { AppCardOverride, PolicyRef } from '../../shared/schemas/card';
import type { TemplateBody, TemplateOverlayOp } from '../../shared/schemas/template';

export type OverlayConflictReason =
  'TARGET_MISSING' | 'ANCHOR_MISSING' | 'DUPLICATE_ADD' | 'UPSTREAM_MODIFIED' | 'INVALID_REFERENCE';

export type ConflictAction = 'keep' | 'drop' | 'retarget';

export type OverlayConflict = {
  opIndex: number;
  op: TemplateOverlayOp;
  reason: OverlayConflictReason;
  targetId: string;
  message: string;
  suggestedActions: readonly ConflictAction[];
};

export type OverlayApplyResult = {
  resolved: TemplateBody;
  conflicts: OverlayConflict[];
  appliedCount: number;
};

export type RebaseDiff = {
  addedCards: string[];
  removedCards: string[];
  reorderedCards: boolean;
  modifiedCards: string[];
  addedRegionGroups: string[];
  removedRegionGroups: string[];
  addedSlots: string[];
  removedSlots: string[];
  finalChanged: boolean;
  dnsChanged: boolean;
  groupModeChanged: boolean;
  outputChanged: boolean;
  modulesChanged: boolean;
};

export type RebaseResult = {
  resolved: TemplateBody;
  conflicts: OverlayConflict[];
  diff: RebaseDiff;
  hasConflicts: boolean;
};

export type ConflictResolution =
  | { opIndex: number; action: 'keep' }
  | { opIndex: number; action: 'drop' }
  | { opIndex: number; action: 'retarget'; replacement: TemplateOverlayOp };

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function mergeCardOverrides(existing: AppCardOverride | undefined, incoming: AppCardOverride): AppCardOverride {
  const merged: AppCardOverride = {
    ...existing,
    ...incoming,
  };
  if (existing?.group || incoming.group) {
    merged.group = {
      ...existing?.group,
      ...incoming.group,
    };
  }
  return merged;
}

function validatePolicyRefExists(body: TemplateBody, ref: PolicyRef): string | null {
  if (ref.kind === 'builtin') return null;
  if (ref.kind === 'card') {
    return body.cards.some((card) => card.cardId === ref.cardId) ? null : ref.cardId;
  }
  if (ref.kind === 'region') {
    return body.regionGroups.some((group) => group.id === ref.regionGroupId) ? null : ref.regionGroupId;
  }
  return body.slots.some((slot) => slot.id === ref.slotId) ? null : ref.slotId;
}

/**
 * Deterministically replays a sequence of `TemplateOverlayOp` operations on top
 * of a `baseBody` without mutating inputs (design §10.3).
 */
export function applyOverlay(baseBody: TemplateBody, overlay: readonly TemplateOverlayOp[]): OverlayApplyResult {
  const resolved: TemplateBody = structuredClone(baseBody);
  const conflicts: OverlayConflict[] = [];
  let appliedCount = 0;

  overlay.forEach((op, opIndex) => {
    switch (op.op) {
      case 'addCard': {
        if (resolved.cards.some((card) => card.cardId === op.cardId)) {
          conflicts.push({
            opIndex,
            op,
            reason: 'DUPLICATE_ADD',
            targetId: op.cardId,
            message: `组件 ${op.cardId} 已存在于底稿中，无法重复添加。`,
            suggestedActions: ['drop', 'retarget'],
          });
          return;
        }
        const newEntry = {
          cardId: op.cardId,
          enabled: op.enabled ?? true,
          ...(op.overrides ? { overrides: structuredClone(op.overrides) } : {}),
        };
        if (op.afterCardId) {
          const anchorIdx = resolved.cards.findIndex((card) => card.cardId === op.afterCardId);
          if (anchorIdx === -1) {
            conflicts.push({
              opIndex,
              op,
              reason: 'ANCHOR_MISSING',
              targetId: op.afterCardId,
              message: `新增组件 ${op.cardId} 的锚点 ${op.afterCardId} 已不存在，已追加到末尾。`,
              suggestedActions: ['keep', 'retarget', 'drop'],
            });
            resolved.cards.push(newEntry);
          } else {
            resolved.cards.splice(anchorIdx + 1, 0, newEntry);
          }
        } else if (op.beforeCardId) {
          const anchorIdx = resolved.cards.findIndex((card) => card.cardId === op.beforeCardId);
          if (anchorIdx === -1) {
            conflicts.push({
              opIndex,
              op,
              reason: 'ANCHOR_MISSING',
              targetId: op.beforeCardId,
              message: `新增组件 ${op.cardId} 的锚点 ${op.beforeCardId} 已不存在，已追加到末尾。`,
              suggestedActions: ['keep', 'retarget', 'drop'],
            });
            resolved.cards.push(newEntry);
          } else {
            resolved.cards.splice(anchorIdx, 0, newEntry);
          }
        } else {
          resolved.cards.push(newEntry);
        }
        appliedCount += 1;
        return;
      }

      case 'removeCard': {
        const idx = resolved.cards.findIndex((card) => card.cardId === op.cardId);
        if (idx === -1) {
          conflicts.push({
            opIndex,
            op,
            reason: 'TARGET_MISSING',
            targetId: op.cardId,
            message: `要删除的组件 ${op.cardId} 在底稿中已不存在。`,
            suggestedActions: ['drop'],
          });
          return;
        }
        resolved.cards.splice(idx, 1);
        appliedCount += 1;
        return;
      }

      case 'moveCard': {
        const fromIdx = resolved.cards.findIndex((card) => card.cardId === op.cardId);
        if (fromIdx === -1) {
          conflicts.push({
            opIndex,
            op,
            reason: 'TARGET_MISSING',
            targetId: op.cardId,
            message: `要移动的组件 ${op.cardId} 在底稿中已不存在。`,
            suggestedActions: ['drop', 'retarget'],
          });
          return;
        }

        const [item] = resolved.cards.splice(fromIdx, 1);
        if (op.afterCardId) {
          const anchorIdx = resolved.cards.findIndex((card) => card.cardId === op.afterCardId);
          if (anchorIdx === -1) {
            resolved.cards.splice(fromIdx, 0, item);
            conflicts.push({
              opIndex,
              op,
              reason: 'ANCHOR_MISSING',
              targetId: op.afterCardId,
              message: `移动组件 ${op.cardId} 的目标锚点 ${op.afterCardId} 已不存在。`,
              suggestedActions: ['retarget', 'drop'],
            });
            return;
          }
          resolved.cards.splice(anchorIdx + 1, 0, item);
        } else if (op.beforeCardId) {
          const anchorIdx = resolved.cards.findIndex((card) => card.cardId === op.beforeCardId);
          if (anchorIdx === -1) {
            resolved.cards.splice(fromIdx, 0, item);
            conflicts.push({
              opIndex,
              op,
              reason: 'ANCHOR_MISSING',
              targetId: op.beforeCardId,
              message: `移动组件 ${op.cardId} 的目标锚点 ${op.beforeCardId} 已不存在。`,
              suggestedActions: ['retarget', 'drop'],
            });
            return;
          }
          resolved.cards.splice(anchorIdx, 0, item);
        } else if (op.toIndex !== undefined) {
          const clamped = Math.max(0, Math.min(op.toIndex, resolved.cards.length));
          resolved.cards.splice(clamped, 0, item);
        } else {
          resolved.cards.splice(fromIdx, 0, item);
        }
        appliedCount += 1;
        return;
      }

      case 'setCardEnabled': {
        const card = resolved.cards.find((entry) => entry.cardId === op.cardId);
        if (!card) {
          conflicts.push({
            opIndex,
            op,
            reason: 'TARGET_MISSING',
            targetId: op.cardId,
            message: `要修改启用状态的组件 ${op.cardId} 在底稿中已不存在。`,
            suggestedActions: ['drop', 'retarget'],
          });
          return;
        }
        card.enabled = op.enabled;
        appliedCount += 1;
        return;
      }

      case 'setCardOverride': {
        const card = resolved.cards.find((entry) => entry.cardId === op.cardId);
        if (!card) {
          conflicts.push({
            opIndex,
            op,
            reason: 'TARGET_MISSING',
            targetId: op.cardId,
            message: `要覆写的组件 ${op.cardId} 在底稿中已不存在。`,
            suggestedActions: ['drop', 'retarget'],
          });
          return;
        }
        if (op.overrides === null) {
          delete card.overrides;
        } else {
          if (op.overrides.group?.candidates) {
            for (const candidate of op.overrides.group.candidates) {
              const missingTarget = validatePolicyRefExists(resolved, candidate);
              if (missingTarget) {
                conflicts.push({
                  opIndex,
                  op,
                  reason: 'INVALID_REFERENCE',
                  targetId: missingTarget,
                  message: `组件 ${op.cardId} 的候选出口引用了不存在的目标 ${missingTarget}。`,
                  suggestedActions: ['retarget', 'drop', 'keep'],
                });
              }
            }
          }
          card.overrides = mergeCardOverrides(card.overrides, structuredClone(op.overrides));
        }
        appliedCount += 1;
        return;
      }

      case 'addRegionGroup': {
        if (resolved.regionGroups.some((group) => group.id === op.regionGroup.id)) {
          conflicts.push({
            opIndex,
            op,
            reason: 'DUPLICATE_ADD',
            targetId: op.regionGroup.id,
            message: `地区组 ${op.regionGroup.id} 已存在于底稿中。`,
            suggestedActions: ['drop', 'retarget'],
          });
          return;
        }
        resolved.regionGroups.push(structuredClone(op.regionGroup));
        appliedCount += 1;
        return;
      }

      case 'removeRegionGroup': {
        const idx = resolved.regionGroups.findIndex((group) => group.id === op.regionGroupId);
        if (idx === -1) {
          conflicts.push({
            opIndex,
            op,
            reason: 'TARGET_MISSING',
            targetId: op.regionGroupId,
            message: `要删除的地区组 ${op.regionGroupId} 在底稿中已不存在。`,
            suggestedActions: ['drop'],
          });
          return;
        }
        resolved.regionGroups.splice(idx, 1);
        appliedCount += 1;
        return;
      }

      case 'updateRegionGroup': {
        const group = resolved.regionGroups.find((entry) => entry.id === op.regionGroupId);
        if (!group) {
          conflicts.push({
            opIndex,
            op,
            reason: 'TARGET_MISSING',
            targetId: op.regionGroupId,
            message: `要更新的地区组 ${op.regionGroupId} 在底稿中已不存在。`,
            suggestedActions: ['drop', 'retarget'],
          });
          return;
        }
        if (op.patch.name !== undefined) group.name = op.patch.name;
        if (op.patch.region !== undefined) group.region = op.patch.region;
        if (op.patch.type !== undefined) group.type = op.patch.type;
        if (op.patch.extraInclude === null) delete group.extraInclude;
        else if (op.patch.extraInclude !== undefined) group.extraInclude = op.patch.extraInclude;
        if (op.patch.extraExclude === null) delete group.extraExclude;
        else if (op.patch.extraExclude !== undefined) group.extraExclude = op.patch.extraExclude;
        if (op.patch.test === null) delete group.test;
        else if (op.patch.test !== undefined) group.test = structuredClone(op.patch.test);
        if (op.patch.slotId === null) delete group.slotId;
        else if (op.patch.slotId !== undefined) group.slotId = op.patch.slotId;
        if (op.patch.hidden === null) delete group.hidden;
        else if (op.patch.hidden !== undefined) group.hidden = op.patch.hidden;
        appliedCount += 1;
        return;
      }

      case 'addSlot': {
        if (resolved.slots.some((slot) => slot.id === op.slot.id)) {
          conflicts.push({
            opIndex,
            op,
            reason: 'DUPLICATE_ADD',
            targetId: op.slot.id,
            message: `节点槽位 ${op.slot.id} 已存在于底稿中。`,
            suggestedActions: ['drop', 'retarget'],
          });
          return;
        }
        resolved.slots.push(structuredClone(op.slot));
        appliedCount += 1;
        return;
      }

      case 'removeSlot': {
        const idx = resolved.slots.findIndex((slot) => slot.id === op.slotId);
        if (idx === -1) {
          conflicts.push({
            opIndex,
            op,
            reason: 'TARGET_MISSING',
            targetId: op.slotId,
            message: `要删除的节点槽位 ${op.slotId} 在底稿中已不存在。`,
            suggestedActions: ['drop'],
          });
          return;
        }
        resolved.slots.splice(idx, 1);
        appliedCount += 1;
        return;
      }

      case 'updateSlot': {
        const slot = resolved.slots.find((entry) => entry.id === op.slotId);
        if (!slot) {
          conflicts.push({
            opIndex,
            op,
            reason: 'TARGET_MISSING',
            targetId: op.slotId,
            message: `要更新的节点槽位 ${op.slotId} 在底稿中已不存在。`,
            suggestedActions: ['drop', 'retarget'],
          });
          return;
        }
        if (op.patch.name !== undefined) slot.name = op.patch.name;
        if (op.patch.excludeInfo !== undefined) slot.excludeInfo = op.patch.excludeInfo;
        if (op.patch.udp === null) delete slot.udp;
        else if (op.patch.udp !== undefined) slot.udp = op.patch.udp;
        if (op.patch.healthCheck === null) delete slot.healthCheck;
        else if (op.patch.healthCheck !== undefined) slot.healthCheck = structuredClone(op.patch.healthCheck);
        appliedCount += 1;
        return;
      }

      case 'setGroupMode': {
        resolved.groupMode = op.groupMode;
        appliedCount += 1;
        return;
      }

      case 'setFinal': {
        const missingTarget = validatePolicyRefExists(resolved, op.final);
        if (missingTarget) {
          conflicts.push({
            opIndex,
            op,
            reason: 'INVALID_REFERENCE',
            targetId: missingTarget,
            message: `兜底出口引用的目标 ${missingTarget} 在底稿中不存在。`,
            suggestedActions: ['retarget', 'drop', 'keep'],
          });
        }
        resolved.final = structuredClone(op.final);
        appliedCount += 1;
        return;
      }

      case 'setOutput': {
        resolved.output = op.output;
        appliedCount += 1;
        return;
      }

      case 'setDns': {
        resolved.dns = structuredClone(op.dns);
        appliedCount += 1;
        return;
      }

      case 'setGeneral': {
        if (op.general === null) {
          delete resolved.general;
        } else {
          resolved.general = structuredClone(op.general);
        }
        appliedCount += 1;
        return;
      }

      case 'setModule': {
        const existing = resolved.modules.find((mod) => mod.id === op.moduleId);
        if (existing) {
          existing.enabled = op.enabled;
          if (op.params !== undefined) {
            existing.params = structuredClone(op.params);
          }
        } else {
          resolved.modules.push({
            id: op.moduleId,
            enabled: op.enabled,
            ...(op.params !== undefined ? { params: structuredClone(op.params) } : {}),
          });
        }
        appliedCount += 1;
        return;
      }

      case 'setPatch': {
        if (op.patch === null) {
          if (resolved.clientPatches) {
            delete resolved.clientPatches[op.client];
          }
        } else {
          resolved.clientPatches = {
            ...resolved.clientPatches,
            [op.client]: op.patch,
          };
        }
        appliedCount += 1;
        return;
      }

      case 'setLegacyGeodata': {
        if (op.legacyGeodata) {
          resolved.legacyGeodata = true;
        } else {
          delete resolved.legacyGeodata;
        }
        appliedCount += 1;
        return;
      }
    }
  });

  return {
    resolved,
    conflicts,
    appliedCount,
  };
}

function computeRebaseDiff(before: TemplateBody, after: TemplateBody): RebaseDiff {
  const beforeCardIds = before.cards.map((c) => c.cardId);
  const afterCardIds = after.cards.map((c) => c.cardId);
  const beforeCardMap = new Map(before.cards.map((c) => [c.cardId, c]));
  const afterCardMap = new Map(after.cards.map((c) => [c.cardId, c]));

  const addedCards = afterCardIds.filter((cardId) => !beforeCardMap.has(cardId));
  const removedCards = beforeCardIds.filter((cardId) => !afterCardMap.has(cardId));
  const commonBeforeOrder = beforeCardIds.filter((cardId) => afterCardMap.has(cardId));
  const commonAfterOrder = afterCardIds.filter((cardId) => beforeCardMap.has(cardId));
  const reorderedCards = !deepEqual(commonBeforeOrder, commonAfterOrder);

  const modifiedCards = commonAfterOrder.filter(
    (cardId) => !deepEqual(beforeCardMap.get(cardId), afterCardMap.get(cardId)),
  );

  const beforeRegionIds = new Set(before.regionGroups.map((g) => g.id));
  const afterRegionIds = new Set(after.regionGroups.map((g) => g.id));
  const addedRegionGroups = after.regionGroups.filter((g) => !beforeRegionIds.has(g.id)).map((g) => g.id);
  const removedRegionGroups = before.regionGroups.filter((g) => !afterRegionIds.has(g.id)).map((g) => g.id);

  const beforeSlotIds = new Set(before.slots.map((s) => s.id));
  const afterSlotIds = new Set(after.slots.map((s) => s.id));
  const addedSlots = after.slots.filter((s) => !beforeSlotIds.has(s.id)).map((s) => s.id);
  const removedSlots = before.slots.filter((s) => !afterSlotIds.has(s.id)).map((s) => s.id);

  return {
    addedCards,
    removedCards,
    reorderedCards,
    modifiedCards,
    addedRegionGroups,
    removedRegionGroups,
    addedSlots,
    removedSlots,
    finalChanged: !deepEqual(before.final, after.final),
    dnsChanged: !deepEqual(before.dns, after.dns),
    groupModeChanged: before.groupMode !== after.groupMode,
    outputChanged: before.output !== after.output,
    modulesChanged: !deepEqual(before.modules, after.modules),
  };
}

/**
 * Replays an existing user overlay onto an updated upstream base body,
 * reporting missing targets, duplicate adds, invalid references, and 3-way
 * upstream modifications alongside a diff against the previous resolved result
 * (design §10.3).
 */
export function rebaseOverlay(
  previousBase: TemplateBody,
  nextBase: TemplateBody,
  overlay: readonly TemplateOverlayOp[],
): RebaseResult {
  const before = applyOverlay(previousBase, overlay);
  const rebased = applyOverlay(nextBase, overlay);
  const conflicts: OverlayConflict[] = [...rebased.conflicts];
  const conflictedOpIndices = new Set(conflicts.map((item) => item.opIndex));

  const prevCardMap = new Map(previousBase.cards.map((c) => [c.cardId, c]));
  const nextCardMap = new Map(nextBase.cards.map((c) => [c.cardId, c]));
  const prevRegionMap = new Map(previousBase.regionGroups.map((g) => [g.id, g]));
  const nextRegionMap = new Map(nextBase.regionGroups.map((g) => [g.id, g]));
  const prevSlotMap = new Map(previousBase.slots.map((s) => [s.id, s]));
  const nextSlotMap = new Map(nextBase.slots.map((s) => [s.id, s]));

  // Detect 3-way conflicts where both upstream and the user overlay modified the same target.
  overlay.forEach((op, opIndex) => {
    if (conflictedOpIndices.has(opIndex)) return;

    if (op.op === 'setCardOverride' || op.op === 'setCardEnabled') {
      const prevCard = prevCardMap.get(op.cardId);
      const nextCard = nextCardMap.get(op.cardId);
      if (prevCard && nextCard && !deepEqual(prevCard, nextCard)) {
        conflicts.push({
          opIndex,
          op,
          reason: 'UPSTREAM_MODIFIED',
          targetId: op.cardId,
          message: `上游已更新组件 ${op.cardId}，同时本地修改层也修改了该组件。`,
          suggestedActions: ['keep', 'drop', 'retarget'],
        });
      }
    } else if (op.op === 'updateRegionGroup') {
      const prevGroup = prevRegionMap.get(op.regionGroupId);
      const nextGroup = nextRegionMap.get(op.regionGroupId);
      if (prevGroup && nextGroup && !deepEqual(prevGroup, nextGroup)) {
        conflicts.push({
          opIndex,
          op,
          reason: 'UPSTREAM_MODIFIED',
          targetId: op.regionGroupId,
          message: `上游已更新地区组 ${op.regionGroupId}，与本地修改存在重叠。`,
          suggestedActions: ['keep', 'drop', 'retarget'],
        });
      }
    } else if (op.op === 'updateSlot') {
      const prevSlot = prevSlotMap.get(op.slotId);
      const nextSlot = nextSlotMap.get(op.slotId);
      if (prevSlot && nextSlot && !deepEqual(prevSlot, nextSlot)) {
        conflicts.push({
          opIndex,
          op,
          reason: 'UPSTREAM_MODIFIED',
          targetId: op.slotId,
          message: `上游已更新节点槽位 ${op.slotId}，与本地修改存在重叠。`,
          suggestedActions: ['keep', 'drop', 'retarget'],
        });
      }
    } else if (op.op === 'setFinal' && !deepEqual(previousBase.final, nextBase.final)) {
      conflicts.push({
        opIndex,
        op,
        reason: 'UPSTREAM_MODIFIED',
        targetId: 'final',
        message: '上游已更改兜底出口，同时本地修改层也覆写了兜底出口。',
        suggestedActions: ['keep', 'drop', 'retarget'],
      });
    } else if (op.op === 'setDns' && !deepEqual(previousBase.dns, nextBase.dns)) {
      conflicts.push({
        opIndex,
        op,
        reason: 'UPSTREAM_MODIFIED',
        targetId: 'dns',
        message: '上游已更改 DNS 配置，同时本地修改层也覆写了 DNS 配置。',
        suggestedActions: ['keep', 'drop', 'retarget'],
      });
    }
  });

  conflicts.sort((a, b) => a.opIndex - b.opIndex);

  return {
    resolved: rebased.resolved,
    conflicts,
    diff: computeRebaseDiff(before.resolved, rebased.resolved),
    hasConflicts: conflicts.length > 0,
  };
}

/** Applies user conflict decisions (`keep` / `drop` / `retarget`) to produce a clean overlay list. */
export function resolveOverlayConflicts(
  overlay: readonly TemplateOverlayOp[],
  resolutions: readonly ConflictResolution[],
): TemplateOverlayOp[] {
  const byIndex = new Map<number, ConflictResolution>(resolutions.map((item) => [item.opIndex, item]));
  const result: TemplateOverlayOp[] = [];

  overlay.forEach((op, index) => {
    const decision = byIndex.get(index);
    if (!decision || decision.action === 'keep') {
      result.push(structuredClone(op));
    } else if (decision.action === 'retarget') {
      result.push(structuredClone(decision.replacement));
    }
    // `drop` omits the op
  });

  return result;
}
