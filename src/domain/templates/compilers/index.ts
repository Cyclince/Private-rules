import type { TemplateClientId } from '../../../shared/clients';
import { compileMihomo } from './mihomo';
import { compileStash } from './stash';
import { compileSurge } from './surge';
import type { CompiledConfigResult, CompileTemplateInput } from './types';

export {
  compileMihomo,
  sanitizeMihomoGroupName,
  sanitizeMihomoNodeName,
  sanitizeMihomoProviderKey,
  sanitizeMihomoRuleValue,
  sanitizeMihomoScalar,
} from './mihomo';
export {
  compileStash,
  sanitizeStashGroupName,
  sanitizeStashNodeName,
  sanitizeStashProviderKey,
  sanitizeStashRuleValue,
  sanitizeStashScalar,
} from './stash';
export {
  compileSurge,
  quoteSurgeParam,
  sanitizeSurgeGroupName,
  sanitizeSurgeNodeName,
  sanitizeSurgeRulesetName,
  sanitizeSurgeRuleValue,
  sanitizeSurgeScalar,
  sanitizeSurgeUrl,
} from './surge';
export type {
  CompatibilityItem,
  CompatibilityItemCode,
  CompatibilityReport,
  CompatibilitySeverity,
  CompileTemplateInput,
  CompiledConfigResult,
  CompiledNodeSlotBinding,
  InlineProxyNode,
} from './types';

/**
 * Dispatches template compilation to the target client's pure compiler.
 * Throws if called for a client without an active compiler implementation.
 */
export function compileTemplate(client: TemplateClientId, input: CompileTemplateInput): CompiledConfigResult {
  switch (client) {
    case 'mihomo':
      return compileMihomo(input);
    case 'stash':
      return compileStash(input);
    case 'surge':
      return compileSurge(input);
    default:
      throw new Error(`Unsupported compiler target client: ${client}`);
  }
}
