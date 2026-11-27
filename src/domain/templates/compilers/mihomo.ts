import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { rewriteGithubUrl } from '../../../lib/github-mirror';
import type { OutputProfile } from '../../../shared/clients';
import type {
  Condition,
  NodeFilter,
  PolicyRef,
  RemoteRuleBehavior,
  RemoteRuleFormat,
} from '../../../shared/schemas/card';
import type { DnsProfile, NodeSlot, RegionGroup, TemplateBody } from '../../../shared/schemas/template';
import { buildExcludeInfoRegex, buildRegionRegex, detectRegexDialectIssues } from '../../nodes/regex';
import { CLIENT_CAPABILITIES, isRemoteFormatSupported, isRuleTypeSupported } from '../capabilities';
import { buildDefaultIconPack, recognizeGroupIcon } from '../icons';
import { DEFAULT_HEALTH_CHECK, resolveTemplateCards, type ResolvedTemplateCard } from '../model';
import { applyEnhancementModules } from '../modules';
import { planRulesetReferences, type PlannedMatcherBinding, type PlannedProvider } from '../planner';
import type {
  CompatibilityItem,
  CompiledConfigResult,
  CompiledNodeSlotBinding,
  CompileTemplateInput,
  InlineProxyNode,
} from './types';

const MIHOMO_CAPS = CLIENT_CAPABILITIES.mihomo;

const DEFAULT_PROVIDER_INTERVAL_SEC = 3600;
const DEFAULT_MRS_INTERVAL_SEC = 86_400;
const DEFAULT_BOOTSTRAP_DNS = ['223.5.5.5', '119.29.29.29'];
const DEFAULT_DOMESTIC_DOH = ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'];
const DEFAULT_PROXY_DOH = ['https://1.1.1.1/dns-query', 'https://dns.google/dns-query'];
const DEFAULT_FAKE_IP_RANGE = '198.18.0.1/16';
const DEFAULT_LOAD_BALANCE_STRATEGY = 'consistent-hashing';
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5000;
const DEFAULT_EXPECTED_STATUS = 204;

/**
 * Verified MetaCubeX meta-rules-dat `.mrs` binary rule-set URL templates
 * (HTTP HEAD verified against `MetaCubeX/meta-rules-dat` branch `meta`):
 * - GeoSite (`behavior: domain`, `format: mrs`):
 *   `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/<name>.mrs`
 * - GeoIP (`behavior: ipcidr`, `format: mrs`):
 *   `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/<name>.mrs`
 */
const METACUBEX_MRS_GEOSITE_BASE = 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite';
const METACUBEX_MRS_GEOIP_BASE = 'https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip';

/** Verified MetaCubeX `.mrs` geosite entries; unknown entries fall back to `GEOSITE`. */
const KNOWN_METACUBEX_GEOSITE_MRS = new Set([
  'private',
  'category-ads-all',
  'openai',
  'category-ai-!cn',
  'telegram',
  'twitter',
  'discord',
  'youtube',
  'netflix',
  'disney',
  'bilibili',
  'spotify',
  'tiktok',
  'github',
  'googlefcm',
  'google',
  'apple',
  'onedrive',
  'microsoft',
  'steam',
  'category-games',
  'speedtest',
  'gfw',
  'cn',
]);

/** Verified MetaCubeX `.mrs` geoip entries; unknown entries fall back to `GEOIP`. */
const KNOWN_METACUBEX_GEOIP_MRS = new Set(['private', 'telegram', 'google', 'netflix', 'twitter', 'cn']);

/** Core hubs that stay visible in mihomo GUI (design §6A.3). */
const VISIBLE_CORE_HUB_CARD_IDS = new Set(['proxy-select', 'auto-select', 'final-fallback', 'module-dns-leak-final']);

/** Auxiliary infrastructure / plumbing cards marked `hidden: true` to keep visible groups around 8–12. */
const HIDDEN_AUXILIARY_CARD_IDS = new Set([
  'lan-direct',
  'custom-direct',
  'gfw-proxy',
  'proxy-ip',
  'domestic-direct',
  'non-standard-ports',
  'speedtest',
  'module-block-encrypted-dns',
  'module-game-download-direct',
  'module-tunnel-direct',
]);

function applyGithubMirror(url: string, mirrorUrl?: string): string {
  const mirror = mirrorUrl?.trim() ?? '';
  if (!mirror) return url;
  try {
    return rewriteGithubUrl(url, mirror);
  } catch {
    return url;
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL_AND_LINE_BREAK_RE = /[\r\n\u2028\u2029\x00-\x1f\x7f]+/g;

/**
 * Strips CR/LF/Unicode line separators and ASCII control characters from any
 * scalar emitted into YAML comments or fields.
 */
export function sanitizeMihomoScalar(raw: string): string {
  return raw.replace(CONTROL_AND_LINE_BREAK_RE, ' ').trim();
}

/**
 * Sanitizes a proxy-group name so it cannot inject YAML structure or break
 * comma-delimited mihomo `rules:` entries (e.g. `DOMAIN,a.com,<GROUP>`).
 * Commas are replaced with full-width `，`.
 */
export function sanitizeMihomoGroupName(raw: string, fallback = 'ProxyGroup'): string {
  const cleaned = sanitizeMihomoScalar(raw).replace(/,/g, '，').trim();
  return cleaned || fallback;
}

/**
 * Sanitizes a proxy/node name against control characters, line breaks, and
 * comma-based rule injection.
 */
export function sanitizeMihomoNodeName(raw: string, fallback = 'Node'): string {
  const cleaned = sanitizeMihomoScalar(raw).replace(/,/g, '，').trim();
  return cleaned || fallback;
}

/**
 * Produces a safe ASCII key for `proxy-providers` / `rule-providers` maps and
 * cache file paths (`[A-Za-z0-9_-]`), eliminating path traversal (`../`) and
 * comma/YAML key injection.
 */
export function sanitizeMihomoProviderKey(raw: string, fallback = 'provider'): string {
  const normalized = sanitizeMihomoScalar(raw)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

/**
 * Sanitizes a rule value embedded in a comma-delimited mihomo rule string so
 * it cannot inject extra comma fields (such as `,DIRECT` or `,no-resolve`).
 */
export function sanitizeMihomoRuleValue(raw: string): string {
  return sanitizeMihomoScalar(raw).replace(/,/g, '').trim();
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = sanitizeMihomoScalar(value);
  return /^https?:\/\/\S+$/i.test(trimmed);
}

function toSlotBindingMap(bindings?: CompileTemplateInput['slotBindings']): Map<string, CompiledNodeSlotBinding> {
  if (!bindings) return new Map();
  if (bindings instanceof Map) return new Map(bindings);
  return new Map(Object.entries(bindings));
}

function toInlinePayloadsMap(payloads?: CompileTemplateInput['inlineRulePayloads']): Map<string, readonly string[]> {
  if (!payloads) return new Map();
  if (payloads instanceof Map) return new Map(payloads);
  return new Map(Object.entries(payloads));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeObjects(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMergeObjects(merged[key] as Record<string, unknown>, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function formatExtensionForRuleProvider(format: RemoteRuleFormat): string {
  if (format === 'mrs') return 'mrs';
  if (format === 'text') return 'list';
  return 'yaml';
}

function resolveGroupIconUrl(
  input: {
    explicitIcon?: string;
    name: string;
    slug?: string;
    category?: ResolvedTemplateCard['effective']['category'];
    region?: string;
    groupType: ResolvedTemplateCard['effective']['group']['type'];
    matchers?: ResolvedTemplateCard['effective']['matchers'];
  },
  iconPack?: CompileTemplateInput['iconPack'],
  githubMirrorUrl?: string,
): string | undefined {
  if (isHttpUrl(input.explicitIcon)) {
    return applyGithubMirror(sanitizeMihomoScalar(input.explicitIcon), githubMirrorUrl);
  }
  if (!iconPack || iconPack.length === 0) return undefined;
  const recognized = recognizeGroupIcon(
    {
      name: input.name,
      slug: input.slug,
      category: input.category,
      region: input.region,
      groupType: input.groupType,
      matchers: input.matchers,
    },
    iconPack,
  );
  // Omit icon for unrecognized groups (generic fallback or generic other/infrastructure category)
  if (recognized.source === 'fallback') return undefined;
  if (recognized.source === 'category' && (input.category === 'other' || input.category === 'infrastructure')) {
    return undefined;
  }
  if (isHttpUrl(recognized.packIcon?.url)) {
    return applyGithubMirror(sanitizeMihomoScalar(recognized.packIcon.url), githubMirrorUrl);
  }
  return undefined;
}

function allocateUniqueName(
  desired: string,
  used: Set<string>,
  avoidBuiltins: boolean,
  onRenamed?: (finalName: string, reason: 'sanitized' | 'builtin-collision' | 'duplicate') => void,
  original?: string,
): string {
  let candidate = desired;
  const changedBySanitize = original !== undefined && candidate !== original;

  if (avoidBuiltins && MIHOMO_CAPS.builtinPolicies.has(candidate.toUpperCase())) {
    candidate = `${candidate} 组`;
    onRenamed?.(candidate, 'builtin-collision');
  } else if (changedBySanitize) {
    onRenamed?.(candidate, 'sanitized');
  }

  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }

  let suffix = 2;
  while (used.has(`${candidate} (${suffix})`)) {
    suffix += 1;
  }
  const unique = `${candidate} (${suffix})`;
  used.add(unique);
  onRenamed?.(unique, 'duplicate');
  return unique;
}

function allocateUniqueKey(desired: string, used: Set<string>): string {
  if (!used.has(desired)) {
    used.add(desired);
    return desired;
  }
  let suffix = 2;
  while (used.has(`${desired}-${suffix}`)) {
    suffix += 1;
  }
  const unique = `${desired}-${suffix}`;
  used.add(unique);
  return unique;
}

type CompiledFilterPair = {
  filter?: string;
  excludeFilter?: string;
};

function compileNodeFilter(
  nodeFilter: NodeFilter | undefined,
  items: CompatibilityItem[],
  location: CompatibilityItem['location'],
): CompiledFilterPair {
  if (!nodeFilter) return {};

  let includeRegex: string | undefined;
  let excludeRegex: string | undefined;

  if (nodeFilter.regions && nodeFilter.regions.length > 0) {
    const compiled = buildRegionRegex(nodeFilter.regions, 'mihomo', {
      extraInclude: nodeFilter.include,
      extraExclude: nodeFilter.exclude,
    });
    includeRegex = sanitizeMihomoScalar(compiled.include);
    excludeRegex = compiled.exclude ? sanitizeMihomoScalar(compiled.exclude) : undefined;
    for (const warning of compiled.warnings) {
      items.push({
        code: 'REGEX_DIALECT_WARNING',
        severity: 'warning',
        message: warning.message,
        location,
      });
    }
  } else {
    if (nodeFilter.include) {
      const cleaned = sanitizeMihomoScalar(nodeFilter.include);
      for (const issue of detectRegexDialectIssues(cleaned, 'mihomo')) {
        items.push({
          code: 'REGEX_DIALECT_WARNING',
          severity: 'warning',
          message: issue.message,
          location,
        });
      }
      includeRegex = cleaned;
    }
    if (nodeFilter.exclude) {
      const cleaned = sanitizeMihomoScalar(nodeFilter.exclude);
      for (const issue of detectRegexDialectIssues(cleaned, 'mihomo')) {
        items.push({
          code: 'REGEX_DIALECT_WARNING',
          severity: 'warning',
          message: issue.message,
          location,
        });
      }
      excludeRegex = cleaned;
    }
  }

  return {
    ...(includeRegex ? { filter: includeRegex } : {}),
    ...(excludeRegex ? { excludeFilter: excludeRegex } : {}),
  };
}

function buildProxyProviderEntry(
  slot: NodeSlot,
  providerKey: string,
  binding: CompiledNodeSlotBinding | undefined,
  general: TemplateBody['general'],
  items: CompatibilityItem[],
  multiSlot: boolean,
): { entry: Record<string, unknown>; inlineProxyCount: number } {
  const excludeInfoRegex = slot.excludeInfo !== false ? buildExcludeInfoRegex('mihomo').exclude : undefined;
  const hcUrl = sanitizeMihomoScalar(slot.healthCheck?.url ?? general?.testUrl ?? DEFAULT_HEALTH_CHECK.url);
  const hcInterval = slot.healthCheck?.intervalSec ?? general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec;
  const overrideUdp = slot.udp !== false;
  const additionalPrefix = multiSlot ? `${sanitizeMihomoScalar(slot.name) || providerKey} · ` : undefined;

  const overrideObj: Record<string, unknown> = {};
  if (overrideUdp) {
    overrideObj.udp = true;
  }
  if (additionalPrefix) {
    overrideObj['additional-prefix'] = additionalPrefix;
  }

  const commonFields: Record<string, unknown> = {};
  if (excludeInfoRegex) {
    commonFields['exclude-filter'] = excludeInfoRegex;
  }
  if (Object.keys(overrideObj).length > 0) {
    commonFields.override = overrideObj;
  }
  commonFields['health-check'] = {
    enable: true,
    url: hcUrl,
    interval: hcInterval,
    lazy: true,
    timeout: DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
    'expected-status': DEFAULT_EXPECTED_STATUS,
  };

  if (!binding || binding.kind === 'snapshot') {
    items.push({
      code: 'UNBOUND_NODE_SLOT',
      severity: 'warning',
      message: `节点槽位「${slot.name}」（${slot.id}）未绑定订阅源，已使用占位 HTTP Provider。`,
      location: { slotId: slot.id },
    });
    return {
      entry: {
        type: 'http',
        url: `https://example.invalid/providers/${providerKey}.yaml`,
        path: `./providers/proxies/${providerKey}.yaml`,
        interval: DEFAULT_PROVIDER_INTERVAL_SEC,
        proxy: 'DIRECT',
        ...commonFields,
      },
      inlineProxyCount: 0,
    };
  }

  if (binding.kind === 'http') {
    const entry: Record<string, unknown> = {
      type: 'http',
      url: sanitizeMihomoScalar(binding.url),
      path: sanitizeMihomoScalar(binding.path ?? `./providers/proxies/${providerKey}.yaml`),
      interval: binding.intervalSec ?? DEFAULT_PROVIDER_INTERVAL_SEC,
      proxy: sanitizeMihomoGroupName(binding.proxy ?? 'DIRECT', 'DIRECT'),
    };
    if (binding.userAgent?.trim()) {
      entry.header = {
        'User-Agent': [sanitizeMihomoScalar(binding.userAgent)],
      };
    }
    return {
      entry: { ...entry, ...commonFields },
      inlineProxyCount: 0,
    };
  }

  if (binding.kind === 'file') {
    return {
      entry: {
        type: 'file',
        path: sanitizeMihomoScalar(binding.path),
        ...commonFields,
      },
      inlineProxyCount: 0,
    };
  }

  // binding.kind === 'inline'
  const usedProxyNames = new Set<string>();
  const sanitizedPayload: InlineProxyNode[] = binding.proxies.map((proxy, idx) => {
    const cleanName = allocateUniqueName(sanitizeMihomoNodeName(proxy.name, `Node-${idx + 1}`), usedProxyNames, true);
    const cleanedNode: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(proxy)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (k === 'name') {
        cleanedNode.name = cleanName;
      } else if (typeof v === 'string') {
        cleanedNode[k] = sanitizeMihomoScalar(v);
      } else {
        cleanedNode[k] = v;
      }
    }
    cleanedNode.name = cleanName;
    if (overrideUdp && cleanedNode.udp === undefined) {
      cleanedNode.udp = true;
    }
    return cleanedNode as InlineProxyNode;
  });

  return {
    entry: {
      type: 'inline',
      ...(excludeInfoRegex ? { 'exclude-filter': excludeInfoRegex } : {}),
      ...(Object.keys(overrideObj).length > 0 ? { override: overrideObj } : {}),
      payload: sanitizedPayload,
    },
    inlineProxyCount: sanitizedPayload.length,
  };
}

function buildRuleProviderEntry(
  provider: PlannedProvider,
  providerKey: string,
  inlinePayloads: ReadonlyMap<string, readonly string[]>,
  items: CompatibilityItem[],
  githubMirrorUrl?: string,
): { entry: Record<string, unknown>; effectiveBehavior: RemoteRuleBehavior } {
  const behavior = provider.behavior;
  let format = provider.format;

  if (!isRemoteFormatSupported('mihomo', format, behavior)) {
    items.push({
      code: 'MRS_CLASSICAL_DOWNGRADED',
      severity: 'warning',
      message: `规则集 ${provider.id} 为 classical 行为，mihomo 的 mrs 格式不支持 classical，已降级为 yaml。`,
      location: { providerId: provider.id },
    });
    format = 'yaml';
  }

  const inlineEntries = inlinePayloads.get(provider.id);
  if (inlineEntries && inlineEntries.length > 0) {
    return {
      entry: {
        type: 'inline',
        behavior,
        payload: inlineEntries.map((item) => sanitizeMihomoScalar(item)),
      },
      effectiveBehavior: behavior,
    };
  }

  let url: string | undefined;
  const shouldApplyMirror = provider.source.kind === 'remote' || provider.source.kind === 'catalog';
  if (provider.source.kind === 'remote' || provider.source.kind === 'catalog') {
    url = provider.source.url;
  } else if (provider.source.kind === 'ruleset' || provider.source.kind === 'geosite-hosted') {
    url = provider.source.url;
  }

  if (!url) {
    const fallbackSlug = sanitizeMihomoProviderKey(
      provider.source.kind === 'ruleset' ? provider.source.ruleSetId : provider.id,
      'ruleset',
    );
    url = `https://example.invalid/rules/${fallbackSlug}_${behavior}.${formatExtensionForRuleProvider(format)}`;
    items.push({
      code: 'MISSING_RULESET_URL',
      severity: 'warning',
      message: `规则集 ${provider.id} 未提供 baseUrl 或内联规则内容，已生成占位 URL。`,
      location: { providerId: provider.id },
    });
  }

  const finalUrl = shouldApplyMirror
    ? applyGithubMirror(sanitizeMihomoScalar(url), githubMirrorUrl)
    : sanitizeMihomoScalar(url);
  const ext = formatExtensionForRuleProvider(format);
  return {
    entry: {
      type: 'http',
      behavior,
      format,
      url: finalUrl,
      path: `./providers/rules/${providerKey}.${ext}`,
      interval: provider.updateIntervalSec,
    },
    effectiveBehavior: behavior,
  };
}

type CompiledRuleAtom = {
  /** Top-level mihomo rule string (`TYPE,VAL,POLICY[,no-resolve]` or `AND,((...)),POLICY`). */
  topLevel: string;
};

type CompiledConditionExpr = {
  /** Expression valid inside logical parens `((...))` (without target policy). */
  inner: string;
  /** True when the rule is a simple leaf with `,no-resolve` that must trail the policy at top-level. */
  leafParts?: {
    type: string;
    value: string;
    noResolve: boolean;
  };
};

function compileConditionExpr(
  cond: Condition,
  cardId: string,
  items: CompatibilityItem[],
): CompiledConditionExpr | null {
  if (cond.op === 'rule') {
    const { type, value, options } = cond.rule;
    if (!isRuleTypeSupported('mihomo', type)) {
      items.push({
        code: 'UNSUPPORTED_RULE_TYPE',
        severity: 'warning',
        message: `mihomo 不支持规则类型 ${type}（值：${sanitizeMihomoScalar(value)}），已跳过该条规则。`,
        location: { cardId },
      });
      return null;
    }

    const cleanValue = sanitizeMihomoRuleValue(value);
    if (!cleanValue) return null;

    const emittedType = type === 'IP-CIDR' && cleanValue.includes(':') ? MIHOMO_CAPS.ipV6RuleType : type;
    const noResolve = Boolean(options?.noResolve && MIHOMO_CAPS.noResolveRuleTypes.has(type));
    const inner = noResolve ? `${emittedType},${cleanValue},no-resolve` : `${emittedType},${cleanValue}`;
    return {
      inner,
      leafParts: {
        type: emittedType,
        value: cleanValue,
        noResolve,
      },
    };
  }

  if (cond.op === 'not') {
    const sub = compileConditionExpr(cond.item, cardId, items);
    if (!sub) return null;
    return {
      inner: `NOT,((${sub.inner}))`,
    };
  }

  // 'and' | 'or'
  const compiledChildren: CompiledConditionExpr[] = [];
  for (const child of cond.items) {
    const compiled = compileConditionExpr(child, cardId, items);
    if (!compiled) {
      return null;
    }
    compiledChildren.push(compiled);
  }
  if (compiledChildren.length === 0) return null;
  if (compiledChildren.length === 1) return compiledChildren[0]!;

  const keyword = cond.op === 'and' ? 'AND' : 'OR';
  const joined = compiledChildren.map((child) => `(${child.inner})`).join(',');
  return {
    inner: `${keyword},(${joined})`,
  };
}

function compileTopLevelCondition(
  cond: Condition,
  policyName: string,
  cardId: string,
  items: CompatibilityItem[],
): CompiledRuleAtom | null {
  const expr = compileConditionExpr(cond, cardId, items);
  if (!expr) return null;
  if (expr.leafParts) {
    const { type, value, noResolve } = expr.leafParts;
    return {
      topLevel: noResolve ? `${type},${value},${policyName},no-resolve` : `${type},${value},${policyName}`,
    };
  }
  return {
    topLevel: `${expr.inner},${policyName}`,
  };
}

function compileProfileSection(): Record<string, unknown> {
  return {
    'store-selected': true,
    'store-fake-ip': true,
  };
}

function compileSnifferSection(): Record<string, unknown> {
  return {
    enable: true,
    'force-dns-mapping': true,
    'parse-pure-ip': true,
    'override-destination': true,
    sniff: {
      HTTP: {
        ports: [80, '8080-8880'],
        'override-destination': true,
      },
      TLS: {
        ports: [443, 8443],
      },
      QUIC: {
        ports: [443, 8443],
      },
    },
    'skip-domain': ['Mijia Cloud', '+.push.apple.com', '+.lan', '+.local'],
  };
}

function sanitizeDnsPolicyMap(raw: unknown): Record<string, string | string[]> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const cleanKey = sanitizeMihomoScalar(key);
    if (!cleanKey) continue;
    if (typeof value === 'string') {
      const cleanVal = sanitizeMihomoScalar(value);
      if (cleanVal) out[cleanKey] = cleanVal;
    } else if (Array.isArray(value)) {
      const cleanArr = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => sanitizeMihomoScalar(item))
        .filter(Boolean);
      if (cleanArr.length > 0) out[cleanKey] = cleanArr;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function compileDnsSection(
  dns: DnsProfile,
  general: TemplateBody['general'],
  items: CompatibilityItem[],
): Record<string, unknown> {
  const enhancedMode =
    dns.mode === 'redir-host'
      ? 'redir-host'
      : dns.mode === 'custom' && typeof dns.custom?.['enhanced-mode'] === 'string'
        ? sanitizeMihomoScalar(dns.custom['enhanced-mode'])
        : 'fake-ip';

  const respectRules = dns.respectRules ?? true;

  const result: Record<string, unknown> = {
    enable: dns.enable ?? true,
    ipv6: dns.ipv6 ?? general?.ipv6 ?? false,
    'enhanced-mode': enhancedMode,
  };

  if (enhancedMode === 'fake-ip') {
    const fakeIpRange =
      typeof dns.custom?.['fake-ip-range'] === 'string'
        ? sanitizeMihomoScalar(dns.custom['fake-ip-range'])
        : DEFAULT_FAKE_IP_RANGE;
    result['fake-ip-range'] = fakeIpRange;
    if (dns.fakeIpFilter && dns.fakeIpFilter.length > 0) {
      result['fake-ip-filter'] = dns.fakeIpFilter.map((entry) => sanitizeMihomoScalar(entry)).filter(Boolean);
    }
  }

  if (respectRules) {
    result['respect-rules'] = true;
  }

  const defaultNs =
    dns.defaultNameserver && dns.defaultNameserver.length > 0
      ? dns.defaultNameserver.map((entry) => sanitizeMihomoScalar(entry)).filter(Boolean)
      : [...DEFAULT_BOOTSTRAP_DNS];
  if (defaultNs.length > 0) {
    result['default-nameserver'] = defaultNs;
  }

  const cleanedInputNs =
    dns.nameserver && dns.nameserver.length > 0
      ? dns.nameserver.map((entry) => sanitizeMihomoScalar(entry)).filter(Boolean)
      : [];
  const cleanedLegacyFallback =
    dns.fallback && dns.fallback.length > 0
      ? dns.fallback.map((entry) => sanitizeMihomoScalar(entry)).filter(Boolean)
      : [];

  // Modern mihomo DNS avoids legacy `fallback` / `fallback-filter`:
  // - `nameserver` uses foreign DoH (routed via `respect-rules: true`)
  // - `nameserver-policy` routes `geosite:cn` & `geosite:private` to domestic DoH
  // - `proxy-server-nameserver` resolves airport proxy hostnames via domestic DoH
  const domesticDoh =
    cleanedLegacyFallback.length > 0 && cleanedInputNs.length > 0 ? cleanedInputNs : [...DEFAULT_DOMESTIC_DOH];
  const primaryNameservers =
    cleanedLegacyFallback.length > 0
      ? cleanedLegacyFallback
      : cleanedInputNs.length > 0
        ? cleanedInputNs
        : [...DEFAULT_PROXY_DOH];

  result.nameserver = primaryNameservers;

  // Extract proxy-server-nameserver (supports structured field, camelCase from dns-leak module, and kebab-case)
  const rawProxyServerNs =
    dns.proxyServerNameserver ?? dns.custom?.['proxy-server-nameserver'] ?? dns.custom?.proxyServerNameserver;
  let proxyServerNs: string[] | undefined;
  if (Array.isArray(rawProxyServerNs)) {
    const cleaned = rawProxyServerNs
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => sanitizeMihomoScalar(entry))
      .filter(Boolean);
    if (cleaned.length > 0) proxyServerNs = cleaned;
  }

  if (!proxyServerNs) {
    proxyServerNs = [...domesticDoh];
    if (dns.respectRules === true && MIHOMO_CAPS.requiresProxyServerNameserverWithRespectRules) {
      items.push({
        code: 'PROXY_SERVER_NAMESERVER_INFERRED',
        severity: 'info',
        message: 'mihomo 开启 respect-rules 时要求配置 proxy-server-nameserver，已自动使用国内 DoH 补全。',
      });
    }
  }

  result['proxy-server-nameserver'] = proxyServerNs;

  const customPolicy = sanitizeDnsPolicyMap(dns.nameserverPolicy ?? dns.custom?.['nameserver-policy']);
  result['nameserver-policy'] = customPolicy ?? {
    'geosite:cn': [...domesticDoh],
    'geosite:private': [...domesticDoh],
  };

  // Forward remaining safe custom DNS keys (excluding internal metadata, legacy fallback, and already-mapped keys)
  if (dns.custom) {
    const handledKeys = new Set([
      'dnsLeakGuard',
      'proxyServerNameserver',
      'proxy-server-nameserver',
      'nameserver-policy',
      'fallback',
      'fallback-filter',
      'enhanced-mode',
      'fake-ip-range',
    ]);
    for (const [key, value] of Object.entries(dns.custom)) {
      if (handledKeys.has(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      result[key] = value;
    }
  }

  return result;
}

/**
 * Compiles a template intermediate representation into a valid mihomo YAML
 * configuration along with a structured compatibility report (design §10.6, §10.13).
 *
 * Pure function — no I/O, no wall-clock dependency, safe for Workers / Node / tests.
 */
export function compileMihomo(input: CompileTemplateInput): CompiledConfigResult {
  const items: CompatibilityItem[] = [];
  const output: OutputProfile = input.output ?? input.body.output ?? 'full';

  // 1. Resolve cards (overrides + template groupMode) and optionally apply enhancement modules
  const baseResolved = resolveTemplateCards({ ...input.body, output }, input.cards);
  for (const missingCardId of baseResolved.missingCardIds) {
    items.push({
      code: 'MISSING_CARD_REFERENCE',
      severity: 'warning',
      message: `模板引用的应用组件「${missingCardId}」未在组件库中找到，已跳过。`,
      location: { cardId: missingCardId },
    });
  }

  let resolved = baseResolved;
  let appliedModules: string[] = [];
  let skippedModules: string[] = [];

  if (input.applyModules !== false) {
    const modResult = applyEnhancementModules(baseResolved, {
      client: 'mihomo',
      registry: input.moduleRegistry,
    });
    resolved = modResult.template;
    appliedModules = modResult.applied;
    skippedModules = modResult.skipped.map((record) => record.moduleId);

    for (const skipped of modResult.skipped) {
      items.push({
        code: 'MODULE_SKIPPED',
        severity: 'warning',
        message: skipped.message,
        location: { moduleId: skipped.moduleId },
      });
    }
    for (const note of modResult.notes) {
      items.push({
        code: 'MODULE_NOTE',
        severity: 'info',
        message: note,
      });
    }
  }

  const body = resolved.body;
  const enabledCards = resolved.cards.filter((card) => card.enabled);
  const ipNoResolveEnabled = appliedModules.includes('ip-no-resolve');
  const githubMirrorUrl = input.githubMirrorUrl?.trim() || undefined;
  const effectiveIconPack = input.iconPack !== undefined ? input.iconPack : buildDefaultIconPack(githubMirrorUrl);
  const multiSlot = body.slots.length > 1;
  const perProviderVisible = multiSlot && (body.combineMode ?? body.wizardMeta?.combineMode) === 'perProvider';
  const useLegacyGeodata = Boolean(body.legacyGeodata);

  if (output === 'minimal') {
    items.push({
      code: 'MINIMAL_OMITTED_SECTIONS',
      severity: 'info',
      message: '输出档位为 minimal，已省略基础运行参数与 dns 段，仅输出节点、策略组、规则集与分流规则。',
    });
  }

  // 2. Compile NodeSlots -> proxy-providers
  const slotBindingMap = toSlotBindingMap(input.slotBindings);
  const usedProxyProviderKeys = new Set<string>();
  const slotProviderKeyById = new Map<string, string>();
  const proxyProviders: Record<string, Record<string, unknown>> = {};
  let totalInlineProxies = 0;

  for (const slot of body.slots) {
    const key = allocateUniqueKey(sanitizeMihomoProviderKey(slot.id, 'slot'), usedProxyProviderKeys);
    slotProviderKeyById.set(slot.id, key);
    const { entry, inlineProxyCount } = buildProxyProviderEntry(
      slot,
      key,
      slotBindingMap.get(slot.id),
      body.general,
      items,
      multiSlot,
    );
    proxyProviders[key] = entry;
    totalInlineProxies += inlineProxyCount;
  }

  const allProviderKeys = [...slotProviderKeyById.values()];

  // 3. Allocate unique sanitized group names for all enabled cards, region groups, and multi-airport helper groups
  const usedGroupNames = new Set<string>();
  const cardGroupNameById = new Map<string, string>();
  const regionGroupNameById = new Map<string, string>();
  const airportGroupNameBySlotId = new Map<string, string>();
  let allNodesGroupName: string | undefined;

  for (const card of enabledCards) {
    const sanitized = sanitizeMihomoGroupName(card.effective.name, card.cardId);
    const finalName = allocateUniqueName(
      sanitized,
      usedGroupNames,
      true,
      (resolvedName, reason) => {
        if (reason === 'sanitized' || reason === 'builtin-collision') {
          items.push({
            code: 'GROUP_NAME_SANITIZED',
            severity: 'info',
            message: `策略组名称已安全转义为「${resolvedName}」。`,
            location: { cardId: card.cardId },
          });
        }
      },
      card.effective.name,
    );
    cardGroupNameById.set(card.cardId, finalName);
  }

  for (const regionGroup of body.regionGroups) {
    const sanitized = sanitizeMihomoGroupName(regionGroup.name, regionGroup.id);
    const finalName = allocateUniqueName(
      sanitized,
      usedGroupNames,
      true,
      (resolvedName, reason) => {
        if (reason === 'sanitized' || reason === 'builtin-collision') {
          items.push({
            code: 'GROUP_NAME_SANITIZED',
            severity: 'info',
            message: `地区组名称已安全转义为「${resolvedName}」。`,
            location: { regionGroupId: regionGroup.id },
          });
        }
      },
      regionGroup.name,
    );
    regionGroupNameById.set(regionGroup.id, finalName);
  }

  if (multiSlot) {
    for (const slot of body.slots) {
      const sanitized = sanitizeMihomoGroupName(slot.name, slot.id);
      const finalName = allocateUniqueName(sanitized, usedGroupNames, true);
      airportGroupNameBySlotId.set(slot.id, finalName);
    }
    allNodesGroupName = allocateUniqueName('🌐 全部节点', usedGroupNames, true);
  }

  // Helper to resolve a PolicyRef into either a policy name or a slot reference
  const syntheticFilterGroups: Record<string, unknown>[] = [];
  const syntheticFilterGroupNames = new Map<string, string>();

  const resolveFilteredSlotGroup = (slotId: string, filter: NodeFilter, card: ResolvedTemplateCard): string | null => {
    const providerKey = slotProviderKeyById.get(slotId);
    if (!providerKey) {
      items.push({
        code: 'MISSING_SLOT_REFERENCE',
        severity: 'warning',
        message: `策略组「${card.effective.name}」引用了不存在的节点槽位 ${slotId}。`,
        location: { cardId: card.cardId, slotId },
      });
      return null;
    }

    const filterKey = JSON.stringify({ slotId, filter });
    const existingName = syntheticFilterGroupNames.get(filterKey);
    if (existingName) return existingName;

    const compiledFilter = compileNodeFilter(filter, items, { cardId: card.cardId, slotId });
    const baseName = sanitizeMihomoGroupName(`${card.effective.name} 节点`, `${card.cardId}-nodes`);
    const groupName = allocateUniqueName(baseName, usedGroupNames, true);
    syntheticFilterGroupNames.set(filterKey, groupName);

    const groupObj: Record<string, unknown> = {
      name: groupName,
      type: 'url-test',
      use: [providerKey],
      ...(compiledFilter.filter ? { filter: compiledFilter.filter } : {}),
      ...(compiledFilter.excludeFilter ? { 'exclude-filter': compiledFilter.excludeFilter } : {}),
      url: sanitizeMihomoScalar(card.effective.group.test?.url ?? body.general?.testUrl ?? DEFAULT_HEALTH_CHECK.url),
      interval:
        card.effective.group.test?.intervalSec ?? body.general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec,
      tolerance: card.effective.group.test?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 50,
      lazy: true,
      timeout: DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
      'expected-status': DEFAULT_EXPECTED_STATUS,
      hidden: true,
    };
    syntheticFilterGroups.push(groupObj);
    return groupName;
  };

  const shouldHideCardGroup = (card: ResolvedTemplateCard, groupType: string): boolean => {
    if (VISIBLE_CORE_HUB_CARD_IDS.has(card.cardId)) return false;
    if (HIDDEN_AUXILIARY_CARD_IDS.has(card.cardId)) return true;
    if ((groupType === 'fallback' || groupType === 'load-balance') && card.effective.matchers.length === 0) {
      return true;
    }
    return false;
  };

  const shouldHideRegionGroup = (regionGroup: RegionGroup): boolean => {
    if (regionGroup.hidden !== undefined) return regionGroup.hidden;
    return body.wizardMeta?.groupMode !== 'region';
  };

  // 4. Build proxy-groups for enabled cards
  const proxyGroups: Record<string, unknown>[] = [];

  for (const card of enabledCards) {
    const groupName = cardGroupNameById.get(card.cardId)!;
    const groupSpec = card.effective.group;
    const proxies: string[] = [];
    const use: string[] = [];
    let inlineFilter: CompiledFilterPair | undefined;

    const slotCandidates = groupSpec.candidates.filter(
      (candidate): candidate is Extract<PolicyRef, { kind: 'slot' }> => candidate.kind === 'slot',
    );
    const filteredSlotCandidates = slotCandidates.filter((candidate) => Boolean(candidate.filter));
    const canAttachSingleFilterDirectly = filteredSlotCandidates.length === 1 && slotCandidates.length === 1;

    for (const candidate of groupSpec.candidates) {
      if (candidate.kind === 'builtin') {
        if (!proxies.includes(candidate.id)) proxies.push(candidate.id);
        continue;
      }

      if (candidate.kind === 'card') {
        const targetName = cardGroupNameById.get(candidate.cardId);
        if (!targetName) {
          items.push({
            code: 'MISSING_CARD_REFERENCE',
            severity: 'warning',
            message: `策略组「${groupName}」引用的组件 ${candidate.cardId} 未启用或不存在，已忽略。`,
            location: { cardId: card.cardId },
          });
          continue;
        }
        if (!proxies.includes(targetName)) proxies.push(targetName);
        continue;
      }

      if (candidate.kind === 'region') {
        const regionName = regionGroupNameById.get(candidate.regionGroupId);
        if (!regionName) {
          items.push({
            code: 'MISSING_REGION_REFERENCE',
            severity: 'warning',
            message: `策略组「${groupName}」引用的地区组 ${candidate.regionGroupId} 不存在，已忽略。`,
            location: { cardId: card.cardId, regionGroupId: candidate.regionGroupId },
          });
          continue;
        }
        if (!proxies.includes(regionName)) proxies.push(regionName);
        continue;
      }

      // candidate.kind === 'slot'
      if (multiSlot && !candidate.filter && card.cardId === 'proxy-select') {
        // In multi-airport mode, `proxy-select` exposes per-airport hidden groups + `全部节点` instead of raw single-slot nodes
        for (const airportGroupName of airportGroupNameBySlotId.values()) {
          if (!proxies.includes(airportGroupName)) proxies.push(airportGroupName);
        }
        if (allNodesGroupName && !proxies.includes(allNodesGroupName)) {
          proxies.push(allNodesGroupName);
        }
        continue;
      }

      if (multiSlot && !candidate.filter && card.cardId === 'auto-select') {
        for (const key of allProviderKeys) {
          if (!use.includes(key)) use.push(key);
        }
        continue;
      }

      const providerKey = slotProviderKeyById.get(candidate.slotId);
      if (!providerKey) {
        items.push({
          code: 'MISSING_SLOT_REFERENCE',
          severity: 'warning',
          message: `策略组「${groupName}」引用的节点槽位 ${candidate.slotId} 不存在，已忽略。`,
          location: { cardId: card.cardId, slotId: candidate.slotId },
        });
        continue;
      }

      if (candidate.filter) {
        if (canAttachSingleFilterDirectly) {
          if (!use.includes(providerKey)) use.push(providerKey);
          inlineFilter = compileNodeFilter(candidate.filter, items, {
            cardId: card.cardId,
            slotId: candidate.slotId,
          });
        } else {
          const synthName = resolveFilteredSlotGroup(candidate.slotId, candidate.filter, card);
          if (synthName && !proxies.includes(synthName)) {
            proxies.push(synthName);
          }
        }
      } else if (!use.includes(providerKey)) {
        use.push(providerKey);
      }
    }

    // Ensure multi-airport `proxy-select` always includes airport groups and `全部节点` even if its candidates omitted slot refs
    if (multiSlot && card.cardId === 'proxy-select') {
      const insertBeforeDirect = (name: string) => {
        if (proxies.includes(name)) return;
        const directIdx = proxies.indexOf('DIRECT');
        if (directIdx >= 0) proxies.splice(directIdx, 0, name);
        else proxies.push(name);
      };
      for (const airportGroupName of airportGroupNameBySlotId.values()) {
        insertBeforeDirect(airportGroupName);
      }
      if (allNodesGroupName) {
        insertBeforeDirect(allNodesGroupName);
      }
    }

    if (proxies.length === 0 && use.length === 0) {
      proxies.push('DIRECT');
      items.push({
        code: 'GROUP_FALLBACK_DIRECT',
        severity: 'warning',
        message: `策略组「${groupName}」没有可用候选节点或分组，已兜底填入 DIRECT。`,
        location: { cardId: card.cardId },
      });
    }

    const groupObj: Record<string, unknown> = {
      name: groupName,
      type: groupSpec.type,
    };
    if (proxies.length > 0) groupObj.proxies = proxies;
    if (use.length > 0) groupObj.use = use;
    if (inlineFilter?.filter) groupObj.filter = inlineFilter.filter;
    if (inlineFilter?.excludeFilter) groupObj['exclude-filter'] = inlineFilter.excludeFilter;

    if (groupSpec.type === 'url-test' || groupSpec.type === 'fallback' || groupSpec.type === 'load-balance') {
      groupObj.url = sanitizeMihomoScalar(groupSpec.test?.url ?? body.general?.testUrl ?? DEFAULT_HEALTH_CHECK.url);
      groupObj.interval =
        groupSpec.test?.intervalSec ?? body.general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec;
      if (groupSpec.type === 'url-test') {
        groupObj.tolerance = groupSpec.test?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 50;
      }
      if (groupSpec.type === 'url-test' || groupSpec.type === 'fallback') {
        groupObj.lazy = true;
        groupObj.timeout = DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
        groupObj['expected-status'] = DEFAULT_EXPECTED_STATUS;
      }
      if (groupSpec.type === 'load-balance') {
        groupObj.strategy = DEFAULT_LOAD_BALANCE_STRATEGY;
      }
    }

    if (shouldHideCardGroup(card, groupSpec.type)) {
      groupObj.hidden = true;
    }

    const iconUrl = resolveGroupIconUrl(
      {
        explicitIcon: card.effective.icon,
        name: card.effective.name,
        slug: card.effective.slug,
        category: card.effective.category,
        groupType: groupSpec.type,
        matchers: card.effective.matchers,
      },
      effectiveIconPack,
      githubMirrorUrl,
    );
    if (iconUrl) {
      groupObj.icon = iconUrl;
    }

    proxyGroups.push(groupObj);
  }

  // 5. Build proxy-groups for regionGroups, multi-airport helper groups, and synthesized filtered slot sub-groups
  const compileRegionGroup = (regionGroup: RegionGroup): Record<string, unknown> => {
    const groupName = regionGroupNameById.get(regionGroup.id)!;
    const use: string[] = [];

    if (
      multiSlot &&
      (!regionGroup.slotId || regionGroup.slotId === 'slot-main' || !slotProviderKeyById.has(regionGroup.slotId))
    ) {
      for (const key of allProviderKeys) {
        use.push(key);
      }
    } else if (regionGroup.slotId) {
      const providerKey = slotProviderKeyById.get(regionGroup.slotId);
      if (providerKey) {
        use.push(providerKey);
      } else {
        items.push({
          code: 'MISSING_SLOT_REFERENCE',
          severity: 'warning',
          message: `地区组「${groupName}」引用的节点槽位 ${regionGroup.slotId} 不存在。`,
          location: { regionGroupId: regionGroup.id, slotId: regionGroup.slotId },
        });
      }
    } else {
      for (const key of allProviderKeys) {
        use.push(key);
      }
    }

    const compiledRegex = buildRegionRegex(regionGroup.region, 'mihomo', {
      extraInclude: regionGroup.extraInclude,
      extraExclude: regionGroup.extraExclude,
    });
    for (const warning of compiledRegex.warnings) {
      items.push({
        code: 'REGEX_DIALECT_WARNING',
        severity: 'warning',
        message: warning.message,
        location: { regionGroupId: regionGroup.id },
      });
    }

    const groupObj: Record<string, unknown> = {
      name: groupName,
      type: regionGroup.type,
    };

    if (use.length > 0) {
      groupObj.use = use;
      groupObj.filter = sanitizeMihomoScalar(compiledRegex.include);
      if (compiledRegex.exclude) {
        groupObj['exclude-filter'] = sanitizeMihomoScalar(compiledRegex.exclude);
      }
    } else {
      groupObj.proxies = ['DIRECT'];
      items.push({
        code: 'GROUP_FALLBACK_DIRECT',
        severity: 'warning',
        message: `地区组「${groupName}」没有可用节点槽位，已兜底填入 DIRECT。`,
        location: { regionGroupId: regionGroup.id },
      });
    }

    if (regionGroup.type === 'url-test' || regionGroup.type === 'fallback' || regionGroup.type === 'load-balance') {
      groupObj.url = sanitizeMihomoScalar(regionGroup.test?.url ?? body.general?.testUrl ?? DEFAULT_HEALTH_CHECK.url);
      groupObj.interval =
        regionGroup.test?.intervalSec ?? body.general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec;
      if (regionGroup.type === 'url-test') {
        groupObj.tolerance = regionGroup.test?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 50;
      }
      if (regionGroup.type === 'url-test' || regionGroup.type === 'fallback') {
        groupObj.lazy = true;
        groupObj.timeout = DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
        groupObj['expected-status'] = DEFAULT_EXPECTED_STATUS;
      }
      if (regionGroup.type === 'load-balance') {
        groupObj.strategy = DEFAULT_LOAD_BALANCE_STRATEGY;
      }
    }

    if (shouldHideRegionGroup(regionGroup)) {
      groupObj.hidden = true;
    }

    const iconUrl = resolveGroupIconUrl(
      {
        name: regionGroup.name,
        region: regionGroup.region,
        groupType: regionGroup.type,
      },
      effectiveIconPack,
      githubMirrorUrl,
    );
    if (iconUrl) {
      groupObj.icon = iconUrl;
    }

    return groupObj;
  };

  for (const regionGroup of body.regionGroups) {
    proxyGroups.push(compileRegionGroup(regionGroup));
  }

  if (multiSlot) {
    for (const slot of body.slots) {
      const providerKey = slotProviderKeyById.get(slot.id)!;
      const airportGroupName = airportGroupNameBySlotId.get(slot.id)!;
      const airportGroup: Record<string, unknown> = {
        name: airportGroupName,
        type: 'url-test',
        use: [providerKey],
        url: sanitizeMihomoScalar(slot.healthCheck?.url ?? body.general?.testUrl ?? DEFAULT_HEALTH_CHECK.url),
        interval: slot.healthCheck?.intervalSec ?? body.general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec,
        tolerance: slot.healthCheck?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 50,
        lazy: true,
        timeout: DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
        'expected-status': DEFAULT_EXPECTED_STATUS,
        ...(perProviderVisible ? {} : { hidden: true }),
      };
      const airportIcon = resolveGroupIconUrl(
        {
          name: slot.name,
          slug: 'airport',
          groupType: 'url-test',
        },
        effectiveIconPack,
        githubMirrorUrl,
      );
      if (airportIcon) {
        airportGroup.icon = airportIcon;
      }
      proxyGroups.push(airportGroup);
    }

    if (allNodesGroupName) {
      const allNodesGroup: Record<string, unknown> = {
        name: allNodesGroupName,
        type: 'select',
        use: allProviderKeys,
        ...(perProviderVisible ? {} : { hidden: true }),
      };
      const allNodesIcon = resolveGroupIconUrl(
        {
          name: allNodesGroupName,
          slug: 'all-nodes',
          groupType: 'select',
        },
        effectiveIconPack,
        githubMirrorUrl,
      );
      if (allNodesIcon) {
        allNodesGroup.icon = allNodesIcon;
      }
      proxyGroups.push(allNodesGroup);
    }
  }

  for (const synthGroup of syntheticFilterGroups) {
    proxyGroups.push(synthGroup);
  }

  // 6. Plan rule-providers & compile rules
  const plan = planRulesetReferences({
    cards: enabledCards,
    client: 'mihomo',
    catalogIndex: input.catalogIndex,
    rulesetBehaviors: input.rulesetBehaviors,
    baseUrl: input.baseUrl,
  });

  for (const warning of plan.warnings) {
    if (warning.code === 'CATALOG_ENTRY_MISSING') {
      items.push({
        code: 'CATALOG_ENTRY_MISSING',
        severity: 'warning',
        message: warning.message,
        location: { cardId: warning.cardId },
      });
    }
  }

  const inlinePayloads = toInlinePayloadsMap(input.inlineRulePayloads);
  const usedRuleProviderKeys = new Set<string>();
  const ruleProviderKeyById = new Map<string, string>();
  const ruleProviderBehaviorById = new Map<string, RemoteRuleBehavior>();
  const ruleProviders: Record<string, Record<string, unknown>> = {};

  for (const provider of plan.providers) {
    const key = allocateUniqueKey(sanitizeMihomoProviderKey(provider.id, 'ruleset'), usedRuleProviderKeys);
    ruleProviderKeyById.set(provider.id, key);
    const { entry, effectiveBehavior } = buildRuleProviderEntry(provider, key, inlinePayloads, items, githubMirrorUrl);
    ruleProviderBehaviorById.set(provider.id, effectiveBehavior);
    ruleProviders[key] = entry;
  }

  const mrsProviderKeyByRef = new Map<string, string>();
  const ensureMrsRuleProvider = (kind: 'geosite' | 'geoip', name: string): string => {
    const refKey = `${kind}:${name}`;
    const existing = mrsProviderKeyByRef.get(refKey);
    if (existing) return existing;

    const desiredKey = sanitizeMihomoProviderKey(`${kind}-${name}`, kind);
    const key = allocateUniqueKey(desiredKey, usedRuleProviderKeys);
    const behavior: RemoteRuleBehavior = kind === 'geosite' ? 'domain' : 'ipcidr';
    const rawUrl =
      kind === 'geosite'
        ? `${METACUBEX_MRS_GEOSITE_BASE}/${encodeURIComponent(name)}.mrs`
        : `${METACUBEX_MRS_GEOIP_BASE}/${encodeURIComponent(name)}.mrs`;
    ruleProviders[key] = {
      type: 'http',
      behavior,
      format: 'mrs',
      url: applyGithubMirror(rawUrl, githubMirrorUrl),
      path: `./providers/rules/${key}.mrs`,
      interval: DEFAULT_MRS_INTERVAL_SEC,
    };
    mrsProviderKeyByRef.set(refKey, key);
    return key;
  };

  // Index bindings by (cardId, matcherIndex) for fast ordered emission
  const bindingMap = new Map<string, PlannedMatcherBinding>();
  for (const binding of plan.bindings) {
    bindingMap.set(`${binding.cardId}:${binding.matcherIndex}`, binding);
  }

  const rules: string[] = [];
  let skippedRules = 0;

  for (const card of enabledCards) {
    if (card.effective.hidden) continue;
    const policyName = cardGroupNameById.get(card.cardId)!;

    card.effective.matchers.forEach((matcher, matcherIndex) => {
      const binding = bindingMap.get(`${card.cardId}:${matcherIndex}`);

      if (matcher.kind === 'geosite') {
        const name = sanitizeMihomoRuleValue(matcher.name).toLowerCase();
        if (name) {
          if (!useLegacyGeodata && KNOWN_METACUBEX_GEOSITE_MRS.has(name)) {
            const providerKey = ensureMrsRuleProvider('geosite', name);
            rules.push(`RULE-SET,${providerKey},${policyName}`);
          } else {
            rules.push(`GEOSITE,${name},${policyName}`);
          }
        }
        return;
      }

      if (matcher.kind === 'geoip') {
        const cleanVal = sanitizeMihomoRuleValue(matcher.name);
        const lowerName = cleanVal.toLowerCase();
        const upperName = cleanVal.toUpperCase();
        if (lowerName) {
          const appendNoResolve = Boolean(matcher.noResolve);
          if (!useLegacyGeodata && KNOWN_METACUBEX_GEOIP_MRS.has(lowerName)) {
            const providerKey = ensureMrsRuleProvider('geoip', lowerName);
            rules.push(
              appendNoResolve
                ? `RULE-SET,${providerKey},${policyName},no-resolve`
                : `RULE-SET,${providerKey},${policyName}`,
            );
          } else {
            rules.push(
              appendNoResolve ? `GEOIP,${upperName},${policyName},no-resolve` : `GEOIP,${upperName},${policyName}`,
            );
          }
        }
        return;
      }

      if (matcher.kind === 'inline') {
        for (const cond of matcher.conditions) {
          const compiled = compileTopLevelCondition(cond, policyName, card.cardId, items);
          if (compiled) {
            rules.push(compiled.topLevel);
          } else {
            skippedRules += 1;
          }
        }
        return;
      }

      // 'ruleset' | 'catalog' | 'remote' -> emit planned RULE-SET lines in strict evaluation order
      if (!binding || binding.providerIds.length === 0) return;
      for (const providerId of binding.providerIds) {
        const providerKey = ruleProviderKeyById.get(providerId);
        if (!providerKey) continue;
        const behavior = ruleProviderBehaviorById.get(providerId);
        const appendNoResolve = behavior === 'ipcidr' && (ipNoResolveEnabled || input.applyModules === false);
        rules.push(
          appendNoResolve
            ? `RULE-SET,${providerKey},${policyName},no-resolve`
            : `RULE-SET,${providerKey},${policyName}`,
        );
      }
    });
  }

  // 7. Resolve final catch-all MATCH policy
  const resolveFinalPolicy = (finalRef: PolicyRef): string => {
    if (finalRef.kind === 'builtin') return finalRef.id;
    if (finalRef.kind === 'card') {
      const target = cardGroupNameById.get(finalRef.cardId);
      if (target) return target;
      items.push({
        code: 'MISSING_CARD_REFERENCE',
        severity: 'warning',
        message: `兜底出口引用的组件 ${finalRef.cardId} 未启用或不存在，已回退为 DIRECT。`,
        location: { cardId: finalRef.cardId },
      });
      return 'DIRECT';
    }
    if (finalRef.kind === 'region') {
      const target = regionGroupNameById.get(finalRef.regionGroupId);
      if (target) return target;
      items.push({
        code: 'MISSING_REGION_REFERENCE',
        severity: 'warning',
        message: `兜底出口引用的地区组 ${finalRef.regionGroupId} 不存在，已回退为 DIRECT。`,
        location: { regionGroupId: finalRef.regionGroupId },
      });
      return 'DIRECT';
    }
    // finalRef.kind === 'slot' -> mihomo MATCH must point to a proxy or group, not a provider name
    const fallbackGroup = proxyGroups[0]?.name;
    return typeof fallbackGroup === 'string' ? fallbackGroup : 'DIRECT';
  };

  rules.push(`${MIHOMO_CAPS.finalRuleKeyword},${resolveFinalPolicy(body.final)}`);

  // 8. Assemble top-level YAML document according to output profile (`full` vs `minimal`)
  let document: Record<string, unknown> = {};

  if (output === 'full') {
    document['mixed-port'] = body.general?.mixedPort ?? 7890;
    document['allow-lan'] = body.general?.allowLan ?? false;
    document.mode = 'rule';
    document['log-level'] = body.general?.logLevel ?? 'info';
    document.ipv6 = body.general?.ipv6 ?? false;
    document['unified-delay'] = true;
    document['tcp-concurrent'] = true;
    document['find-process-mode'] = 'strict';
    document.profile = compileProfileSection();
    document.dns = compileDnsSection(body.dns, body.general, items);
    document.sniffer = compileSnifferSection();
  }

  if (Object.keys(proxyProviders).length > 0) {
    document['proxy-providers'] = proxyProviders;
  }

  document['proxy-groups'] = proxyGroups;

  if (Object.keys(ruleProviders).length > 0) {
    document['rule-providers'] = ruleProviders;
  }

  document.rules = rules;

  // 9. Apply optional mihomo client patch safely
  const rawPatch = body.clientPatches?.mihomo?.trim();
  if (rawPatch) {
    try {
      const parsedPatch = parseYaml(rawPatch) as unknown;
      if (isPlainObject(parsedPatch)) {
        document = deepMergeObjects(document, parsedPatch);
      } else {
        items.push({
          code: 'INVALID_CLIENT_PATCH',
          severity: 'warning',
          message: 'mihomo 客户端补丁必须是 YAML 映射对象，已忽略。',
        });
      }
    } catch (cause) {
      items.push({
        code: 'INVALID_CLIENT_PATCH',
        severity: 'warning',
        message: `mihomo 客户端补丁解析失败：${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
  }

  // 10. Serialize with `yaml` library (prevents YAML injection across all scalars)
  const headerLines = [
    `# Generated by Private Rules (mihomo / ${output})`,
    ...(input.templateName ? [`# TEMPLATE: ${sanitizeMihomoScalar(input.templateName)}`] : []),
    ...(input.generatedAt ? [`# UPDATED: ${sanitizeMihomoScalar(input.generatedAt)}`] : []),
  ];

  const yamlBody = stringifyYaml(document, {
    lineWidth: 0,
    minContentWidth: 0,
  });

  const content = `${headerLines.join('\n')}\n${yamlBody}`;

  return {
    client: 'mihomo',
    output,
    contentType: 'application/yaml; charset=utf-8',
    extension: '.yaml',
    content,
    report: {
      client: 'mihomo',
      output,
      items,
      stats: {
        proxyProviders: Object.keys(proxyProviders).length,
        inlineProxies: totalInlineProxies,
        proxyGroups: proxyGroups.length,
        ruleProviders: Object.keys(ruleProviders).length,
        rules: rules.length,
        skippedRules,
        appliedModules,
        skippedModules,
      },
    },
  };
}
