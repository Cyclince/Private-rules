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
 * - `dns`: `respect-rules: true` requires `proxy-server-nameserver` to be configured;
 *   supports `enhanced-mode: fake-ip | redir-host`.
 *
 * Official `stash` (https://stash.wiki — iOS/tvOS 3.6–3.7+, macOS 4.3–4.4+, docs Oct 2026) audit notes:
 * - `rule-providers`: remote/local providers omit `type` (`behavior`, `format`, `url`, `path`,
 *   `interval`, `headers`); inline providers use `type: inline`, `behavior`, `payload` (iOS 3.6+ / macOS 4.3+).
 *   Formats: `yaml`, `text`, `mrs` (`mrs` supports `domain` and `ipcidr`, NOT `classical`).
 * - `proxy-providers`: `url`, `path`, `interval`, `filter`, `headers` (plural, string or string[]).
 *   Does NOT support `type: inline` (inline nodes go in top-level `proxies:`), `exclude-filter`,
 *   `override.udp`, `proxy` fetch routing, or provider-level `health-check`.
 * - `proxy-groups`: `select`, `url-test`, `fallback`, `load-balance` (+ deprecated `relay`);
 *   supports `proxies`, `use`, `include-all`, `filter` (ICU regex; NO `exclude-filter`), `icon`,
 *   `hidden`, `interval`, `tolerance`, `strategy`, `lazy`, `benchmark-url`. Empty groups resolve to `DIRECT`.
 * - `rules`: all 14 canonical rule types supported (`SRC-IP-CIDR` emits as `SRC-IP` Beta 3.7+/4.4+,
 *   `SRC-PORT` Beta 3.7+/4.4+, IPv6 CIDR emits as `IP-CIDR6`, `USER-AGENT` & `URL-REGEX` supported,
 *   `GEOSITE` uses bundled v2fly `domain-list-community` -> marked `'partial'` for verification);
 *   `no-resolve` valid on `IP-CIDR`, `IP-CIDR6`, `IP-ASN`, `GEOIP`, `RULE-SET`;
 *   logical rules `AND`/`OR`/`NOT` use double parens `((...))`; final keyword is `MATCH`;
 *   built-in policies: `DIRECT`, `REJECT`, `REJECT-DROP`.
 * - `dns`: Fake-IP only (NO `enhanced-mode: redir-host`); supports `follow-rule: true` with
 *   `proxy-server-nameserver` (iOS 3.6+ / macOS 4.3+), `default-nameserver`, `nameserver`,
 *   `fallback`, `fake-ip-range`, `fake-ip-filter`, `ipv6`.
 *
 * Official `surge` (https://manual.nssurge.com — Surge iOS 5.22–6.0+, Mac 5.4–6.13+, 2026 Manual) audit notes:
 * - `[Rule]` / `[Ruleset <name>]`: remote `RULE-SET,<url>,<policy>[,no-resolve][,update-interval=<sec>]`
 *   and inline `[Ruleset <name>]` sections (Mac 5.3.1+ / iOS 5.22.0+); plain `text` format ONLY
 *   (`yaml` and `mrs` unsupported). No native `GEOSITE` (converted to self-hosted text rulesets).
 * - `[Proxy Group]`: `select`, `url-test` (`interval`, `tolerance`), `fallback` (`interval`),
 *   `load-balance` (`persistent=true`, `interval`); supports `policy-path=<url>`,
 *   `update-interval=<sec>`, `policy-regex-filter=<icu-regex>` (NO separate `exclude-filter`),
 *   `external-policy-modifier="udp-relay=true"`, `include-all-proxies`, `include-other-group`,
 *   `icon-url=<url>` (Mac 6.5.0+), `hidden`, `no-alert`. Legacy `url=` on groups has no effect
 *   (use `[General] proxy-test-url`). `policy-path` does NOT support custom `User-Agent` headers
 *   or fetch-proxy override.
 * - `rules`: 12 of 14 canonical rule types (`GEOSITE` & `DOMAIN-REGEX` unsupported; Surge only has
 *   `DOMAIN-WILDCARD`); `DST-PORT` emits as `DEST-PORT`; `SRC-IP-CIDR` emits as `SRC-IP`;
 *   IPv6 CIDR emits as `IP-CIDR6`; `SRC-PORT` supported (iOS 5.8.4+ / Mac 5.4.4+); `PROCESS-NAME`
 *   is Surge Mac only (ignored on iOS); `no-resolve` valid on `IP-CIDR`, `IP-CIDR6`, `IP-ASN`,
 *   `GEOIP`, `RULE-SET`; logical rules `AND`/`OR`/`NOT` use double parens `((...))` (max depth 10);
 *   final keyword is `FINAL,<policy>[,dns-failed]`; built-in policies: `DIRECT`, `REJECT`,
 *   `REJECT-TINYGIF`, `REJECT-DROP`, `REJECT-NO-DROP`.
 * - `[General]` DNS: `dns-server`, `encrypted-dns-server`, `always-real-ip`; VIF always uses
 *   Fake-IP (NO `redir-host` mode, NO `respect-rules`).
 *
 * Official `sing-box` (https://sing-box.sagernet.org — minimum target version: **1.12**, tentative) audit notes:
 * - Outbounds (class B — no remote proxy-provider; nodes inlined from server-parsed snapshots):
 *   - `shadowsocks` (`method`, `password`, `plugin`: `obfs-local` | `v2ray-plugin`, `plugin_opts`),
 *   - `vmess` (`uuid`, `security`, `alter_id`, `packet_encoding`, `tls`, `transport`),
 *   - `vless` (`uuid`, `flow`, `packet_encoding`, `tls` incl. `utls` + `reality`, `transport`),
 *   - `trojan` (`password`, `tls`, `transport`),
 *   - `hysteria2` (`password`, `up_mbps`, `down_mbps`, `obfs` (`salamander` only in 1.12), `server_ports` mutually exclusive with `server_port`, `tls`),
 *   - `tuic` (`uuid`, `password`, `congestion_control`, `udp_relay_mode`, `zero_rtt_handshake`, `tls` incl. `disable_sni`),
 *   - Groups: `selector` (`outbounds`, `default`) and `urltest` (`outbounds`, `url`, `interval`, `tolerance`) ONLY
 *     (no native `fallback` or `load-balance`; compiler downgrades `fallback` -> `urltest` / `load-balance` -> `urltest` with compatibility report).
 *   - Legacy `block` & `dns` special outbounds are deprecated (since 1.11.0); use route rule actions `reject` (`method: "drop"` for `REJECT-DROP`), `sniff`, and `hijack-dns`.
 * - `route` & `route.rule_set`:
 *   - Legacy `route.geoip`, `route.geosite`, and rule `geoip` / `geosite` fields were REMOVED in 1.12.0; use `route.rule_set` (`remote` with `format: "binary"` `.srs` or `format: "source"` `.json`, and `inline` with headless `rules`).
 *   - `geoip: private` compiles natively to `{ "ip_is_private": true }` in `route.rules`.
 *   - 11 of 14 canonical rule types supported (`USER-AGENT`, `URL-REGEX`, `IP-ASN` unsupported); IPv4 & IPv6 both use `ip_cidr`; `DST-PORT` -> `port` / `port_range` (`start:end`); `SRC-PORT` -> `source_port` / `source_port_range`; `SRC-IP-CIDR` -> `source_ip_cidr`; logical rules use `{ "type": "logical", "mode": "and" | "or", "rules": [...] }` and `invert: true` for `NOT`.
 *   - `route.default_domain_resolver` (1.12.0+) replaces legacy `dns.rules[].outbound`.
 * - `dns` (1.12.0 new typed server format; legacy `address`/`address_resolver` removed in 1.14):
 *   - Typed servers (`https`, `tls`, `udp`, `tcp`, `quic`, `h3`, `local`, `dhcp`, `fakeip`) with `server`, `server_port`, `path`, `headers`, `tls`, `detour`, `domain_resolver`.
 *   - New DNS servers dial directly by default (do NOT set `detour` to an empty `direct` outbound); domain-based server addresses MUST set `domain_resolver` to an IP-based bootstrap server tag.
 *   - FakeIP uses `{ "type": "fakeip", "tag": "...", "inet4_range": "...", "inet6_range"?: "..." }` (replaces legacy `dns.fakeip`).
 *   - Supports rule-routed DNS (`dns.rules` + proxy `detour` for `dns-leak-guard`) and both standard (non-FakeIP) & FakeIP modes.
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
  /** Client-specific keyword renames for canonical rule types (e.g. `DST-PORT` -> `DEST-PORT`). */
  ruleTypeAliases: Readonly<Partial<Record<RuleType, string>>>;
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
  /** Whether DNS config supports rule-following (`respect-rules` / Stash `follow-rule`). */
  supportsRespectRules: boolean;
  /** Whether rule-following DNS requires/recommends `proxy-server-nameserver`. */
  requiresProxyServerNameserverWithRespectRules: boolean;
  /** Whether DNS supports `redir-host` mode natively. */
  supportsDnsRedirHost: boolean;
  /** Custom HTTP headers field name on remote proxy providers (`header` / `headers`), or `null`. */
  proxyProviderHeadersField: string | null;
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
    ruleTypeAliases: {},
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
    supportsDnsRedirHost: true,
    proxyProviderHeadersField: 'header',
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
    rejectDrop: true,
    supportedRuleTypes: new Set<RuleType>(ALL_RULE_TYPES),
    ruleTypeAliases: {
      'SRC-IP-CIDR': 'SRC-IP',
    },
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test', 'fallback', 'load-balance']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['yaml', 'text', 'mrs']),
    remoteRulesetField: 'rule-providers',
    remoteNodeField: 'proxy-providers',
    nodeFilterField: 'filter',
    nodeExcludeFilterField: null,
    groupIconField: 'icon',
    finalRuleKeyword: 'MATCH',
    ipV6RuleType: 'IP-CIDR6',
    noResolveRuleTypes: new Set<RuleType>(['IP-CIDR', 'IP-ASN', 'GEOIP']),
    builtinPolicies: new Set(['DIRECT', 'REJECT', 'REJECT-DROP']),
    mrsSupportedBehaviors: new Set<RulesetBehavior>(['domain', 'ipcidr']),
    supportsRespectRules: true,
    requiresProxyServerNameserverWithRespectRules: true,
    supportsDnsRedirHost: false,
    proxyProviderHeadersField: 'headers',
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
    groupIcons: true,
    emptyFallback: false,
    emptyFallbackMechanism: 'explicit-fallback-proxy',
    noResolve: true,
    rejectDrop: true,
    supportedRuleTypes: new Set<RuleType>(ALL_RULE_TYPES.filter((t) => t !== 'GEOSITE' && t !== 'DOMAIN-REGEX')),
    ruleTypeAliases: {
      'DST-PORT': 'DEST-PORT',
      'SRC-IP-CIDR': 'SRC-IP',
    },
    supportedGroupTypes: new Set<GroupType>(['select', 'url-test', 'fallback', 'load-balance']),
    supportedRemoteFormats: new Set<RemoteRuleFormat>(['text']),
    remoteRulesetField: 'RULE-SET',
    remoteNodeField: 'policy-path',
    nodeFilterField: 'policy-regex-filter',
    nodeExcludeFilterField: null,
    groupIconField: 'icon-url',
    finalRuleKeyword: 'FINAL',
    ipV6RuleType: 'IP-CIDR6',
    noResolveRuleTypes: new Set<RuleType>(['IP-CIDR', 'IP-ASN', 'GEOIP']),
    builtinPolicies: new Set(['DIRECT', 'REJECT', 'REJECT-TINYGIF', 'REJECT-DROP', 'REJECT-NO-DROP']),
    mrsSupportedBehaviors: EMPTY_BEHAVIORS,
    supportsRespectRules: false,
    requiresProxyServerNameserverWithRespectRules: false,
    supportsDnsRedirHost: false,
    proxyProviderHeadersField: null,
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
    ruleTypeAliases: {
      DOMAIN: 'domain',
      'DOMAIN-SUFFIX': 'domain_suffix',
      'DOMAIN-KEYWORD': 'domain_keyword',
      'DOMAIN-REGEX': 'domain_regex',
      'IP-CIDR': 'ip_cidr',
      'SRC-IP-CIDR': 'source_ip_cidr',
      'DST-PORT': 'port',
      'SRC-PORT': 'source_port',
      'PROCESS-NAME': 'process_name',
      GEOSITE: 'rule_set',
      GEOIP: 'rule_set',
    },
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
    supportsRespectRules: true,
    requiresProxyServerNameserverWithRespectRules: false,
    supportsDnsRedirHost: true,
    proxyProviderHeadersField: null,
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
    ruleTypeAliases: {},
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
    supportsDnsRedirHost: false,
    proxyProviderHeadersField: null,
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
    ruleTypeAliases: {},
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
    supportsDnsRedirHost: false,
    proxyProviderHeadersField: null,
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
    ruleTypeAliases: {},
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
    supportsDnsRedirHost: false,
    proxyProviderHeadersField: null,
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
