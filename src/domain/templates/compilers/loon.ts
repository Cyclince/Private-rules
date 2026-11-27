import type { OutputProfile } from '../../../shared/clients';
import type { Condition, NodeFilter, PolicyRef, RemoteRuleBehavior } from '../../../shared/schemas/card';
import type { DnsProfile, TemplateBody } from '../../../shared/schemas/template';
import { compileClientNodeFilter } from '../../nodes';
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
  toSlotBindingMap,
} from './pool-helpers';
import type { CompatibilityItem, CompiledConfigResult, CompileTemplateInput } from './types';

/**
 * Loon compiler (design §10.6, §10.11–10.13, §11, §20).
 *
 * Official docs audited:
 * - https://nsloon.app/docs/ (mirror: https://loon0x00.github.io/docs/)
 * - https://github.com/Loon0x00/LoonManual
 * - https://github.com/Loon0x00/LoonExampleConfig (`example2.lcf`, `Rule/ExampleRule.list`)
 */

const LOON_CAPS = CLIENT_CAPABILITIES.loon;

const DEFAULT_LOON_SKIP_PROXY = [
  '192.168.0.0/16',
  '10.0.0.0/8',
  '172.16.0.0/12',
  'localhost',
  '*.local',
  'e.crashlytics.com',
];
const DEFAULT_LOON_BYPASS_TUN = [
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '224.0.0.0/4',
  '255.255.255.255/32',
];
const MAX_LOON_LOGICAL_DEPTH = 10;

// eslint-disable-next-line no-control-regex
const CONTROL_AND_LINE_BREAK_RE = /[\r\n\u2028\u2029\x00-\x1f\x7f]+/g;

/**
 * Strips CR/LF/Unicode line separators and ASCII control characters from any
 * scalar emitted into a Loon config or rule resource (blocks `[Section]` injection).
 */
export function sanitizeLoonScalar(raw: string): string {
  return raw.replace(CONTROL_AND_LINE_BREAK_RE, ' ').trim();
}

/**
 * Sanitizes a Loon `[Proxy Group]` name against INI section injection, `=` / `,`
 * delimiter breaks, double-quote injection, and inline comments (`#`, `;`, `//`).
 */
export function sanitizeLoonGroupName(raw: string, fallback = 'ProxyGroup'): string {
  const cleaned = sanitizeLoonScalar(raw)
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
 * Sanitizes a Loon node name against INI syntax & rule injection.
 */
export function sanitizeLoonNodeName(raw: string, fallback = 'Node'): string {
  return sanitizeLoonGroupName(raw, fallback);
}

/**
 * Sanitizes a Loon `[Remote Filter]` identifier.
 */
export function sanitizeLoonFilterName(raw: string, fallback = 'Filter'): string {
  return sanitizeLoonGroupName(raw, fallback);
}

/**
 * Sanitizes a URL emitted into Loon `[Remote Rule]` or `img-url=...` by removing
 * control chars/whitespace and percent-encoding INI delimiters (`,`, `"`, `;`, `#`).
 */
export function sanitizeLoonUrl(raw: string): string {
  return sanitizeLoonScalar(raw)
    .replace(/\s+/g, '')
    .replace(/,/g, '%2C')
    .replace(/"/g, '%22')
    .replace(/;/g, '%3B')
    .replace(/#/g, '%23');
}

/**
 * Sanitizes a Loon rule value (domain, CIDR, ASN, port, GEOIP, etc.) so it
 * cannot inject extra comma fields or inline comments.
 */
export function sanitizeLoonRuleValue(raw: string): string {
  return sanitizeLoonScalar(raw).replace(/,/g, '').replace(/[;#]/g, '').replace(/\/\//g, '').trim();
}

/**
 * Quotes a Loon INI parameter value (such as `FilterKey="..."`) safely by
 * stripping control characters and escaping backslashes and double quotes.
 */
export function quoteLoonParam(raw: string, forceQuote = false): string {
  const cleaned = sanitizeLoonScalar(raw);
  const needsQuote = forceQuote || /[,"\s=;#]/.test(cleaned) || cleaned.includes('//');
  if (!needsQuote) return cleaned;
  const escaped = cleaned.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = sanitizeLoonScalar(value);
  return /^https?:\/\/\S+$/i.test(trimmed);
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

  if (avoidBuiltins && LOON_CAPS.builtinPolicies.has(candidate.toUpperCase())) {
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
    return sanitizeLoonUrl(input.explicitIcon);
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
    return sanitizeLoonUrl(recognized.packIcon.url);
  }
  return undefined;
}

function formatLoonRuleValue(type: string, rawValue: string): string {
  if (type === 'URL-REGEX' || type === 'USER-AGENT') {
    return sanitizeLoonScalar(rawValue).replace(/,/g, '');
  }
  const value = sanitizeLoonRuleValue(rawValue);
  if (type === 'GEOIP') return value.toUpperCase();
  return value;
}

type CompiledLoonConditionExpr = {
  inner: string;
  leafParts?: {
    type: string;
    value: string;
    noResolve: boolean;
  };
};

function compileLoonConditionExpr(
  cond: Condition,
  cardId: string,
  depth: number,
  items: CompatibilityItem[],
  reportedProcessNameCards: Set<string>,
): CompiledLoonConditionExpr | null {
  if (depth > MAX_LOON_LOGICAL_DEPTH) {
    items.push({
      code: 'UNSUPPORTED_LOGICAL_RULE',
      severity: 'warning',
      message: `Loon 逻辑规则嵌套深度超过上限（${MAX_LOON_LOGICAL_DEPTH} 层），已跳过该条规则。`,
      location: { cardId },
    });
    return null;
  }

  if (cond.op === 'rule') {
    const { type, value, options } = cond.rule;
    if (!isRuleTypeSupported('loon', type)) {
      items.push({
        code: 'UNSUPPORTED_RULE_TYPE',
        severity: 'warning',
        message: `Loon 不支持规则类型 ${type}（值：${sanitizeLoonScalar(value)}），已跳过该条规则。`,
        location: { cardId },
      });
      return null;
    }

    const formattedValue = formatLoonRuleValue(type, value);
    if (!formattedValue) return null;

    if (type === 'PROCESS-NAME' && !reportedProcessNameCards.has(cardId)) {
      reportedProcessNameCards.add(cardId);
      items.push({
        code: 'UNSUPPORTED_CLIENT_FEATURE',
        severity: 'info',
        message: 'Loon 的 PROCESS-NAME 规则仅在 macOS 版本生效，iOS 版本将忽略该规则。',
        location: { cardId },
      });
    }

    const aliasedType = LOON_CAPS.ruleTypeAliases[type] ?? type;
    const emittedType = type === 'IP-CIDR' && formattedValue.includes(':') ? LOON_CAPS.ipV6RuleType : aliasedType;
    const noResolve = Boolean(options?.noResolve && LOON_CAPS.noResolveRuleTypes.has(type));
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
    const sub = compileLoonConditionExpr(cond.item, cardId, depth + 1, items, reportedProcessNameCards);
    if (!sub) {
      items.push({
        code: 'UNSUPPORTED_LOGICAL_RULE',
        severity: 'warning',
        message: 'Loon 逻辑规则 NOT 包含不受支持的子条件，已跳过整条逻辑规则。',
        location: { cardId },
      });
      return null;
    }
    return { inner: `NOT,((${sub.inner}))` };
  }

  const compiledChildren: CompiledLoonConditionExpr[] = [];
  for (const child of cond.items) {
    const compiled = compileLoonConditionExpr(child, cardId, depth + 1, items, reportedProcessNameCards);
    if (!compiled) {
      items.push({
        code: 'UNSUPPORTED_LOGICAL_RULE',
        severity: 'warning',
        message: `Loon 逻辑规则 ${cond.op.toUpperCase()} 包含不受支持的子条件，已跳过整条逻辑规则。`,
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
  return { inner: `${keyword},(${joined})` };
}

function compileLoonTopLevelCondition(
  cond: Condition,
  policyName: string,
  cardId: string,
  items: CompatibilityItem[],
  reportedProcessNameCards: Set<string>,
): string | null {
  const expr = compileLoonConditionExpr(cond, cardId, 0, items, reportedProcessNameCards);
  if (!expr) return null;
  if (expr.leafParts) {
    const { type, value, noResolve } = expr.leafParts;
    return noResolve ? `${type},${value},${policyName},no-resolve` : `${type},${value},${policyName}`;
  }
  return `${expr.inner},${policyName}`;
}

/**
 * Converts a raw rule line from an inline remote-rule payload into a Loon rule
 * bound to `policyName`. Returns `null` for comments, empty lines, or unsupported types.
 */
function convertPayloadLineToLoonRule(
  rawLine: string,
  behavior: RemoteRuleBehavior,
  policyName: string,
  appendNoResolve: boolean,
): string | null {
  const line = sanitizeLoonScalar(rawLine);
  if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) return null;

  if (!line.includes(',')) {
    if (behavior === 'domain') {
      const cleaned = sanitizeLoonRuleValue(line);
      if (!cleaned) return null;
      if (cleaned.startsWith('+.')) return `DOMAIN-SUFFIX,${cleaned.slice(2)},${policyName}`;
      if (cleaned.startsWith('.')) return `DOMAIN-SUFFIX,${cleaned.slice(1)},${policyName}`;
      return `DOMAIN,${cleaned},${policyName}`;
    }
    if (behavior === 'ipcidr') {
      const cleaned = sanitizeLoonRuleValue(line);
      if (!cleaned) return null;
      const type = cleaned.includes(':') ? 'IP-CIDR6' : 'IP-CIDR';
      return appendNoResolve ? `${type},${cleaned},${policyName},no-resolve` : `${type},${cleaned},${policyName}`;
    }
    return null;
  }

  const parts = line.split(',').map((part) => part.trim());
  if (parts.length < 2) return null;
  const rawType = parts[0]!.toUpperCase();
  const mappedType = rawType === 'DST-PORT' ? 'DEST-PORT' : rawType;
  const allowed = new Set([
    'DOMAIN',
    'DOMAIN-SUFFIX',
    'DOMAIN-KEYWORD',
    'IP-CIDR',
    'IP-CIDR6',
    'IP-ASN',
    'GEOIP',
    'USER-AGENT',
    'URL-REGEX',
    'DEST-PORT',
    'SRC-PORT',
    'PROCESS-NAME',
  ]);
  if (!allowed.has(mappedType)) return null;

  const value = formatLoonRuleValue(mappedType, parts[1]!);
  if (!value) return null;
  const emittedType = mappedType === 'IP-CIDR' && value.includes(':') ? 'IP-CIDR6' : mappedType;
  const hasNoResolve =
    parts.some((p) => p.toLowerCase() === 'no-resolve') ||
    (appendNoResolve &&
      (emittedType === 'IP-CIDR' || emittedType === 'IP-CIDR6' || emittedType === 'IP-ASN' || emittedType === 'GEOIP'));
  return hasNoResolve ? `${emittedType},${value},${policyName},no-resolve` : `${emittedType},${value},${policyName}`;
}

function normalizeLoonRealIp(entry: string): string {
  const cleaned = sanitizeLoonScalar(entry).replace(/,/g, '').replace(/[;#]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+.')) return `*.${cleaned.slice(2)}`;
  if (cleaned.startsWith('.')) return `*.${cleaned.slice(1)}`;
  return cleaned;
}

function compileLoonGeneralSection(
  dns: DnsProfile,
  general: TemplateBody['general'],
  items: CompatibilityItem[],
): string[] {
  if (dns.mode === 'redir-host') {
    items.push({
      code: 'UNSUPPORTED_DNS_OPTION',
      severity: 'warning',
      message: 'Loon TUN/VIF 默认采用 Fake-IP 模式，不支持 redir-host，已忽略该 DNS 模式设置。',
    });
  }
  if (dns.respectRules) {
    items.push({
      code: 'UNSUPPORTED_DNS_OPTION',
      severity: 'warning',
      message: 'Loon 不支持 Clash 风格的 dns.respect-rules 开关，已忽略该项。',
    });
  }

  const lines: string[] = [
    `ip-mode = ${general?.ipv6 ? 'dual' : 'v4-only'}`,
    'ipv6 = ' + (general?.ipv6 ? 'true' : 'false'),
    'internet-test-url = http://www.gstatic.com/generate_204',
    `proxy-test-url = ${sanitizeLoonUrl(general?.testUrl ?? DEFAULT_HEALTH_CHECK.url)}`,
    'test-timeout = 5',
    'sni-sniffing = true',
  ];

  if (general?.allowLan) {
    lines.push('allow-wifi-access = true');
  }

  const plainDns: string[] = [];
  const dohServers: string[] = [];
  const doqServers: string[] = [];
  const doh3Servers: string[] = [];

  for (const rawEntry of [...(dns.defaultNameserver ?? []), ...(dns.nameserver ?? [])]) {
    const cleaned = sanitizeLoonScalar(rawEntry).replace(/,/g, '').replace(/[;#]/g, '');
    if (!cleaned) continue;
    if (/^https:\/\//i.test(cleaned)) {
      if (!dohServers.includes(cleaned)) dohServers.push(cleaned);
    } else if (/^quic:\/\//i.test(cleaned)) {
      if (!doqServers.includes(cleaned)) doqServers.push(cleaned);
    } else if (/^h3:\/\//i.test(cleaned)) {
      if (!doh3Servers.includes(cleaned)) doh3Servers.push(cleaned);
    } else if (/^tls:\/\//i.test(cleaned)) {
      // Loon uses plain DNS + DoH/DoQ/DoH3; keep DoT comment note or skip silently if plain exists
      if (!plainDns.includes(cleaned)) plainDns.push(cleaned);
    } else if (!plainDns.includes(cleaned)) {
      plainDns.push(cleaned);
    }
  }
  if (!plainDns.includes('system')) {
    plainDns.push('system');
  }

  lines.push(`dns-server = ${plainDns.join(', ')}`);
  if (dohServers.length > 0) lines.push(`doh-server = ${dohServers.join(', ')}`);
  if (doqServers.length > 0) lines.push(`doq-server = ${doqServers.join(', ')}`);
  if (doh3Servers.length > 0) lines.push(`doh3-server = ${doh3Servers.join(', ')}`);

  if (dns.fakeIpFilter && dns.fakeIpFilter.length > 0) {
    const realIpList = [...new Set(dns.fakeIpFilter.map(normalizeLoonRealIp).filter(Boolean))];
    if (realIpList.length > 0) {
      lines.push(`real-ip = ${realIpList.join(', ')}`);
    }
  }

  lines.push(`skip-proxy = ${DEFAULT_LOON_SKIP_PROXY.join(', ')}`);
  lines.push(`bypass-tun = ${DEFAULT_LOON_BYPASS_TUN.join(', ')}`);
  return lines;
}

type LoonSection = {
  header: string;
  lines: string[];
};

function applyLoonIniPatch(sections: LoonSection[], rawPatch: string, items: CompatibilityItem[]): void {
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
      currentHeader = `[${sanitizeLoonScalar(headerMatch[1]!)}]`;
      continue;
    }

    if (!currentHeader) {
      if (!orphanWarned) {
        orphanWarned = true;
        items.push({
          code: 'INVALID_CLIENT_PATCH',
          severity: 'warning',
          message: 'Loon 客户端补丁中存在未归属任何 [Section] 的配置行，已忽略。',
        });
      }
      continue;
    }

    let section = sections.find((item) => item.header.toLowerCase() === currentHeader!.toLowerCase());
    if (!section) {
      section = { header: currentHeader, lines: [] };
      sections.push(section);
    }
    section.lines.push(sanitizeLoonScalar(trimmed));
  }
}

/**
 * Compiles a template intermediate representation into either:
 * - **Safe default (`experimentalFullConfig !== true`)**: a rules-only remote
 *   rule resource safe to import in Loon without overwriting existing `[Remote Proxy]`
 *   node subscriptions (design §20).
 * - **Experimental full config (`experimentalFullConfig === true`)**: full Loon
 *   INI profile with `[General]`, `[Remote Filter]`, `[Proxy Group]`, `[Rule]`,
 *   `[Remote Rule]`, marked unverified (`未经真机验证`) in the compatibility report.
 *
 * Pure function — no I/O, no wall-clock dependency.
 */
export function compileLoon(input: CompileTemplateInput): CompiledConfigResult {
  const output: OutputProfile = input.output ?? input.body.output ?? 'full';
  const experimentalFullConfig = Boolean(input.experimentalFullConfig);
  const items: CompatibilityItem[] = [];

  if (experimentalFullConfig) {
    items.push({
      code: 'EXPERIMENTAL_FULL_CONFIG_UNVERIFIED',
      severity: 'warning',
      message:
        '实验性完整配置（未经真机验证）：当前 Loon 完整配置包含 [General]/[Remote Filter]/[Proxy Group]/[Rule]/[Remote Rule]，直接作为主配置导入可能覆盖客户端已有节点订阅，请先备份并在真机验证。',
    });
  } else {
    items.push({
      code: 'RULES_ONLY_SAFE_DEFAULT',
      severity: 'info',
      message:
        '安全默认：Loon 默认仅输出远程规则资源（不包含 [General]/[Proxy]/[Remote Proxy]/[Proxy Group]），避免导入完整配置覆盖已有节点订阅；如需实验性完整配置，请在发布设置中开启（未经真机验证）。',
    });
  }

  // 1. Resolve cards & apply enhancement modules
  const initialResolved = resolveTemplateCards(input.body, input.cards);
  for (const missingId of initialResolved.missingCardIds) {
    items.push({
      code: 'MISSING_CARD_REFERENCE',
      severity: 'warning',
      message: `模板引用的应用组件 ${missingId} 未在组件库中找到，已跳过。`,
      location: { cardId: missingId },
    });
  }

  let resolved = initialResolved;
  let appliedModules: string[] = [];
  let skippedModules: string[] = [];
  if (input.applyModules !== false) {
    const modResult = applyEnhancementModules(initialResolved, {
      client: 'loon',
      registry: input.moduleRegistry,
    });
    resolved = modResult.template;
    appliedModules = modResult.applied;
    skippedModules = modResult.skipped.map((entry) => entry.moduleId);
    for (const skipped of modResult.skipped) {
      items.push({
        code: 'MODULE_SKIPPED',
        severity: 'info',
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
  const inlinePayloads = toInlinePayloadsMap(input.inlineRulePayloads);
  const ipNoResolveEnabled = appliedModules.includes('ip-no-resolve');

  const hasExplicitPools = body.pools !== undefined;
  const bodyPools = getNormalizedBodyPools(body);
  const slotMap = new Map(body.slots.map((slot) => [slot.id, slot]));
  const slotBindingMap = toSlotBindingMap(input.slotBindings);

  // 2. Allocate unique sanitized group names (used both in full config and as policy targets in rules)
  const usedGroupNames = new Set<string>();
  const cardGroupNameById = new Map<string, string>();
  const poolGroupNameById = new Map<string, string>();
  const declaredGroupNames: string[] = [];

  for (const card of enabledCards) {
    const original = card.effective.name;
    const sanitized = sanitizeLoonGroupName(original, card.cardId);
    const unique = allocateUniqueName(
      sanitized,
      usedGroupNames,
      true,
      (finalName, reason) => {
        if (reason === 'sanitized' || reason === 'builtin-collision') {
          items.push({
            code: 'GROUP_NAME_SANITIZED',
            severity: 'info',
            message: `策略组名称「${sanitizeLoonScalar(original)}」已规范化为「${finalName}」以符合 Loon INI 语法。`,
            location: { cardId: card.cardId },
          });
        }
      },
      original,
    );
    cardGroupNameById.set(card.cardId, unique);
    declaredGroupNames.push(unique);
  }

  for (const pool of bodyPools) {
    const original = pool.name;
    const sanitized = sanitizeLoonGroupName(original, pool.id);
    const unique = allocateUniqueName(
      sanitized,
      usedGroupNames,
      true,
      (finalName, reason) => {
        if (reason === 'sanitized' || reason === 'builtin-collision') {
          items.push({
            code: 'GROUP_NAME_SANITIZED',
            severity: 'info',
            message: `${pool.kind === 'region' ? '地区策略组' : '节点池'}名称「${sanitizeLoonScalar(original)}」已规范化为「${finalName}」以符合 Loon INI 语法。`,
            location: poolCompatibilityLocation(pool, hasExplicitPools),
          });
        }
      },
      original,
    );
    poolGroupNameById.set(pool.id, unique);
    declaredGroupNames.push(unique);
  }

  // 3. Plan rulesets (Loon is local-first: remote rulesets before inline rules are marked inlineForPriority)
  const plan = planRulesetReferences({
    cards: enabledCards,
    client: 'loon',
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
    } else if (warning.code === 'REMOTE_INLINED_FOR_LOCAL_FIRST_CLIENT') {
      items.push({
        code: 'REMOTE_INLINED_FOR_LOCAL_FIRST_CLIENT',
        severity: 'info',
        message: warning.message,
        location: { cardId: warning.cardId },
      });
    }
  }

  const providerById = new Map<string, PlannedProvider>();
  for (const provider of plan.providers) {
    providerById.set(provider.id, provider);
    if (!isRemoteFormatSupported('loon', provider.format, provider.behavior)) {
      items.push({
        code: 'UNSUPPORTED_REMOTE_FORMAT',
        severity: 'warning',
        message: `Loon 远程规则仅支持纯文本格式，规则集 ${provider.id} 的原始格式 ${provider.format} 可能需要转换后使用。`,
        location: { providerId: provider.id },
      });
    }
  }

  // 4. Build [Remote Filter] & [Proxy Group] only when experimentalFullConfig is enabled
  const remoteFilterLines: string[] = [];
  const proxyGroupLines: string[] = [];
  const usedFilterNames = new Set<string>(usedGroupNames);

  const registerFilter = (
    preferredName: string,
    nodeFilter: NodeFilter | undefined,
    excludeInfo: boolean,
    location: CompatibilityItem['location'],
  ): string => {
    const compiled = compileClientNodeFilter(nodeFilter, 'loon', { excludeInfo });
    for (const warning of compiled.warnings) {
      items.push({
        code: 'REGEX_DIALECT_WARNING',
        severity: 'warning',
        message: warning.message,
        location,
      });
    }

    const filterName = allocateUniqueName(sanitizeLoonFilterName(preferredName, 'NodeFilter'), usedFilterNames, true);
    if (compiled.mode === 'two-stage') {
      items.push({
        code: 'REGEX_DEGRADED_TWO_STAGE',
        severity: 'warning',
        message: `Loon 节点筛选「${filterName}」${compiled.degradedReason ?? '已降级为包含/排除两段式筛选。'}`,
        location,
      });
      if (compiled.includeKeywords.length > 0) {
        remoteFilterLines.push(
          `${filterName} = NameKeyword, FilterKey=${quoteLoonParam(compiled.includeKeywords.join(','), true)}`,
        );
      } else {
        remoteFilterLines.push(`${filterName} = NameRegex, FilterKey=${quoteLoonParam(compiled.includePattern, true)}`);
      }
      if (compiled.excludeKeywords.length > 0) {
        const excludeFilterName = allocateUniqueName(`${filterName}-Exclude`, usedFilterNames, true);
        remoteFilterLines.push(
          `# Two-stage exclude (${filterName}): 请在 Loon 中配合排除关键词 ${compiled.excludeKeywords.slice(0, 8).join(', ')}`,
        );
        remoteFilterLines.push(
          `${excludeFilterName} = NameKeyword, FilterKey=${quoteLoonParam(compiled.excludeKeywords.join(','), true)}`,
        );
      }
      return filterName;
    }

    remoteFilterLines.push(`${filterName} = NameRegex, FilterKey=${quoteLoonParam(compiled.regex, true)}`);
    return filterName;
  };

  if (experimentalFullConfig) {
    if (body.slots.length > 0) {
      items.push({
        code: 'UNSUPPORTED_CLIENT_FEATURE',
        severity: 'info',
        message:
          'Loon 为客户端托管节点模式，本配置不写入 [Remote Proxy] 订阅链接，请保留 Loon 客户端中已添加的节点订阅，策略组将通过 [Remote Filter] 按节点名筛选。',
      });
    }

    const defaultExcludeInfo = body.slots.some((slot) => slot.excludeInfo !== false);
    const defaultSlotFilterCache = new Map<string, string>();

    const getUnfilteredSlotFilterName = (slotId: string): string => {
      const cached = defaultSlotFilterCache.get(slotId);
      if (cached) return cached;
      const slot = slotMap.get(slotId);
      const excludeInfo = slot ? slot.excludeInfo !== false : defaultExcludeInfo;
      const filterName = registerFilter(`Filter-${slot?.name ?? slotId}`, undefined, excludeInfo, { slotId });
      defaultSlotFilterCache.set(slotId, filterName);
      return filterName;
    };

    const resolveCandidates = (
      candidates: readonly PolicyRef[],
      ownerName: string,
      location: CompatibilityItem['location'],
    ): string[] => {
      const members: string[] = [];
      const pushUnique = (member: string) => {
        if (member && !members.includes(member)) members.push(member);
      };

      candidates.forEach((ref, idx) => {
        switch (ref.kind) {
          case 'builtin':
            pushUnique(ref.id);
            break;
          case 'card': {
            const target = cardGroupNameById.get(ref.cardId);
            if (!target) {
              items.push({
                code: 'MISSING_CARD_REFERENCE',
                severity: 'warning',
                message: `策略组引用的应用组件 ${ref.cardId} 未启用或不存在，已忽略。`,
                location: { ...location, cardId: ref.cardId },
              });
              return;
            }
            pushUnique(target);
            break;
          }
          case 'region':
          case 'pool': {
            const targetId = ref.kind === 'pool' ? ref.poolId : ref.regionGroupId;
            const target = poolGroupNameById.get(targetId);
            if (!target) {
              items.push({
                code: ref.kind === 'pool' ? 'MISSING_POOL_REFERENCE' : 'MISSING_REGION_REFERENCE',
                severity: 'warning',
                message:
                  ref.kind === 'pool'
                    ? `策略组引用的节点池 ${targetId} 不存在，已忽略。`
                    : `策略组引用的地区组 ${targetId} 不存在，已忽略。`,
                location:
                  ref.kind === 'pool' ? { ...location, poolId: targetId } : { ...location, regionGroupId: targetId },
              });
              return;
            }
            pushUnique(target);
            break;
          }
          case 'slot': {
            const slot = slotMap.get(ref.slotId);
            if (!slot) {
              items.push({
                code: 'MISSING_SLOT_REFERENCE',
                severity: 'warning',
                message: `策略组引用的节点槽位 ${ref.slotId} 不存在，已忽略。`,
                location: { ...location, slotId: ref.slotId },
              });
              return;
            }
            if (ref.filter && (ref.filter.regions?.length || ref.filter.include || ref.filter.exclude)) {
              const filterName = registerFilter(
                `Filter-${ownerName}-${idx + 1}`,
                ref.filter,
                slot.excludeInfo !== false,
                { ...location, slotId: ref.slotId },
              );
              pushUnique(filterName);
            } else {
              pushUnique(getUnfilteredSlotFilterName(ref.slotId));
            }
            break;
          }
        }
      });

      if (members.length === 0) {
        members.push('DIRECT');
        items.push({
          code: 'GROUP_FALLBACK_DIRECT',
          severity: 'warning',
          message: `策略组「${ownerName}」没有可用候选项，已自动兜底为 DIRECT。`,
          location,
        });
      }
      return members;
    };

    const formatGroupLine = (
      groupName: string,
      groupType: ResolvedTemplateCard['effective']['group']['type'],
      members: readonly string[],
      test: { url?: string; intervalSec?: number; toleranceMs?: number } | undefined,
      iconUrl: string | undefined,
      location: CompatibilityItem['location'],
    ): string => {
      const effectiveType = isGroupTypeSupported('loon', groupType) ? groupType : 'select';
      if (effectiveType !== groupType) {
        items.push({
          code: 'UNSUPPORTED_GROUP_TYPE',
          severity: 'warning',
          message: `Loon 不支持策略组类型 ${groupType}，已降级为 select。`,
          location,
        });
      }

      const testUrl = sanitizeLoonUrl(test?.url ?? body.general?.testUrl ?? DEFAULT_HEALTH_CHECK.url);
      const interval = test?.intervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec;
      const tolerance = test?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 100;

      const parts: string[] = [effectiveType, ...members];
      if (effectiveType === 'url-test') {
        parts.push(`url=${testUrl}`, `interval=${interval}`, `tolerance=${tolerance}`);
      } else if (effectiveType === 'fallback') {
        parts.push(`url=${testUrl}`, `interval=${interval}`, 'max-timeout=5000');
      } else if (effectiveType === 'load-balance') {
        parts.push(`url=${testUrl}`, `interval=${interval}`, 'algorithm=pcc', 'max-timeout=5000');
      }
      if (iconUrl) {
        parts.push(`img-url=${iconUrl}`);
      }
      return `${groupName} = ${parts.join(', ')}`;
    };

    // Card strategy groups
    for (const card of enabledCards) {
      const groupName = cardGroupNameById.get(card.cardId)!;
      const members = resolveCandidates(card.effective.group.candidates, groupName, { cardId: card.cardId });
      // Empty DIRECT fallback uses select so DIRECT is never speed-tested.
      const effectiveCardType =
        members.length === 1 && members[0] === 'DIRECT' && card.effectiveGroupType !== 'select'
          ? 'select'
          : card.effectiveGroupType;
      const iconUrl = resolveGroupIconUrl(
        {
          explicitIcon: card.effective.icon,
          name: card.effective.name,
          slug: card.effective.slug,
          category: card.effective.category,
          groupType: effectiveCardType,
          matchers: card.effective.matchers,
        },
        input.iconPack,
      );
      proxyGroupLines.push(
        formatGroupLine(groupName, effectiveCardType, members, card.effective.group.test, iconUrl, {
          cardId: card.cardId,
        }),
      );
    }

    // Pool strategy groups (regions, providers, traits, all, stability)
    for (const pool of bodyPools) {
      const groupName = poolGroupNameById.get(pool.id)!;
      const location = poolCompatibilityLocation(pool, hasExplicitPools);
      let members: string[];

      if (pool.kind === 'stability') {
        const stabilityMembers = resolveStabilityPoolMembers(pool, poolGroupNameById, items, hasExplicitPools);
        if (stabilityMembers.length > 0) {
          members = stabilityMembers;
        } else {
          items.push({
            code: 'EMPTY_POOL_FALLBACK_ALL',
            severity: 'warning',
            message: `稳定性节点池「${groupName}」无可用成员池，已退化为引用全部节点。`,
            location,
          });
          members = [registerFilter(`Filter-${pool.name}`, undefined, defaultExcludeInfo, location)];
        }
      } else {
        const emptyProtection = hasExplicitPools
          ? evaluatePoolEmptyProtection({
              pool,
              client: 'loon',
              slots: body.slots,
              slotById: slotMap,
              slotBindings: slotBindingMap,
            })
          : { fallbackToAll: false };
        if (emptyProtection.fallbackToAll) {
          items.push({
            code: 'EMPTY_POOL_FALLBACK_ALL',
            severity: 'warning',
            message: emptyProtection.message ?? `节点池「${groupName}」已退化为引用全部节点。`,
            location,
          });
        }
        const nodeFilter = emptyProtection.fallbackToAll ? undefined : poolToNodeFilter(pool);
        members = [registerFilter(`Filter-${pool.name}`, nodeFilter, defaultExcludeInfo, location)];
      }

      const iconUrl = resolveGroupIconUrl(
        {
          ...(pool.kind !== 'region' && pool.icon ? { explicitIcon: pool.icon } : {}),
          name: pool.name,
          ...(pool.kind === 'region' && pool.region ? { region: pool.region } : {}),
          ...(pool.kind === 'all' ? { slug: 'all-nodes' } : pool.kind === 'provider' ? { slug: 'airport' } : {}),
          groupType: pool.type,
        },
        input.iconPack,
      );
      proxyGroupLines.push(formatGroupLine(groupName, pool.type, members, pool.test, iconUrl, location));
    }
  }

  // 5. Compile [Rule] and [Remote Rule] (respecting local-first priority inlining)
  const bindingMap = new Map<string, PlannedMatcherBinding>();
  for (const binding of plan.bindings) {
    bindingMap.set(`${binding.cardId}:${binding.matcherIndex}`, binding);
  }

  const localRules: string[] = [];
  const remoteRuleLines: string[] = [];
  const emittedRemoteKeys = new Set<string>();
  let skippedRules = 0;
  let activeRuleProviders = 0;
  const countedProviderIds = new Set<string>();
  const reportedProcessNameCards = new Set<string>();

  const getProviderRemoteUrl = (provider: PlannedProvider): string | undefined => {
    switch (provider.source.kind) {
      case 'remote':
      case 'catalog':
        return provider.source.url;
      case 'ruleset':
      case 'geosite-hosted':
        return provider.source.url;
      case 'geoip-ruleset':
        return undefined;
    }
  };

  for (const card of enabledCards) {
    if (card.effective.hidden) continue;
    const policyName = cardGroupNameById.get(card.cardId)!;

    card.effective.matchers.forEach((matcher, matcherIndex) => {
      const binding = bindingMap.get(`${card.cardId}:${matcherIndex}`);

      if (matcher.kind === 'geoip') {
        const name = sanitizeLoonRuleValue(matcher.name).toUpperCase();
        if (name) {
          localRules.push(matcher.noResolve ? `GEOIP,${name},${policyName},no-resolve` : `GEOIP,${name},${policyName}`);
        }
        return;
      }

      if (matcher.kind === 'inline') {
        for (const cond of matcher.conditions) {
          const line = compileLoonTopLevelCondition(cond, policyName, card.cardId, items, reportedProcessNameCards);
          if (line) {
            localRules.push(line);
          } else {
            skippedRules += 1;
          }
        }
        return;
      }

      if (!binding || binding.providerIds.length === 0) return;

      for (const providerId of binding.providerIds) {
        const provider = providerById.get(providerId);
        if (!provider) continue;

        const remoteUrl = getProviderRemoteUrl(provider);
        const payload = inlinePayloads.get(providerId);
        const appendNoResolve = provider.behavior === 'ipcidr' && (ipNoResolveEnabled || input.applyModules === false);

        if (binding.inlinedForPriority || provider.inlineForPriority) {
          // Local-first client: inline this remote ruleset into [Rule] so it is evaluated BEFORE subsequent local rules.
          if (payload && payload.length > 0) {
            localRules.push(`# Inlined for priority: ${provider.id} -> ${policyName}`);
            for (const rawLine of payload) {
              const converted = convertPayloadLineToLoonRule(rawLine, provider.behavior, policyName, appendNoResolve);
              if (converted) {
                localRules.push(converted);
              }
            }
          } else {
            const urlHint = remoteUrl ? sanitizeLoonUrl(remoteUrl) : '未提供 URL';
            localRules.push(`# [Inlined Remote Rule Required] ${provider.id} (${urlHint}) -> ${policyName}`);
            if (!remoteUrl) {
              items.push({
                code: 'MISSING_RULESET_URL',
                severity: 'warning',
                message: `需内联的规则集 ${provider.id} 未提供内联规则内容或 baseUrl，已写入占位注释。`,
                location: { cardId: card.cardId, providerId: provider.id },
              });
            }
          }
          if (!countedProviderIds.has(providerId)) {
            countedProviderIds.add(providerId);
            activeRuleProviders += 1;
          }
          continue;
        }

        if (!remoteUrl) {
          items.push({
            code: 'MISSING_RULESET_URL',
            severity: 'warning',
            message: `规则集 ${provider.id} 未提供 baseUrl，已跳过该 [Remote Rule] 条目。`,
            location: { cardId: card.cardId, providerId: provider.id },
          });
          skippedRules += 1;
          continue;
        }

        const safeUrl = sanitizeLoonUrl(remoteUrl);
        const dedupeEntry = `${safeUrl}|${policyName}`;
        if (!emittedRemoteKeys.has(dedupeEntry)) {
          emittedRemoteKeys.add(dedupeEntry);
          const tag = sanitizeLoonGroupName(`${provider.id}-${card.cardId}`, provider.id);
          remoteRuleLines.push(`${safeUrl}, policy=${policyName}, tag=${tag}, enabled=true`);
        }
        if (!countedProviderIds.has(providerId)) {
          countedProviderIds.add(providerId);
          activeRuleProviders += 1;
        }
      }
    });
  }

  // 6. Resolve final catch-all policy
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
    return declaredGroupNames[0] ?? 'DIRECT';
  };

  const finalPolicy = resolveFinalPolicy(body.final);

  // 7. Serialize output
  const headerLines: string[] = [
    '# Generated by Private Rules (Loon)',
    experimentalFullConfig
      ? '# Mode: Experimental Full Config (未经真机验证 — 导入完整配置可能覆盖已有节点订阅)'
      : '# Mode: Rules-Only Remote Resource (Safe Default — 仅规则资源，不覆盖已有节点订阅)',
  ];
  if (input.templateName) headerLines.push(`# Template: ${sanitizeLoonScalar(input.templateName)}`);
  headerLines.push(`# Output: ${output}`);
  if (input.generatedAt) headerLines.push(`# UPDATED: ${sanitizeLoonScalar(input.generatedAt)}`);

  let content: string;
  let ruleCount = localRules.filter((line) => !line.startsWith('#')).length;

  if (!experimentalFullConfig) {
    // Rules-only remote rule resource (Loon ExampleRule.list compatible, no [General]/[Proxy]/[Proxy Group])
    const bodyLines: string[] = [...headerLines, ''];
    if (localRules.length > 0) {
      bodyLines.push(...localRules);
    }
    if (remoteRuleLines.length > 0) {
      bodyLines.push('', '# [Remote Rule] 以下远程规则列表请按需在 Loon 远程规则中添加：');
      for (const remoteLine of remoteRuleLines) {
        bodyLines.push(`# ${remoteLine}`);
      }
    }
    bodyLines.push('', `# Default Final Policy (请在 Loon 主配置 [Rule] 中保持兜底策略): FINAL,${finalPolicy}`);
    content = `${bodyLines.join('\n')}\n`;
  } else {
    localRules.push(`${LOON_CAPS.finalRuleKeyword},${finalPolicy}`);
    ruleCount += 1;

    const sections: LoonSection[] = [];
    if (output === 'full') {
      sections.push({
        header: '[General]',
        lines: compileLoonGeneralSection(body.dns, body.general, items),
      });
    } else {
      items.push({
        code: 'MINIMAL_OMITTED_SECTIONS',
        severity: 'info',
        message: '最小模式（minimal）已省略 [General] 基础与 DNS 配置段。',
      });
    }

    if (remoteFilterLines.length > 0) {
      sections.push({
        header: '[Remote Filter]',
        lines: remoteFilterLines,
      });
    }

    sections.push({
      header: '[Proxy Group]',
      lines: proxyGroupLines,
    });

    sections.push({
      header: '[Rule]',
      lines: localRules,
    });

    if (remoteRuleLines.length > 0) {
      sections.push({
        header: '[Remote Rule]',
        lines: remoteRuleLines,
      });
    }

    if (body.clientPatches?.loon?.trim()) {
      applyLoonIniPatch(sections, body.clientPatches.loon, items);
    }

    const renderedSections = sections
      .filter((section) => section.lines.length > 0)
      .map((section) => `${section.header}\n${section.lines.join('\n')}`);
    content = `${headerLines.join('\n')}\n\n${renderedSections.join('\n\n')}\n`;
  }

  return {
    client: 'loon',
    output,
    contentType: 'text/plain; charset=utf-8',
    extension: '.conf',
    content,
    report: {
      client: 'loon',
      output,
      items,
      stats: {
        proxyProviders: 0,
        inlineProxies: 0,
        proxyGroups: experimentalFullConfig ? proxyGroupLines.length : 0,
        ruleProviders: activeRuleProviders,
        rules: ruleCount,
        skippedRules,
        appliedModules,
        skippedModules,
      },
    },
  };
}
