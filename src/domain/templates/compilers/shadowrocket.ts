import type { OutputProfile } from '../../../shared/clients';
import type { Condition, NodeFilter, PolicyRef } from '../../../shared/schemas/card';
import type { DnsProfile, TemplateBody } from '../../../shared/schemas/template';
import { compileClientNodeFilter } from '../../nodes';
import {
  CLIENT_CAPABILITIES,
  isGroupTypeSupported,
  isRemoteFormatSupported,
  isRuleTypeSupported,
} from '../capabilities';
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
 * Shadowrocket compiler (design §10.6, §10.11–10.13, §11).
 *
 * Official docs audited:
 * - https://shadowlaunch.com/
 * - https://github.com/LOWERTOP/Shadowrocket/blob/master/README.md
 * - https://github.com/LOWERTOP/Shadowrocket/blob/master/lazy_group.conf (v2.2.x)
 */

const SR_CAPS = CLIENT_CAPABILITIES.shadowrocket;

const DEFAULT_SR_SKIP_PROXY = ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '127.0.0.1', 'localhost', '*.local'];
const DEFAULT_SR_TUN_EXCLUDED_ROUTES = [
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
const MAX_SR_LOGICAL_DEPTH = 10;

// eslint-disable-next-line no-control-regex
const CONTROL_AND_LINE_BREAK_RE = /[\r\n\u2028\u2029\x00-\x1f\x7f]+/g;

/**
 * Strips CR/LF/Unicode line separators and ASCII control characters from any
 * scalar emitted into a Shadowrocket INI profile (blocks `[Section]` injection).
 */
export function sanitizeShadowrocketScalar(raw: string): string {
  return raw.replace(CONTROL_AND_LINE_BREAK_RE, ' ').trim();
}

/**
 * Sanitizes a Shadowrocket `[Proxy Group]` name against INI section injection,
 * `=` / `,` delimiter breaks, quotes, and inline comment starters (`#`, `;`, `//`).
 */
export function sanitizeShadowrocketGroupName(raw: string, fallback = 'ProxyGroup'): string {
  const cleaned = sanitizeShadowrocketScalar(raw)
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
 * Sanitizes a Shadowrocket node name against INI syntax & rule injection.
 */
export function sanitizeShadowrocketNodeName(raw: string, fallback = 'Node'): string {
  return sanitizeShadowrocketGroupName(raw, fallback);
}

/**
 * Sanitizes a URL emitted into Shadowrocket `RULE-SET,<url>,...` or `url=...`.
 */
export function sanitizeShadowrocketUrl(raw: string): string {
  return sanitizeShadowrocketScalar(raw)
    .replace(/\s+/g, '')
    .replace(/,/g, '%2C')
    .replace(/"/g, '%22')
    .replace(/;/g, '%3B')
    .replace(/#/g, '%23');
}

/**
 * Sanitizes a Shadowrocket rule value so it cannot inject extra comma fields or comments.
 */
export function sanitizeShadowrocketRuleValue(raw: string): string {
  return sanitizeShadowrocketScalar(raw).replace(/,/g, '').replace(/[;#]/g, '').replace(/\/\//g, '').trim();
}

/**
 * Quotes or escapes a Shadowrocket parameter value when it contains commas,
 * whitespace, quotes, or comment characters.
 */
export function quoteShadowrocketParam(raw: string, forceQuote = false): string {
  const cleaned = sanitizeShadowrocketScalar(raw);
  const needsQuote = forceQuote || /[,"\s=;#]/.test(cleaned) || cleaned.includes('//');
  if (!needsQuote) return cleaned;
  const escaped = cleaned.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function sanitizeShadowrocketRegexParam(raw: string): string {
  return sanitizeShadowrocketScalar(raw).replace(/,/g, '\\x2c').replace(/[;#]/g, '');
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

  if (avoidBuiltins && SR_CAPS.builtinPolicies.has(candidate.toUpperCase())) {
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

function formatShadowrocketRuleValue(type: string, rawValue: string): string {
  if (type === 'URL-REGEX' || type === 'USER-AGENT') {
    return sanitizeShadowrocketScalar(rawValue).replace(/,/g, '');
  }
  const value = sanitizeShadowrocketRuleValue(rawValue);
  if (type === 'GEOIP') return value.toUpperCase();
  return value;
}

type CompiledSrConditionExpr = {
  inner: string;
  leafParts?: {
    type: string;
    value: string;
    noResolve: boolean;
  };
};

function compileShadowrocketConditionExpr(
  cond: Condition,
  cardId: string,
  depth: number,
  items: CompatibilityItem[],
): CompiledSrConditionExpr | null {
  if (depth > MAX_SR_LOGICAL_DEPTH) {
    items.push({
      code: 'UNSUPPORTED_LOGICAL_RULE',
      severity: 'warning',
      message: `Shadowrocket 逻辑规则嵌套深度超过上限（${MAX_SR_LOGICAL_DEPTH} 层），已跳过该条规则。`,
      location: { cardId },
    });
    return null;
  }

  if (cond.op === 'rule') {
    const { type, value, options } = cond.rule;
    if (!isRuleTypeSupported('shadowrocket', type)) {
      items.push({
        code: 'UNSUPPORTED_RULE_TYPE',
        severity: 'warning',
        message: `Shadowrocket 不支持规则类型 ${type}（值：${sanitizeShadowrocketScalar(value)}），已跳过该条规则。`,
        location: { cardId },
      });
      return null;
    }

    const formattedValue = formatShadowrocketRuleValue(type, value);
    if (!formattedValue) return null;

    // Shadowrocket IP-CIDR matches both IPv4 and IPv6
    const aliasedType = SR_CAPS.ruleTypeAliases[type] ?? type;
    const emittedType = type === 'IP-CIDR' && formattedValue.includes(':') ? SR_CAPS.ipV6RuleType : aliasedType;
    const noResolve = Boolean(options?.noResolve && SR_CAPS.noResolveRuleTypes.has(type));
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
    const sub = compileShadowrocketConditionExpr(cond.item, cardId, depth + 1, items);
    if (!sub) {
      items.push({
        code: 'UNSUPPORTED_LOGICAL_RULE',
        severity: 'warning',
        message: 'Shadowrocket 逻辑规则 NOT 包含不受支持的子条件，已跳过整条逻辑规则。',
        location: { cardId },
      });
      return null;
    }
    return { inner: `NOT,((${sub.inner}))` };
  }

  const compiledChildren: CompiledSrConditionExpr[] = [];
  for (const child of cond.items) {
    const compiled = compileShadowrocketConditionExpr(child, cardId, depth + 1, items);
    if (!compiled) {
      items.push({
        code: 'UNSUPPORTED_LOGICAL_RULE',
        severity: 'warning',
        message: `Shadowrocket 逻辑规则 ${cond.op.toUpperCase()} 包含不受支持的子条件，已跳过整条逻辑规则。`,
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

function compileShadowrocketTopLevelCondition(
  cond: Condition,
  policyName: string,
  cardId: string,
  items: CompatibilityItem[],
): string | null {
  const expr = compileShadowrocketConditionExpr(cond, cardId, 0, items);
  if (!expr) return null;
  if (expr.leafParts) {
    const { type, value, noResolve } = expr.leafParts;
    return noResolve ? `${type},${value},${policyName},no-resolve` : `${type},${value},${policyName}`;
  }
  return `${expr.inner},${policyName}`;
}

function normalizeSrRealIp(entry: string): string {
  const cleaned = sanitizeShadowrocketScalar(entry).replace(/,/g, '').replace(/[;#]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+.')) return `*.${cleaned.slice(2)}`;
  if (cleaned.startsWith('.')) return `*.${cleaned.slice(1)}`;
  return cleaned;
}

function compileShadowrocketGeneralSection(
  dns: DnsProfile,
  general: TemplateBody['general'],
  items: CompatibilityItem[],
): string[] {
  if (dns.mode === 'redir-host') {
    items.push({
      code: 'UNSUPPORTED_DNS_OPTION',
      severity: 'warning',
      message: 'Shadowrocket 不支持 Clash 风格的 redir-host DNS 模式，已忽略该项。',
    });
  }
  if (dns.respectRules) {
    items.push({
      code: 'UNSUPPORTED_DNS_OPTION',
      severity: 'warning',
      message: 'Shadowrocket 不支持 Clash 风格的 dns.respect-rules 开关，已忽略该项。',
    });
  }

  const lines: string[] = [
    'bypass-system = true',
    `skip-proxy = ${DEFAULT_SR_SKIP_PROXY.join(', ')}`,
    `tun-excluded-routes = ${DEFAULT_SR_TUN_EXCLUDED_ROUTES.join(', ')}`,
    `ipv6 = ${general?.ipv6 ? 'true' : 'false'}`,
    'prefer-ipv6 = false',
    'icmp-auto-reply = true',
    'private-ip-answer = true',
  ];

  const primaryDns: string[] = [];
  const fallbackDns: string[] = [];

  for (const rawEntry of [...(dns.defaultNameserver ?? []), ...(dns.nameserver ?? [])]) {
    const cleaned = sanitizeShadowrocketScalar(rawEntry).replace(/,/g, '').replace(/[;#]/g, '');
    if (!cleaned) continue;
    if (!primaryDns.includes(cleaned)) primaryDns.push(cleaned);
  }
  for (const rawEntry of dns.fallback ?? []) {
    const cleaned = sanitizeShadowrocketScalar(rawEntry).replace(/,/g, '').replace(/[;#]/g, '');
    if (!cleaned) continue;
    if (!fallbackDns.includes(cleaned)) fallbackDns.push(cleaned);
  }
  if (!primaryDns.includes('system')) {
    primaryDns.push('system');
  }

  lines.push(`dns-server = ${primaryDns.join(', ')}`);
  if (fallbackDns.length > 0) {
    lines.push(`fallback-dns-server = ${fallbackDns.join(', ')}`);
  }

  if (dns.fakeIpFilter && dns.fakeIpFilter.length > 0) {
    const realIpList = [...new Set(dns.fakeIpFilter.map(normalizeSrRealIp).filter(Boolean))];
    if (realIpList.length > 0) {
      lines.push(`always-real-ip = ${realIpList.join(', ')}`);
    }
  }

  return lines;
}

type SrSection = {
  header: string;
  lines: string[];
};

function applyShadowrocketIniPatch(sections: SrSection[], rawPatch: string, items: CompatibilityItem[]): void {
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
      currentHeader = `[${sanitizeShadowrocketScalar(headerMatch[1]!)}]`;
      continue;
    }

    if (!currentHeader) {
      if (!orphanWarned) {
        orphanWarned = true;
        items.push({
          code: 'INVALID_CLIENT_PATCH',
          severity: 'warning',
          message: 'Shadowrocket 客户端补丁中存在未归属任何 [Section] 的配置行，已忽略。',
        });
      }
      continue;
    }

    let section = sections.find((item) => item.header.toLowerCase() === currentHeader!.toLowerCase());
    if (!section) {
      section = { header: currentHeader, lines: [] };
      sections.push(section);
    }
    section.lines.push(sanitizeShadowrocketScalar(trimmed));
  }
}

/**
 * Compiles a template intermediate representation into a full Shadowrocket INI
 * configuration (`.conf`). Shadowrocket stores proxy nodes in its own database
 * separately from `.conf`, so emitting full config (`[General]`, `[Proxy Group]`,
 * `[Rule]`) does not overwrite existing client subscriptions.
 *
 * Pure function — no I/O, no wall-clock dependency.
 */
export function compileShadowrocket(input: CompileTemplateInput): CompiledConfigResult {
  const output: OutputProfile = input.output ?? input.body.output ?? 'full';
  const items: CompatibilityItem[] = [];

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
      client: 'shadowrocket',
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

  const hasExplicitPools = body.pools !== undefined;
  const bodyPools = getNormalizedBodyPools(body);
  const slotBindingMap = toSlotBindingMap(input.slotBindings);

  // 2. Allocate unique sanitized group names
  const usedGroupNames = new Set<string>();
  const cardGroupNameById = new Map<string, string>();
  const poolGroupNameById = new Map<string, string>();
  const declaredGroupNames: string[] = [];

  for (const card of enabledCards) {
    const original = card.effective.name;
    const sanitized = sanitizeShadowrocketGroupName(original, card.cardId);
    const unique = allocateUniqueName(
      sanitized,
      usedGroupNames,
      true,
      (finalName, reason) => {
        if (reason === 'sanitized' || reason === 'builtin-collision') {
          items.push({
            code: 'GROUP_NAME_SANITIZED',
            severity: 'info',
            message: `策略组名称「${sanitizeShadowrocketScalar(original)}」已规范化为「${finalName}」以符合 Shadowrocket INI 语法。`,
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
    const sanitized = sanitizeShadowrocketGroupName(original, pool.id);
    const unique = allocateUniqueName(
      sanitized,
      usedGroupNames,
      true,
      (finalName, reason) => {
        if (reason === 'sanitized' || reason === 'builtin-collision') {
          items.push({
            code: 'GROUP_NAME_SANITIZED',
            severity: 'info',
            message: `${pool.kind === 'region' ? '地区策略组' : '节点池'}名称「${sanitizeShadowrocketScalar(original)}」已规范化为「${finalName}」以符合 Shadowrocket INI 语法。`,
            location: poolCompatibilityLocation(pool, hasExplicitPools),
          });
        }
      },
      original,
    );
    poolGroupNameById.set(pool.id, unique);
    declaredGroupNames.push(unique);
  }

  // 3. Build [Proxy Group]
  const proxyGroupLines: string[] = [];
  const slotMap = new Map(body.slots.map((slot) => [slot.id, slot]));
  const defaultExcludeInfo = body.slots.some((slot) => slot.excludeInfo !== false);

  const compileSrNodeFilter = (
    ownerName: string,
    nodeFilter: NodeFilter | undefined,
    excludeInfo: boolean,
    location: CompatibilityItem['location'],
  ): { regexParam: string; twoStageComment?: string } => {
    const compiled = compileClientNodeFilter(nodeFilter, 'shadowrocket', { excludeInfo });
    for (const warning of compiled.warnings) {
      items.push({
        code: 'REGEX_DIALECT_WARNING',
        severity: 'warning',
        message: warning.message,
        location,
      });
    }
    if (compiled.mode === 'two-stage') {
      items.push({
        code: 'REGEX_DEGRADED_TWO_STAGE',
        severity: 'warning',
        message: `Shadowrocket 策略组「${ownerName}」${compiled.degradedReason ?? '已降级为包含/排除两段式筛选。'}`,
        location,
      });
      const safeInclude = sanitizeShadowrocketRegexParam(compiled.includePattern);
      const excludeDesc = compiled.excludePattern
        ? sanitizeShadowrocketScalar(compiled.excludePattern)
        : compiled.excludeKeywords.slice(0, 8).join(', ');
      return {
        regexParam: safeInclude,
        twoStageComment: `# Two-stage node filter (${ownerName}): include=${safeInclude} | exclude=${excludeDesc}`,
      };
    }
    return {
      regexParam: sanitizeShadowrocketRegexParam(compiled.regex),
    };
  };

  const emitGroupLine = (
    groupName: string,
    groupType: ResolvedTemplateCard['effective']['group']['type'],
    members: readonly string[],
    filterInfo: { regexParam?: string; twoStageComment?: string },
    test: { url?: string; intervalSec?: number; toleranceMs?: number } | undefined,
    location: CompatibilityItem['location'],
  ): void => {
    const effectiveType = isGroupTypeSupported('shadowrocket', groupType) ? groupType : 'select';
    if (effectiveType !== groupType) {
      items.push({
        code: 'UNSUPPORTED_GROUP_TYPE',
        severity: 'warning',
        message: `Shadowrocket 不支持策略组类型 ${groupType}，已降级为 select。`,
        location,
      });
    }

    if (filterInfo.twoStageComment) {
      proxyGroupLines.push(filterInfo.twoStageComment);
    }

    const testUrl = sanitizeShadowrocketUrl(test?.url ?? body.general?.testUrl ?? DEFAULT_HEALTH_CHECK.url);
    const interval = test?.intervalSec ?? DEFAULT_HEALTH_CHECK.intervalSec;
    const tolerance = test?.toleranceMs ?? DEFAULT_HEALTH_CHECK.toleranceMs ?? 100;

    const parts: string[] = [effectiveType, ...members];
    if (filterInfo.regexParam) {
      parts.push(`policy-regex-filter=${filterInfo.regexParam}`);
    }
    if (effectiveType === 'url-test') {
      parts.push(`url=${testUrl}`, `interval=${interval}`, `tolerance=${tolerance}`);
    } else if (effectiveType === 'fallback' || effectiveType === 'load-balance') {
      parts.push(`url=${testUrl}`, `interval=${interval}`, 'timeout=5');
    }
    proxyGroupLines.push(`${groupName} = ${parts.join(', ')}`);
  };

  // Card strategy groups
  for (const card of enabledCards) {
    const groupName = cardGroupNameById.get(card.cardId)!;
    const members: string[] = [];
    let filterInfo: { regexParam?: string; twoStageComment?: string } = {};
    const pushUnique = (member: string) => {
      if (member && !members.includes(member)) members.push(member);
    };

    for (const ref of card.effective.group.candidates) {
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
          if (!filterInfo.regexParam) {
            filterInfo = compileSrNodeFilter(groupName, ref.filter, slot.excludeInfo !== false, {
              cardId: card.cardId,
              slotId: ref.slotId,
            });
          }
          break;
        }
      }
    }

    if (members.length === 0 && !filterInfo.regexParam) {
      members.push('DIRECT');
      items.push({
        code: 'GROUP_FALLBACK_DIRECT',
        severity: 'warning',
        message: `策略组「${groupName}」没有可用候选项，已自动兜底为 DIRECT。`,
        location: { cardId: card.cardId },
      });
    }

    emitGroupLine(groupName, card.effectiveGroupType, members, filterInfo, card.effective.group.test, {
      cardId: card.cardId,
    });
  }

  // Pool strategy groups (regions, providers, traits, all, stability)
  for (const pool of bodyPools) {
    const groupName = poolGroupNameById.get(pool.id)!;
    const location = poolCompatibilityLocation(pool, hasExplicitPools);
    let members: string[] = [];
    let filterInfo: { regexParam?: string; twoStageComment?: string } = {};

    if (pool.kind === 'stability') {
      members = resolveStabilityPoolMembers(pool, poolGroupNameById, items, hasExplicitPools);
      if (members.length === 0) {
        items.push({
          code: 'EMPTY_POOL_FALLBACK_ALL',
          severity: 'warning',
          message: `稳定性节点池「${groupName}」无可用成员池，已退化为引用全部节点。`,
          location,
        });
        filterInfo = compileSrNodeFilter(groupName, undefined, defaultExcludeInfo, location);
      }
    } else {
      const emptyProtection = evaluatePoolEmptyProtection({
        pool,
        client: 'shadowrocket',
        slots: body.slots,
        slotById: slotMap,
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
      filterInfo = compileSrNodeFilter(groupName, nodeFilter, defaultExcludeInfo, location);
    }

    emitGroupLine(groupName, pool.type, members, filterInfo, pool.test, location);
  }

  // 4. Plan and compile [Rule] in strict top-to-bottom order
  const plan = planRulesetReferences({
    cards: enabledCards,
    client: 'shadowrocket',
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

  const providerById = new Map<string, PlannedProvider>();
  for (const provider of plan.providers) {
    providerById.set(provider.id, provider);
    if (!isRemoteFormatSupported('shadowrocket', provider.format, provider.behavior)) {
      items.push({
        code: 'UNSUPPORTED_REMOTE_FORMAT',
        severity: 'warning',
        message: `Shadowrocket RULE-SET 仅支持纯文本规则列表，规则集 ${provider.id} 的原始格式 ${provider.format} 可能需要转换后使用。`,
        location: { providerId: provider.id },
      });
    }
  }

  const bindingMap = new Map<string, PlannedMatcherBinding>();
  for (const binding of plan.bindings) {
    bindingMap.set(`${binding.cardId}:${binding.matcherIndex}`, binding);
  }

  const rules: string[] = [];
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
        const name = sanitizeShadowrocketRuleValue(matcher.name).toUpperCase();
        if (name) {
          rules.push(matcher.noResolve ? `GEOIP,${name},${policyName},no-resolve` : `GEOIP,${name},${policyName}`);
        }
        return;
      }

      if (matcher.kind === 'inline') {
        for (const cond of matcher.conditions) {
          const line = compileShadowrocketTopLevelCondition(cond, policyName, card.cardId, items);
          if (line) {
            rules.push(line);
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
        if (!remoteUrl) {
          items.push({
            code: 'MISSING_RULESET_URL',
            severity: 'warning',
            message: `规则集 ${provider.id} 未提供 baseUrl，已跳过该 RULE-SET 引用。`,
            location: { cardId: card.cardId, providerId: provider.id },
          });
          skippedRules += 1;
          continue;
        }
        if (!countedProviderIds.has(providerId)) {
          countedProviderIds.add(providerId);
          activeRuleProviders += 1;
        }
        rules.push(`RULE-SET,${sanitizeShadowrocketUrl(remoteUrl)},${policyName}`);
      }
    });
  }

  // 5. Final catch-all policy
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
  rules.push(`${SR_CAPS.finalRuleKeyword},${finalPolicy}`);

  // 6. Assemble sections
  const sections: SrSection[] = [];
  if (output === 'full') {
    sections.push({
      header: '[General]',
      lines: compileShadowrocketGeneralSection(body.dns, body.general, items),
    });
  } else {
    items.push({
      code: 'MINIMAL_OMITTED_SECTIONS',
      severity: 'info',
      message: '最小模式（minimal）已省略 [General] 基础与 DNS 配置段。',
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

  if (body.clientPatches?.shadowrocket?.trim()) {
    applyShadowrocketIniPatch(sections, body.clientPatches.shadowrocket, items);
  }

  const headerLines: string[] = ['# Generated by Private Rules (Shadowrocket)'];
  if (input.templateName) headerLines.push(`# Template: ${sanitizeShadowrocketScalar(input.templateName)}`);
  headerLines.push(`# Output: ${output}`);
  if (input.generatedAt) headerLines.push(`# UPDATED: ${sanitizeShadowrocketScalar(input.generatedAt)}`);

  const renderedSections = sections
    .filter((section) => section.lines.length > 0)
    .map((section) => `${section.header}\n${section.lines.join('\n')}`);
  const content = `${headerLines.join('\n')}\n\n${renderedSections.join('\n\n')}\n`;

  return {
    client: 'shadowrocket',
    output,
    contentType: 'text/plain; charset=utf-8',
    extension: '.conf',
    content,
    report: {
      client: 'shadowrocket',
      output,
      items,
      stats: {
        proxyProviders: 0,
        inlineProxies: 0,
        proxyGroups: proxyGroupLines.filter((line) => !line.startsWith('#')).length,
        ruleProviders: activeRuleProviders,
        rules: rules.length,
        skippedRules,
        appliedModules,
        skippedModules,
      },
    },
  };
}
