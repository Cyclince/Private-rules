import type { TemplateClientId } from '../../../shared/clients';
import type { NodeFilter } from '../../../shared/schemas/card';
import type { NodePool, NodeSlot } from '../../../shared/schemas/template';
import { filterNodes } from '../../nodes/filter';
import { detectRegexDialectIssues } from '../../nodes/regex';
import { getRegionDefinition } from '../../nodes/regions';
import type { CompatibilityItem, CompiledNodeSlotBinding, CompileTemplateInput } from './types';

/** Normalizes optional `slotBindings` input (Map or plain Record) into a Map. */
export function toSlotBindingMap(
  bindings?: CompileTemplateInput['slotBindings'],
): Map<string, CompiledNodeSlotBinding> {
  if (!bindings) return new Map();
  if (bindings instanceof Map) return new Map(bindings);
  return new Map(Object.entries(bindings));
}

/** Converts a non-stability `NodePool` into the equivalent `NodeFilter` (or `undefined` for all nodes). */
export function poolToNodeFilter(pool: NodePool): NodeFilter | undefined {
  if (pool.kind === 'stability') {
    return undefined;
  }
  const hasRegion = pool.kind === 'region' && Boolean(pool.region);
  const hasInclude = Boolean(pool.include?.trim());
  const hasExclude = Boolean(pool.exclude?.trim());
  if (!hasRegion && !hasInclude && !hasExclude) {
    return undefined;
  }
  return {
    ...(hasRegion && pool.region ? { regions: [pool.region] } : {}),
    ...(hasInclude && pool.include ? { include: pool.include } : {}),
    ...(hasExclude && pool.exclude ? { exclude: pool.exclude } : {}),
  };
}

/** Builds structured compatibility report location metadata for a `NodePool`. */
export function poolCompatibilityLocation(
  pool: NodePool,
  hasExplicitPools: boolean,
  extra?: { cardId?: string; slotId?: string },
): CompatibilityItem['location'] {
  if (pool.kind === 'region') {
    return {
      ...extra,
      regionGroupId: pool.id,
      ...(hasExplicitPools ? { poolId: pool.id } : {}),
    };
  }
  return {
    ...extra,
    poolId: pool.id,
  };
}

/** Checks whether a user-supplied regex is invalid or structurally incapable of matching nodes. */
export function isRegexObviouslyUnmatchable(pattern: string, client: TemplateClientId): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  const issues = detectRegexDialectIssues(trimmed, client);
  if (issues.some((issue) => issue.code === 'INVALID_REGEX')) {
    return true;
  }
  const stripped = trimmed.replace(/^\(\?[imsx-]+\)/, '');
  if (
    stripped === '(?!)' ||
    stripped === '(?!.*)' ||
    stripped === '(?!.)' ||
    stripped === '^$' ||
    stripped === 'a^' ||
    stripped === '$a' ||
    /^\(\?![^)]*\)$/.test(stripped)
  ) {
    return true;
  }
  return false;
}

/** Extracts known node names from Class-B slot bindings (`inline` / `snapshot`). */
export function extractSlotKnownNodeNames(
  slot: NodeSlot,
  binding: CompiledNodeSlotBinding | undefined,
): { known: boolean; names: string[] } {
  if (!binding || binding.kind === 'http' || binding.kind === 'file') {
    return { known: false, names: [] };
  }
  const rawNames =
    binding.kind === 'inline' ? binding.proxies.map((proxy) => proxy.name) : binding.nodes.map((node) => node.name);
  return {
    known: true,
    names: filterNodes(rawNames, undefined, { excludeInfo: slot.excludeInfo !== false }),
  };
}

export type PoolEmptyProtectionResult = {
  fallbackToAll: boolean;
  reason?: 'unmatchable-regex' | 'empty-known-nodes';
  message?: string;
};

/**
 * Implements §3.3 empty-pool protection during compilation:
 * - Always checks obviously invalid/unmatchable regexes & unknown region codes
 * - When targeted slots are Class-B (`snapshot`/`inline` with known nodes), degrades to
 *   all-nodes reference if 0 nodes match
 * - Does NOT judge Class-A (`http`/`file`/unbound) provider subscriptions by node count
 */
export function evaluatePoolEmptyProtection(options: {
  pool: NodePool;
  client: TemplateClientId;
  slots: readonly NodeSlot[];
  slotById: ReadonlyMap<string, NodeSlot>;
  slotBindings: ReadonlyMap<string, CompiledNodeSlotBinding>;
  allowEmptyNodeFallback?: boolean;
}): PoolEmptyProtectionResult {
  const { pool, client, slots, slotById, slotBindings } = options;
  if (pool.kind === 'stability') {
    return { fallbackToAll: false };
  }

  if (pool.kind === 'region' && (!pool.region || !getRegionDefinition(pool.region))) {
    return {
      fallbackToAll: true,
      reason: 'unmatchable-regex',
      message: `节点池「${pool.name}」地区代码 ${pool.region ?? '(空)'} 未知，已退化为引用全部节点。`,
    };
  }

  if (
    (pool.include && isRegexObviouslyUnmatchable(pool.include, client)) ||
    (pool.exclude && isRegexObviouslyUnmatchable(pool.exclude, client))
  ) {
    return {
      fallbackToAll: true,
      reason: 'unmatchable-regex',
      message: `节点池「${pool.name}」的正则条件无效或明显无法匹配任何节点，已退化为引用全部节点。`,
    };
  }

  if (options.allowEmptyNodeFallback === false) {
    return { fallbackToAll: false };
  }

  const targetSlotIds = pool.sources === 'all' ? slots.map((slot) => slot.id) : pool.sources;
  if (targetSlotIds.length === 0) {
    return { fallbackToAll: false };
  }

  let hasAnyClassASlot = false;
  let hasAnyKnownClassBSlot = false;
  const knownTargetNodeNames: string[] = [];

  for (const slotId of targetSlotIds) {
    const slot = slotById.get(slotId);
    if (!slot) continue;
    const binding = slotBindings.get(slotId);
    const extracted = extractSlotKnownNodeNames(slot, binding);
    if (!extracted.known) {
      hasAnyClassASlot = true;
    } else {
      hasAnyKnownClassBSlot = true;
      knownTargetNodeNames.push(...extracted.names);
    }
  }

  // Class-A provider slots cannot pre-determine node lists; skip node-count judgment.
  if (hasAnyClassASlot || !hasAnyKnownClassBSlot) {
    return { fallbackToAll: false };
  }

  // If the targeted slot(s) have known nodes (> 0) and filtering produces 0 nodes, degrade to all nodes.
  if (knownTargetNodeNames.length > 0) {
    const nodeFilter = poolToNodeFilter(pool);
    if (nodeFilter) {
      const matched = filterNodes(knownTargetNodeNames, nodeFilter, { excludeInfo: false });
      if (matched.length === 0) {
        return {
          fallbackToAll: true,
          reason: 'empty-known-nodes',
          message: `节点池「${pool.name}」在当前节点下匹配 0 个节点，已退化为引用全部节点。`,
        };
      }
    }
  }

  return { fallbackToAll: false };
}

/** Resolves ordered member group names/tags for a `stability` pool. */
export function resolveStabilityPoolMembers(
  pool: NodePool,
  poolGroupNameById: ReadonlyMap<string, string>,
  items: CompatibilityItem[],
  hasExplicitPools: boolean,
): string[] {
  const members: string[] = [];
  for (const memberId of pool.members ?? []) {
    if (memberId === pool.id) {
      items.push({
        code: 'MISSING_POOL_REFERENCE',
        severity: 'warning',
        message: `稳定性节点池「${pool.name}」存在自引用 ${memberId}，已忽略。`,
        location: poolCompatibilityLocation(pool, hasExplicitPools),
      });
      continue;
    }
    const targetName = poolGroupNameById.get(memberId);
    if (!targetName) {
      items.push({
        code: 'MISSING_POOL_REFERENCE',
        severity: 'warning',
        message: `稳定性节点池「${pool.name}」引用的节点池 ${memberId} 不存在，已忽略。`,
        location: poolCompatibilityLocation(pool, hasExplicitPools),
      });
      continue;
    }
    if (!members.includes(targetName)) {
      members.push(targetName);
    }
  }
  return members;
}
