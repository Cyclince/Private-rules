import type { TemplateClientId } from '../../../shared/clients';
import { compileLoon } from './loon';
import { compileMihomo } from './mihomo';
import { compileQuanx } from './quanx';
import { compileShadowrocket } from './shadowrocket';
import { compileSingbox } from './singbox';
import { compileStash } from './stash';
import { compileSurge } from './surge';
import type { CompiledConfigResult, CompileTemplateInput } from './types';

export {
  compileLoon,
  quoteLoonParam,
  sanitizeLoonFilterName,
  sanitizeLoonGroupName,
  sanitizeLoonNodeName,
  sanitizeLoonRuleValue,
  sanitizeLoonScalar,
  sanitizeLoonUrl,
} from './loon';
export {
  compileMihomo,
  sanitizeMihomoGroupName,
  sanitizeMihomoNodeName,
  sanitizeMihomoProviderKey,
  sanitizeMihomoRuleValue,
  sanitizeMihomoScalar,
} from './mihomo';
export {
  compileQuanx,
  sanitizeQuanxGroupName,
  sanitizeQuanxNodeName,
  sanitizeQuanxRuleValue,
  sanitizeQuanxScalar,
  sanitizeQuanxUrl,
} from './quanx';
export {
  compileShadowrocket,
  quoteShadowrocketParam,
  sanitizeShadowrocketGroupName,
  sanitizeShadowrocketNodeName,
  sanitizeShadowrocketRuleValue,
  sanitizeShadowrocketScalar,
  sanitizeShadowrocketUrl,
} from './shadowrocket';
export {
  SINGBOX_MIN_VERSION,
  compileSingbox,
  formatSingboxDuration,
  mapParsedNodeToSingboxOutbound,
  sanitizeSingboxRuleSetTag,
  sanitizeSingboxScalar,
  sanitizeSingboxTag,
} from './singbox';
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
    case 'sing-box':
      return compileSingbox(input);
    case 'loon':
      return compileLoon(input);
    case 'quantumult-x':
      return compileQuanx(input);
    case 'shadowrocket':
      return compileShadowrocket(input);
    default:
      throw new Error(`Unsupported compiler target client: ${client}`);
  }
}
