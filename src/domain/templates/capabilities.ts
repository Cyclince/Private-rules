import type { TemplateClientId } from '../../shared/clients';
import type { GroupType, RemoteRuleFormat } from '../../shared/schemas/card';
import type { RuleType } from '../../shared/schemas/rule';

export type GeositeSupport = 'native' | 'partial' | 'ruleset' | 'none';
export type GeoipSupport = 'native' | 'ruleset' | 'none';
export type RemoteNodeSupport = 'provider' | 'client-managed' | 'none';

/**
 * Per-client capability matrix (design §10.6).
 * Shared by linters, enhancement modules, planners, and compilers.
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
  emptyFallback: boolean;
  noResolve: boolean;
  rejectDrop: boolean;
  supportedRuleTypes: ReadonlySet<RuleType>;
  supportedGroupTypes: ReadonlySet<GroupType>;
  supportedRemoteFormats: ReadonlySet<RemoteRuleFormat>;
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
    emptyFallback: true,
    noResolve: true,
    rejectDrop: true,
    supportedRuleTypes: new Set<RuleType>(ALL_RULE_TYPES.filter((t) => t !== 'USER-AGENT' && t !== 'URL-REGEX')),
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test', 'fallback', 'load-balance']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['yaml', 'text', 'mrs']),
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
    noResolve: true,
    rejectDrop: false,
    supportedRuleTypes: new Set<RuleType>(ALL_RULE_TYPES.filter((t) => t !== 'USER-AGENT')),
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test', 'fallback', 'load-balance']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['yaml', 'text']),
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
    noResolve: true,
    rejectDrop: true,
    supportedRuleTypes: new Set<RuleType>(ALL_RULE_TYPES.filter((t) => t !== 'GEOSITE' && t !== 'DOMAIN-REGEX')),
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test', 'fallback', 'load-balance']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['text']),
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
    noResolve: false,
    rejectDrop: true,
    supportedRuleTypes: new Set<RuleType>(
      ALL_RULE_TYPES.filter((t) => t !== 'USER-AGENT' && t !== 'URL-REGEX' && t !== 'IP-ASN'),
    ),
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['text']),
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
  },
};

export function getClientCapabilities(client: TemplateClientId): ClientCapabilities {
  return CLIENT_CAPABILITIES[client];
}
