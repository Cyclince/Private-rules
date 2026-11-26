import type { OutputProfile, TemplateClientId } from '../../../shared/clients';
import type { CatalogEntry, RemoteRuleBehavior } from '../../../shared/schemas/card';
import type { TemplateBody } from '../../../shared/schemas/template';
import type { NodeParseReport, ParsedNode } from '../../nodes/parse';
import type { IconPackEntry } from '../icons';
import type { CardLookup } from '../model';
import type { EnhancementModule } from '../modules';

export type CompatibilitySeverity = 'info' | 'warning' | 'error';

export type CompatibilityItemCode =
  | 'UNSUPPORTED_RULE_TYPE'
  | 'UNSUPPORTED_GROUP_TYPE'
  | 'UNSUPPORTED_LOGICAL_RULE'
  | 'UNSUPPORTED_REMOTE_FORMAT'
  | 'UNSUPPORTED_PROVIDER_OPTION'
  | 'UNSUPPORTED_DNS_OPTION'
  | 'UNSUPPORTED_CLIENT_FEATURE'
  | 'MRS_CLASSICAL_DOWNGRADED'
  | 'GEOSITE_CONVERTED_TO_SELF_HOSTED'
  | 'PARTIAL_GEOSITE_SUPPORT'
  | 'MODULE_SKIPPED'
  | 'MODULE_NOTE'
  | 'MINIMAL_OMITTED_SECTIONS'
  | 'UNBOUND_NODE_SLOT'
  | 'STALE_NODE_SNAPSHOT'
  | 'SKIPPED_UNSUPPORTED_NODES'
  | 'MISSING_RULESET_URL'
  | 'CATALOG_ENTRY_MISSING'
  | 'MISSING_CARD_REFERENCE'
  | 'MISSING_REGION_REFERENCE'
  | 'MISSING_SLOT_REFERENCE'
  | 'GROUP_NAME_SANITIZED'
  | 'GROUP_FALLBACK_DIRECT'
  | 'PROXY_SERVER_NAMESERVER_INFERRED'
  | 'REGEX_DIALECT_WARNING'
  | 'INVALID_CLIENT_PATCH';

export type CompatibilityItem = {
  code: CompatibilityItemCode;
  severity: CompatibilitySeverity;
  message: string;
  location?: {
    cardId?: string;
    regionGroupId?: string;
    slotId?: string;
    providerId?: string;
    moduleId?: string;
  };
};

export type CompatibilityReport = {
  client: TemplateClientId;
  output: OutputProfile;
  items: CompatibilityItem[];
  stats: {
    proxyProviders: number;
    inlineProxies: number;
    proxyGroups: number;
    ruleProviders: number;
    rules: number;
    skippedRules: number;
    appliedModules: string[];
    skippedModules: string[];
  };
};

/** Raw inline proxy node object (e.g. from a parsed node snapshot). */
export type InlineProxyNode = Record<string, unknown> & {
  name: string;
  type: string;
  server?: string;
  port?: number;
};

/** Runtime binding supplied for a declared `NodeSlot` during compilation (design §11). */
export type CompiledNodeSlotBinding =
  | {
      kind: 'http';
      url: string;
      userAgent?: string;
      intervalSec?: number;
      proxy?: string;
      path?: string;
    }
  | {
      kind: 'file';
      path: string;
    }
  | {
      kind: 'inline';
      proxies: readonly InlineProxyNode[];
    }
  | {
      kind: 'snapshot';
      nodes: readonly ParsedNode[];
      report?: NodeParseReport;
      stale?: boolean;
      staleReason?: string;
      fetchedAt?: string;
      expiresAt?: string;
    };

export type CompileTemplateInput = {
  /** Resolved or raw template body. */
  body: TemplateBody;
  /** App card lookup table (builtin + user cards). */
  cards: CardLookup;
  /** Optional template display name written to config header comment. */
  templateName?: string;
  /** Optional deterministic timestamp written to `# UPDATED:` header (pure; never calls Date.now()). */
  generatedAt?: string;
  /** Override `body.output` (`full` | `minimal`, design §10.13). */
  output?: OutputProfile;
  /** Optional catalog index for resolving `catalog` matchers. */
  catalogIndex?: ReadonlyMap<string, CatalogEntry> | readonly CatalogEntry[];
  /** Optional per-ruleset behavior breakdown (`domain` / `classical` / `ipcidr` counts). */
  rulesetBehaviors?: ReadonlyMap<string, Partial<Record<RemoteRuleBehavior, number>>>;
  /** Optional inline rule payloads keyed by planned provider ID (e.g. for `type: inline` rule-providers). */
  inlineRulePayloads?: ReadonlyMap<string, readonly string[]> | Readonly<Record<string, readonly string[]>>;
  /** Optional base URL for self-hosted rulesets / converted GeoSite endpoints. */
  baseUrl?: string;
  /** Optional node slot bindings keyed by `slot.id`. */
  slotBindings?: ReadonlyMap<string, CompiledNodeSlotBinding> | Readonly<Record<string, CompiledNodeSlotBinding>>;
  /** Optional external icon pack entries for resolving `icon` URLs on proxy groups. */
  iconPack?: readonly IconPackEntry[];
  /** Whether to apply enabled enhancement modules during compilation (defaults to `true`). */
  applyModules?: boolean;
  /** Optional custom enhancement module registry. */
  moduleRegistry?: readonly EnhancementModule[];
};

export type CompiledConfigResult = {
  client: TemplateClientId;
  output: OutputProfile;
  /** MIME content type for HTTP subscription delivery. */
  contentType: string;
  /** Suggested file extension (e.g. `.yaml`). */
  extension: string;
  /** Serialized target configuration text. */
  content: string;
  /** Structured compatibility report generated during compilation. */
  report: CompatibilityReport;
};
