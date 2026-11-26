import type { TemplateClientId } from '../../../shared/clients';
import type { TemplateModuleBinding } from '../../../shared/schemas/template';
import type { ResolvedTemplate } from '../model';
import { BLOCK_ENCRYPTED_DNS_CARD_ID, blockEncryptedDnsModule } from './block-encrypted-dns';
import { DNS_LEAK_FINAL_CARD_ID, dnsLeakGuardModule } from './dns-leak';
import { GAME_DOWNLOAD_DIRECT_CARD_ID, gameDownloadDirectModule } from './game-download';
import { ipNoResolveModule } from './no-resolve';
import { TUNNEL_DIRECT_CARD_ID, tunnelDirectModule } from './tunnel-direct';
import {
  ModuleConflictError,
  type ApplyModulesResult,
  type EnhancementModule,
  type ModuleConflict,
  type ModuleSkipRecord,
  type ModuleValidationError,
  type ModuleValidationResult,
} from './types';

export {
  BLOCK_ENCRYPTED_DNS_CARD_ID,
  DNS_LEAK_FINAL_CARD_ID,
  GAME_DOWNLOAD_DIRECT_CARD_ID,
  TUNNEL_DIRECT_CARD_ID,
  ModuleConflictError,
  blockEncryptedDnsModule,
  dnsLeakGuardModule,
  gameDownloadDirectModule,
  ipNoResolveModule,
  tunnelDirectModule,
};
export type {
  ApplyModulesResult,
  EnhancementModule,
  EnhancementModuleAffect,
  ModuleCompileContext,
  ModuleConflict,
  ModuleSkipRecord,
  ModuleValidationError,
  ModuleValidationResult,
} from './types';

/** All 5 built-in enhancement modules in deterministic execution order (design §10.12). */
export const ENHANCEMENT_MODULES: readonly EnhancementModule[] = [
  blockEncryptedDnsModule,
  gameDownloadDirectModule,
  tunnelDirectModule,
  dnsLeakGuardModule,
  ipNoResolveModule,
];

const MODULE_MAP = new Map<string, EnhancementModule>(ENHANCEMENT_MODULES.map((mod) => [mod.id, mod]));

export function getEnhancementModule(id: string): EnhancementModule | undefined {
  return MODULE_MAP.get(id);
}

export function listEnhancementModules(): readonly EnhancementModule[] {
  return ENHANCEMENT_MODULES;
}

function toRegistryMap(registry?: readonly EnhancementModule[]): Map<string, EnhancementModule> {
  if (!registry) return MODULE_MAP;
  return new Map(registry.map((mod) => [mod.id, mod]));
}

/**
 * Validates a set of template module bindings for unknown modules, invalid
 * parameters, and mutually conflicting enabled modules (design §10.12).
 */
export function validateModuleCombination(
  bindings: readonly TemplateModuleBinding[],
  registry?: readonly EnhancementModule[],
): ModuleValidationResult {
  const regMap = toRegistryMap(registry);
  const enabledBindings = bindings.filter((b) => b.enabled);
  const enabledSet = new Set(enabledBindings.map((b) => b.id));
  const conflicts: ModuleConflict[] = [];
  const errors: ModuleValidationError[] = [];
  const seenConflictPairs = new Set<string>();

  for (const binding of enabledBindings) {
    const mod = regMap.get(binding.id);
    if (!mod) {
      errors.push({
        code: 'UNKNOWN_MODULE',
        moduleId: binding.id,
        message: `未知的增强模块：${binding.id}。`,
      });
      continue;
    }

    if (mod.paramsSchema && binding.params !== undefined) {
      const check = mod.paramsSchema.safeParse(binding.params);
      if (!check.success) {
        errors.push({
          code: 'INVALID_MODULE_PARAMS',
          moduleId: mod.id,
          message: `增强模块 ${mod.name}（${mod.id}）参数无效：${check.error.issues.map((i) => i.message).join('; ')}`,
        });
      }
    }

    for (const conflictId of mod.conflictsWith ?? []) {
      if (!enabledSet.has(conflictId)) continue;
      const pairKey = [mod.id, conflictId].sort().join('::');
      if (seenConflictPairs.has(pairKey)) continue;
      seenConflictPairs.add(pairKey);

      const other = regMap.get(conflictId);
      const reason =
        mod.conflictReasons?.[conflictId] ??
        other?.conflictReasons?.[mod.id] ??
        `增强模块「${mod.name}」与「${other?.name ?? conflictId}」互斥，不能同时启用。`;

      conflicts.push({
        moduleA: mod.id,
        moduleB: conflictId,
        reason,
      });
      errors.push({
        code: 'MODULE_CONFLICT',
        moduleId: mod.id,
        conflictWith: conflictId,
        message: reason,
      });
    }
  }

  return {
    ok: errors.length === 0,
    conflicts,
    errors,
  };
}

export type ApplyEnhancementModulesOptions = {
  /** Target client; unsupported modules are skipped and recorded in `skipped`. */
  client?: TemplateClientId;
  /** Override bindings instead of reading `template.body.modules`. */
  bindings?: readonly TemplateModuleBinding[];
  /** Custom module registry (defaults to the 5 built-in enhancement modules). */
  registry?: readonly EnhancementModule[];
};

/**
 * Purely applies all enabled enhancement modules to a resolved template in
 * deterministic order (design §10.12). Throws `ModuleConflictError` when
 * conflicting or invalid module combinations are enabled.
 */
export function applyEnhancementModules(
  template: ResolvedTemplate,
  options?: ApplyEnhancementModulesOptions,
): ApplyModulesResult {
  const bindings = options?.bindings ?? template.body.modules ?? [];
  const regMap = toRegistryMap(options?.registry);

  const validation = validateModuleCombination(bindings, options?.registry);
  if (!validation.ok) {
    throw new ModuleConflictError(
      validation.errors.map((e) => e.message).join(' '),
      validation.conflicts,
      validation.errors,
    );
  }

  const enabledMap = new Map<string, TemplateModuleBinding>();
  for (const binding of bindings) {
    if (binding.enabled) {
      enabledMap.set(binding.id, binding);
    }
  }

  const orderedModules = [...enabledMap.keys()].map((id) => regMap.get(id)!).sort((a, b) => a.order - b.order);

  let current = structuredClone(template);
  const applied: string[] = [];
  const skipped: ModuleSkipRecord[] = [];
  const notes: string[] = [];

  for (const mod of orderedModules) {
    const binding = enabledMap.get(mod.id)!;
    if (options?.client && !mod.supportedClients.includes(options.client)) {
      skipped.push({
        moduleId: mod.id,
        moduleName: mod.name,
        reason: 'unsupported-client',
        client: options.client,
        message: `增强模块「${mod.name}」不支持 ${options.client}，已跳过。`,
      });
      continue;
    }

    current = mod.apply(current, {
      client: options?.client,
      params: binding.params,
    });
    applied.push(mod.id);

    if (current.body.output === 'minimal' && mod.affects.includes('dns')) {
      notes.push(`模板当前输出档位为 minimal，增强模块「${mod.name}」对 DNS 的修改仅在 full 档位生效。`);
    }
  }

  return {
    template: current,
    applied,
    skipped,
    notes,
  };
}
