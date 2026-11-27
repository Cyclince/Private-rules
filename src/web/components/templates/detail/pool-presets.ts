import { REGION_POOLS, TRAIT_POOLS } from '../../../../builtin/pools';
import type { NodePool } from '../../../../shared/schemas/template';
import type { GroupType } from '../../../../shared/schemas/card';
import { clonePool } from '../../../../domain/nodes/pool-preview';

/** Region presets offered from the advanced tier on (design §3.2). */
export function regionPresetPools(): readonly NodePool[] {
  return REGION_POOLS;
}

/** Trait presets (low rate, residential, dedicated, gaming) for the professional tier. */
export function traitPresetPools(): readonly NodePool[] {
  return TRAIT_POOLS;
}

export function clonePresetPool(pool: NodePool): NodePool {
  return clonePool(pool);
}

export const POOL_TYPE_OPTIONS: ReadonlyArray<{ value: GroupType; labelKey: string }> = [
  { value: 'url-test', labelKey: 'templateDetail.poolType.url-test' },
  { value: 'select', labelKey: 'templateDetail.poolType.select' },
  { value: 'fallback', labelKey: 'templateDetail.poolType.fallback' },
  { value: 'load-balance', labelKey: 'templateDetail.poolType.load-balance' },
];

/**
 * Builds the professional tier's custom trait pool. Ids are stable per creation
 * so later overlay updates can target the same pool.
 */
export function buildCustomPool(input: {
  id: string;
  name: string;
  include?: string;
  exclude?: string;
  sources: 'all' | string[];
  type: GroupType;
  visible: boolean;
  test?: NodePool['test'];
}): NodePool {
  return {
    id: input.id,
    name: input.name,
    sources: input.sources,
    ...(input.include ? { include: input.include } : {}),
    ...(input.exclude ? { exclude: input.exclude } : {}),
    kind: 'trait',
    type: input.type,
    ...(input.test ? { test: input.test } : {}),
    hidden: !input.visible,
  };
}
