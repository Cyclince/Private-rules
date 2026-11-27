import type { z } from 'zod';
import type { TemplateClientId } from '../../../shared/clients';
import type { ComplexityTier } from '../../../shared/schemas/template';
import type { ResolvedTemplate } from '../model';

export type EnhancementModuleAffect = 'dns' | 'rules' | 'groups' | 'final' | 'providers' | 'runtime';

/** Logical UI / classification buckets for enhancement modules (design §5.2). */
export const MODULE_GROUPS = ['dns-privacy', 'accuracy', 'direct', 'runtime'] as const;
export type ModuleGroup = (typeof MODULE_GROUPS)[number];

export type ModuleTierDefaults = Readonly<Record<ComplexityTier, boolean>>;

export type ModuleGroupDefinition = {
  id: ModuleGroup;
  name: string;
  icon: string;
  description: string;
  order: number;
};

export type ModuleCompileContext = {
  /** Target client being compiled for; omit when applying client-agnostically (e.g. probe/preview). */
  client?: TemplateClientId;
  /** Validated module parameters from `TemplateModuleBinding.params`. */
  params?: Record<string, unknown>;
};

export type EnhancementModuleMetadata = {
  id: string;
  name: string;
  icon: string;
  group: ModuleGroup;
  description: string;
  defaultEnabled: boolean;
  tierDefaults: ModuleTierDefaults;
  /** Deterministic execution order (lower runs first). */
  order: number;
  affects: readonly EnhancementModuleAffect[];
  conflictsWith?: readonly string[];
  conflictReasons?: Readonly<Record<string, string>>;
  supportedClients: readonly TemplateClientId[];
};

export type EnhancementModule = EnhancementModuleMetadata & {
  paramsSchema?: z.ZodType<Record<string, unknown>>;
  apply(template: ResolvedTemplate, ctx: ModuleCompileContext): ResolvedTemplate;
  /**
   * Optional hook for an explicitly disabled binding. Needed when the compiler writes a
   * capability unconditionally (e.g. mihomo's `sniffer`): the module layer cannot delete a
   * compiler-emitted key, so the hook neutralises it through a client patch instead.
   */
  onDisabled?(template: ResolvedTemplate, ctx: ModuleCompileContext): ResolvedTemplate;
};

export type ModuleGroupBucket = ModuleGroupDefinition & {
  modules: readonly EnhancementModule[];
};

export type ModuleConflict = {
  moduleA: string;
  moduleB: string;
  reason: string;
};

export type ModuleValidationError = {
  code: 'MODULE_CONFLICT' | 'UNKNOWN_MODULE' | 'INVALID_MODULE_PARAMS';
  moduleId: string;
  conflictWith?: string;
  message: string;
};

export type ModuleValidationResult = {
  ok: boolean;
  conflicts: ModuleConflict[];
  errors: ModuleValidationError[];
};

export class ModuleConflictError extends Error {
  readonly code = 'MODULE_CONFLICT' as const;
  readonly conflicts: ModuleConflict[];
  readonly errors: ModuleValidationError[];

  constructor(message: string, conflicts: ModuleConflict[], errors: ModuleValidationError[]) {
    super(message);
    this.name = 'ModuleConflictError';
    this.conflicts = conflicts;
    this.errors = errors;
  }
}

export type ModuleSkipRecord = {
  moduleId: string;
  moduleName: string;
  reason: 'unsupported-client';
  client: TemplateClientId;
  message: string;
};

export type ApplyModulesResult = {
  template: ResolvedTemplate;
  applied: string[];
  /** Modules whose explicit `enabled: false` binding ran an `onDisabled` hook. */
  disabled: string[];
  skipped: ModuleSkipRecord[];
  notes: string[];
};
