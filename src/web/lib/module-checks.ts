import { validateModuleCombinationMetadata } from '../../domain/templates/modules/metadata';
import type { TemplateModuleBinding } from '../../shared/schemas/template';

/**
 * Conflict check for module switches (design §10.12). Separate from the advanced
 * editor helpers so the plain-language modules tab can use the pure domain
 * validator without the overlay engine.
 */
export type ModuleToggleCheck = {
  allowed: boolean;
  reason?: string;
  conflictWith?: string;
};

/**
 * Checks whether toggling `moduleId` to `nextEnabled` would create a module
 * conflict (design §10.12) using the pure domain validator.
 */
export function checkModuleToggleConflict(
  currentModules: readonly TemplateModuleBinding[],
  moduleId: string,
  nextEnabled: boolean,
): ModuleToggleCheck {
  if (!nextEnabled) return { allowed: true };
  const exists = currentModules.some((m) => m.id === moduleId);
  const candidate: TemplateModuleBinding[] = exists
    ? currentModules.map((m) => (m.id === moduleId ? { ...m, enabled: true } : m))
    : [...currentModules, { id: moduleId, enabled: true }];

  const result = validateModuleCombinationMetadata(candidate);
  if (result.ok) return { allowed: true };
  const firstConflict = result.conflicts[0];
  if (firstConflict) {
    return {
      allowed: false,
      reason: firstConflict.reason,
      conflictWith: firstConflict.moduleA === moduleId ? firstConflict.moduleB : firstConflict.moduleA,
    };
  }
  return {
    allowed: false,
    reason: result.errors[0]?.message ?? 'Module combination is invalid.',
  };
}
