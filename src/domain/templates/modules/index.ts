import type { TemplateClientId } from '../../../shared/clients';
import type { ComplexityTier, TemplateModuleBinding } from '../../../shared/schemas/template';
import type { ResolvedTemplate } from '../model';
import { BLOCK_ENCRYPTED_DNS_CARD_ID, blockEncryptedDnsModule } from './block-encrypted-dns';
import { APPLE_PUSH_DIRECT_CARD_ID, applePushDirectModule } from './apple-push-direct';
import { BT_DIRECT_CARD_ID, btDirectModule } from './bt-direct';
import { DNS_LEAK_FINAL_CARD_ID, dnsLeakGuardModule } from './dns-leak';
import { DOMESTIC_APPS_DIRECT_CARD_ID, domesticAppsDirectModule } from './domestic-apps-direct';
import { GAME_DOWNLOAD_DIRECT_CARD_ID, gameDownloadDirectModule } from './game-download';
import { ipNoResolveModule } from './no-resolve';
import { PRIVACY_TRACKER_BLOCK_CARD_ID, privacyTrackerBlockModule } from './privacy-tracker-block';
import {
  MIHOMO_DEFAULT_SNIFFER_PATCH,
  MIHOMO_SNIFFER_DISABLED_PATCH,
  SNIFFER_MODULE_ID,
  shouldEmitSniffer,
  snifferModule,
} from './sniffer';
import { TUN_PATCH_KEY, TUN_MODE_MODULE_ID, tunModeModule } from './tun-mode';
import { TUNNEL_DIRECT_CARD_ID, tunnelDirectModule } from './tunnel-direct';
import {
  MODULE_GROUPS,
  ModuleConflictError,
  type ApplyModulesResult,
  type EnhancementModule,
  type ModuleConflict,
  type ModuleGroup,
  type ModuleGroupBucket,
  type ModuleGroupDefinition,
  type ModuleSkipRecord,
  type ModuleValidationError,
  type ModuleValidationResult,
} from './types';

export {
  APPLE_PUSH_DIRECT_CARD_ID,
  BLOCK_ENCRYPTED_DNS_CARD_ID,
  BT_DIRECT_CARD_ID,
  DNS_LEAK_FINAL_CARD_ID,
  DOMESTIC_APPS_DIRECT_CARD_ID,
  GAME_DOWNLOAD_DIRECT_CARD_ID,
  MIHOMO_DEFAULT_SNIFFER_PATCH,
  MIHOMO_SNIFFER_DISABLED_PATCH,
  PRIVACY_TRACKER_BLOCK_CARD_ID,
  SNIFFER_MODULE_ID,
  TUNNEL_DIRECT_CARD_ID,
  TUN_MODE_MODULE_ID,
  TUN_PATCH_KEY,
  MODULE_GROUPS,
  ModuleConflictError,
  applePushDirectModule,
  blockEncryptedDnsModule,
  btDirectModule,
  dnsLeakGuardModule,
  domesticAppsDirectModule,
  gameDownloadDirectModule,
  ipNoResolveModule,
  privacyTrackerBlockModule,
  shouldEmitSniffer,
  snifferModule,
  tunModeModule,
  tunnelDirectModule,
};
export type {
  ApplyModulesResult,
  EnhancementModule,
  EnhancementModuleAffect,
  ModuleCompileContext,
  ModuleConflict,
  ModuleGroup,
  ModuleGroupBucket,
  ModuleGroupDefinition,
  ModuleSkipRecord,
  ModuleTierDefaults,
  ModuleValidationError,
  ModuleValidationResult,
} from './types';

/** Ordered definitions of enhancement module UI groups (design §5.2). */
export const MODULE_GROUP_DEFINITIONS: readonly ModuleGroupDefinition[] = [
  {
    id: 'dns-privacy',
    name: 'DNS 与隐私',
    icon: '🛡️',
    description: '控制上游 DNS 行为、防止请求泄漏、阻断应用绕过加密 DNS，并拦截常见跟踪与遥测域名。',
    order: 10,
  },
  {
    id: 'accuracy',
    name: '识别准确度',
    icon: '🔍',
    description: '从加密流量还原域名、减少不必要的 DNS 触发，提升域名与 IP 规则分流准确度。',
    order: 20,
  },
  {
    id: 'direct',
    name: '直连优化',
    icon: '🏠',
    description: '将内网穿透、系统推送、国内常用应用与大流量下载直连分流。',
    order: 30,
  },
  {
    id: 'runtime',
    name: '运行',
    icon: '⚙️',
    description: '客户端运行时参数，例如路由器 / 透明代理下的 TUN 模式。',
    order: 40,
  },
];

/** All built-in enhancement modules in deterministic execution order (design §5.2). */
export const ENHANCEMENT_MODULES: readonly EnhancementModule[] = [
  privacyTrackerBlockModule,
  blockEncryptedDnsModule,
  snifferModule,
  gameDownloadDirectModule,
  applePushDirectModule,
  domesticAppsDirectModule,
  tunnelDirectModule,
  btDirectModule,
  dnsLeakGuardModule,
  ipNoResolveModule,
  tunModeModule,
];

/**
 * Cards contributed by enhancement modules. Compilers can mark these `hidden` so the module
 * cards do not inflate the visible group count (T1 targets 8–12 visible groups).
 */
export const MODULE_AUXILIARY_CARD_IDS: readonly string[] = [
  PRIVACY_TRACKER_BLOCK_CARD_ID,
  BLOCK_ENCRYPTED_DNS_CARD_ID,
  GAME_DOWNLOAD_DIRECT_CARD_ID,
  APPLE_PUSH_DIRECT_CARD_ID,
  DOMESTIC_APPS_DIRECT_CARD_ID,
  TUNNEL_DIRECT_CARD_ID,
  BT_DIRECT_CARD_ID,
];

const MODULE_MAP = new Map<string, EnhancementModule>(ENHANCEMENT_MODULES.map((mod) => [mod.id, mod]));

export function getEnhancementModule(id: string): EnhancementModule | undefined {
  return MODULE_MAP.get(id);
}

export function listEnhancementModules(): readonly EnhancementModule[] {
  return ENHANCEMENT_MODULES;
}

/**
 * Resolves the default `TemplateModuleBinding[]` list for a complexity tier (`simple` | `advanced` | `pro`)
 * from module `tierDefaults`, automatically resolving mutual conflicts (preferring `defaultEnabled: true`
 * modules such as `dns-leak-guard` over conflicting `block-encrypted-dns`) so the returned combination
 * always passes `validateModuleCombination` cleanly.
 */
export function buildDefaultModulesForComplexity(
  complexity: ComplexityTier,
  registry: readonly EnhancementModule[] = ENHANCEMENT_MODULES,
): TemplateModuleBinding[] {
  const ordered = [...registry].sort(
    (a, b) => Number(b.defaultEnabled) - Number(a.defaultEnabled) || a.order - b.order,
  );
  const enabledSet = new Set<string>();

  for (const mod of ordered) {
    if (!mod.tierDefaults[complexity]) continue;
    const conflictsWithAccepted = (mod.conflictsWith ?? []).some((id) => enabledSet.has(id));
    if (conflictsWithAccepted) continue;
    let conflictsReverse = false;
    for (const acceptedId of enabledSet) {
      const accepted = ordered.find((m) => m.id === acceptedId);
      if (accepted?.conflictsWith?.includes(mod.id)) {
        conflictsReverse = true;
        break;
      }
    }
    if (!conflictsReverse) {
      enabledSet.add(mod.id);
    }
  }

  return registry.map((mod) => ({
    id: mod.id,
    enabled: enabledSet.has(mod.id),
  }));
}

/** Returns enhancement modules grouped by §5.2 `group` buckets in stable order. */
export function listEnhancementModulesByGroup(
  registry: readonly EnhancementModule[] = ENHANCEMENT_MODULES,
): ModuleGroupBucket[] {
  const byGroup = new Map<ModuleGroup, EnhancementModule[]>();
  for (const groupId of MODULE_GROUPS) {
    byGroup.set(groupId, []);
  }
  for (const mod of registry) {
    const bucket = byGroup.get(mod.group);
    if (bucket) {
      bucket.push(mod);
    }
  }
  return [...MODULE_GROUP_DEFINITIONS]
    .sort((a, b) => a.order - b.order)
    .map((group) => ({
      ...group,
      modules: (byGroup.get(group.id) ?? []).slice().sort((a, b) => a.order - b.order),
    }));
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
  const disabled: string[] = [];
  const skipped: ModuleSkipRecord[] = [];
  const notes: string[] = [];

  // Explicitly disabled modules may still need to neutralise a compiler default (see `onDisabled`).
  // `minimal` output omits runtime sections altogether, so there is nothing to neutralise.
  for (const binding of bindings) {
    if (binding.enabled) continue;
    if (current.body.output === 'minimal') break;
    const mod = regMap.get(binding.id);
    if (!mod?.onDisabled) continue;
    if (!options?.client || !mod.supportedClients.includes(options.client)) continue;
    current = mod.onDisabled(current, { client: options.client, params: binding.params });
    disabled.push(mod.id);
  }

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
    if (current.body.output === 'minimal' && mod.affects.includes('runtime')) {
      notes.push(`模板当前输出档位为 minimal，增强模块「${mod.name}」写入的运行参数可能不完整，建议使用 full 档位。`);
    }
  }

  return {
    template: current,
    applied,
    disabled,
    skipped,
    notes,
  };
}
