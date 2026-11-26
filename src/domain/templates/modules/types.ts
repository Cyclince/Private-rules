import type { z } from 'zod';
import type { TemplateClientId } from '../../../shared/clients';
import type { ResolvedTemplate } from '../model';

export type EnhancementModuleAffect = 'dns' | 'rules' | 'groups' | 'final' | 'providers';

export type ModuleCompileContext = {
  /** Target client being compiled for; omit when applying client-agnostically (e.g. probe/preview). */
  client?: TemplateClientId;
  /** Validated module parameters from `TemplateModuleBinding.params`. */
  params?: Record<string, unknown>;
};

export type EnhancementModule = {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  /** Deterministic execution order (lower runs first). */
  order: number;
  affects: readonly EnhancementModuleAffect[];
  conflictsWith?: readonly string[];
  conflictReasons?: Readonly<Record<string, string>>;
  supportedClients: readonly TemplateClientId[];
  paramsSchema?: z.ZodType<Record<string, unknown>>;
  apply(template: ResolvedTemplate, ctx: ModuleCompileContext): ResolvedTemplate;
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
  skipped: ModuleSkipRecord[];
  notes: string[];
};
