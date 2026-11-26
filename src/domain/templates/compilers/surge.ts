import type { OutputProfile } from '../../../shared/clients';
import type { Condition, NodeFilter, PolicyRef, RemoteRuleBehavior } from '../../../shared/schemas/card';
import type { DnsProfile, NodeSlot, RegionGroup, TemplateBody } from '../../../shared/schemas/template';
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
import type {
  CompatibilityItem,
  CompiledConfigResult,
  CompiledNodeSlotBinding,
  CompileTemplateInput,
  InlineProxyNode,
} from './types';

const SURGE_CAPS = CLIENT_CAPABILITIES.surge;

const DEFAULT_PROVIDER_INTERVAL_SEC = 3600;
const DEFAULT_SURGE_SKIP_PROXY = [
  '127.0.0.1',
  '192.168.0.0/16',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '100.64.0.0/10',
  'localhost',
  '*.local',
];
const MAX_SURGE_LOGICAL_DEPTH = 10;

// eslint-disable-next-line no-control-regex
const CONTROL_AND_LINE_BREAK_RE = /[\r\n\u2028\u2029\x00-\x1f\x7f]+/g;

/**
 * Strips CR/LF/Unicode line separators and ASCII control characters from any
 * scalar emitted into a Surge INI profile (blocks `[Section]` header injection).
 */
export function sanitizeSurgeScalar(raw: string): string {
  return raw.replace(CONTROL_AND_LINE_BREAK_RE, ' ').trim();
}

/**
 * Sanitizes a Surge policy-group name against INI section injection, `=` / `,`
 * delimiter breaks, double-quote injection, and inline comment delimiters (`#`,
 * `;`, `//`).
 */
export function sanitizeSurgeGroupName(raw: string, fallback = 'ProxyGroup'): string {
  const cleaned = sanitizeSurgeScalar(raw)
    .replace(/,/g, '，')
    .replace(/=/g, '＝')
    .replace(/\[/g, '（')
    .replace(/\]/g, '）')
    .replace(/"/g, "'")
    .replace(/#/g, '＃')
    .replace(/;/g, '；')
    .replace(/\/\//g, '／')
    .trim();
  return cleaned || fallback;
}

/**
 * Sanitizes a Surge `[Proxy]` policy name against INI syntax & rule injection.
 */
export function sanitizeSurgeNodeName(raw: string, fallback = 'Node'): string {
  return sanitizeSurgeGroupName(raw, fallback);
}

/**
 * Produces a safe ASCII identifier for Surge `[Ruleset <name>]` inline sections
 * (`[A-Za-z0-9_-]`, max 64 chars).
 */
export function sanitizeSurgeRulesetName(raw: string, fallback = 'ruleset'): string {
  const normalized = sanitizeSurgeScalar(raw)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

/**
 * Sanitizes a URL emitted into Surge `policy-path=...`, `RULE-SET,<url>,...`,
 * or `icon-url=...` by removing control chars/whitespace and percent-encoding
 * INI delimiters (`,`, `"`, `;`, `#`) while preserving `https://`.
 */
export function sanitizeSurgeUrl(raw: string): string {
  return sanitizeSurgeScalar(raw)
    .replace(/\s+/g, '')
    .replace(/,/g, '%2C')
    .replace(/"/g, '%22')
    .replace(/;/g, '%3B')
    .replace(/#/g, '%23');
}

/**
 * Sanitizes a standard rule value (domain, IP, port, ASN, GEOIP, etc.) so it
 * cannot inject extra comma fields or INI comments.
 */
export function sanitizeSurgeRuleValue(raw: string): string {
  return sanitizeSurgeScalar(raw).replace(/,/g, '').replace(/[;#]/g, '').replace(/\/\//g, '').trim();
}

/**
 * Quotes a Surge INI parameter value using official Surge quoted-value syntax
 * (`\"` for literal `"`, `\\` for literal `\`, iOS 5.21+ / Mac 6.8+) whenever
 * it contains delimiters, whitespace, quotes, or comment starters.
 */
export function quoteSurgeParam(raw: string, forceQuote = false): string {
  const cleaned = sanitizeSurgeScalar(raw);
  const needsQuote = forceQuote || /[,"\s=;#]/.test(cleaned) || cleaned.includes('//');
  if (!needsQuote) return cleaned;
  const escaped = cleaned.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = sanitizeSurgeScalar(value);
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

function allocateUniqueName(
  desired: string,
  used: Set<string>,
  avoidBuiltins: boolean,
  onRenamed?: (finalName: string, reason: 'sanitized' | 'builtin-collision' | 'duplicate') => void,
  original?: string,
): string {
  let candidate = desired;
  const changedBySanitize = original !== undefined && candidate !== original;

  if (avoidBuiltins && SURGE_CAPS.builtinPolicies.has(candidate.toUpperCase())) {
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
    return sanitizeSurgeUrl(input.explicitIcon);
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
    return sanitizeSurgeUrl(recognized.packIcon.url);
  }
  return undefined;
}

function stripLeadingInlineCaseFlag(pattern: string): string {
  return pattern.startsWith('(?i)') ? pattern.slice(4) : pattern;
}

/**
 * Compiles a `NodeFilter` into a single Surge ICU regex for `policy-regex-filter`.
 */
function compileSurgeNodeFilter(
  nodeFilter: NodeFilter | undefined,
  items: CompatibilityItem[],
  location: CompatibilityItem['location'],
): string | undefined {
  if (!nodeFilter) return undefined;

  if (nodeFilter.regions && nodeFilter.regions.length > 0) {
    const compiled = buildRegionRegex(nodeFilter.regions, 'surge', {
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
    return sanitizeSurgeScalar(compiled.combined);
  }

  const rawInclude = nodeFilter.include ? sanitizeSurgeScalar(nodeFilter.include) : undefined;
  const rawExclude = nodeFilter.exclude ? sanitizeSurgeScalar(nodeFilter.exclude) : undefined;

  if (rawInclude) {
    for (const issue of detectRegexDialectIssues(rawInclude, 'surge')) {
      items.push({
        code: 'REGEX_DIALECT_WARNING',
        severity: 'warning',
        message: issue.message,
        location,
      });
    }
  }
  if (rawExclude) {
    for (const issue of detectRegexDialectIssues(rawExclude, 'surge')) {
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

function combineSurgeRegexFilters(baseRegex: string | undefined, extraRegex: string | undefined): string | undefined {
  if (!baseRegex) return extraRegex;
  if (!extraRegex) return baseRegex;
  const a = stripLeadingInlineCaseFlag(baseRegex);
  const b = stripLeadingInlineCaseFlag(extraRegex);
  const aWrap = a.startsWith('^') ? a : `.*(?:${a})`;
  const bWrap = b.startsWith('^') ? b : `.*(?:${b})`;
  return `(?i)^(?=${aWrap})(?=${bWrap})`;
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  if (typeof val !== 'string') return undefined;
  const cleaned = sanitizeSurgeScalar(val);
  return cleaned || undefined;
}

function booleanField(obj: Record<string, unknown>, key: string): boolean | undefined {
  const val = obj[key];
  return typeof val === 'boolean' ? val : undefined;
}

function serializeInlineProxyToSurge(
  proxy: InlineProxyNode,
  cleanName: string,
  defaultUdp: boolean,
  slotId: string,
  items: CompatibilityItem[],
): string | null {
  const type = sanitizeSurgeScalar(String(proxy.type ?? '')).toLowerCase();
  const server = proxy.server ? sanitizeSurgeScalar(String(proxy.server)).replace(/[,;\s#"]/g, '') : '';
  const port = typeof proxy.port === 'number' && Number.isInteger(proxy.port) && proxy.port > 0 ? proxy.port : null;

  if (!server || !port) {
    items.push({
      code: 'UNSUPPORTED_CLIENT_FEATURE',
      severity: 'warning',
      message: `内联节点「${cleanName}」缺少有效的 server 或 port，无法写入 Surge [Proxy] 段，已跳过。`,
      location: { slotId },
    });
    return null;
  }

  const udpEnabled = booleanField(proxy, 'udp') ?? defaultUdp;
  const skipCert = booleanField(proxy, 'skip-cert-verify') ?? false;
  const sni = stringField(proxy, 'sni') ?? stringField(proxy, 'servername');

  if (type === 'ss' || type === 'shadowsocks') {
    const cipher = stringField(proxy, 'cipher');
    const password = stringField(proxy, 'password');
    if (!cipher || !password) {
      items.push({
        code: 'UNSUPPORTED_CLIENT_FEATURE',
        severity: 'warning',
        message: `Shadowsocks 节点「${cleanName}」缺少 cipher 或 password，已跳过。`,
        location: { slotId },
      });
      return null;
    }
    const parts = [
      'ss',
      server,
      String(port),
      `encrypt-method=${quoteSurgeParam(cipher)}`,
      `password=${quoteSurgeParam(password)}`,
    ];
    if (udpEnabled) parts.push('udp-relay=true');
    return `${cleanName} = ${parts.join(', ')}`;
  }

  if (type === 'trojan') {
    const password = stringField(proxy, 'password');
    if (!password) {
      items.push({
        code: 'UNSUPPORTED_CLIENT_FEATURE',
        severity: 'warning',
        message: `Trojan 节点「${cleanName}」缺少 password，已跳过。`,
        location: { slotId },
      });
      return null;
    }
    const parts = ['trojan', server, String(port), `password=${quoteSurgeParam(password)}`];
    if (sni) parts.push(`sni=${quoteSurgeParam(sni)}`);
    if (skipCert) parts.push('skip-cert-verify=true');
    if (udpEnabled) parts.push('udp-relay=true');
    return `${cleanName} = ${parts.join(', ')}`;
  }

  if (type === 'vmess') {
    const uuid = stringField(proxy, 'uuid');
    if (!uuid) {
      items.push({
        code: 'UNSUPPORTED_CLIENT_FEATURE',
        severity: 'warning',
        message: `VMess 节点「${cleanName}」缺少 uuid，已跳过。`,
        location: { slotId },
      });
      return null;
    }
    const parts = ['vmess', server, String(port), `username=${quoteSurgeParam(uuid)}`];
    if (booleanField(proxy, 'tls')) parts.push('tls=true');
    if (stringField(proxy, 'network')?.toLowerCase() === 'ws') {
      parts.push('ws=true');
      const wsOpts = proxy['ws-opts'];
      if (wsOpts && typeof wsOpts === 'object' && !Array.isArray(wsOpts)) {
        const wsPath = stringField(wsOpts as Record<string, unknown>, 'path');
        if (wsPath) parts.push(`ws-path=${quoteSurgeParam(wsPath)}`);
      }
    }
    if (sni) parts.push(`sni=${quoteSurgeParam(sni)}`);
    if (skipCert) parts.push('skip-cert-verify=true');
    if (udpEnabled) parts.push('udp-relay=true');
    return `${cleanName} = ${parts.join(', ')}`;
  }

  if (type === 'http' || type === 'https') {
    const username = stringField(proxy, 'username');
    const password = stringField(proxy, 'password');
    const parts = [type === 'https' || booleanField(proxy, 'tls') ? 'https' : 'http', server, String(port)];
    if (username !== undefined || password !== undefined) {
      parts.push(quoteSurgeParam(username ?? ''), quoteSurgeParam(password ?? ''));
    }
    if (sni) parts.push(`sni=${quoteSurgeParam(sni)}`);
    if (skipCert) parts.push('skip-cert-verify=true');
    return `${cleanName} = ${parts.join(', ')}`;
  }

  if (type === 'socks5') {
    const username = stringField(proxy, 'username');
    const password = stringField(proxy, 'password');
    const parts = [booleanField(proxy, 'tls') ? 'socks5-tls' : 'socks5', server, String(port)];
    if (username !== undefined || password !== undefined) {
      parts.push(quoteSurgeParam(username ?? ''), quoteSurgeParam(password ?? ''));
    }
    if (udpEnabled) parts.push('udp-relay=true');
    return `${cleanName} = ${parts.join(', ')}`;
  }

  if (type === 'snell') {
    const psk = stringField(proxy, 'psk');
    if (!psk) {
      items.push({
        code: 'UNSUPPORTED_CLIENT_FEATURE',
        severity: 'warning',
        message: `Snell 节点「${cleanName}」缺少 psk，已跳过。`,
        location: { slotId },
      });
      return null;
    }
    const parts = ['snell', server, String(port), `psk=${quoteSurgeParam(psk)}`];
    const version = proxy.version;
    if (typeof version === 'number' && Number.isInteger(version)) {
      parts.push(`version=${version}`);
    }
    return `${cleanName} = ${parts.join(', ')}`;
  }

  if (type === 'hysteria2') {
    const password = stringField(proxy, 'password');
    if (!password) {
      items.push({
        code: 'UNSUPPORTED_CLIENT_FEATURE',
        severity: 'warning',
        message: `Hysteria2 节点「${cleanName}」缺少 password，已跳过。`,
        location: { slotId },
      });
      return null;
    }
    const parts = ['hysteria2', server, String(port), `password=${quoteSurgeParam(password)}`];
    if (sni) parts.push(`sni=${quoteSurgeParam(sni)}`);
    if (skipCert) parts.push('skip-cert-verify=true');
    return `${cleanName} = ${parts.join(', ')}`;
  }

  if (type === 'tuic') {
    const password = stringField(proxy, 'password');
    if (!password) {
      items.push({
        code: 'UNSUPPORTED_CLIENT_FEATURE',
        severity: 'warning',
        message: `TUIC 节点「${cleanName}」缺少 password，已跳过。`,
        location: { slotId },
      });
      return null;
    }
    const parts = ['tuic-v5', server, String(port), `password=${quoteSurgeParam(password)}`];
    const uuid = stringField(proxy, 'uuid');
    if (uuid) parts.push(`uuid=${quoteSurgeParam(uuid)}`);
    if (sni) parts.push(`sni=${quoteSurgeParam(sni)}`);
    if (skipCert) parts.push('skip-cert-verify=true');
    return `${cleanName} = ${parts.join(', ')}`;
  }

  items.push({
    code: 'UNSUPPORTED_CLIENT_FEATURE',
    severity: 'warning',
    message: `内联节点「${cleanName}」使用的协议类型 ${type || 'unknown'} 暂不支持转换为 Surge [Proxy] 行，已跳过。`,
    location: { slotId },
  });
  return null;
}

type CompiledSurgeSlot =
  | {
      kind: 'external';
      slotId: string;
      policyPath: string;
      isRemote: boolean;
      updateIntervalSec?: number;
      udpRelay: boolean;
      excludeInfoRegex?: string;
    }
  | {
      kind: 'inline';
      slotId: string;
      proxyNames: string[];
      proxyLines: string[];
    };

function buildSurgeSlot(
  slot: NodeSlot,
  safeKey: string,
  binding: CompiledNodeSlotBinding | undefined,
  usedInlineProxyNames: Set<string>,
  items: CompatibilityItem[],
): CompiledSurgeSlot {
  const excludeInfoRegex = slot.excludeInfo !== false ? buildExcludeInfoRegex('surge').combined : undefined;
  const udpRelay = slot.udp !== false;

  if (binding?.kind === 'inline') {
    const proxyNames: string[] = [];
    const proxyLines: string[] = [];

    binding.proxies.forEach((proxy, idx) => {
      const cleanName = allocateUniqueName(
        sanitizeSurgeNodeName(proxy.name, `Node-${idx + 1}`),
        usedInlineProxyNames,
        true,
      );
      const line = serializeInlineProxyToSurge(proxy, cleanName, udpRelay, slot.id, items);
      if (line) {
        proxyNames.push(cleanName);
        proxyLines.push(line);
      }
    });

    return {
      kind: 'inline',
      slotId: slot.id,
      proxyNames,
      proxyLines,
    };
  }

  if (!binding || binding.kind === 'snapshot') {
    items.push({
      code: 'UNBOUND_NODE_SLOT',
      severity: 'warning',
      message: `节点槽位「${slot.name}」（${slot.id}）未绑定订阅源，已使用占位 policy-path。`,
      location: { slotId: slot.id },
    });
    return {
      kind: 'external',
      slotId: slot.id,
      policyPath: `https://example.invalid/providers/${safeKey}.list`,
      isRemote: true,
      updateIntervalSec: DEFAULT_PROVIDER_INTERVAL_SEC,
      udpRelay,
      excludeInfoRegex,
    };
  }

  if (binding.kind === 'http') {
    if (binding.userAgent?.trim()) {
      items.push({
        code: 'UNSUPPORTED_PROVIDER_OPTION',
        severity: 'warning',
        message: `Surge 的 policy-path 不支持自定义 User-Agent 请求头（槽位「${slot.name}」），已忽略自定义 UA。`,
        location: { slotId: slot.id },
      });
    }
    if (binding.proxy && binding.proxy.trim().toUpperCase() !== 'DIRECT') {
      items.push({
        code: 'UNSUPPORTED_PROVIDER_OPTION',
        severity: 'warning',
        message: `Surge 的 policy-path 不支持指定拉取代理策略（${sanitizeSurgeScalar(binding.proxy)}），已忽略该参数。`,
        location: { slotId: slot.id },
      });
    }

    return {
      kind: 'external',
      slotId: slot.id,
      policyPath: sanitizeSurgeUrl(binding.url),
      isRemote: true,
      updateIntervalSec: binding.intervalSec ?? DEFAULT_PROVIDER_INTERVAL_SEC,
      udpRelay,
      excludeInfoRegex,
    };
  }

  // binding.kind === 'file'
  return {
    kind: 'external',
    slotId: slot.id,
    policyPath: sanitizeSurgeScalar(binding.path).replace(/,/g, ''),
    isRemote: false,
    udpRelay,
    excludeInfoRegex,
  };
}

function formatSurgeGroupParams(params: {
  groupType: RegionGroup['type'];
  testIntervalSec: number;
  testToleranceMs: number;
  policyPath?: string;
  isRemotePolicyPath?: boolean;
  updateIntervalSec?: number;
  udpRelay?: boolean;
  includeOtherGroups?: string[];
  regexFilter?: string;
  iconUrl?: string;
  hidden?: boolean;
  noAlert?: boolean;
}): string[] {
  const parts: string[] = [];

  if (params.policyPath) {
    parts.push(`policy-path=${params.isRemotePolicyPath ? params.policyPath : quoteSurgeParam(params.policyPath)}`);
    if (params.isRemotePolicyPath && params.updateIntervalSec !== undefined) {
      parts.push(`update-interval=${params.updateIntervalSec}`);
    }
    if (params.udpRelay) {
      parts.push('external-policy-modifier="udp-relay=true"');
    }
  }

  if (params.includeOtherGroups && params.includeOtherGroups.length > 0) {
    parts.push(`include-other-group=${quoteSurgeParam(params.includeOtherGroups.join(','), true)}`);
  }

  if (params.regexFilter) {
    parts.push(`policy-regex-filter=${quoteSurgeParam(params.regexFilter)}`);
  }

  if (params.groupType === 'url-test') {
    parts.push(`interval=${params.testIntervalSec}`);
    parts.push(`tolerance=${params.testToleranceMs}`);
  } else if (params.groupType === 'fallback') {
    parts.push(`interval=${params.testIntervalSec}`);
  } else if (params.groupType === 'load-balance') {
    parts.push('persistent=true');
    parts.push(`interval=${params.testIntervalSec}`);
  }

  if (params.iconUrl) {
    parts.push(`icon-url=${params.iconUrl}`);
  }
  if (params.hidden) {
    parts.push('hidden=true');
  }
  if (params.noAlert) {
    parts.push('no-alert=true');
  }

  return parts;
}

type CompiledSurgeRuleAtom = {
  topLevel: string;
};

type CompiledSurgeConditionExpr = {
  inner: string;
  leafParts?: {
    type: string;
    value: string;
    noResolve: boolean;
  };
};

function formatSurgeRuleValue(ruleType: string, rawValue: string): string {
  if (ruleType === 'USER-AGENT' || ruleType === 'URL-REGEX') {
    const cleaned = sanitizeSurgeScalar(rawValue);
    if (!cleaned) return '';
    return quoteSurgeParam(cleaned);
  }
  return sanitizeSurgeRuleValue(rawValue);
}

function compileSurgeConditionExpr(
  cond: Condition,
  cardId: string,
  depth: number,
  items: CompatibilityItem[],
  reportedProcessNameCards: Set<string>,
): CompiledSurgeConditionExpr | null {
  if (depth > MAX_SURGE_LOGICAL_DEPTH) {
    items.push({
      code: 'UNSUPPORTED_LOGICAL_RULE',
      severity: 'warning',
      message: `Surge 逻辑规则嵌套深度超过上限（${MAX_SURGE_LOGICAL_DEPTH} 层），已跳过该条规则。`,
      location: { cardId },
    });
    return null;
  }

  if (cond.op === 'rule') {
    const { type, value, options } = cond.rule;
    if (!isRuleTypeSupported('surge', type)) {
      items.push({
        code: 'UNSUPPORTED_RULE_TYPE',
        severity: 'warning',
        message: `Surge 不支持规则类型 ${type}（值：${sanitizeSurgeScalar(value)}），已跳过该条规则。`,
        location: { cardId },
      });
      return null;
    }

    const formattedValue = formatSurgeRuleValue(type, value);
    if (!formattedValue) return null;

    if (type === 'PROCESS-NAME' && !reportedProcessNameCards.has(cardId)) {
      reportedProcessNameCards.add(cardId);
      items.push({
        code: 'UNSUPPORTED_CLIENT_FEATURE',
        severity: 'info',
        message: 'Surge 的 PROCESS-NAME 规则仅在 Surge Mac 生效，Surge iOS 将忽略该规则。',
        location: { cardId },
      });
    }

    const aliasedType = SURGE_CAPS.ruleTypeAliases[type] ?? type;
    const emittedType = type === 'IP-CIDR' && formattedValue.includes(':') ? SURGE_CAPS.ipV6RuleType : aliasedType;
    const noResolve = Boolean(options?.noResolve && SURGE_CAPS.noResolveRuleTypes.has(type));
    const inner = noResolve ? `${emittedType},${formattedValue},no-resolve` : `${emittedType},${formattedValue}`;
    return {
      inner,
      leafParts: {
        type: emittedType,
        value: formattedValue,
        noResolve,
      },
    };
  }

  if (cond.op === 'not') {
    const sub = compileSurgeConditionExpr(cond.item, cardId, depth + 1, items, reportedProcessNameCards);
    if (!sub) {
      items.push({
        code: 'UNSUPPORTED_LOGICAL_RULE',
        severity: 'warning',
        message: 'Surge 逻辑规则 NOT 包含不受支持的子条件，已跳过整条逻辑规则。',
        location: { cardId },
      });
      return null;
    }
    return {
      inner: `NOT,((${sub.inner}))`,
    };
  }

  const compiledChildren: CompiledSurgeConditionExpr[] = [];
  for (const child of cond.items) {
    const compiled = compileSurgeConditionExpr(child, cardId, depth + 1, items, reportedProcessNameCards);
    if (!compiled) {
      items.push({
        code: 'UNSUPPORTED_LOGICAL_RULE',
        severity: 'warning',
        message: `Surge 逻辑规则 ${cond.op.toUpperCase()} 包含不受支持的子条件，已跳过整条逻辑规则。`,
        location: { cardId },
      });
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

function compileSurgeTopLevelCondition(
  cond: Condition,
  policyName: string,
  cardId: string,
  items: CompatibilityItem[],
  reportedProcessNameCards: Set<string>,
): CompiledSurgeRuleAtom | null {
  const expr = compileSurgeConditionExpr(cond, cardId, 0, items, reportedProcessNameCards);
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

function mapSurgeLogLevel(level: string | undefined): string {
  switch (level) {
    case 'debug':
      return 'verbose';
    case 'warning':
    case 'error':
    case 'silent':
      return 'warning';
    default:
      return 'notify';
  }
}

function isEncryptedDnsUrl(entry: string): boolean {
  return /^(https|tls|quic|h3):\/\//i.test(entry);
}

function normalizeSurgeAlwaysRealIp(entry: string): string {
  const cleaned = sanitizeSurgeScalar(entry).replace(/,/g, '').replace(/[;#]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+.')) return `*.${cleaned.slice(2)}`;
  if (cleaned.startsWith('.')) return `*.${cleaned.slice(1)}`;
  return cleaned;
}

function compileSurgeGeneralSection(
  dns: DnsProfile,
  general: TemplateBody['general'],
  items: CompatibilityItem[],
): string[] {
  if (dns.mode === 'redir-host') {
    items.push({
      code: 'UNSUPPORTED_DNS_OPTION',
      severity: 'warning',
      message: 'Surge VIF 始终使用 Fake-IP 模式，不支持 redir-host，已忽略该 DNS 模式设置。',
    });
  }
  if (dns.respectRules) {
    items.push({
      code: 'UNSUPPORTED_DNS_OPTION',
      severity: 'warning',
      message: 'Surge 不支持 Clash 风格的 dns.respect-rules 开关，已忽略该项。',
    });
  }

  const lines: string[] = [
    `loglevel = ${mapSurgeLogLevel(general?.logLevel)}`,
    `ipv6 = ${general?.ipv6 ? 'true' : 'false'}`,
    'internet-test-url = http://www.gstatic.com/generate_204',
    `proxy-test-url = ${sanitizeSurgeUrl(general?.testUrl ?? DEFAULT_HEALTH_CHECK.url)}`,
    'test-timeout = 5',
  ];

  if (general?.allowLan) {
    lines.push('allow-wifi-access = true');
  }

  const plainDns: string[] = [];
  const encryptedDns: string[] = [];
  const allDnsSources = [...(dns.defaultNameserver ?? []), ...(dns.nameserver ?? [])];
  for (const rawEntry of allDnsSources) {
    const cleaned = sanitizeSurgeScalar(rawEntry).replace(/,/g, '').replace(/[;#]/g, '');
    if (!cleaned) continue;
    if (isEncryptedDnsUrl(cleaned)) {
      if (!encryptedDns.includes(cleaned)) encryptedDns.push(cleaned);
    } else if (!plainDns.includes(cleaned)) {
      plainDns.push(cleaned);
    }
  }
  if (!plainDns.includes('system')) {
    plainDns.push('system');
  }

  lines.push(`dns-server = ${plainDns.join(', ')}`);
  if (encryptedDns.length > 0) {
    lines.push(`encrypted-dns-server = ${encryptedDns.join(', ')}`);
  }

  if (dns.fakeIpFilter && dns.fakeIpFilter.length > 0) {
    const realIpList = [...new Set(dns.fakeIpFilter.map(normalizeSurgeAlwaysRealIp).filter(Boolean))];
    if (realIpList.length > 0) {
      lines.push(`always-real-ip = ${realIpList.join(', ')}`);
    }
  }

  lines.push(`skip-proxy = ${DEFAULT_SURGE_SKIP_PROXY.join(', ')}`);
  return lines;
}

type SurgeSection = {
  header: string;
  lines: string[];
};

function applySurgeIniPatch(sections: SurgeSection[], rawPatch: string, items: CompatibilityItem[]): void {
  const lines = rawPatch.split(/\r?\n/);
  let currentHeader: string | null = null;
  let orphanWarned = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';') || trimmed.startsWith('//')) {
      continue;
    }

    const headerMatch = /^\[([^\]\r\n]+)\]$/.exec(trimmed);
    if (headerMatch) {
      currentHeader = `[${sanitizeSurgeScalar(headerMatch[1]!)}]`;
      continue;
    }

    if (!currentHeader) {
      if (!orphanWarned) {
        orphanWarned = true;
        items.push({
          code: 'INVALID_CLIENT_PATCH',
          severity: 'warning',
          message: 'Surge 客户端补丁中存在未归属任何 [Section] 的配置行，已忽略。',
        });
      }
      continue;
    }

    let section = sections.find((item) => item.header.toLowerCase() === currentHeader!.toLowerCase());
    if (!section) {
      section = { header: currentHeader, lines: [] };
      sections.push(section);
    }
    section.lines.push(sanitizeSurgeScalar(trimmed));
  }
}

/**
 * Compiles a template intermediate representation into a valid Surge INI
 * profile (https://manual.nssurge.com — iOS 5.22–6.0+, Mac 5.4–6.13+) along
 * with a structured compatibility report (design §10.6, §10.13, §11).
 *
 * Pure function — no I/O, no wall-clock dependency.
 */
export function compileSurge(input: CompileTemplateInput): CompiledConfigResult {
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
      client: 'surge',
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
      message: '输出档位为 minimal，已省略 [General] 基础运行与 DNS 段，仅输出节点、策略组与分流规则。',
    });
  }

  // 2. Compile NodeSlots -> Surge external policy-path metadata or [Proxy] inline lines
  const slotBindingMap = toSlotBindingMap(input.slotBindings);
  const usedSlotKeys = new Set<string>();
  const usedInlineProxyNames = new Set<string>();
  const slotById = new Map<string, NodeSlot>();
  const compiledSlotById = new Map<string, CompiledSurgeSlot>();
  const proxySectionLines: string[] = [];
  let externalSlotCount = 0;

  for (const slot of body.slots) {
    slotById.set(slot.id, slot);
    const safeKey = allocateUniqueKey(sanitizeSurgeRulesetName(slot.id, 'slot'), usedSlotKeys);
    const compiledSlot = buildSurgeSlot(slot, safeKey, slotBindingMap.get(slot.id), usedInlineProxyNames, items);
    compiledSlotById.set(slot.id, compiledSlot);
    if (compiledSlot.kind === 'external') {
      externalSlotCount += 1;
    } else {
      proxySectionLines.push(...compiledSlot.proxyLines);
    }
  }

  // 3. Allocate unique sanitized group names for enabled cards and region groups
  const usedGroupNames = new Set<string>(usedInlineProxyNames);
  const cardGroupNameById = new Map<string, string>();
  const regionGroupNameById = new Map<string, string>();

  for (const card of enabledCards) {
    const sanitized = sanitizeSurgeGroupName(card.effective.name, card.cardId);
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
    const sanitized = sanitizeSurgeGroupName(regionGroup.name, regionGroup.id);
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

  // Hidden helper groups for multi-slot composition & multi-filtered slot candidates
  const helperGroupLines: string[] = [];
  const hiddenSlotPoolGroupNameById = new Map<string, string>();
  const syntheticFilterGroupNames = new Map<string, string>();

  const ensureHiddenSlotPoolGroup = (slotId: string): string | null => {
    const existing = hiddenSlotPoolGroupNameById.get(slotId);
    if (existing) return existing;
    const compiledSlot = compiledSlotById.get(slotId);
    if (!compiledSlot || compiledSlot.kind !== 'external') return null;

    const slot = slotById.get(slotId);
    const baseName = sanitizeSurgeGroupName(`${slot?.name ?? slotId} 节点源`, `${slotId}-pool`);
    const groupName = allocateUniqueName(baseName, usedGroupNames, true);
    hiddenSlotPoolGroupNameById.set(slotId, groupName);

    const params = formatSurgeGroupParams({
      groupType: 'select',
      testIntervalSec: body.general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec,
      testToleranceMs: DEFAULT_HEALTH_CHECK.toleranceMs ?? 50,
      policyPath: compiledSlot.policyPath,
      isRemotePolicyPath: compiledSlot.isRemote,
      updateIntervalSec: compiledSlot.updateIntervalSec,
      udpRelay: compiledSlot.udpRelay,
      regexFilter: compiledSlot.excludeInfoRegex,
      hidden: true,
      noAlert: true,
    });
    helperGroupLines.push(`${groupName} = select, ${params.join(', ')}`);
    return groupName;
  };

  const resolveFilteredSlotGroup = (slotId: string, filter: NodeFilter, card: ResolvedTemplateCard): string | null => {
    const compiledSlot = compiledSlotById.get(slotId);
    if (!compiledSlot || compiledSlot.kind !== 'external') return null;

    const filterKey = JSON.stringify({ slotId, filter });
    const existingName = syntheticFilterGroupNames.get(filterKey);
    if (existingName) return existingName;

    const compiledFilter = compileSurgeNodeFilter(filter, items, { cardId: card.cardId, slotId });
    const combinedFilter = combineSurgeRegexFilters(compiledSlot.excludeInfoRegex, compiledFilter);
    const baseName = sanitizeSurgeGroupName(`${card.effective.name} 节点`, `${card.cardId}-nodes`);
    const groupName = allocateUniqueName(baseName, usedGroupNames, true);
    syntheticFilterGroupNames.set(filterKey, groupName);

    const params = formatSurgeGroupParams({
      groupType: 'url-test',
      testIntervalSec:
        card.effective.group.test?.intervalSec ?? body.general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec,
      testToleranceMs: card.effective.group.test?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 50,
      policyPath: compiledSlot.policyPath,
      isRemotePolicyPath: compiledSlot.isRemote,
      updateIntervalSec: compiledSlot.updateIntervalSec,
      udpRelay: compiledSlot.udpRelay,
      regexFilter: combinedFilter,
    });
    helperGroupLines.push(`${groupName} = url-test, ${params.join(', ')}`);
    return groupName;
  };

  // 4. Build [Proxy Group] lines for enabled cards
  const proxyGroupLines: string[] = [];
  const declaredGroupNames: string[] = [];

  for (const card of enabledCards) {
    const groupName = cardGroupNameById.get(card.cardId)!;
    const groupSpec = card.effective.group;
    let effectiveGroupType = groupSpec.type;
    if (!isGroupTypeSupported('surge', effectiveGroupType)) {
      items.push({
        code: 'UNSUPPORTED_GROUP_TYPE',
        severity: 'warning',
        message: `Surge 不支持策略组类型 ${effectiveGroupType}（策略组「${groupName}」），已降级为 select。`,
        location: { cardId: card.cardId },
      });
      effectiveGroupType = 'select';
    }

    const explicitMembers: string[] = [];
    let directExternalSlot: Extract<CompiledSurgeSlot, { kind: 'external' }> | undefined;
    let directRegexFilter: string | undefined;
    const includeOtherGroups: string[] = [];

    const externalSlotCandidates = groupSpec.candidates.filter(
      (candidate): candidate is Extract<PolicyRef, { kind: 'slot' }> =>
        candidate.kind === 'slot' && compiledSlotById.get(candidate.slotId)?.kind === 'external',
    );
    const canAttachSingleExternalSlotDirectly = externalSlotCandidates.length === 1;

    for (const candidate of groupSpec.candidates) {
      if (candidate.kind === 'builtin') {
        if (!explicitMembers.includes(candidate.id)) explicitMembers.push(candidate.id);
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
        if (!explicitMembers.includes(targetName)) explicitMembers.push(targetName);
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
        if (!explicitMembers.includes(regionName)) explicitMembers.push(regionName);
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
          compileSurgeNodeFilter(candidate.filter, items, { cardId: card.cardId, slotId: candidate.slotId });
        }
        for (const nodeName of matchedNames) {
          if (!explicitMembers.includes(nodeName)) explicitMembers.push(nodeName);
        }
        continue;
      }

      // compiledSlot.kind === 'external'
      if (canAttachSingleExternalSlotDirectly) {
        directExternalSlot = compiledSlot;
        const filterRegex = candidate.filter
          ? compileSurgeNodeFilter(candidate.filter, items, { cardId: card.cardId, slotId: candidate.slotId })
          : undefined;
        directRegexFilter = filterRegex
          ? combineSurgeRegexFilters(compiledSlot.excludeInfoRegex, filterRegex)
          : compiledSlot.excludeInfoRegex;
      } else if (candidate.filter) {
        const synthName = resolveFilteredSlotGroup(candidate.slotId, candidate.filter, card);
        if (synthName && !explicitMembers.includes(synthName)) {
          explicitMembers.push(synthName);
        }
      } else {
        const poolName = ensureHiddenSlotPoolGroup(candidate.slotId);
        if (poolName && !includeOtherGroups.includes(poolName)) {
          includeOtherGroups.push(poolName);
        }
      }
    }

    if (explicitMembers.length === 0 && !directExternalSlot && includeOtherGroups.length === 0) {
      explicitMembers.push('DIRECT');
      items.push({
        code: 'GROUP_FALLBACK_DIRECT',
        severity: 'warning',
        message: `策略组「${groupName}」没有可用候选节点或分组，已兜底填入 DIRECT。`,
        location: { cardId: card.cardId },
      });
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

    const paramTokens = formatSurgeGroupParams({
      groupType: effectiveGroupType,
      testIntervalSec: groupSpec.test?.intervalSec ?? body.general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec,
      testToleranceMs: groupSpec.test?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 50,
      policyPath: directExternalSlot?.policyPath,
      isRemotePolicyPath: directExternalSlot?.isRemote,
      updateIntervalSec: directExternalSlot?.updateIntervalSec,
      udpRelay: directExternalSlot?.udpRelay,
      includeOtherGroups,
      regexFilter: directRegexFilter,
      iconUrl,
    });

    const rhs = [effectiveGroupType, ...explicitMembers, ...paramTokens];
    proxyGroupLines.push(`${groupName} = ${rhs.join(', ')}`);
    declaredGroupNames.push(groupName);
  }

  // 5. Build [Proxy Group] lines for regionGroups
  for (const regionGroup of body.regionGroups) {
    const groupName = regionGroupNameById.get(regionGroup.id)!;
    let effectiveType = regionGroup.type;
    if (!isGroupTypeSupported('surge', effectiveType)) {
      items.push({
        code: 'UNSUPPORTED_GROUP_TYPE',
        severity: 'warning',
        message: `Surge 不支持地区组类型 ${effectiveType}（地区组「${groupName}」），已降级为 select。`,
        location: { regionGroupId: regionGroup.id },
      });
      effectiveType = 'select';
    }

    const compiledRegex = buildRegionRegex(regionGroup.region, 'surge', {
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

    const targetSlotIds = regionGroup.slotId ? [regionGroup.slotId] : [...compiledSlotById.keys()];
    const externalSlots: Array<Extract<CompiledSurgeSlot, { kind: 'external' }>> = [];
    const inlineMatchedMembers: string[] = [];

    for (const slotId of targetSlotIds) {
      const compiledSlot = compiledSlotById.get(slotId);
      if (!compiledSlot) {
        items.push({
          code: 'MISSING_SLOT_REFERENCE',
          severity: 'warning',
          message: `地区组「${groupName}」引用的节点槽位 ${slotId} 不存在。`,
          location: { regionGroupId: regionGroup.id, slotId },
        });
        continue;
      }
      if (compiledSlot.kind === 'external') {
        externalSlots.push(compiledSlot);
      } else {
        const slot = slotById.get(slotId);
        const excludeInfo = slot?.excludeInfo !== false;
        const matched = compiledSlot.proxyNames.filter((name) =>
          matchNodeFilter(
            name,
            {
              regions: [regionGroup.region],
              include: regionGroup.extraInclude,
              exclude: regionGroup.extraExclude,
            },
            { excludeInfo },
          ),
        );
        for (const nodeName of matched) {
          if (!inlineMatchedMembers.includes(nodeName)) inlineMatchedMembers.push(nodeName);
        }
      }
    }

    let directExternalSlot: Extract<CompiledSurgeSlot, { kind: 'external' }> | undefined;
    const includeOtherGroups: string[] = [];
    let regexFilter: string | undefined;

    if (externalSlots.length === 1) {
      directExternalSlot = externalSlots[0];
      regexFilter = sanitizeSurgeScalar(compiledRegex.combined);
    } else if (externalSlots.length > 1) {
      for (const extSlot of externalSlots) {
        const poolName = ensureHiddenSlotPoolGroup(extSlot.slotId);
        if (poolName && !includeOtherGroups.includes(poolName)) {
          includeOtherGroups.push(poolName);
        }
      }
      regexFilter = sanitizeSurgeScalar(compiledRegex.combined);
    }

    if (inlineMatchedMembers.length === 0 && !directExternalSlot && includeOtherGroups.length === 0) {
      inlineMatchedMembers.push('DIRECT');
      items.push({
        code: 'GROUP_FALLBACK_DIRECT',
        severity: 'warning',
        message: `地区组「${groupName}」没有可用节点槽位，已兜底填入 DIRECT。`,
        location: { regionGroupId: regionGroup.id },
      });
    }

    const iconUrl = resolveGroupIconUrl(
      {
        name: regionGroup.name,
        region: regionGroup.region,
        groupType: effectiveType,
      },
      input.iconPack,
    );

    const paramTokens = formatSurgeGroupParams({
      groupType: effectiveType,
      testIntervalSec:
        regionGroup.test?.intervalSec ?? body.general?.testIntervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec,
      testToleranceMs: regionGroup.test?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 50,
      policyPath: directExternalSlot?.policyPath,
      isRemotePolicyPath: directExternalSlot?.isRemote,
      updateIntervalSec: directExternalSlot?.updateIntervalSec,
      udpRelay: directExternalSlot?.udpRelay,
      includeOtherGroups,
      regexFilter,
      iconUrl,
    });

    const rhs = [effectiveType, ...inlineMatchedMembers, ...paramTokens];
    proxyGroupLines.push(`${groupName} = ${rhs.join(', ')}`);
    declaredGroupNames.push(groupName);
  }

  for (const helperLine of helperGroupLines) {
    proxyGroupLines.push(helperLine);
  }

  // 6. Plan RULE-SET / inline [Ruleset <name>] & compile [Rule]
  const plan = planRulesetReferences({
    cards: enabledCards,
    client: 'surge',
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
    } else if (warning.code === 'GEOSITE_CONVERTED_TO_SELF_HOSTED') {
      items.push({
        code: 'GEOSITE_CONVERTED_TO_SELF_HOSTED',
        severity: 'info',
        message: warning.message,
        location: { cardId: warning.cardId },
      });
    }
  }

  const inlinePayloads = toInlinePayloadsMap(input.inlineRulePayloads);
  const providerById = new Map<string, PlannedProvider>();
  for (const provider of plan.providers) {
    providerById.set(provider.id, provider);
  }

  const usedRulesetNames = new Set<string>();
  const inlineRulesetSections = new Map<string, { sectionName: string; lines: string[] }>();
  const resolvedProviderRef = new Map<
    string,
    {
      kind: 'inline' | 'remote' | 'skipped';
      target: string;
      behavior: RemoteRuleBehavior;
      updateIntervalSec?: number;
    }
  >();

  for (const provider of plan.providers) {
    const inlineLines = inlinePayloads.get(provider.id);
    if (inlineLines) {
      const sectionName = allocateUniqueKey(sanitizeSurgeRulesetName(provider.id, 'ruleset'), usedRulesetNames);
      const cleanedLines = inlineLines
        .map((line) => sanitizeSurgeScalar(line))
        .filter((line) => Boolean(line) && !line.startsWith('['));
      inlineRulesetSections.set(provider.id, { sectionName, lines: cleanedLines });
      resolvedProviderRef.set(provider.id, {
        kind: 'inline',
        target: sectionName,
        behavior: provider.behavior,
      });
      continue;
    }

    if (!isRemoteFormatSupported('surge', provider.format, provider.behavior)) {
      items.push({
        code: 'UNSUPPORTED_REMOTE_FORMAT',
        severity: 'warning',
        message: `Surge 的 RULE-SET 仅支持纯文本 (text) 格式，不支持 ${provider.format} 格式（规则集 ${provider.id}），已跳过。`,
        location: { providerId: provider.id },
      });
      resolvedProviderRef.set(provider.id, {
        kind: 'skipped',
        target: '',
        behavior: provider.behavior,
      });
      continue;
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
        message: `规则集 ${provider.id} 未提供 baseUrl 或内联规则内容，已跳过该 RULE-SET 引用。`,
        location: { providerId: provider.id },
      });
      resolvedProviderRef.set(provider.id, {
        kind: 'skipped',
        target: '',
        behavior: provider.behavior,
      });
      continue;
    }

    resolvedProviderRef.set(provider.id, {
      kind: 'remote',
      target: sanitizeSurgeUrl(remoteUrl),
      behavior: provider.behavior,
      updateIntervalSec: provider.updateIntervalSec,
    });
  }

  const bindingMap = new Map<string, PlannedMatcherBinding>();
  for (const binding of plan.bindings) {
    bindingMap.set(`${binding.cardId}:${binding.matcherIndex}`, binding);
  }

  const rules: string[] = [];
  let skippedRules = 0;
  let activeRuleProviders = 0;
  const countedProviderIds = new Set<string>();
  const reportedProcessNameCards = new Set<string>();

  for (const card of enabledCards) {
    if (card.effective.hidden) continue;
    const policyName = cardGroupNameById.get(card.cardId)!;

    card.effective.matchers.forEach((matcher, matcherIndex) => {
      const binding = bindingMap.get(`${card.cardId}:${matcherIndex}`);

      if (matcher.kind === 'geoip') {
        const name = sanitizeSurgeRuleValue(matcher.name).toUpperCase();
        if (name) {
          rules.push(matcher.noResolve ? `GEOIP,${name},${policyName},no-resolve` : `GEOIP,${name},${policyName}`);
        }
        return;
      }

      if (matcher.kind === 'inline') {
        for (const cond of matcher.conditions) {
          const compiled = compileSurgeTopLevelCondition(
            cond,
            policyName,
            card.cardId,
            items,
            reportedProcessNameCards,
          );
          if (compiled) {
            rules.push(compiled.topLevel);
          } else {
            skippedRules += 1;
          }
        }
        return;
      }

      // 'ruleset' | 'catalog' | 'remote' | 'geosite' (converted by planner to self-hosted text ruleset)
      if (!binding || binding.providerIds.length === 0) return;
      for (const providerId of binding.providerIds) {
        const resolvedRef = resolvedProviderRef.get(providerId);
        if (!resolvedRef || resolvedRef.kind === 'skipped') {
          skippedRules += 1;
          continue;
        }
        if (!countedProviderIds.has(providerId)) {
          countedProviderIds.add(providerId);
          activeRuleProviders += 1;
        }
        const appendNoResolve =
          resolvedRef.behavior === 'ipcidr' && (ipNoResolveEnabled || input.applyModules === false);
        const parts = ['RULE-SET', resolvedRef.target, policyName];
        if (appendNoResolve) parts.push('no-resolve');
        if (resolvedRef.kind === 'remote' && resolvedRef.updateIntervalSec !== undefined) {
          parts.push(`update-interval=${resolvedRef.updateIntervalSec}`);
        }
        rules.push(parts.join(','));
      }
    });
  }

  // 7. Resolve final catch-all FINAL rule
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
    return declaredGroupNames[0] ?? 'DIRECT';
  };

  const finalPolicy = resolveFinalPolicy(body.final);
  rules.push(
    finalPolicy === 'DIRECT'
      ? `${SURGE_CAPS.finalRuleKeyword},DIRECT`
      : `${SURGE_CAPS.finalRuleKeyword},${finalPolicy},dns-failed`,
  );

  // 8. Assemble Surge INI sections
  const sections: SurgeSection[] = [];

  if (output === 'full') {
    sections.push({
      header: '[General]',
      lines: compileSurgeGeneralSection(body.dns, body.general, items),
    });
  }

  if (proxySectionLines.length > 0) {
    sections.push({
      header: '[Proxy]',
      lines: proxySectionLines,
    });
  }

  sections.push({
    header: '[Proxy Group]',
    lines: proxyGroupLines,
  });

  sections.push({
    header: '[Rule]',
    lines: rules,
  });

  for (const { sectionName, lines } of inlineRulesetSections.values()) {
    sections.push({
      header: `[Ruleset ${sectionName}]`,
      lines,
    });
  }

  // 9. Apply optional Surge client patch safely
  const rawPatch = body.clientPatches?.surge?.trim();
  if (rawPatch) {
    applySurgeIniPatch(sections, rawPatch, items);
  }

  // 10. Serialize final INI text
  const headerLines = [
    `# Generated by Private Rules (surge / ${output})`,
    ...(input.templateName ? [`# TEMPLATE: ${sanitizeSurgeScalar(input.templateName)}`] : []),
    ...(input.generatedAt ? [`# UPDATED: ${sanitizeSurgeScalar(input.generatedAt)}`] : []),
  ];

  const sectionBlocks = sections.map((section) =>
    section.lines.length > 0 ? `${section.header}\n${section.lines.join('\n')}` : section.header,
  );

  const content = `${headerLines.join('\n')}\n\n${sectionBlocks.join('\n\n')}\n`;

  return {
    client: 'surge',
    output,
    contentType: 'text/plain; charset=utf-8',
    extension: '.conf',
    content,
    report: {
      client: 'surge',
      output,
      items,
      stats: {
        proxyProviders: externalSlotCount,
        inlineProxies: proxySectionLines.length,
        proxyGroups: proxyGroupLines.length,
        ruleProviders: activeRuleProviders,
        rules: rules.length,
        skippedRules,
        appliedModules,
        skippedModules,
      },
    },
  };
}
