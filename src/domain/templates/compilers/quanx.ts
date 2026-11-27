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
 * Quantumult X compiler (design §10.6, §10.11–10.13, §11, §20).
 *
 * Official docs audited:
 * - https://github.com/crossutility/Quantumult-X/blob/master/sample.conf (v1.5.5 build 914)
 * - https://github.com/crossutility/Quantumult-X/blob/master/filter.snippet
 * - https://github.com/crossutility/Quantumult-X/blob/master/README.md
 */

const QX_CAPS = CLIENT_CAPABILITIES['quantumult-x'];

const DEFAULT_QX_EXCLUDED_ROUTES = ['192.168.0.0/16', '172.16.0.0/12', '100.64.0.0/10', '10.0.0.0/8'];
const DEFAULT_QX_DNS_EXCLUSION_LIST = [
  '*.cmpassport.com',
  '*.jegotrip.com.cn',
  '*.icitymobile.mobi',
  'id6.me',
  '*.local',
];

// eslint-disable-next-line no-control-regex
const CONTROL_AND_LINE_BREAK_RE = /[\r\n\u2028\u2029\x00-\x1f\x7f]+/g;

/**
 * Strips CR/LF/Unicode line separators and ASCII control characters from any
 * scalar emitted into a Quantumult X config or filter resource.
 */
export function sanitizeQuanxScalar(raw: string): string {
  return raw.replace(CONTROL_AND_LINE_BREAK_RE, ' ').trim();
}

/**
 * Sanitizes a Quantumult X `[policy]` group name against INI section injection,
 * `=` / `,` delimiter breaks, quotes, and inline comment markers (`#`, `;`).
 */
export function sanitizeQuanxGroupName(raw: string, fallback = 'ProxyGroup'): string {
  const cleaned = sanitizeQuanxScalar(raw)
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
 * Sanitizes a Quantumult X server tag / node name against INI syntax injection.
 */
export function sanitizeQuanxNodeName(raw: string, fallback = 'Node'): string {
  return sanitizeQuanxGroupName(raw, fallback);
}

/**
 * Sanitizes a URL emitted into Quantumult X `[filter_remote]` or `img-url=...`.
 */
export function sanitizeQuanxUrl(raw: string): string {
  return sanitizeQuanxScalar(raw)
    .replace(/\s+/g, '')
    .replace(/,/g, '%2C')
    .replace(/"/g, '%22')
    .replace(/;/g, '%3B')
    .replace(/#/g, '%23');
}

/**
 * Sanitizes a Quantumult X filter rule value (host, ip-cidr, ip-asn, geoip, user-agent).
 */
export function sanitizeQuanxRuleValue(raw: string): string {
  return sanitizeQuanxScalar(raw).replace(/,/g, '').replace(/[;#]/g, '').replace(/\/\//g, '').trim();
}

/**
 * Sanitizes a regex parameter emitted into `server-tag-regex=...` so it cannot
 * break comma-delimited `[policy]` parameters or inject INI sections/comments.
 */
function sanitizeQuanxRegexParam(raw: string): string {
  return sanitizeQuanxScalar(raw).replace(/,/g, '\\x2c').replace(/[;#]/g, '');
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = sanitizeQuanxScalar(value);
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

  if (avoidBuiltins && QX_CAPS.builtinPolicies.has(candidate.toLowerCase())) {
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
    return sanitizeQuanxUrl(input.explicitIcon);
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
    return sanitizeQuanxUrl(recognized.packIcon.url);
  }
  return undefined;
}

function mapQuanxBuiltinPolicy(
  id: 'DIRECT' | 'REJECT' | 'REJECT-DROP',
  items: CompatibilityItem[],
  reportedRejectDrop: { warned: boolean },
  location?: CompatibilityItem['location'],
): string {
  if (id === 'DIRECT') return 'direct';
  if (id === 'REJECT') return 'reject';
  if (!reportedRejectDrop.warned) {
    reportedRejectDrop.warned = true;
    items.push({
      code: 'UNSUPPORTED_CLIENT_FEATURE',
      severity: 'info',
      message: 'Quantumult X 不支持 REJECT-DROP 动作，已降级为 reject。',
      location,
    });
  }
  return 'reject';
}

function formatQuanxRuleValue(type: string, rawValue: string): string {
  if (type === 'USER-AGENT') {
    return sanitizeQuanxScalar(rawValue).replace(/,/g, '');
  }
  const value = sanitizeQuanxRuleValue(rawValue);
  if (type === 'GEOIP') return value.toLowerCase();
  return value;
}

function compileQuanxCondition(
  cond: Condition,
  policyName: string,
  cardId: string,
  items: CompatibilityItem[],
): string | null {
  if (cond.op !== 'rule') {
    items.push({
      code: 'UNSUPPORTED_LOGICAL_RULE',
      severity: 'warning',
      message: `Quantumult X 不支持逻辑组合规则（${cond.op.toUpperCase()}），已跳过该条规则。`,
      location: { cardId },
    });
    return null;
  }

  const { type, value } = cond.rule;
  if (!isRuleTypeSupported('quantumult-x', type)) {
    items.push({
      code: 'UNSUPPORTED_RULE_TYPE',
      severity: 'warning',
      message: `Quantumult X 不支持规则类型 ${type}（值：${sanitizeQuanxScalar(value)}），已跳过该条规则。`,
      location: { cardId },
    });
    return null;
  }

  const formattedValue = formatQuanxRuleValue(type, value);
  if (!formattedValue) return null;

  const aliasedType = QX_CAPS.ruleTypeAliases[type] ?? type.toLowerCase();
  const emittedType = type === 'IP-CIDR' && formattedValue.includes(':') ? QX_CAPS.ipV6RuleType : aliasedType;
  // Quantumult X filter syntax omits trailing `,no-resolve`
  return `${emittedType}, ${formattedValue}, ${policyName}`;
}

/**
 * Converts a raw rule line from an inline remote-rule payload into a Quantumult X
 * filter line bound to `policyName`. Unsupported types return `null`.
 */
function convertPayloadLineToQuanxRule(
  rawLine: string,
  behavior: RemoteRuleBehavior,
  policyName: string,
): string | null {
  const line = sanitizeQuanxScalar(rawLine);
  if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) return null;

  if (!line.includes(',')) {
    if (behavior === 'domain') {
      const cleaned = sanitizeQuanxRuleValue(line);
      if (!cleaned) return null;
      if (cleaned.startsWith('+.')) return `host-suffix, ${cleaned.slice(2)}, ${policyName}`;
      if (cleaned.startsWith('.')) return `host-suffix, ${cleaned.slice(1)}, ${policyName}`;
      return `host, ${cleaned}, ${policyName}`;
    }
    if (behavior === 'ipcidr') {
      const cleaned = sanitizeQuanxRuleValue(line);
      if (!cleaned) return null;
      const type = cleaned.includes(':') ? 'ip6-cidr' : 'ip-cidr';
      return `${type}, ${cleaned}, ${policyName}`;
    }
    return null;
  }

  const parts = line.split(',').map((part) => part.trim());
  if (parts.length < 2) return null;
  const rawType = parts[0]!.toUpperCase();
  const typeMap: Record<string, string> = {
    DOMAIN: 'host',
    HOST: 'host',
    'DOMAIN-SUFFIX': 'host-suffix',
    'HOST-SUFFIX': 'host-suffix',
    'DOMAIN-KEYWORD': 'host-keyword',
    'HOST-KEYWORD': 'host-keyword',
    'IP-CIDR': 'ip-cidr',
    'IP-CIDR6': 'ip6-cidr',
    'IP6-CIDR': 'ip6-cidr',
    'IP-ASN': 'ip-asn',
    GEOIP: 'geoip',
    'USER-AGENT': 'user-agent',
  };
  const mapped = typeMap[rawType];
  if (!mapped) return null;

  const value =
    mapped === 'user-agent'
      ? sanitizeQuanxScalar(parts[1]!).replace(/,/g, '')
      : mapped === 'geoip'
        ? sanitizeQuanxRuleValue(parts[1]!).toLowerCase()
        : sanitizeQuanxRuleValue(parts[1]!);
  if (!value) return null;
  const finalType = mapped === 'ip-cidr' && value.includes(':') ? 'ip6-cidr' : mapped;
  return `${finalType}, ${value}, ${policyName}`;
}

function normalizeQuanxDnsExclusion(entry: string): string {
  const cleaned = sanitizeQuanxScalar(entry).replace(/,/g, '').replace(/[;#]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+.')) return `*.${cleaned.slice(2)}`;
  if (cleaned.startsWith('.')) return `*.${cleaned.slice(1)}`;
  return cleaned;
}

function compileQuanxGeneralAndDns(
  dns: DnsProfile,
  general: TemplateBody['general'],
  items: CompatibilityItem[],
): { generalLines: string[]; dnsLines: string[] } {
  if (dns.mode === 'redir-host') {
    items.push({
      code: 'UNSUPPORTED_DNS_OPTION',
      severity: 'warning',
      message: 'Quantumult X 不支持 Clash 风格的 redir-host DNS 模式，已忽略该项。',
    });
  }
  if (dns.respectRules) {
    items.push({
      code: 'UNSUPPORTED_DNS_OPTION',
      severity: 'warning',
      message: 'Quantumult X 不支持 Clash 风格的 dns.respect-rules 开关，已忽略该项。',
    });
  }

  const exclusions = [...DEFAULT_QX_DNS_EXCLUSION_LIST];
  for (const item of dns.fakeIpFilter ?? []) {
    const normalized = normalizeQuanxDnsExclusion(item);
    if (normalized && !exclusions.includes(normalized)) exclusions.push(normalized);
  }

  const generalLines: string[] = [
    `server_check_url=${sanitizeQuanxUrl(general?.testUrl ?? DEFAULT_HEALTH_CHECK.url)}`,
    `dns_exclusion_list=${exclusions.join(', ')}`,
    `excluded_routes=${DEFAULT_QX_EXCLUDED_ROUTES.join(', ')}`,
  ];

  const dnsLines: string[] = [];
  if (!general?.ipv6) {
    dnsLines.push('no-ipv6');
  }
  const plainServers: string[] = [];
  const dohServers: string[] = [];
  const doqServers: string[] = [];

  for (const rawEntry of [...(dns.defaultNameserver ?? []), ...(dns.nameserver ?? [])]) {
    const cleaned = sanitizeQuanxScalar(rawEntry).replace(/,/g, '').replace(/[;#]/g, '');
    if (!cleaned || cleaned === 'system') continue;
    if (/^https:\/\//i.test(cleaned)) {
      if (!dohServers.includes(cleaned)) dohServers.push(cleaned);
    } else if (/^quic:\/\//i.test(cleaned)) {
      if (!doqServers.includes(cleaned)) doqServers.push(cleaned);
    } else if (!/^(tls|h3):\/\//i.test(cleaned)) {
      if (!plainServers.includes(cleaned)) plainServers.push(cleaned);
    }
  }
  for (const server of plainServers) dnsLines.push(`server=${server}`);
  for (const doh of dohServers) dnsLines.push(`doh-server=${doh}`);
  for (const doq of doqServers) dnsLines.push(`doq-server=${doq}`);
  if (plainServers.length === 0 && dohServers.length === 0 && doqServers.length === 0) {
    dnsLines.push('server=223.5.5.5');
    dnsLines.push('server=119.29.29.29');
  }

  return { generalLines, dnsLines };
}

type QuanxSection = {
  header: string;
  lines: string[];
};

function applyQuanxIniPatch(sections: QuanxSection[], rawPatch: string, items: CompatibilityItem[]): void {
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
      currentHeader = `[${sanitizeQuanxScalar(headerMatch[1]!)}]`;
      continue;
    }

    if (!currentHeader) {
      if (!orphanWarned) {
        orphanWarned = true;
        items.push({
          code: 'INVALID_CLIENT_PATCH',
          severity: 'warning',
          message: 'Quantumult X 客户端补丁中存在未归属任何 [section] 的配置行，已忽略。',
        });
      }
      continue;
    }

    let section = sections.find((item) => item.header.toLowerCase() === currentHeader!.toLowerCase());
    if (!section) {
      section = { header: currentHeader, lines: [] };
      sections.push(section);
    }
    section.lines.push(sanitizeQuanxScalar(trimmed));
  }
}

/**
 * Compiles a template intermediate representation into either:
 * - **Safe default (`experimentalFullConfig !== true`)**: a `filter_remote`-importable
 *   rules-only resource (`filter.snippet` syntax) that never overwrites user
 *   `[server_remote]` node subscriptions (design §20).
 * - **Experimental full config (`experimentalFullConfig === true`)**: full Quantumult X
 *   INI profile with `[general]`, `[dns]`, `[policy]`, `[filter_local]`, `[filter_remote]`,
 *   marked unverified (`未经真机验证`) in the compatibility report.
 *
 * Pure function — no I/O, no wall-clock dependency.
 */
export function compileQuanx(input: CompileTemplateInput): CompiledConfigResult {
  const output: OutputProfile = input.output ?? input.body.output ?? 'full';
  const experimentalFullConfig = Boolean(input.experimentalFullConfig);
  const items: CompatibilityItem[] = [];
  const reportedRejectDrop = { warned: false };

  if (experimentalFullConfig) {
    items.push({
      code: 'EXPERIMENTAL_FULL_CONFIG_UNVERIFIED',
      severity: 'warning',
      message:
        '实验性完整配置（未经真机验证）：当前 Quantumult X 完整配置包含 [general]/[dns]/[policy]/[filter_local]/[filter_remote]，直接作为完整配置导入可能覆盖客户端已有 [server_remote] 节点订阅，请先备份并在真机验证。',
    });
  } else {
    items.push({
      code: 'RULES_ONLY_SAFE_DEFAULT',
      severity: 'info',
      message:
        '安全默认：Quantumult X 默认仅输出可由 [filter_remote] 导入的规则资源（filter.snippet 格式，不包含 [general]/[dns]/[policy]/[server_remote]），避免导入完整配置覆盖已有节点订阅；如需实验性完整配置，请在发布设置中开启（未经真机验证）。',
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
      client: 'quantumult-x',
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

  const hasExplicitPools = body.pools !== undefined;
  const bodyPools = getNormalizedBodyPools(body);
  const slotById = new Map(body.slots.map((slot) => [slot.id, slot]));
  const slotBindingMap = toSlotBindingMap(input.slotBindings);

  // 2. Allocate unique sanitized group names
  const usedGroupNames = new Set<string>();
  const cardGroupNameById = new Map<string, string>();
  const poolGroupNameById = new Map<string, string>();
  const declaredGroupNames: string[] = [];

  for (const card of enabledCards) {
    const original = card.effective.name;
    const sanitized = sanitizeQuanxGroupName(original, card.cardId);
    const unique = allocateUniqueName(
      sanitized,
      usedGroupNames,
      true,
      (finalName, reason) => {
        if (reason === 'sanitized' || reason === 'builtin-collision') {
          items.push({
            code: 'GROUP_NAME_SANITIZED',
            severity: 'info',
            message: `策略组名称「${sanitizeQuanxScalar(original)}」已规范化为「${finalName}」以符合 Quantumult X 语法。`,
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
    const sanitized = sanitizeQuanxGroupName(original, pool.id);
    const unique = allocateUniqueName(
      sanitized,
      usedGroupNames,
      true,
      (finalName, reason) => {
        if (reason === 'sanitized' || reason === 'builtin-collision') {
          items.push({
            code: 'GROUP_NAME_SANITIZED',
            severity: 'info',
            message: `${pool.kind === 'region' ? '地区策略组' : '节点池'}名称「${sanitizeQuanxScalar(original)}」已规范化为「${finalName}」以符合 Quantumult X 语法。`,
            location: poolCompatibilityLocation(pool, hasExplicitPools),
          });
        }
      },
      original,
    );
    poolGroupNameById.set(pool.id, unique);
    declaredGroupNames.push(unique);
  }

  // 3. Plan rulesets (QX is local-first: [filter_local] executes before [filter_remote])
  const plan = planRulesetReferences({
    cards: enabledCards,
    client: 'quantumult-x',
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
    if (!isRemoteFormatSupported('quantumult-x', provider.format, provider.behavior)) {
      items.push({
        code: 'UNSUPPORTED_REMOTE_FORMAT',
        severity: 'warning',
        message: `Quantumult X [filter_remote] 仅支持纯文本规则列表，规则集 ${provider.id} 的原始格式 ${provider.format} 可能需要转换后使用。`,
        location: { providerId: provider.id },
      });
    }
  }

  // 4. Build [policy] section only when experimentalFullConfig is enabled
  const policyLines: string[] = [];
  const slotMap = new Map(body.slots.map((slot) => [slot.id, slot]));

  const compilePolicyNodeFilter = (
    ownerName: string,
    nodeFilter: NodeFilter | undefined,
    excludeInfo: boolean,
    location: CompatibilityItem['location'],
  ): { serverTagRegex: string; twoStageComment?: string } => {
    const compiled = compileClientNodeFilter(nodeFilter, 'quantumult-x', { excludeInfo });
    for (const warning of compiled.warnings) {
      items.push({
        code: 'REGEX_DIALECT_WARNING',
        severity: 'warning',
        message: warning.message,
        location,
      });
    }
    const safeInclude = sanitizeQuanxRegexParam(compiled.includePattern);
    if (compiled.mode === 'two-stage') {
      items.push({
        code: 'REGEX_DEGRADED_TWO_STAGE',
        severity: 'warning',
        message: `Quantumult X 策略组「${ownerName}」${compiled.degradedReason ?? '已降级为包含/排除两段式筛选。'}`,
        location,
      });
      const excludeDesc = compiled.excludePattern
        ? sanitizeQuanxScalar(compiled.excludePattern)
        : compiled.excludeKeywords.slice(0, 8).join(', ');
      return {
        serverTagRegex: safeInclude,
        twoStageComment: `# Two-stage node filter (${ownerName}): include=${safeInclude} | exclude=${excludeDesc}`,
      };
    }
    return {
      serverTagRegex: sanitizeQuanxRegexParam(compiled.regex),
    };
  };

  if (experimentalFullConfig) {
    if (body.slots.length > 0) {
      items.push({
        code: 'UNSUPPORTED_CLIENT_FEATURE',
        severity: 'info',
        message:
          'Quantumult X 为客户端托管节点模式，本配置不写入 [server_remote] 订阅链接，策略组将通过 server-tag-regex 匹配客户端已有的节点订阅。',
      });
    }

    const defaultExcludeInfo = body.slots.some((slot) => slot.excludeInfo !== false);

    const buildPolicyEntry = (
      groupName: string,
      groupType: ResolvedTemplateCard['effective']['group']['type'],
      members: readonly string[],
      regexInfo: { serverTagRegex?: string; twoStageComment?: string },
      test: { url?: string; intervalSec?: number; toleranceMs?: number } | undefined,
      iconUrl: string | undefined,
      location: CompatibilityItem['location'],
    ): void => {
      const effectiveType = isGroupTypeSupported('quantumult-x', groupType) ? groupType : 'select';
      if (effectiveType !== groupType) {
        items.push({
          code: 'UNSUPPORTED_GROUP_TYPE',
          severity: 'warning',
          message: `Quantumult X 不支持策略组类型 ${groupType}，已降级为 static。`,
          location,
        });
      }

      if (regexInfo.twoStageComment) {
        policyLines.push(regexInfo.twoStageComment);
      }

      const constructorName =
        effectiveType === 'url-test'
          ? 'url-latency-benchmark'
          : effectiveType === 'fallback'
            ? 'available'
            : effectiveType === 'load-balance'
              ? 'dest-hash'
              : 'static';

      const parts: string[] = [`${constructorName}=${groupName}`, ...members];
      if (regexInfo.serverTagRegex) {
        parts.push(`server-tag-regex=${regexInfo.serverTagRegex}`);
      }
      if (effectiveType === 'url-test') {
        const interval = test?.intervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec;
        const tolerance = test?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 100;
        parts.push(`check-interval=${interval}`, `tolerance=${tolerance}`);
      }
      if (iconUrl) {
        parts.push(`img-url=${iconUrl}`);
      }
      policyLines.push(parts.join(', '));
    };

    // Card strategy groups
    for (const card of enabledCards) {
      const groupName = cardGroupNameById.get(card.cardId)!;
      const members: string[] = [];
      let regexInfo: { serverTagRegex?: string; twoStageComment?: string } = {};

      const pushUnique = (member: string) => {
        if (member && !members.includes(member)) members.push(member);
      };

      for (const ref of card.effective.group.candidates) {
        switch (ref.kind) {
          case 'builtin':
            pushUnique(mapQuanxBuiltinPolicy(ref.id, items, reportedRejectDrop, { cardId: card.cardId }));
            break;
          case 'card': {
            const target = cardGroupNameById.get(ref.cardId);
            if (!target) {
              items.push({
                code: 'MISSING_CARD_REFERENCE',
                severity: 'warning',
                message: `策略组引用的应用组件 ${ref.cardId} 未启用或不存在，已忽略。`,
                location: { cardId: ref.cardId },
              });
              break;
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
                location: ref.kind === 'pool' ? { poolId: targetId } : { regionGroupId: targetId },
              });
              break;
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
                location: { cardId: card.cardId, slotId: ref.slotId },
              });
              break;
            }
            if (!regexInfo.serverTagRegex) {
              regexInfo = compilePolicyNodeFilter(groupName, ref.filter, slot.excludeInfo !== false, {
                cardId: card.cardId,
                slotId: ref.slotId,
              });
            }
            break;
          }
        }
      }

      if (members.length === 0 && !regexInfo.serverTagRegex) {
        members.push('direct');
        items.push({
          code: 'GROUP_FALLBACK_DIRECT',
          severity: 'warning',
          message: `策略组「${groupName}」没有可用候选项，已自动兜底为 direct。`,
          location: { cardId: card.cardId },
        });
      }

      const iconUrl = resolveGroupIconUrl(
        {
          explicitIcon: card.effective.icon,
          name: card.effective.name,
          slug: card.effective.slug,
          category: card.effective.category,
          groupType: card.effectiveGroupType,
          matchers: card.effective.matchers,
        },
        input.iconPack,
      );

      buildPolicyEntry(groupName, card.effectiveGroupType, members, regexInfo, card.effective.group.test, iconUrl, {
        cardId: card.cardId,
      });
    }

    // Pool strategy groups (regions, providers, traits, all, stability)
    for (const pool of bodyPools) {
      const groupName = poolGroupNameById.get(pool.id)!;
      const location = poolCompatibilityLocation(pool, hasExplicitPools);
      let members: string[] = [];
      let regexInfo: { serverTagRegex?: string; twoStageComment?: string } = {};

      if (pool.kind === 'stability') {
        members = resolveStabilityPoolMembers(pool, poolGroupNameById, items, hasExplicitPools);
        if (members.length === 0) {
          items.push({
            code: 'EMPTY_POOL_FALLBACK_ALL',
            severity: 'warning',
            message: `稳定性节点池「${groupName}」无可用成员池，已退化为引用全部节点。`,
            location,
          });
          regexInfo = compilePolicyNodeFilter(groupName, undefined, defaultExcludeInfo, location);
        }
      } else {
        const emptyProtection = evaluatePoolEmptyProtection({
          pool,
          client: 'quantumult-x',
          slots: body.slots,
          slotById,
          slotBindings: slotBindingMap,
        });
        if (emptyProtection.fallbackToAll) {
          items.push({
            code: 'EMPTY_POOL_FALLBACK_ALL',
            severity: 'warning',
            message: emptyProtection.message ?? `节点池「${groupName}」已退化为引用全部节点。`,
            location,
          });
        }
        const nodeFilter = emptyProtection.fallbackToAll ? undefined : poolToNodeFilter(pool);
        regexInfo = compilePolicyNodeFilter(groupName, nodeFilter, defaultExcludeInfo, location);
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
      buildPolicyEntry(groupName, pool.type, members, regexInfo, pool.test, iconUrl, location);
    }
  }

  // 5. Compile [filter_local] & [filter_remote]
  const bindingMap = new Map<string, PlannedMatcherBinding>();
  for (const binding of plan.bindings) {
    bindingMap.set(`${binding.cardId}:${binding.matcherIndex}`, binding);
  }

  const localFilterLines: string[] = [];
  const remoteFilterLines: string[] = [];
  const emittedRemoteKeys = new Set<string>();
  let skippedRules = 0;
  let activeRuleProviders = 0;
  const countedProviderIds = new Set<string>();

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
        const name = sanitizeQuanxRuleValue(matcher.name).toLowerCase();
        if (name) {
          localFilterLines.push(`geoip, ${name}, ${policyName}`);
        }
        return;
      }

      if (matcher.kind === 'inline') {
        for (const cond of matcher.conditions) {
          const line = compileQuanxCondition(cond, policyName, card.cardId, items);
          if (line) {
            localFilterLines.push(line);
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

        if (binding.inlinedForPriority || provider.inlineForPriority) {
          if (payload && payload.length > 0) {
            localFilterLines.push(`# Inlined for priority: ${provider.id} -> ${policyName}`);
            for (const rawLine of payload) {
              const converted = convertPayloadLineToQuanxRule(rawLine, provider.behavior, policyName);
              if (converted) {
                localFilterLines.push(converted);
              }
            }
          } else {
            const urlHint = remoteUrl ? sanitizeQuanxUrl(remoteUrl) : '未提供 URL';
            localFilterLines.push(`# [Inlined Remote Filter Required] ${provider.id} (${urlHint}) -> ${policyName}`);
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
            message: `规则集 ${provider.id} 未提供 baseUrl，已跳过该 [filter_remote] 条目。`,
            location: { cardId: card.cardId, providerId: provider.id },
          });
          skippedRules += 1;
          continue;
        }

        const safeUrl = sanitizeQuanxUrl(remoteUrl);
        const dedupeEntry = `${safeUrl}|${policyName}`;
        if (!emittedRemoteKeys.has(dedupeEntry)) {
          emittedRemoteKeys.add(dedupeEntry);
          const tag = sanitizeQuanxGroupName(`${provider.id}-${card.cardId}`, provider.id);
          remoteFilterLines.push(
            `${safeUrl}, tag=${tag}, force-policy=${policyName}, update-interval=${provider.updateIntervalSec}, opt-parser=false, enabled=true`,
          );
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
    if (finalRef.kind === 'builtin') {
      return mapQuanxBuiltinPolicy(finalRef.id, items, reportedRejectDrop);
    }
    if (finalRef.kind === 'card') {
      const target = cardGroupNameById.get(finalRef.cardId);
      if (target) return target;
      items.push({
        code: 'MISSING_CARD_REFERENCE',
        severity: 'warning',
        message: `兜底出口引用的组件 ${finalRef.cardId} 未启用或不存在，已回退为 direct。`,
        location: { cardId: finalRef.cardId },
      });
      return 'direct';
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
            ? `兜底出口引用的节点池 ${targetId} 不存在，已回退为 direct。`
            : `兜底出口引用的地区组 ${targetId} 不存在，已回退为 direct。`,
        location: finalRef.kind === 'pool' ? { poolId: targetId } : { regionGroupId: targetId },
      });
      return 'direct';
    }
    return declaredGroupNames[0] ?? 'direct';
  };

  const finalPolicy = resolveFinalPolicy(body.final);

  // 7. Serialize output
  const headerLines: string[] = [
    '# Generated by Private Rules (Quantumult X)',
    experimentalFullConfig
      ? '# Mode: Experimental Full Config (未经真机验证 — 导入完整配置可能覆盖已有 [server_remote] 订阅)'
      : '# Mode: filter_remote Rules-Only Resource (Safe Default — 仅规则资源，不覆盖已有节点订阅)',
  ];
  if (input.templateName) headerLines.push(`# Template: ${sanitizeQuanxScalar(input.templateName)}`);
  headerLines.push(`# Output: ${output}`);
  if (input.generatedAt) headerLines.push(`# UPDATED: ${sanitizeQuanxScalar(input.generatedAt)}`);

  let content: string;
  let ruleCount = localFilterLines.filter((line) => !line.startsWith('#')).length;

  if (!experimentalFullConfig) {
    // Safe default: filter_remote-importable snippet (no [general]/[dns]/[policy]/[server_remote])
    const bodyLines: string[] = [...headerLines, ''];
    if (localFilterLines.length > 0) {
      bodyLines.push(...localFilterLines);
    }
    if (remoteFilterLines.length > 0) {
      bodyLines.push('', '# [filter_remote] 以下远程分流列表请按需添加到 Quantumult X 的 [filter_remote] 段：');
      for (const remoteLine of remoteFilterLines) {
        bodyLines.push(`# ${remoteLine}`);
      }
    }
    bodyLines.push(
      '',
      `# Default Final Policy (请在 Quantumult X 主配置 [filter_local] 中保持兜底): ${QX_CAPS.finalRuleKeyword}, ${finalPolicy}`,
    );
    content = `${bodyLines.join('\n')}\n`;
  } else {
    localFilterLines.push(`${QX_CAPS.finalRuleKeyword}, ${finalPolicy}`);
    ruleCount += 1;

    const sections: QuanxSection[] = [];
    if (output === 'full') {
      const { generalLines, dnsLines } = compileQuanxGeneralAndDns(body.dns, body.general, items);
      sections.push({ header: '[general]', lines: generalLines });
      sections.push({ header: '[dns]', lines: dnsLines });
    } else {
      items.push({
        code: 'MINIMAL_OMITTED_SECTIONS',
        severity: 'info',
        message: '最小模式（minimal）已省略 [general] 与 [dns] 配置段。',
      });
    }

    sections.push({
      header: '[policy]',
      lines: policyLines,
    });

    sections.push({
      header: '[filter_local]',
      lines: localFilterLines,
    });

    if (remoteFilterLines.length > 0) {
      sections.push({
        header: '[filter_remote]',
        lines: remoteFilterLines,
      });
    }

    if (body.clientPatches?.['quantumult-x']?.trim()) {
      applyQuanxIniPatch(sections, body.clientPatches['quantumult-x'], items);
    }

    const renderedSections = sections
      .filter((section) => section.lines.length > 0)
      .map((section) => `${section.header}\n${section.lines.join('\n')}`);
    content = `${headerLines.join('\n')}\n\n${renderedSections.join('\n\n')}\n`;
  }

  return {
    client: 'quantumult-x',
    output,
    contentType: 'text/plain; charset=utf-8',
    extension: '.conf',
    content,
    report: {
      client: 'quantumult-x',
      output,
      items,
      stats: {
        proxyProviders: 0,
        inlineProxies: 0,
        proxyGroups: experimentalFullConfig ? policyLines.filter((line) => !line.startsWith('#')).length : 0,
        ruleProviders: activeRuleProviders,
        rules: ruleCount,
        skippedRules,
        appliedModules,
        skippedModules,
      },
    },
  };
}
