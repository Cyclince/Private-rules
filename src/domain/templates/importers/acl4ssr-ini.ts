import type {
  AppCard,
  GroupHealthCheck,
  GroupType,
  Matcher,
  PolicyRef,
  RemoteRuleBehavior,
} from '../../../shared/schemas/card';
import type { RegionGroup, TemplateBody, TemplateCardRef } from '../../../shared/schemas/template';
import { recognizeGroupIcon } from '../icons';
import { DEFAULT_HEALTH_CHECK } from '../model';
import {
  allocateUniqueId,
  detectSingleRegionForGroup,
  inferCardCategory,
  inferImportedCardStage,
  inferRemoteBehaviorFromUrl,
  inferRemoteFormatFromUrl,
  makeDeterministicSlug,
  parseBuiltinPolicy,
  parseGroupType,
  parseInlineRuleParts,
} from './shared';
import type { ImportCompatibilityItem, ImportedTemplateResult, ImportTemplateOptions } from './types';

type ParsedIniGroup = {
  rawName: string;
  type: GroupType;
  rawMembers: string[];
  test?: GroupHealthCheck;
  lineNumber: number;
};

type ParsedIniRuleset = {
  targetGroup: string;
  matcher?: Matcher;
  isFinal?: boolean;
  lineNumber: number;
};

const DEFAULT_SLOT_ID = 'slot-main';

function parseHealthCheckTiming(timingToken: string): { intervalSec: number; toleranceMs?: number } | null {
  const parts = timingToken.split(',').map((s) => s.trim());
  const interval = Number(parts[0]);
  if (!Number.isInteger(interval) || interval <= 0) return null;
  const toleranceRaw = parts[2];
  const tolerance = toleranceRaw !== undefined && toleranceRaw !== '' ? Number(toleranceRaw) : undefined;
  return {
    intervalSec: Math.min(interval, 86_400),
    ...(tolerance !== undefined && Number.isInteger(tolerance) && tolerance >= 0
      ? { toleranceMs: Math.min(tolerance, 10_000) }
      : {}),
  };
}

function parseRulesetLine(
  value: string,
  lineNumber: number,
  rawLine: string,
  items: ImportCompatibilityItem[],
): ParsedIniRuleset | null {
  const commaIdx = value.indexOf(',');
  if (commaIdx <= 0) {
    items.push({
      severity: 'warning',
      code: 'INI_MALFORMED_RULESET',
      source: `line:${lineNumber}`,
      raw: rawLine,
      message: `第 ${lineNumber} 行 ruleset 格式无效，已记录到兼容性报告。`,
    });
    return null;
  }

  const targetGroup = value.slice(0, commaIdx).trim();
  const spec = value.slice(commaIdx + 1).trim();
  if (!targetGroup || !spec) {
    items.push({
      severity: 'warning',
      code: 'INI_MALFORMED_RULESET',
      source: `line:${lineNumber}`,
      raw: rawLine,
      message: `第 ${lineNumber} 行 ruleset 缺少目标组或规则来源。`,
    });
    return null;
  }

  // Inline / built-in `[]...` syntax
  if (spec.startsWith('[]')) {
    const inner = spec.slice(2).trim();
    const upper = inner.toUpperCase();
    if (upper === 'FINAL' || upper === 'MATCH') {
      return { targetGroup, isFinal: true, lineNumber };
    }

    const parts = inner.split(',').map((s) => s.trim());
    const head = parts[0]?.toUpperCase() ?? '';

    if (head === 'GEOSITE' && parts[1]) {
      return {
        targetGroup,
        matcher: { kind: 'geosite', name: parts[1] },
        lineNumber,
      };
    }

    if (head === 'GEOIP' && parts[1]) {
      const noResolve = parts.slice(2).some((opt) => opt.toLowerCase() === 'no-resolve');
      return {
        targetGroup,
        matcher: { kind: 'geoip', name: parts[1], ...(noResolve ? { noResolve: true } : {}) },
        lineNumber,
      };
    }

    // Inline standard rule (e.g. `[]DOMAIN-SUFFIX,example.com`, `[]IP-CIDR,1.2.3.4/32,no-resolve`)
    if (parts.length >= 2) {
      const noResolve = parts.slice(2).some((opt) => opt.toLowerCase() === 'no-resolve');
      const rule = parseInlineRuleParts(parts[0], parts[1], noResolve);
      if (rule) {
        return {
          targetGroup,
          matcher: { kind: 'inline', conditions: [{ op: 'rule', rule }] },
          lineNumber,
        };
      }
    }

    items.push({
      severity: 'warning',
      code: 'INI_UNSUPPORTED_INLINE_RULE',
      source: `line:${lineNumber}`,
      raw: rawLine,
      message: `第 ${lineNumber} 行包含无法识别的内置规则「${spec}」，已写入兼容性报告。`,
    });
    return null;
  }

  // Remote ruleset with optional prefix (`clash-domain:`, `clash-ipcidr:`, `clash-classic:`, `surge:`, `quanx:`)
  // and optional trailing `,intervalSec`
  let remaining = spec;
  let updateIntervalSec: number | undefined;
  const intervalMatch = /^(.*),(\d+)$/.exec(remaining);
  if (intervalMatch) {
    const parsedInterval = Number(intervalMatch[2]);
    if (Number.isInteger(parsedInterval) && parsedInterval >= 60 && parsedInterval <= 604_800) {
      remaining = intervalMatch[1].trim();
      updateIntervalSec = parsedInterval;
    }
  }

  let explicitBehavior: RemoteRuleBehavior | undefined;
  const prefixMatch = /^(clash-domain|clash-ipcidr|clash-classic|surge|quanx):(.*)$/i.exec(remaining);
  if (prefixMatch) {
    const prefix = prefixMatch[1].toLowerCase();
    remaining = prefixMatch[2].trim();
    if (prefix === 'clash-domain') explicitBehavior = 'domain';
    else if (prefix === 'clash-ipcidr') explicitBehavior = 'ipcidr';
    else explicitBehavior = 'classical';
  }

  if (!/^https?:\/\//i.test(remaining)) {
    items.push({
      severity: 'warning',
      code: 'INI_UNRECOGNIZED_RULESET_SOURCE',
      source: `line:${lineNumber}`,
      raw: rawLine,
      message: `第 ${lineNumber} 行规则来源「${remaining}」不是有效的 HTTP(S) URL 或内置规则，已写入兼容性报告。`,
    });
    return null;
  }

  const behavior = explicitBehavior ?? inferRemoteBehaviorFromUrl(remaining);
  const format = inferRemoteFormatFromUrl(remaining);

  return {
    targetGroup,
    matcher: {
      kind: 'remote',
      url: remaining,
      behavior,
      format,
      ...(updateIntervalSec !== undefined ? { updateIntervalSec } : {}),
    },
    lineNumber,
  };
}

function parseCustomProxyGroupLine(
  value: string,
  lineNumber: number,
  rawLine: string,
  items: ImportCompatibilityItem[],
): ParsedIniGroup | null {
  const tokens = value.split('`').map((s) => s.trim());
  if (tokens.length < 3 || !tokens[0] || !tokens[1]) {
    items.push({
      severity: 'warning',
      code: 'INI_MALFORMED_PROXY_GROUP',
      source: `line:${lineNumber}`,
      raw: rawLine,
      message: `第 ${lineNumber} 行 custom_proxy_group 字段不足，已跳过。`,
    });
    return null;
  }

  const [rawName, rawType, ...rest] = tokens;
  const groupType = parseGroupType(rawType);
  if (!groupType) {
    items.push({
      severity: 'warning',
      code: 'INI_UNSUPPORTED_GROUP_TYPE',
      source: `line:${lineNumber}`,
      raw: rawLine,
      message: `第 ${lineNumber} 行策略组「${rawName}」使用了暂不支持的类型「${rawType}」，已写入兼容性报告。`,
    });
    return null;
  }

  const members = [...rest];
  let test: GroupHealthCheck | undefined;

  if (groupType === 'url-test' || groupType === 'fallback' || groupType === 'load-balance') {
    // Subconverter format: ...`<testUrl>`<interval>,<timeout>,<tolerance>
    if (members.length >= 2 && /^https?:\/\//i.test(members[members.length - 2])) {
      const timingToken = members[members.length - 1];
      const urlToken = members[members.length - 2];
      const parsedTiming = parseHealthCheckTiming(timingToken);
      if (parsedTiming) {
        test = {
          url: urlToken,
          intervalSec: parsedTiming.intervalSec,
          ...(parsedTiming.toleranceMs !== undefined ? { toleranceMs: parsedTiming.toleranceMs } : {}),
        };
        members.splice(members.length - 2, 2);
      }
    }
  }

  return {
    rawName,
    type: groupType,
    rawMembers: members.filter(Boolean),
    test,
    lineNumber,
  };
}

/**
 * Pure subconverter `.ini` importer supporting ACL4SSR and Custom_OpenClash_Rules
 * conventions (design §10.5). Unrecognized keys, sections, and rules are preserved
 * in the compatibility report rather than silently dropped.
 */
export function importSubconverterIni(iniText: string, options?: ImportTemplateOptions): ImportedTemplateResult {
  const items: ImportCompatibilityItem[] = [];
  const parsedGroups: ParsedIniGroup[] = [];
  const parsedRulesets: ParsedIniRuleset[] = [];
  const unrecognizedLines: string[] = [];

  let currentSection = 'custom';
  let skippedCount = 0;
  let unrecognizedCount = 0;

  const lines = iniText.split(/\r?\n/);
  lines.forEach((rawLine, idx) => {
    const lineNumber = idx + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) {
      return;
    }

    const sectionMatch = /^\[([^\]]+)\]$/.exec(trimmed);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim().toLowerCase();
      if (currentSection !== 'custom') {
        unrecognizedCount += 1;
        unrecognizedLines.push(trimmed);
        items.push({
          severity: 'info',
          code: 'INI_UNRECOGNIZED_SECTION',
          source: `line:${lineNumber}`,
          raw: trimmed,
          message: `第 ${lineNumber} 行存在非 [custom] 分段 [${sectionMatch[1].trim()}]，内容将记录在兼容性报告中。`,
        });
      }
      return;
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) {
      unrecognizedCount += 1;
      unrecognizedLines.push(trimmed);
      items.push({
        severity: 'warning',
        code: 'INI_UNRECOGNIZED_LINE',
        source: `line:${lineNumber}`,
        raw: trimmed,
        message: `第 ${lineNumber} 行无法解析为 key=value，已记录到兼容性报告。`,
      });
      return;
    }

    const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
    const value = trimmed.slice(eqIdx + 1).trim();

    if (currentSection !== 'custom') {
      unrecognizedCount += 1;
      unrecognizedLines.push(trimmed);
      items.push({
        severity: 'info',
        code: 'INI_UNRECOGNIZED_KEY',
        source: `line:${lineNumber}`,
        raw: trimmed,
        message: `分段 [${currentSection}] 中的字段 ${key} 未映射，已记录到兼容性报告。`,
      });
      return;
    }

    if (key === 'ruleset') {
      const parsed = parseRulesetLine(value, lineNumber, trimmed, items);
      if (parsed) {
        parsedRulesets.push(parsed);
      } else {
        skippedCount += 1;
        unrecognizedLines.push(trimmed);
      }
      return;
    }

    if (key === 'custom_proxy_group') {
      const parsed = parseCustomProxyGroupLine(value, lineNumber, trimmed, items);
      if (parsed) {
        parsedGroups.push(parsed);
      } else {
        skippedCount += 1;
        unrecognizedLines.push(trimmed);
      }
      return;
    }

    if (key === 'enable_rule_generator' || key === 'overwrite_original_rules') {
      if (value.toLowerCase() === 'false') {
        items.push({
          severity: 'info',
          code: 'INI_GENERATOR_FLAG',
          source: `line:${lineNumber}`,
          raw: trimmed,
          message: `导入源设置了 ${key}=false，Private Rules 仍按中间结构解析模板规则。`,
        });
      }
      return;
    }

    unrecognizedCount += 1;
    unrecognizedLines.push(trimmed);
    items.push({
      severity: 'info',
      code: 'INI_UNRECOGNIZED_KEY',
      source: `line:${lineNumber}`,
      raw: trimmed,
      message: `第 ${lineNumber} 行字段「${key}」不在标准映射范围内，已记录到兼容性报告。`,
    });
  });

  // Step 1: Classify `custom_proxy_group` entries into RegionGroups vs AppCards
  const usedRegionIds = new Set<string>();
  const usedCardIds = new Set<string>();
  const regionGroups: RegionGroup[] = [];
  const nameToRef = new Map<string, PolicyRef>();
  const nonRegionGroups: ParsedIniGroup[] = [];

  for (const group of parsedGroups) {
    const hasBracketRefs = group.rawMembers.some((m) => m.startsWith('[]'));
    const regexMembers = group.rawMembers.filter((m) => !m.startsWith('[]') && m !== '.*');
    const isRegexOnlyNodeGroup = !hasBracketRefs && regexMembers.length > 0;

    if (isRegexOnlyNodeGroup) {
      const combinedRegex = regexMembers.join('|');
      const regionCode = detectSingleRegionForGroup(group.rawName, combinedRegex);
      if (regionCode) {
        const regionId = allocateUniqueId(`region-${regionCode.toLowerCase()}`, usedRegionIds);
        regionGroups.push({
          id: regionId,
          name: group.rawName,
          region: regionCode,
          type: group.type,
          slotId: DEFAULT_SLOT_ID,
          extraInclude: combinedRegex,
          ...(group.test ? { test: group.test } : {}),
        });
        nameToRef.set(group.rawName, { kind: 'region', regionGroupId: regionId });
        continue;
      }
    }

    const cardId = allocateUniqueId(makeDeterministicSlug(group.rawName, 'card'), usedCardIds);
    nameToRef.set(group.rawName, { kind: 'card', cardId });
    nonRegionGroups.push(group);
  }

  // Helper to resolve a group name token to a PolicyRef
  const resolveGroupRef = (groupName: string): PolicyRef => {
    const builtin = parseBuiltinPolicy(groupName);
    if (builtin) return { kind: 'builtin', id: builtin };
    const existing = nameToRef.get(groupName);
    if (existing) return structuredClone(existing);
    // Synthesize a placeholder card ref if referenced by a ruleset but not declared
    const cardId = allocateUniqueId(makeDeterministicSlug(groupName, 'card'), usedCardIds);
    const ref: PolicyRef = { kind: 'card', cardId };
    nameToRef.set(groupName, ref);
    return ref;
  };

  // Step 2: Build AppCard stubs for every non-region custom_proxy_group
  const cardById = new Map<string, AppCard>();
  const declaredCardOrder: string[] = [];

  for (const group of nonRegionGroups) {
    const ref = nameToRef.get(group.rawName);
    if (!ref || ref.kind !== 'card') continue;
    const candidates: PolicyRef[] = [];

    for (const member of group.rawMembers) {
      if (member.startsWith('[]')) {
        const targetName = member.slice(2).trim();
        candidates.push(resolveGroupRef(targetName));
      } else if (member === '.*') {
        candidates.push({ kind: 'slot', slotId: DEFAULT_SLOT_ID });
      } else {
        candidates.push({
          kind: 'slot',
          slotId: DEFAULT_SLOT_ID,
          filter: { include: member },
        });
      }
    }

    if (candidates.length === 0) {
      candidates.push({ kind: 'slot', slotId: DEFAULT_SLOT_ID });
    }

    const icon = recognizeGroupIcon({ name: group.rawName, groupType: group.type });
    const card: AppCard = {
      id: ref.cardId,
      slug: ref.cardId,
      name: group.rawName,
      icon: icon.key,
      category: inferCardCategory(group.rawName, []),
      stage: 'app',
      origin: 'user',
      group: {
        type: group.type,
        candidates,
        ...(group.test ? { test: group.test } : {}),
      },
      matchers: [],
    };
    cardById.set(card.id, card);
    declaredCardOrder.push(card.id);
  }

  // Step 3: Attach rulesets in exact priority order (preserving non-contiguous splits & builtin-targeted rulesets)
  let finalPolicy: PolicyRef | undefined;
  const orderedRuleCardIds: string[] = [];
  const attachedCardIds = new Set<string>();
  let lastRuleCardId: string | null = null;
  let importedMatchers = 0;

  for (const entry of parsedRulesets) {
    if (entry.isFinal) {
      finalPolicy = resolveGroupRef(entry.targetGroup);
      continue;
    }
    if (!entry.matcher) continue;
    importedMatchers += 1;

    const targetRef = resolveGroupRef(entry.targetGroup);

    // If targeting a declared card and either it hasn't been placed yet or is the immediately preceding rule card, attach directly
    if (targetRef.kind === 'card') {
      let card = cardById.get(targetRef.cardId);
      if (!card) {
        // Group was used in ruleset= without a custom_proxy_group= declaration
        card = {
          id: targetRef.cardId,
          slug: targetRef.cardId,
          name: entry.targetGroup,
          icon: recognizeGroupIcon({ name: entry.targetGroup }).key,
          category: inferCardCategory(entry.targetGroup, [entry.matcher]),
          stage: 'app',
          origin: 'user',
          group: {
            type: 'select',
            candidates: [{ kind: 'slot', slotId: DEFAULT_SLOT_ID }],
          },
          matchers: [],
        };
        cardById.set(card.id, card);
      }

      if (!attachedCardIds.has(card.id)) {
        card.matchers.push(entry.matcher);
        attachedCardIds.add(card.id);
        orderedRuleCardIds.push(card.id);
        lastRuleCardId = card.id;
      } else if (lastRuleCardId === card.id) {
        card.matchers.push(entry.matcher);
      } else {
        // Non-contiguous re-use of the same target group: emit an auxiliary rule card to preserve exact rule priority
        const auxId = allocateUniqueId(`${card.id}-rules`, usedCardIds);
        const auxCard: AppCard = {
          id: auxId,
          slug: auxId,
          name: `${card.name}（分段规则）`,
          icon: card.icon,
          category: inferCardCategory(card.name, [entry.matcher]),
          stage: 'app',
          origin: 'user',
          group: {
            type: 'select',
            candidates: [{ kind: 'card', cardId: card.id }],
          },
          matchers: [entry.matcher],
        };
        cardById.set(auxId, auxCard);
        orderedRuleCardIds.push(auxId);
        lastRuleCardId = auxId;
      }
    } else {
      // Builtin (DIRECT/REJECT) or RegionGroup targeted directly by ruleset=
      const prevCard = lastRuleCardId ? cardById.get(lastRuleCardId) : undefined;
      const sameDirectTarget =
        prevCard &&
        prevCard.group.candidates.length === 1 &&
        JSON.stringify(prevCard.group.candidates[0]) === JSON.stringify(targetRef) &&
        !declaredCardOrder.includes(prevCard.id);

      if (sameDirectTarget && prevCard) {
        prevCard.matchers.push(entry.matcher);
      } else {
        const ruleCardId = allocateUniqueId(makeDeterministicSlug(`${entry.targetGroup}-rules`, 'rules'), usedCardIds);
        const ruleCard: AppCard = {
          id: ruleCardId,
          slug: ruleCardId,
          name: entry.targetGroup,
          icon: recognizeGroupIcon({ name: entry.targetGroup, matchers: [entry.matcher] }).key,
          category: inferCardCategory(entry.targetGroup, [entry.matcher]),
          stage: 'app',
          origin: 'user',
          group: {
            type: 'select',
            candidates: [targetRef],
          },
          matchers: [entry.matcher],
        };
        cardById.set(ruleCardId, ruleCard);
        orderedRuleCardIds.push(ruleCardId);
        lastRuleCardId = ruleCardId;
      }
    }
  }

  // Step 4: Finalize stages, categories, hidden flags, and card ordering
  const finalCardId = finalPolicy?.kind === 'card' ? finalPolicy.cardId : undefined;
  const hubCardIds: string[] = [];
  const trailingFinalIds: string[] = [];

  for (const id of declaredCardOrder) {
    if (attachedCardIds.has(id)) continue;
    const card = cardById.get(id)!;
    if (id === finalCardId) {
      card.stage = 'final';
      trailingFinalIds.push(id);
    } else {
      card.hidden = true;
      card.stage = 'proxy-fallback';
      hubCardIds.push(id);
    }
  }

  for (const id of orderedRuleCardIds) {
    const card = cardById.get(id)!;
    card.category = inferCardCategory(card.name, card.matchers);
    card.stage = inferImportedCardStage(card);
    card.icon = recognizeGroupIcon({
      name: card.name,
      category: card.category,
      groupType: card.group.type,
      matchers: card.matchers,
    }).key;
  }

  const finalOrderedIds = [...hubCardIds, ...orderedRuleCardIds, ...trailingFinalIds];
  const cards = finalOrderedIds.map((id) => cardById.get(id)!);
  const cardRefs: TemplateCardRef[] = cards.map((card) => ({ cardId: card.id, enabled: true }));

  if (!finalPolicy) {
    finalPolicy = { kind: 'builtin', id: 'DIRECT' };
    items.push({
      severity: 'warning',
      code: 'INI_MISSING_FINAL',
      source: 'template',
      message: '未在 .ini 中找到 []FINAL 或 []MATCH 兜底规则，已默认指向 DIRECT。',
    });
  }

  const body: TemplateBody = {
    slots: [
      {
        id: DEFAULT_SLOT_ID,
        name: '主力订阅',
        excludeInfo: true,
        udp: true,
        healthCheck: {
          url: DEFAULT_HEALTH_CHECK.url,
          intervalSec: DEFAULT_HEALTH_CHECK.intervalSec,
        },
      },
    ],
    regionGroups,
    cards: cardRefs,
    groupMode: 'select',
    final: finalPolicy,
    output: 'full',
    dns: { mode: 'fake-ip', enable: true },
    modules: [{ id: 'ip-no-resolve', enabled: true }],
    ...(unrecognizedLines.length > 0
      ? {
          clientPatches: {
            mihomo: `# Unrecognized subconverter .ini lines\n${unrecognizedLines.map((l) => `# ${l}`).join('\n')}`,
          },
        }
      : {}),
  };

  return {
    baseKind: 'acl4ssr-ini',
    name: options?.name?.trim() || '导入的 Subconverter 模板',
    body,
    cards,
    report: {
      sourceFormat: 'acl4ssr-ini',
      importedCards: cards.length,
      importedRegionGroups: regionGroups.length,
      importedMatchers,
      skippedCount,
      unrecognizedCount,
      items,
    },
  };
}
