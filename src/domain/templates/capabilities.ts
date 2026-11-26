import type { TemplateClientId } from '../../shared/clients';
import type { GroupType, RemoteRuleFormat } from '../../shared/schemas/card';
import type { RuleType } from '../../shared/schemas/rule';
import type { RulesetBehavior } from '../formatters/behavior-split';

export type GeositeSupport = 'native' | 'partial' | 'ruleset' | 'none';
export type GeoipSupport = 'native' | 'ruleset' | 'none';
export type RemoteNodeSupport = 'provider' | 'client-managed' | 'none';
export type EmptyFallbackMechanism = 'compatible-builtin' | 'explicit-fallback-proxy' | 'none';

/**
 * Per-client capability matrix (design §10.6).
 * Shared by linters, enhancement modules, planners, and compilers.
 *
 * Official `mihomo` (MetaCubeX/mihomo v1.18–v1.19) field audit notes:
 * - `rule-providers`: `type: http | file | inline`, `behavior: domain | ipcidr | classical`,
 *   `format: yaml | text | mrs` (`mrs` only supports `domain` and `ipcidr`, NOT `classical`).
 * - `proxy-providers`: `type: http | file | inline`, supports `filter`, `exclude-filter`,
 *   `exclude-type`, `header` (values are string arrays), `health-check`, `override.udp`.
 * - `proxy-groups`: `select`, `url-test`, `fallback`, `load-balance`; supports `filter`,
 *   `exclude-filter`, `icon`, `use`, `proxies`, `url`, `interval`, `tolerance`, `strategy`.
 *   Does NOT have an `empty-fallback` YAML key — empty provider matches fall back to the
 *   built-in `COMPATIBLE` proxy or explicit `proxies` entries.
 * - `rules`: 12 of 14 rule types (`USER-AGENT` & `URL-REGEX` unsupported); IPv6 CIDR uses
 *   `IP-CIDR6`; `no-resolve` valid on `IP-CIDR`, `IP-CIDR6`, `IP-ASN`, `GEOIP`, `RULE-SET`
 *   (NOT `SRC-IP-CIDR`); logical rules `AND`/`OR`/`NOT` use double parens `((...))`;
 *   final catch-all keyword is `MATCH`; built-in policies include `DIRECT`, `REJECT`,
 *   `REJECT-DROP`, `PASS`, `COMPATIBLE`.
 * - `dns`: `respect-rules: true` requires `proxy-server-nameserver` to be configured.
 */
export type ClientCapabilities = {
  client: TemplateClientId;
  geosite: GeositeSupport;
  geoip: GeoipSupport;
  logicalRules: boolean;
  remoteRuleset: boolean;
  inlineRuleset: boolean;
  localFirstRules: boolean;
  remoteNodes: RemoteNodeSupport;
  nodeRegexFilter: boolean;
  groupIcons: boolean;
  /**
   * Whether the client accepts an explicit `empty-fallback` key on proxy groups.
   * Note: mihomo uses built-in `COMPATIBLE` automatically rather than an `empty-fallback` key.
   */
  emptyFallback: boolean;
  emptyFallbackMechanism: EmptyFallbackMechanism;
  noResolve: boolean;
  rejectDrop: boolean;
  supportedRuleTypes: ReadonlySet<RuleType>;
  supportedGroupTypes: ReadonlySet<GroupType>;
  supportedRemoteFormats: ReadonlySet<RemoteRuleFormat>;
  /** Rule-set section/field name in target config (e.g. `rule-providers`, `RULE-SET`, `route.rule_set`). */
  remoteRulesetField: string;
  /** Remote node subscription section/field name, or `null` when unsupported/client-managed. */
  remoteNodeField: string | null;
  /** Regex include-filter field name on groups/providers, or `null`. */
  nodeFilterField: string | null;
  /** Regex exclude-filter field name on groups/providers, or `null`. */
  nodeExcludeFilterField: string | null;
  /** Proxy-group icon field name, or `null` when unsupported. */
  groupIconField: string | null;
  /** Catch-all final rule keyword (e.g. `MATCH`, `FINAL`). */
  finalRuleKeyword: string;
  /** Rule type keyword emitted for IPv6 CIDRs (e.g. `IP-CIDR6`, `IP6-CIDR`). */
  ipV6RuleType: string;
  /** Rule types that accept the `,no-resolve` modifier in this client. */
  noResolveRuleTypes: ReadonlySet<RuleType>;
  /** Built-in policy / outbound names reserved by this client. */
  builtinPolicies: ReadonlySet<string>;
  /** Rule behaviors accepted by `format: mrs` (binary Mihomo Rule Set). */
  mrsSupportedBehaviors: ReadonlySet<RulesetBehavior>;
  /** Whether DNS config supports `respect-rules`. */
  supportsRespectRules: boolean;
  /** Whether `respect-rules: true` requires `proxy-server-nameserver` to pass validation. */
  requiresProxyServerNameserverWithRespectRules: boolean;
  /** Whether `proxy-providers` natively supports `exclude-filter`. */
  supportsProxyProviderExcludeFilter: boolean;
  /** Whether `proxy-providers` natively supports `override: { udp: true }`. */
  supportsProxyProviderOverrideUdp: boolean;
};

const ALL_RULE_TYPES: readonly RuleType[] = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'IP-CIDR',
  'SRC-IP-CIDR',
  'IP-ASN',
  'DST-PORT',
  'SRC-PORT',
  'GEOSITE',
  'GEOIP',
  'PROCESS-NAME',
  'USER-AGENT',
  'URL-REGEX',
];

const EMPTY_BEHAVIORS: ReadonlySet<RulesetBehavior> = new Set<RulesetBehavior>();

export const CLIENT_CAPABILITIES: Readonly<Record<TemplateClientId, ClientCapabilities>> = {
  mihomo: {
    client: 'mihomo',
    geosite: 'native',
    geoip: 'native',
    logicalRules: true,
    remoteRuleset: true,
    inlineRuleset: true,
    localFirstRules: false,
    remoteNodes: 'provider',
    nodeRegexFilter: true,
    groupIcons: true,
    emptyFallback: false,
    emptyFallbackMechanism: 'compatible-builtin',
    noResolve: true,
    rejectDrop: true,
    supportedRuleTypes: new Set<RuleType>(ALL_RULE_TYPES.filter((t) => t !== 'USER-AGENT' && t !== 'URL-REGEX')),
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test', 'fallback', 'load-balance']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['yaml', 'text', 'mrs']),
    remoteRulesetField: 'rule-providers',
    remoteNodeField: 'proxy-providers',
    nodeFilterField: 'filter',
    nodeExcludeFilterField: 'exclude-filter',
    groupIconField: 'icon',
    finalRuleKeyword: 'MATCH',
    ipV6RuleType: 'IP-CIDR6',
    noResolveRuleTypes: new Set<RuleType>(['IP-CIDR', 'IP-ASN', 'GEOIP']),
    builtinPolicies: new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']),
    mrsSupportedBehaviors: new Set<RulesetBehavior>(['domain', 'ipcidr']),
    supportsRespectRules: true,
    requiresProxyServerNameserverWithRespectRules: true,
    supportsProxyProviderExcludeFilter: true,
    supportsProxyProviderOverrideUdp: true,
  },
  stash: {
    client: 'stash',
    geosite: 'partial',
    geoip: 'native',
    logicalRules: true,
    remoteRuleset: true,
    inlineRuleset: true,
    localFirstRules: false,
    remoteNodes: 'provider',
    nodeRegexFilter: true,
    groupIcons: true,
    emptyFallback: false,
    emptyFallbackMechanism: 'explicit-fallback-proxy',
    noResolve: true,
    rejectDrop: false,
    supportedRuleTypes: new Set<RuleType>(ALL_RULE_TYPES.filter((t) => t !== 'USER-AGENT')),
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test', 'fallback', 'load-balance']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['yaml', 'text']),
    remoteRulesetField: 'rule-providers',
    remoteNodeField: 'proxy-providers',
    nodeFilterField: 'filter',
    nodeExcludeFilterField: null,
    groupIconField: 'icon',
    finalRuleKeyword: 'MATCH',
    ipV6RuleType: 'IP-CIDR6',
    noResolveRuleTypes: new Set<RuleType>(['IP-CIDR', 'IP-ASN', 'GEOIP']),
    builtinPolicies: new Set(['DIRECT', 'REJECT']),
    mrsSupportedBehaviors: EMPTY_BEHAVIORS,
    supportsRespectRules: false,
    requiresProxyServerNameserverWithRespectRules: false,
    supportsProxyProviderExcludeFilter: false,
    supportsProxyProviderOverrideUdp: false,
  },
  surge: {
    client: 'surge',
    geosite: 'none',
    geoip: 'native',
    logicalRules: true,
    remoteRuleset: true,
    inlineRuleset: true,
    localFirstRules: false,
    remoteNodes: 'provider',
    nodeRegexFilter: true,
    groupIcons: false,
    emptyFallback: false,
    emptyFallbackMechanism: 'explicit-fallback-proxy',
    noResolve: true,
    rejectDrop: true,
    supportedRuleTypes: new Set<RuleType>(ALL_RULE_TYPES.filter((t) => t !== 'GEOSITE' && t !== 'DOMAIN-REGEX')),
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test', 'fallback', 'load-balance']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['text']),
    remoteRulesetField: 'RULE-SET',
    remoteNodeField: 'policy-path',
    nodeFilterField: 'policy-regex-filter',
    nodeExcludeFilterField: null,
    groupIconField: null,
    finalRuleKeyword: 'FINAL',
    ipV6RuleType: 'IP-CIDR6',
    noResolveRuleTypes: new Set<RuleType>(['IP-CIDR', 'IP-ASN', 'GEOIP']),
    builtinPolicies: new Set(['DIRECT', 'REJECT', 'REJECT-TINYGIF', 'REJECT-DROP', 'REJECT-NO-DROP']),
    mrsSupportedBehaviors: EMPTY_BEHAVIORS,
    supportsRespectRules: false,
    requiresProxyServerNameserverWithRespectRules: false,
    supportsProxyProviderExcludeFilter: false,
    supportsProxyProviderOverrideUdp: false,
  },
  'sing-box': {
    client: 'sing-box',
    geosite: 'ruleset',
    geoip: 'ruleset',
    logicalRules: true,
    remoteRuleset: true,
    inlineRuleset: true,
    localFirstRules: false,
    remoteNodes: 'none',
    nodeRegexFilter: true,
    groupIcons: false,
    emptyFallback: false,
    emptyFallbackMechanism: 'explicit-fallback-proxy',
    noResolve: false,
    rejectDrop: true,
    supportedRuleTypes: new Set<RuleType>(
      ALL_RULE_TYPES.filter((t) => t !== 'USER-AGENT' && t !== 'URL-REGEX' && t !== 'IP-ASN'),
    ),
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['text']),
    remoteRulesetField: 'route.rule_set',
    remoteNodeField: null,
    nodeFilterField: null,
    nodeExcludeFilterField: null,
    groupIconField: null,
    finalRuleKeyword: 'route.final',
    ipV6RuleType: 'ip_cidr',
    noResolveRuleTypes: new Set<RuleType>(),
    builtinPolicies: new Set(['direct', 'block']),
    mrsSupportedBehaviors: EMPTY_BEHAVIORS,
    supportsRespectRules: false,
    requiresProxyServerNameserverWithRespectRules: false,
    supportsProxyProviderExcludeFilter: false,
    supportsProxyProviderOverrideUdp: false,
  },
  loon: {
    client: 'loon',
    geosite: 'none',
    geoip: 'native',
    logicalRules: true,
    remoteRuleset: true,
    inlineRuleset: false,
    localFirstRules: true,
    remoteNodes: 'client-managed',
    nodeRegexFilter: true,
    groupIcons: true,
    emptyFallback: false,
    emptyFallbackMechanism: 'explicit-fallback-proxy',
    noResolve: true,
    rejectDrop: false,
    supportedRuleTypes: new Set<RuleType>([
      'DOMAIN',
      'DOMAIN-SUFFIX',
      'DOMAIN-KEYWORD',
      'IP-CIDR',
      'IP-ASN',
      'GEOIP',
      'USER-AGENT',
      'URL-REGEX',
      'DST-PORT',
    ]),
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test', 'fallback', 'load-balance']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['text']),
    remoteRulesetField: '[Remote Rule]',
    remoteNodeField: '[Remote Proxy]',
    nodeFilterField: 'filter',
    nodeExcludeFilterField: null,
    groupIconField: 'img-url',
    finalRuleKeyword: 'FINAL',
    ipV6RuleType: 'IP-CIDR6',
    noResolveRuleTypes: new Set<RuleType>(['IP-CIDR', 'IP-ASN', 'GEOIP']),
    builtinPolicies: new Set(['DIRECT', 'REJECT']),
    mrsSupportedBehaviors: EMPTY_BEHAVIORS,
    supportsRespectRules: false,
    requiresProxyServerNameserverWithRespectRules: false,
    supportsProxyProviderExcludeFilter: false,
    supportsProxyProviderOverrideUdp: false,
  },
  'quantumult-x': {
    client: 'quantumult-x',
    geosite: 'none',
    geoip: 'native',
    logicalRules: false,
    remoteRuleset: true,
    inlineRuleset: false,
    localFirstRules: true,
    remoteNodes: 'client-managed',
    nodeRegexFilter: true,
    groupIcons: true,
    emptyFallback: false,
    emptyFallbackMechanism: 'explicit-fallback-proxy',
    noResolve: true,
    rejectDrop: false,
    supportedRuleTypes: new Set<RuleType>([
      'DOMAIN',
      'DOMAIN-SUFFIX',
      'DOMAIN-KEYWORD',
      'IP-CIDR',
      'IP-ASN',
      'GEOIP',
      'USER-AGENT',
    ]),
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test', 'fallback', 'load-balance']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['text']),
    remoteRulesetField: '[filter_remote]',
    remoteNodeField: '[server_remote]',
    nodeFilterField: 'server-tag-regex',
    nodeExcludeFilterField: null,
    groupIconField: 'img-url',
    finalRuleKeyword: 'FINAL',
    ipV6RuleType: 'IP6-CIDR',
    noResolveRuleTypes: new Set<RuleType>(['IP-CIDR', 'IP-ASN', 'GEOIP']),
    builtinPolicies: new Set(['direct', 'reject', 'proxy']),
    mrsSupportedBehaviors: EMPTY_BEHAVIORS,
    supportsRespectRules: false,
    requiresProxyServerNameserverWithRespectRules: false,
    supportsProxyProviderExcludeFilter: false,
    supportsProxyProviderOverrideUdp: false,
  },
  shadowrocket: {
    client: 'shadowrocket',
    geosite: 'none',
    geoip: 'native',
    logicalRules: true,
    remoteRuleset: true,
    inlineRuleset: false,
    localFirstRules: false,
    remoteNodes: 'client-managed',
    nodeRegexFilter: true,
    groupIcons: false,
    emptyFallback: false,
    emptyFallbackMechanism: 'explicit-fallback-proxy',
    noResolve: true,
    rejectDrop: false,
    supportedRuleTypes: new Set<RuleType>([
      'DOMAIN',
      'DOMAIN-SUFFIX',
      'DOMAIN-KEYWORD',
      'IP-CIDR',
      'IP-ASN',
      'GEOIP',
      'USER-AGENT',
      'URL-REGEX',
      'DST-PORT',
    ]),
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test', 'fallback', 'load-balance']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['text']),
    remoteRulesetField: 'RULE-SET',
    remoteNodeField: null,
    nodeFilterField: 'policy-regex-filter',
    nodeExcludeFilterField: null,
    groupIconField: null,
    finalRuleKeyword: 'FINAL',
    ipV6RuleType: 'IP-CIDR6',
    noResolveRuleTypes: new Set<RuleType>(['IP-CIDR', 'IP-ASN', 'GEOIP']),
    builtinPolicies: new Set(['DIRECT', 'REJECT', 'PROXY']),
    mrsSupportedBehaviors: EMPTY_BEHAVIORS,
    supportsRespectRules: false,
    requiresProxyServerNameserverWithRespectRules: false,
    supportsProxyProviderExcludeFilter: false,
    supportsProxyProviderOverrideUdp: false,
  },
};

export function getClientCapabilities(client: TemplateClientId): ClientCapabilities {
  return CLIENT_CAPABILITIES[client];
}

export function isRuleTypeSupported(client: TemplateClientId, ruleType: RuleType): boolean {
  return CLIENT_CAPABILITIES[client].supportedRuleTypes.has(ruleType);
}

export function isGroupTypeSupported(client: TemplateClientId, groupType: GroupType): boolean {
  return CLIENT_CAPABILITIES[client].supportedGroupTypes.has(groupType);
}

export function isRemoteFormatSupported(
  client: TemplateClientId,
  format: RemoteRuleFormat,
  behavior?: RulesetBehavior,
): boolean {
  const caps = CLIENT_CAPABILITIES[client];
  if (!caps.supportedRemoteFormats.has(format)) return false;
  if (format === 'mrs' && behavior !== undefined) {
    return caps.mrsSupportedBehaviors.has(behavior);
  }
  return true;
}
