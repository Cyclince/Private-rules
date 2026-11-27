import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { OutputProfile } from '../../../shared/clients';
import type {
  Condition,
  NodeFilter,
  PolicyRef,
  RemoteRuleBehavior,
  RemoteRuleFormat,
} from '../../../shared/schemas/card';
import type { DnsProfile, NodePool, NodeSlot, TemplateBody } from '../../../shared/schemas/template';
import { buildExcludeInfoRegex, buildRegionRegex, detectRegexDialectIssues, matchNodeFilter } from '../../nodes';
import {
  CLIENT_CAPABILITIES,
  isGroupTypeSupported,
  isRemoteFormatSupported,
  isRuleTypeSupported,
} from '../capabilities';
import { recognizeGroupIcon } from '../icons';
import { DEFAULT_HEALTH_CHECK, resolveTemplateCards, type ResolvedTemplateCard } from '../model';
import { applyEnhancementModules } from '../modules';
import { planRulesetReferences, type PlannedMatcherBinding, type PlannedProvider } from '../planner';
import { getNormalizedBodyPools } from '../pools';
import {
  evaluatePoolEmptyProtection,
  poolCompatibilityLocation,
  poolToNodeFilter,
  resolveStabilityPoolMembers,
} from './pool-helpers';
import type {
  CompatibilityItem,
  CompiledConfigResult,
  CompiledNodeSlotBinding,
  CompileTemplateInput,
  InlineProxyNode,
} from './types';

const STASH_CAPS = CLIENT_CAPABILITIES.stash;

const DEFAULT_PROVIDER_INTERVAL_SEC = 3600;
const DEFAULT_BOOTSTRAP_DNS = ['223.5.5.5', '119.29.29.29'];
const DEFAULT_FAKE_IP_RANGE = '198.18.0.1/16';
const DEFAULT_LOAD_BALANCE_STRATEGY = 'consistent-hashing';

// eslint-disable-next-line no-control-regex
const CONTROL_AND_LINE_BREAK_RE = /[\r\n\u2028\u2029\x00-\x1f\x7f]+/g;

/**
 * Strips CR/LF/Unicode line separators and ASCII control characters from any
 * scalar emitted into Stash YAML comments or fields.
 */
export function sanitizeStashScalar(raw: string): string {
  return raw.replace(CONTROL_AND_LINE_BREAK_RE, ' ').trim();
}

/**
 * Sanitizes a Stash proxy-group name so it cannot inject YAML structure or break
 * comma-delimited `rules:` entries (e.g. `DOMAIN,a.com,<GROUP>`).
 */
export function sanitizeStashGroupName(raw: string, fallback = 'ProxyGroup'): string {
  const cleaned = sanitizeStashScalar(raw).replace(/,/g, '，').trim();
  return cleaned || fallback;
}

/**
 * Sanitizes a Stash proxy/node name against control characters, line breaks, and
 * comma-based rule injection.
 */
export function sanitizeStashNodeName(raw: string, fallback = 'Node'): string {
  const cleaned = sanitizeStashScalar(raw).replace(/,/g, '，').trim();
  return cleaned || fallback;
}

/**
 * Produces a safe ASCII key for Stash `proxy-providers` / `rule-providers` maps
 * and local cache file paths (`[A-Za-z0-9_-]`), eliminating path traversal.
 */
export function sanitizeStashProviderKey(raw: string, fallback = 'provider'): string {
  const normalized = sanitizeStashScalar(raw)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

/**
 * Sanitizes a rule value embedded in a comma-delimited Stash rule string so it
 * cannot inject extra comma fields (such as `,DIRECT` or `,no-resolve`).
 */
export function sanitizeStashRuleValue(raw: string): string {
  return sanitizeStashScalar(raw).replace(/,/g, '').trim();
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = sanitizeStashScalar(value);
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
): string | undefined {
  if (isHttpUrl(input.explicitIcon)) {
    return sanitizeStashScalar(input.explicitIcon);
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
  if (isHttpUrl(recognized.packIcon?.url)) {
    return sanitizeStashScalar(recognized.packIcon.url);
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

  if (avoidBuiltins && STASH_CAPS.builtinPolicies.has(candidate.toUpperCase())) {
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

function stripLeadingInlineCaseFlag(pattern: string): string {
  return pattern.startsWith('(?i)') ? pattern.slice(4) : pattern;
}

/**
 * Compiles a `NodeFilter` into a single Stash ICU regex `filter` string.
 * Because Stash only supports `filter` (no `exclude-filter`), exclusions are
 * folded into an ICU negative lookahead assertion.
 */
function compileStashNodeFilter(
  nodeFilter: NodeFilter | undefined,
  items: CompatibilityItem[],
  location: CompatibilityItem['location'],
): string | undefined {
  if (!nodeFilter) return undefined;

  if (nodeFilter.regions && nodeFilter.regions.length > 0) {
    const compiled = buildRegionRegex(nodeFilter.regions, 'stash', {
      extraInclude: nodeFilter.include,
      extraExclude: nodeFilter.exclude,
    });
    for (const warning of compiled.warnings) {
      items.push({
        code: 'REGEX_DIALECT_WARNING',
        severity: 'warning',
        message: warning.message,
        location,
      });
    }
    return sanitizeStashScalar(compiled.combined);
  }

  const rawInclude = nodeFilter.include ? sanitizeStashScalar(nodeFilter.include) : undefined;
  const rawExclude = nodeFilter.exclude ? sanitizeStashScalar(nodeFilter.exclude) : undefined;

  if (rawInclude) {
    for (const issue of detectRegexDialectIssues(rawInclude, 'stash')) {
      items.push({
        code: 'REGEX_DIALECT_WARNING',
        severity: 'warning',
        message: issue.message,
        location,
      });
    }
  }
  if (rawExclude) {
    for (const issue of detectRegexDialectIssues(rawExclude, 'stash')) {
      items.push({
        code: 'REGEX_DIALECT_WARNING',
        severity: 'warning',
        message: issue.message,
        location,
      });
    }
  }

  if (rawInclude && rawExclude) {
    const inc = stripLeadingInlineCaseFlag(rawInclude);
    const exc = stripLeadingInlineCaseFlag(rawExclude);
    return `(?i)^(?!.*(?:${exc})).*(?:${inc})`;
  }
  if (rawExclude) {
    const exc = stripLeadingInlineCaseFlag(rawExclude);
    return `(?i)^(?!.*(?:${exc})).*$`;
  }
  return rawInclude;
}

type CompiledStashSlot =
  | {
      kind: 'provider';
      providerKey: string;
      entry: Record<string, unknown>;
    }
  | {
      kind: 'inline';
      proxies: InlineProxyNode[];
      proxyNames: string[];
    };

function buildStashSlot(
  slot: NodeSlot,
  providerKey: string,
  binding: CompiledNodeSlotBinding | undefined,
  usedInlineProxyNames: Set<string>,
  items: CompatibilityItem[],
): CompiledStashSlot {
  const excludeInfoFilter = slot.excludeInfo !== false ? buildExcludeInfoRegex('stash').combined : undefined;
  const overrideUdp = slot.udp !== false;

  if (slot.healthCheck) {
    items.push({
      code: 'UNSUPPORTED_PROVIDER_OPTION',
      severity: 'info',
      message: `Stash 的 proxy-providers 不支持槽位级 health-check（槽位「${slot.name}」），测速参数将通过策略组的 benchmark-url / interval 生效。`,
      location: { slotId: slot.id },
    });
  }

  if (binding?.kind === 'inline') {
    const sanitizedPayload: InlineProxyNode[] = binding.proxies.map((proxy, idx) => {
      const cleanName = allocateUniqueName(
        sanitizeStashNodeName(proxy.name, `Node-${idx + 1}`),
        usedInlineProxyNames,
        true,
      );
      const cleanedNode: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(proxy)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        if (k === 'name') {
          cleanedNode.name = cleanName;
        } else if (typeof v === 'string') {
          cleanedNode[k] = sanitizeStashScalar(v);
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

    items.push({
      code: 'UNSUPPORTED_PROVIDER_OPTION',
      severity: 'info',
      message: `Stash 的 proxy-providers 不支持 type: inline，已将槽位「${slot.name}」的 ${sanitizedPayload.length} 个内联节点写入顶层 proxies 段。`,
      location: { slotId: slot.id },
    });

    return {
      kind: 'inline',
      proxies: sanitizedPayload,
      proxyNames: sanitizedPayload.map((node) => node.name),
    };
  }

  if (overrideUdp) {
    items.push({
      code: 'UNSUPPORTED_PROVIDER_OPTION',
      severity: 'info',
      message: `Stash 的 proxy-providers 不支持 override.udp 强制开启 UDP（槽位「${slot.name}」），将保留上游订阅原节点的 UDP 配置。`,
      location: { slotId: slot.id },
    });
  }

  if (!binding || binding.kind === 'snapshot') {
    items.push({
      code: 'UNBOUND_NODE_SLOT',
      severity: 'warning',
      message: `节点槽位「${slot.name}」（${slot.id}）未绑定订阅源，已使用占位 HTTP Provider。`,
      location: { slotId: slot.id },
    });
    return {
      kind: 'provider',
      providerKey,
      entry: {
        url: `https://example.invalid/providers/${providerKey}.yaml`,
        path: `./providers/proxies/${providerKey}.yaml`,
        interval: DEFAULT_PROVIDER_INTERVAL_SEC,
        ...(excludeInfoFilter ? { filter: excludeInfoFilter } : {}),
      },
    };
  }

  if (binding.kind === 'http') {
    if (binding.proxy && binding.proxy.trim().toUpperCase() !== 'DIRECT') {
      items.push({
        code: 'UNSUPPORTED_PROVIDER_OPTION',
        severity: 'warning',
        message: `Stash 的 proxy-providers 不支持 proxy 拉取策略（${sanitizeStashScalar(binding.proxy)}），已忽略该参数。`,
        location: { slotId: slot.id },
      });
    }

    const entry: Record<string, unknown> = {
      url: sanitizeStashScalar(binding.url),
      path: sanitizeStashScalar(binding.path ?? `./providers/proxies/${providerKey}.yaml`),
      interval: binding.intervalSec ?? DEFAULT_PROVIDER_INTERVAL_SEC,
    };
    if (excludeInfoFilter) {
      entry.filter = excludeInfoFilter;
    }
    if (binding.userAgent?.trim()) {
      // Official Stash docs use plural `headers` (not mihomo's `header`)
      entry.headers = {
        'User-Agent': sanitizeStashScalar(binding.userAgent),
      };
    }
    return {
      kind: 'provider',
      providerKey,
      entry,
    };
  }

  // binding.kind === 'file'
  return {
    kind: 'provider',
    providerKey,
    entry: {
      path: sanitizeStashScalar(binding.path),
      ...(excludeInfoFilter ? { filter: excludeInfoFilter } : {}),
    },
  };
}

function buildStashRuleProviderEntry(
  provider: PlannedProvider,
  providerKey: string,
  inlinePayloads: Map<string, readonly string[]>,
  items: CompatibilityItem[],
): { entry: Record<string, unknown>; effectiveBehavior: RemoteRuleBehavior } {
  const inlineLines = inlinePayloads.get(provider.id);
  if (inlineLines) {
    return {
      entry: {
        type: 'inline',
        behavior: provider.behavior,
        payload: inlineLines.map((line) => sanitizeStashScalar(line)).filter(Boolean),
      },
      effectiveBehavior: provider.behavior,
    };
  }

  let effectiveFormat: RemoteRuleFormat = provider.format;
  if (effectiveFormat === 'mrs' && !isRemoteFormatSupported('stash', 'mrs', provider.behavior)) {
    effectiveFormat = 'yaml';
    items.push({
      code: 'MRS_CLASSICAL_DOWNGRADED',
      severity: 'warning',
      message: `Stash 的 mrs 格式不支持 behavior: ${provider.behavior}（规则集 ${provider.id}），已自动降级为 yaml 格式。`,
      location: { providerId: provider.id },
    });
  }

  let remoteUrl: string | undefined;
  if (provider.source.kind === 'remote' || provider.source.kind === 'catalog') {
    remoteUrl = provider.source.url;
  } else if (provider.source.kind === 'ruleset' || provider.source.kind === 'geosite-hosted') {
    remoteUrl = provider.source.url;
  }

  if (!remoteUrl) {
    items.push({
      code: 'MISSING_RULESET_URL',
      severity: 'warning',
      message: `自托管规则集 ${provider.id} 未提供 baseUrl 或内联规则内容，已输出空的 inline rule-provider 占位。`,
      location: { providerId: provider.id },
    });
    return {
      entry: {
        type: 'inline',
        behavior: provider.behavior,
        payload: [],
      },
      effectiveBehavior: provider.behavior,
    };
  }

  const ext = formatExtensionForRuleProvider(effectiveFormat);
  return {
    entry: {
      behavior: provider.behavior,
      format: effectiveFormat,
      url: sanitizeStashScalar(remoteUrl),
      path: `./providers/rules/${providerKey}.${ext}`,
      interval: provider.updateIntervalSec,
    },
    effectiveBehavior: provider.behavior,
  };
}

type CompiledRuleAtom = {
  topLevel: string;
};

type CompiledConditionExpr = {
  inner: string;
  leafParts?: {
    type: string;
    value: string;
    noResolve: boolean;
  };
};

function compileStashConditionExpr(
  cond: Condition,
  cardId: string,
  items: CompatibilityItem[],
  reportedGeosites: Set<string>,
): CompiledConditionExpr | null {
  if (cond.op === 'rule') {
    const { type, value, options } = cond.rule;
    if (!isRuleTypeSupported('stash', type)) {
      items.push({
        code: 'UNSUPPORTED_RULE_TYPE',
        severity: 'warning',
        message: `Stash 不支持规则类型 ${type}（值：${sanitizeStashScalar(value)}），已跳过该条规则。`,
        location: { cardId },
      });
      return null;
    }

    const cleanValue = sanitizeStashRuleValue(value);
    if (!cleanValue) return null;

    if (type === 'GEOSITE') {
      const normalized = cleanValue.toLowerCase();
      if (!reportedGeosites.has(normalized)) {
        reportedGeosites.add(normalized);
        items.push({
          code: 'PARTIAL_GEOSITE_SUPPORT',
          severity: 'info',
          message: `Stash 依赖内置 v2fly domain-list-community 支持 GEOSITE(${normalized})，请确认该分类在当前 Stash 版本中存在。`,
          location: { cardId },
        });
      }
    }

    const aliasedType = STASH_CAPS.ruleTypeAliases[type] ?? type;
    const emittedType = type === 'IP-CIDR' && cleanValue.includes(':') ? STASH_CAPS.ipV6RuleType : aliasedType;
    const noResolve = Boolean(options?.noResolve && STASH_CAPS.noResolveRuleTypes.has(type));
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
    const sub = compileStashConditionExpr(cond.item, cardId, items, reportedGeosites);
    if (!sub) return null;
    return {
      inner: `NOT,((${sub.inner}))`,
    };
  }

  const compiledChildren: CompiledConditionExpr[] = [];
  for (const child of cond.items) {
    const compiled = compileStashConditionExpr(child, cardId, items, reportedGeosites);
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

function compileStashTopLevelCondition(
  cond: Condition,
  policyName: string,
  cardId: string,
  items: CompatibilityItem[],
  reportedGeosites: Set<string>,
): CompiledRuleAtom | null {
  const expr = compileStashConditionExpr(cond, cardId, items, reportedGeosites);
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

function compileStashDnsSection(
  dns: DnsProfile,
  general: TemplateBody['general'],
  items: CompatibilityItem[],
): Record<string, unknown> {
  if (dns.mode === 'redir-host') {
    items.push({
      code: 'UNSUPPORTED_DNS_OPTION',
      severity: 'warning',
      message: 'Stash 仅支持 Fake-IP DNS 模式，不支持 enhanced-mode: redir-host，已自动切换为 Fake-IP。',
    });
  }

  const result: Record<string, unknown> = {
    ipv6: dns.ipv6 ?? general?.ipv6 ?? false,
  };

  const defaultNs =
    dns.defaultNameserver && dns.defaultNameserver.length > 0
      ? dns.defaultNameserver.map((entry) => sanitizeStashScalar(entry)).filter(Boolean)
      : undefined;
  if (defaultNs && defaultNs.length > 0) {
    result['default-nameserver'] = defaultNs;
  }

  if (dns.nameserver && dns.nameserver.length > 0) {
    result.nameserver = dns.nameserver.map((entry) => sanitizeStashScalar(entry)).filter(Boolean);
  }

  if (dns.fallback && dns.fallback.length > 0) {
    result.fallback = dns.fallback.map((entry) => sanitizeStashScalar(entry)).filter(Boolean);
  }

  const fakeIpRange =
    typeof dns.custom?.['fake-ip-range'] === 'string'
      ? sanitizeStashScalar(dns.custom['fake-ip-range'])
      : DEFAULT_FAKE_IP_RANGE;
  result['fake-ip-range'] = fakeIpRange;

  if (dns.fakeIpFilter && dns.fakeIpFilter.length > 0) {
    result['fake-ip-filter'] = dns.fakeIpFilter.map((entry) => sanitizeStashScalar(entry)).filter(Boolean);
  }

  if (dns.respectRules) {
    result['follow-rule'] = true;
  }

  const rawProxyServerNs = dns.custom?.['proxy-server-nameserver'] ?? dns.custom?.proxyServerNameserver;
  let proxyServerNs: string[] | undefined;
  if (Array.isArray(rawProxyServerNs)) {
    const cleaned = rawProxyServerNs
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => sanitizeStashScalar(entry))
      .filter(Boolean);
    if (cleaned.length > 0) proxyServerNs = cleaned;
  }

  if (dns.respectRules && STASH_CAPS.requiresProxyServerNameserverWithRespectRules && !proxyServerNs) {
    proxyServerNs = defaultNs && defaultNs.length > 0 ? [...defaultNs] : [...DEFAULT_BOOTSTRAP_DNS];
    items.push({
      code: 'PROXY_SERVER_NAMESERVER_INFERRED',
      severity: 'info',
      message: 'Stash 开启 follow-rule 时需要配置 proxy-server-nameserver，已自动从 default-nameserver 补全。',
    });
  }

  if (proxyServerNs && proxyServerNs.length > 0) {
    result['proxy-server-nameserver'] = proxyServerNs;
  }

  if (dns.custom) {
    const handledKeys = new Set([
      'dnsLeakGuard',
      'proxyServerNameserver',
      'proxy-server-nameserver',
      'enhanced-mode',
      'fake-ip-range',
      'respect-rules',
      'follow-rule',
    ]);
    for (const [key, value] of Object.entries(dns.custom)) {
      if (handledKeys.has(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      result[key] = value;
    }
  }

  return result;
}

/**
 * Compiles a template intermediate representation into a valid Stash YAML
 * configuration (https://stash.wiki — iOS/tvOS 3.6–3.7+, macOS 4.3–4.4+) along
 * with a structured compatibility report (design §10.6, §10.13, §11).
 *
 * Pure function — no I/O, no wall-clock dependency.
 */
export function compileStash(input: CompileTemplateInput): CompiledConfigResult {
  const items: CompatibilityItem[] = [];
  const output: OutputProfile = input.output ?? input.body.output ?? 'full';

  // 1. Resolve cards and optionally apply enhancement modules
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
      client: 'stash',
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

  if (output === 'minimal') {
    items.push({
      code: 'MINIMAL_OMITTED_SECTIONS',
      severity: 'info',
      message: '输出档位为 minimal，已省略基础运行参数与 dns 段，仅输出节点、策略组、规则集与分流规则。',
    });
  }

  // 2. Compile NodeSlots -> proxy-providers (or top-level proxies for inline slots)
  const slotBindingMap = toSlotBindingMap(input.slotBindings);
  const usedProxyProviderKeys = new Set<string>();
  const usedInlineProxyNames = new Set<string>();
  const slotById = new Map<string, NodeSlot>();
  const compiledSlotById = new Map<string, CompiledStashSlot>();
  const proxyProviders: Record<string, Record<string, unknown>> = {};
  const topLevelProxies: InlineProxyNode[] = [];

  for (const slot of body.slots) {
    slotById.set(slot.id, slot);
    const key = allocateUniqueKey(sanitizeStashProviderKey(slot.id, 'slot'), usedProxyProviderKeys);
    const compiledSlot = buildStashSlot(slot, key, slotBindingMap.get(slot.id), usedInlineProxyNames, items);
    compiledSlotById.set(slot.id, compiledSlot);
    if (compiledSlot.kind === 'provider') {
      proxyProviders[compiledSlot.providerKey] = compiledSlot.entry;
    } else {
      topLevelProxies.push(...compiledSlot.proxies);
    }
  }

  const hasExplicitPools = body.pools !== undefined;
  const bodyPools = getNormalizedBodyPools(body);

  // 3. Allocate unique sanitized group names for enabled cards and pools
  const usedGroupNames = new Set<string>(usedInlineProxyNames);
  const cardGroupNameById = new Map<string, string>();
  const poolGroupNameById = new Map<string, string>();

  for (const card of enabledCards) {
    const sanitized = sanitizeStashGroupName(card.effective.name, card.cardId);
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

  for (const pool of bodyPools) {
    const sanitized = sanitizeStashGroupName(pool.name, pool.id);
    const finalName = allocateUniqueName(
      sanitized,
      usedGroupNames,
      true,
      (resolvedName, reason) => {
        if (reason === 'sanitized' || reason === 'builtin-collision') {
          items.push({
            code: 'GROUP_NAME_SANITIZED',
            severity: 'info',
            message: `${pool.kind === 'region' ? '地区组' : '节点池'}名称已安全转义为「${resolvedName}」。`,
            location: poolCompatibilityLocation(pool, hasExplicitPools),
          });
        }
      },
      pool.name,
    );
    poolGroupNameById.set(pool.id, finalName);
  }

  const syntheticFilterGroups: Record<string, unknown>[] = [];
  const syntheticFilterGroupNames = new Map<string, string>();

  const resolveFilteredProviderSlotGroup = (
    slotId: string,
    providerKey: string,
    filter: NodeFilter,
    card: ResolvedTemplateCard,
  ): string => {
    const filterKey = JSON.stringify({ slotId, filter });
    const existingName = syntheticFilterGroupNames.get(filterKey);
    if (existingName) return existingName;

    const compiledFilter = compileStashNodeFilter(filter, items, { cardId: card.cardId, slotId });
    const baseName = sanitizeStashGroupName(`${card.effective.name} 节点`, `${card.cardId}-nodes`);
    const groupName = allocateUniqueName(baseName, usedGroupNames, true);
    syntheticFilterGroupNames.set(filterKey, groupName);

    const groupObj: Record<string, unknown> = {
      name: groupName,
      type: 'url-test',
      use: [providerKey],
      ...(compiledFilter ? { filter: compiledFilter } : {}),
      'benchmark-url': sanitizeStashScalar(
        card.effective.group.test?.url ?? body.general?.testUrl ?? DEFAULT_HEALTH_CHECK.url,
      ),
      interval:
        card.effective.group.test?.intervalSec ?? body.general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec,
      tolerance: card.effective.group.test?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 50,
    };
    syntheticFilterGroups.push(groupObj);
    return groupName;
  };

  // 4. Build proxy-groups for enabled cards
  const proxyGroups: Record<string, unknown>[] = [];

  for (const card of enabledCards) {
    const groupName = cardGroupNameById.get(card.cardId)!;
    const groupSpec = card.effective.group;
    let effectiveGroupType = groupSpec.type;
    if (!isGroupTypeSupported('stash', effectiveGroupType)) {
      items.push({
        code: 'UNSUPPORTED_GROUP_TYPE',
        severity: 'warning',
        message: `Stash 不支持策略组类型 ${effectiveGroupType}（策略组「${groupName}」），已降级为 select。`,
        location: { cardId: card.cardId },
      });
      effectiveGroupType = 'select';
    }

    const proxies: string[] = [];
    const use: string[] = [];
    let inlineFilter: string | undefined;

    const providerSlotCandidates = groupSpec.candidates.filter(
      (candidate): candidate is Extract<PolicyRef, { kind: 'slot' }> =>
        candidate.kind === 'slot' && compiledSlotById.get(candidate.slotId)?.kind === 'provider',
    );
    const filteredProviderSlotCandidates = providerSlotCandidates.filter((candidate) => Boolean(candidate.filter));
    const canAttachSingleFilterDirectly =
      filteredProviderSlotCandidates.length === 1 && providerSlotCandidates.length === 1;

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

      if (candidate.kind === 'region' || candidate.kind === 'pool') {
        const targetId = candidate.kind === 'pool' ? candidate.poolId : candidate.regionGroupId;
        const poolName = poolGroupNameById.get(targetId);
        if (!poolName) {
          items.push({
            code: candidate.kind === 'pool' ? 'MISSING_POOL_REFERENCE' : 'MISSING_REGION_REFERENCE',
            severity: 'warning',
            message:
              candidate.kind === 'pool'
                ? `策略组「${groupName}」引用的节点池 ${targetId} 不存在，已忽略。`
                : `策略组「${groupName}」引用的地区组 ${targetId} 不存在，已忽略。`,
            location:
              candidate.kind === 'pool'
                ? { cardId: card.cardId, poolId: targetId }
                : { cardId: card.cardId, regionGroupId: targetId },
          });
          continue;
        }
        if (!proxies.includes(poolName)) proxies.push(poolName);
        continue;
      }

      // candidate.kind === 'slot'
      const compiledSlot = compiledSlotById.get(candidate.slotId);
      if (!compiledSlot) {
        items.push({
          code: 'MISSING_SLOT_REFERENCE',
          severity: 'warning',
          message: `策略组「${groupName}」引用的节点槽位 ${candidate.slotId} 不存在，已忽略。`,
          location: { cardId: card.cardId, slotId: candidate.slotId },
        });
        continue;
      }

      if (compiledSlot.kind === 'inline') {
        const slot = slotById.get(candidate.slotId);
        const excludeInfo = slot?.excludeInfo !== false;
        const matchedNames = candidate.filter
          ? compiledSlot.proxyNames.filter((name) => matchNodeFilter(name, candidate.filter!, { excludeInfo }))
          : compiledSlot.proxyNames;
        if (candidate.filter) {
          // Validate regex dialect even when filtering inline proxies
          compileStashNodeFilter(candidate.filter, items, { cardId: card.cardId, slotId: candidate.slotId });
        }
        for (const nodeName of matchedNames) {
          if (!proxies.includes(nodeName)) proxies.push(nodeName);
        }
        continue;
      }

      // compiledSlot.kind === 'provider'
      if (candidate.filter) {
        if (canAttachSingleFilterDirectly) {
          if (!use.includes(compiledSlot.providerKey)) use.push(compiledSlot.providerKey);
          inlineFilter = compileStashNodeFilter(candidate.filter, items, {
            cardId: card.cardId,
            slotId: candidate.slotId,
          });
        } else {
          const synthName = resolveFilteredProviderSlotGroup(
            candidate.slotId,
            compiledSlot.providerKey,
            candidate.filter,
            card,
          );
          if (!proxies.includes(synthName)) {
            proxies.push(synthName);
          }
        }
      } else if (!use.includes(compiledSlot.providerKey)) {
        use.push(compiledSlot.providerKey);
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
      type: effectiveGroupType,
    };
    if (proxies.length > 0) groupObj.proxies = proxies;
    if (use.length > 0) groupObj.use = use;
    if (inlineFilter) groupObj.filter = inlineFilter;

    if (
      effectiveGroupType === 'url-test' ||
      effectiveGroupType === 'fallback' ||
      effectiveGroupType === 'load-balance'
    ) {
      groupObj['benchmark-url'] = sanitizeStashScalar(
        groupSpec.test?.url ?? body.general?.testUrl ?? DEFAULT_HEALTH_CHECK.url,
      );
      groupObj.interval =
        groupSpec.test?.intervalSec ?? body.general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec;
      if (effectiveGroupType === 'url-test') {
        groupObj.tolerance = groupSpec.test?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 50;
      }
      if (effectiveGroupType === 'load-balance') {
        groupObj.strategy = DEFAULT_LOAD_BALANCE_STRATEGY;
      }
    }

    const iconUrl = resolveGroupIconUrl(
      {
        explicitIcon: card.effective.icon,
        name: card.effective.name,
        slug: card.effective.slug,
        category: card.effective.category,
        groupType: effectiveGroupType,
        matchers: card.effective.matchers,
      },
      input.iconPack,
    );
    if (iconUrl) {
      groupObj.icon = iconUrl;
    }

    proxyGroups.push(groupObj);
  }

  // 5. Build proxy-groups for node pools (plus synthesized filtered slot sub-groups)
  const allProviderKeys = [...compiledSlotById.values()]
    .filter((s): s is Extract<CompiledStashSlot, { kind: 'provider' }> => s.kind === 'provider')
    .map((s) => s.providerKey);
  const allInlineProxyNames = [...compiledSlotById.values()]
    .filter((s): s is Extract<CompiledStashSlot, { kind: 'inline' }> => s.kind === 'inline')
    .flatMap((s) => s.proxyNames);

  const compilePoolGroup = (pool: NodePool): Record<string, unknown> => {
    const groupName = poolGroupNameById.get(pool.id)!;
    const location = poolCompatibilityLocation(pool, hasExplicitPools);
    let effectiveType = pool.type;
    if (!isGroupTypeSupported('stash', effectiveType)) {
      items.push({
        code: 'UNSUPPORTED_GROUP_TYPE',
        severity: 'warning',
        message: `Stash 不支持${pool.kind === 'region' ? '地区组' : '节点池'}类型 ${effectiveType}（${pool.kind === 'region' ? '地区组' : '节点池'}「${groupName}」），已降级为 select。`,
        location,
      });
      effectiveType = 'select';
    }

    const groupObj: Record<string, unknown> = {
      name: groupName,
      type: effectiveType,
    };

    if (pool.kind === 'stability') {
      const members = resolveStabilityPoolMembers(pool, poolGroupNameById, items, hasExplicitPools);
      if (members.length > 0) {
        groupObj.proxies = members;
      } else if (allInlineProxyNames.length > 0 || allProviderKeys.length > 0) {
        if (allInlineProxyNames.length > 0) groupObj.proxies = [...new Set(allInlineProxyNames)];
        if (allProviderKeys.length > 0) groupObj.use = [...allProviderKeys];
        items.push({
          code: 'EMPTY_POOL_FALLBACK_ALL',
          severity: 'warning',
          message: `稳定性节点池「${groupName}」无可用成员池，已退化为引用全部节点。`,
          location,
        });
      } else {
        groupObj.proxies = ['DIRECT'];
        items.push({
          code: 'GROUP_FALLBACK_DIRECT',
          severity: 'warning',
          message: `稳定性节点池「${groupName}」没有可用成员或节点槽位，已兜底填入 DIRECT。`,
          location,
        });
      }
    } else {
      const use: string[] = [];
      const inlineMatchedProxies: string[] = [];
      const nodeFilter = poolToNodeFilter(pool);

      const emptyProtection = evaluatePoolEmptyProtection({
        pool,
        client: 'stash',
        slots: body.slots,
        slotById,
        slotBindings: slotBindingMap,
      });

      const collectSlot = (slotId: string, skipNodeFiltering: boolean) => {
        const compiledSlot = compiledSlotById.get(slotId);
        if (!compiledSlot) {
          items.push({
            code: 'MISSING_SLOT_REFERENCE',
            severity: 'warning',
            message: `${pool.kind === 'region' ? '地区组' : '节点池'}「${groupName}」引用的节点槽位 ${slotId} 不存在。`,
            location: { ...location, slotId },
          });
          return;
        }
        if (compiledSlot.kind === 'provider') {
          if (!use.includes(compiledSlot.providerKey)) use.push(compiledSlot.providerKey);
        } else {
          const slot = slotById.get(slotId);
          const excludeInfo = slot?.excludeInfo !== false;
          const matched =
            !skipNodeFiltering && nodeFilter
              ? compiledSlot.proxyNames.filter((name) => matchNodeFilter(name, nodeFilter, { excludeInfo }))
              : compiledSlot.proxyNames;
          for (const nodeName of matched) {
            if (!inlineMatchedProxies.includes(nodeName)) inlineMatchedProxies.push(nodeName);
          }
        }
      };

      const targetSlots = pool.sources === 'all' ? [...compiledSlotById.keys()] : pool.sources;
      for (const slotId of targetSlots) {
        collectSlot(slotId, emptyProtection.fallbackToAll);
      }

      if (emptyProtection.fallbackToAll) {
        items.push({
          code: 'EMPTY_POOL_FALLBACK_ALL',
          severity: 'warning',
          message: emptyProtection.message ?? `节点池「${groupName}」已退化为引用全部节点。`,
          location,
        });
        if (use.length === 0 && inlineMatchedProxies.length === 0) {
          for (const key of allProviderKeys) {
            if (!use.includes(key)) use.push(key);
          }
          for (const name of allInlineProxyNames) {
            if (!inlineMatchedProxies.includes(name)) inlineMatchedProxies.push(name);
          }
        }
      }

      let compiledFilterString: string | undefined;
      if (!emptyProtection.fallbackToAll && nodeFilter) {
        if (pool.kind === 'region' && pool.region) {
          const compiledRegex = buildRegionRegex(pool.region, 'stash', {
            extraInclude: pool.include,
            extraExclude: pool.exclude,
          });
          for (const warning of compiledRegex.warnings) {
            items.push({
              code: 'REGEX_DIALECT_WARNING',
              severity: 'warning',
              message: warning.message,
              location,
            });
          }
          compiledFilterString = sanitizeStashScalar(compiledRegex.combined);
        } else {
          compiledFilterString = compileStashNodeFilter(nodeFilter, items, location);
        }
      }

      if (inlineMatchedProxies.length > 0) {
        groupObj.proxies = inlineMatchedProxies;
      }
      if (use.length > 0) {
        groupObj.use = use;
        if (compiledFilterString) {
          groupObj.filter = compiledFilterString;
        }
      }
      if (inlineMatchedProxies.length === 0 && use.length === 0) {
        groupObj.proxies = ['DIRECT'];
        items.push({
          code: 'GROUP_FALLBACK_DIRECT',
          severity: 'warning',
          message: `${pool.kind === 'region' ? '地区组' : '节点池'}「${groupName}」没有可用节点槽位，已兜底填入 DIRECT。`,
          location,
        });
      }
    }

    if (effectiveType === 'url-test' || effectiveType === 'fallback' || effectiveType === 'load-balance') {
      groupObj['benchmark-url'] = sanitizeStashScalar(
        pool.test?.url ?? body.general?.testUrl ?? DEFAULT_HEALTH_CHECK.url,
      );
      groupObj.interval = pool.test?.intervalSec ?? body.general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec;
      if (effectiveType === 'url-test') {
        groupObj.tolerance = pool.test?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 50;
      }
      if (effectiveType === 'load-balance') {
        groupObj.strategy = DEFAULT_LOAD_BALANCE_STRATEGY;
      }
    }

    const iconUrl = resolveGroupIconUrl(
      {
        ...(pool.kind !== 'region' && pool.icon ? { explicitIcon: pool.icon } : {}),
        name: pool.name,
        ...(pool.kind === 'region' && pool.region ? { region: pool.region } : {}),
        ...(pool.kind === 'all' ? { slug: 'all-nodes' } : pool.kind === 'provider' ? { slug: 'airport' } : {}),
        groupType: effectiveType,
      },
      input.iconPack,
    );
    if (iconUrl) {
      groupObj.icon = iconUrl;
    }

    return groupObj;
  };

  for (const pool of bodyPools) {
    proxyGroups.push(compilePoolGroup(pool));
  }
  for (const synthGroup of syntheticFilterGroups) {
    proxyGroups.push(synthGroup);
  }

  // 6. Plan rule-providers & compile rules
  const plan = planRulesetReferences({
    cards: enabledCards,
    client: 'stash',
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
    const key = allocateUniqueKey(sanitizeStashProviderKey(provider.id, 'ruleset'), usedRuleProviderKeys);
    ruleProviderKeyById.set(provider.id, key);
    const { entry, effectiveBehavior } = buildStashRuleProviderEntry(provider, key, inlinePayloads, items);
    ruleProviderBehaviorById.set(provider.id, effectiveBehavior);
    ruleProviders[key] = entry;
  }

  const bindingMap = new Map<string, PlannedMatcherBinding>();
  for (const binding of plan.bindings) {
    bindingMap.set(`${binding.cardId}:${binding.matcherIndex}`, binding);
  }

  const rules: string[] = [];
  let skippedRules = 0;
  const reportedGeosites = new Set<string>();

  for (const card of enabledCards) {
    if (card.effective.hidden) continue;
    const policyName = cardGroupNameById.get(card.cardId)!;

    card.effective.matchers.forEach((matcher, matcherIndex) => {
      const binding = bindingMap.get(`${card.cardId}:${matcherIndex}`);

      if (matcher.kind === 'geosite') {
        const name = sanitizeStashRuleValue(matcher.name).toLowerCase();
        if (name) {
          if (!reportedGeosites.has(name)) {
            reportedGeosites.add(name);
            items.push({
              code: 'PARTIAL_GEOSITE_SUPPORT',
              severity: 'info',
              message: `Stash 依赖内置 v2fly domain-list-community 支持 GEOSITE(${name})，请确认该分类在当前 Stash 版本中存在。`,
              location: { cardId: card.cardId },
            });
          }
          rules.push(`GEOSITE,${name},${policyName}`);
        }
        return;
      }

      if (matcher.kind === 'geoip') {
        const name = sanitizeStashRuleValue(matcher.name).toUpperCase();
        if (name) {
          rules.push(matcher.noResolve ? `GEOIP,${name},${policyName},no-resolve` : `GEOIP,${name},${policyName}`);
        }
        return;
      }

      if (matcher.kind === 'inline') {
        for (const cond of matcher.conditions) {
          const compiled = compileStashTopLevelCondition(cond, policyName, card.cardId, items, reportedGeosites);
          if (compiled) {
            rules.push(compiled.topLevel);
          } else {
            skippedRules += 1;
          }
        }
        return;
      }

      // 'ruleset' | 'catalog' | 'remote' -> emit planned RULE-SET lines
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
    if (finalRef.kind === 'region' || finalRef.kind === 'pool') {
      const targetId = finalRef.kind === 'pool' ? finalRef.poolId : finalRef.regionGroupId;
      const target = poolGroupNameById.get(targetId);
      if (target) return target;
      items.push({
        code: finalRef.kind === 'pool' ? 'MISSING_POOL_REFERENCE' : 'MISSING_REGION_REFERENCE',
        severity: 'warning',
        message:
          finalRef.kind === 'pool'
            ? `兜底出口引用的节点池 ${targetId} 不存在，已回退为 DIRECT。`
            : `兜底出口引用的地区组 ${targetId} 不存在，已回退为 DIRECT。`,
        location: finalRef.kind === 'pool' ? { poolId: targetId } : { regionGroupId: targetId },
      });
      return 'DIRECT';
    }
    const fallbackGroup = proxyGroups[0]?.name;
    return typeof fallbackGroup === 'string' ? fallbackGroup : 'DIRECT';
  };

  rules.push(`${STASH_CAPS.finalRuleKeyword},${resolveFinalPolicy(body.final)}`);

  // 8. Assemble top-level Stash YAML document
  let document: Record<string, unknown> = {};

  if (output === 'full') {
    document['allow-lan'] = body.general?.allowLan ?? false;
    document.mode = 'rule';
    document['log-level'] = body.general?.logLevel ?? 'info';
    document.ipv6 = body.general?.ipv6 ?? false;
    document.dns = compileStashDnsSection(body.dns, body.general, items);
  }

  if (topLevelProxies.length > 0) {
    document.proxies = topLevelProxies;
  }

  if (Object.keys(proxyProviders).length > 0) {
    document['proxy-providers'] = proxyProviders;
  }

  document['proxy-groups'] = proxyGroups;

  if (Object.keys(ruleProviders).length > 0) {
    document['rule-providers'] = ruleProviders;
  }

  document.rules = rules;

  // 9. Apply optional Stash client patch safely
  const rawPatch = body.clientPatches?.stash?.trim();
  if (rawPatch) {
    try {
      const parsedPatch = parseYaml(rawPatch) as unknown;
      if (isPlainObject(parsedPatch)) {
        document = deepMergeObjects(document, parsedPatch);
      } else {
        items.push({
          code: 'INVALID_CLIENT_PATCH',
          severity: 'warning',
          message: 'Stash 客户端补丁必须是 YAML 映射对象，已忽略。',
        });
      }
    } catch (cause) {
      items.push({
        code: 'INVALID_CLIENT_PATCH',
        severity: 'warning',
        message: `Stash 客户端补丁解析失败：${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
  }

  // 10. Serialize with `yaml` library (prevents YAML injection across all scalars)
  const headerLines = [
    `# Generated by Private Rules (stash / ${output})`,
    ...(input.templateName ? [`# TEMPLATE: ${sanitizeStashScalar(input.templateName)}`] : []),
    ...(input.generatedAt ? [`# UPDATED: ${sanitizeStashScalar(input.generatedAt)}`] : []),
  ];

  const yamlBody = stringifyYaml(document, {
    lineWidth: 0,
    minContentWidth: 0,
  });

  const content = `${headerLines.join('\n')}\n${yamlBody}`;

  return {
    client: 'stash',
    output,
    contentType: 'application/yaml; charset=utf-8',
    extension: '.yaml',
    content,
    report: {
      client: 'stash',
      output,
      items,
      stats: {
        proxyProviders: Object.keys(proxyProviders).length,
        inlineProxies: topLevelProxies.length,
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
