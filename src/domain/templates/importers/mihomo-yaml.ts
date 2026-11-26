import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  AppCard,
  GroupHealthCheck,
  Matcher,
  NodeFilter,
  PolicyRef,
  RemoteRuleBehavior,
  RemoteRuleFormat,
} from '../../../shared/schemas/card';
import type {
  DnsProfile,
  GeneralSettings,
  LogLevel,
  NodeSlot,
  RegionGroup,
  TemplateBody,
  TemplateCardRef,
} from '../../../shared/schemas/template';
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
  parseConditionExpr,
  parseGroupType,
  parseInlineRuleParts,
  splitTopLevelCommas,
} from './shared';
import type { ImportCompatibilityItem, ImportedTemplateResult, ImportTemplateOptions } from './types';

type RawRuleProvider = {
  type?: string;
  behavior?: string;
  format?: string;
  url?: string;
  interval?: number;
  payload?: unknown;
};

type RawProxyGroup = {
  name?: unknown;
  type?: unknown;
  proxies?: unknown;
  use?: unknown;
  'include-all'?: unknown;
  'include-all-proxies'?: unknown;
  'include-all-providers'?: unknown;
  filter?: unknown;
  'exclude-filter'?: unknown;
  url?: unknown;
  interval?: unknown;
  tolerance?: unknown;
  icon?: unknown;
  hidden?: unknown;
};

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'proxy-groups',
  'proxy-providers',
  'rule-providers',
  'rules',
  'dns',
  'proxies',
  'allow-lan',
  'mixed-port',
  'log-level',
  'ipv6',
  'mode',
]);

const KNOWN_DNS_KEYS = new Set([
  'enable',
  'ipv6',
  'enhanced-mode',
  'nameserver',
  'fallback',
  'default-nameserver',
  'fake-ip-filter',
  'respect-rules',
]);

const VALID_LOG_LEVELS = new Set<LogLevel>(['silent', 'error', 'warning', 'info', 'debug']);
const DEFAULT_SLOT_ID = 'slot-main';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((s) => s.trim());
}

function parseProviderBehavior(raw: unknown, url?: string): RemoteRuleBehavior {
  if (raw === 'domain' || raw === 'ipcidr' || raw === 'classical') return raw;
  return url ? inferRemoteBehaviorFromUrl(url) : 'classical';
}

function parseProviderFormat(raw: unknown, url?: string): RemoteRuleFormat {
  if (raw === 'yaml' || raw === 'text' || raw === 'mrs') return raw;
  return url ? inferRemoteFormatFromUrl(url) : 'yaml';
}

function parseInlinePayloadLines(payload: readonly string[], behavior: RemoteRuleBehavior): Matcher | null {
  const conditions = [];
  for (const rawLine of payload) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (behavior === 'domain') {
      if (line.startsWith('+.')) {
        conditions.push({ op: 'rule' as const, rule: { type: 'DOMAIN-SUFFIX' as const, value: line.slice(2) } });
      } else if (line.startsWith('.')) {
        conditions.push({ op: 'rule' as const, rule: { type: 'DOMAIN-SUFFIX' as const, value: line.slice(1) } });
      } else {
        conditions.push({ op: 'rule' as const, rule: { type: 'DOMAIN' as const, value: line } });
      }
    } else if (behavior === 'ipcidr') {
      conditions.push({
        op: 'rule' as const,
        rule: { type: 'IP-CIDR' as const, value: line, options: { noResolve: true } },
      });
    } else {
      const parts = line.split(',').map((s) => s.trim());
      if (parts.length >= 2) {
        const noResolve = parts.slice(2).some((opt) => opt.toLowerCase() === 'no-resolve');
        const parsed = parseInlineRuleParts(parts[0], parts[1], noResolve);
        if (parsed) conditions.push({ op: 'rule' as const, rule: parsed });
      }
    }
  }
  return conditions.length > 0 ? { kind: 'inline', conditions } : null;
}

/**
 * Pure mihomo / Clash YAML importer (design §10.5).
 * Parses `proxy-groups`, `proxy-providers`, `rule-providers`, `rules`, `dns`, and
 * runtime basics into the client-agnostic template intermediate representation,
 * ignores static `proxies`, and records all unrecognized keys/rules in the
 * compatibility report and `clientPatches.mihomo`.
 */
export function importMihomoYaml(yamlText: string, options?: ImportTemplateOptions): ImportedTemplateResult {
  const rawDoc: unknown = parseYaml(yamlText);
  if (!isRecord(rawDoc)) {
    throw new Error('Invalid mihomo YAML: top-level document must be a YAML mapping');
  }

  const items: ImportCompatibilityItem[] = [];
  let skippedCount = 0;
  let unrecognizedCount = 0;

  // 1. Capture unrecognized top-level keys into clientPatches.mihomo
  const unrecognizedTopLevel: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rawDoc)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      unrecognizedTopLevel[key] = val;
      unrecognizedCount += 1;
      items.push({
        severity: 'info',
        code: 'YAML_UNRECOGNIZED_SECTION',
        source: key,
        message: `顶层配置段「${key}」未直接映射到中间结构，已保留至 mihomo 客户端补丁。`,
      });
    }
  }

  // 2. Ignore static `proxies` per design §10.5 (never embed credentials/nodes in templates)
  const staticProxyNames = new Set<string>();
  if (Array.isArray(rawDoc.proxies) && rawDoc.proxies.length > 0) {
    for (const entry of rawDoc.proxies) {
      if (isRecord(entry) && typeof entry.name === 'string') {
        staticProxyNames.add(entry.name.trim());
      }
    }
    items.push({
      severity: 'info',
      code: 'YAML_PROXIES_IGNORED',
      source: 'proxies',
      message: `已按模板规范忽略 ${rawDoc.proxies.length} 条静态 proxies 节点，节点将在发布阶段通过节点槽位绑定。`,
    });
  }

  // 3. Extract `proxy-providers` as sanitized NodeSlots (strip subscription URLs & auth headers)
  const slots: NodeSlot[] = [];
  const usedSlotIds = new Set<string>();
  const providerNameToSlotId = new Map<string, string>();

  if (isRecord(rawDoc['proxy-providers'])) {
    for (const [provName, provVal] of Object.entries(rawDoc['proxy-providers'])) {
      if (!isRecord(provVal)) continue;
      const slotId = allocateUniqueId(`slot-${makeDeterministicSlug(provName, 'prov')}`, usedSlotIds);
      providerNameToSlotId.set(provName, slotId);

      const filterText = typeof provVal.filter === 'string' ? provVal.filter : '';
      const excludeText = typeof provVal['exclude-filter'] === 'string' ? provVal['exclude-filter'] : '';
      const excludeInfo = /流量|到期|官网|Traffic|Expire/i.test(`${filterText} ${excludeText}`) || true;

      const overrideObj = isRecord(provVal.override) ? provVal.override : undefined;
      const udp = typeof overrideObj?.udp === 'boolean' ? overrideObj.udp : undefined;

      const hcObj = isRecord(provVal['health-check']) ? provVal['health-check'] : undefined;
      const hcUrl = typeof hcObj?.url === 'string' && /^https?:\/\//i.test(hcObj.url) ? hcObj.url : undefined;
      const hcInterval =
        typeof hcObj?.interval === 'number' && Number.isInteger(hcObj.interval) && hcObj.interval > 0
          ? Math.min(hcObj.interval, 86_400)
          : undefined;

      slots.push({
        id: slotId,
        name: provName,
        excludeInfo,
        ...(udp !== undefined ? { udp } : {}),
        ...(hcUrl && hcInterval ? { healthCheck: { url: hcUrl, intervalSec: hcInterval } } : {}),
      });

      if (typeof provVal.url === 'string' || provVal.header !== undefined) {
        items.push({
          severity: 'info',
          code: 'YAML_PROVIDER_SECRET_STRIPPED',
          source: `proxy-providers.${provName}`,
          message: `节点槽位 ${provName} 的订阅地址与请求头已脱敏剥离，请在发布时重新绑定订阅地址。`,
        });
      }
    }
  }

  const ensureDefaultSlot = (): string => {
    if (slots.length > 0) return slots[0].id;
    slots.push({
      id: DEFAULT_SLOT_ID,
      name: '主力订阅',
      excludeInfo: true,
      udp: true,
      healthCheck: {
        url: DEFAULT_HEALTH_CHECK.url,
        intervalSec: DEFAULT_HEALTH_CHECK.intervalSec,
      },
    });
    usedSlotIds.add(DEFAULT_SLOT_ID);
    return DEFAULT_SLOT_ID;
  };

  // 4. Parse `rule-providers`
  const ruleProviders = new Map<string, RawRuleProvider>();
  if (isRecord(rawDoc['rule-providers'])) {
    for (const [rpName, rpVal] of Object.entries(rawDoc['rule-providers'])) {
      if (isRecord(rpVal)) {
        ruleProviders.set(rpName, rpVal as RawRuleProvider);
      }
    }
  }

  // 5. Parse `proxy-groups` into RegionGroups vs AppCards
  const rawGroups = Array.isArray(rawDoc['proxy-groups']) ? (rawDoc['proxy-groups'] as RawProxyGroup[]) : [];
  const usedRegionIds = new Set<string>();
  const usedCardIds = new Set<string>();
  const regionGroups: RegionGroup[] = [];
  const nameToRef = new Map<string, PolicyRef>();
  const validNonRegionGroups: Array<{
    raw: RawProxyGroup;
    name: string;
    type: ReturnType<typeof parseGroupType> & string;
  }> = [];

  for (let i = 0; i < rawGroups.length; i += 1) {
    const raw = rawGroups[i];
    if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.trim()) {
      skippedCount += 1;
      items.push({
        severity: 'warning',
        code: 'YAML_INVALID_PROXY_GROUP',
        source: `proxy-groups[${i}]`,
        message: `proxy-groups[${i}] 缺少有效名称，已跳过。`,
      });
      continue;
    }

    const name = raw.name.trim();
    const rawType = typeof raw.type === 'string' ? raw.type : '';
    const groupType = parseGroupType(rawType);
    if (!groupType) {
      skippedCount += 1;
      items.push({
        severity: 'warning',
        code: 'YAML_UNSUPPORTED_GROUP_TYPE',
        source: `proxy-groups[${i}]`,
        raw: `${name} (${rawType})`,
        message: `策略组「${name}」使用了不支持的类型「${rawType}」，已写入兼容性报告。`,
      });
      continue;
    }

    const proxiesList = asStringArray(raw.proxies).filter((p) => !staticProxyNames.has(p));
    const useList = asStringArray(raw.use);
    const includeAll = Boolean(raw['include-all'] || raw['include-all-proxies'] || raw['include-all-providers']);
    const includeFilter = typeof raw.filter === 'string' && raw.filter.trim() ? raw.filter.trim() : undefined;
    const excludeFilter =
      typeof raw['exclude-filter'] === 'string' && raw['exclude-filter'].trim()
        ? raw['exclude-filter'].trim()
        : undefined;

    const isNodeFilterOnly = proxiesList.length === 0 && (includeAll || useList.length > 0) && Boolean(includeFilter);
    if (isNodeFilterOnly) {
      const regionCode = detectSingleRegionForGroup(name, includeFilter);
      if (regionCode) {
        const regionId = allocateUniqueId(`region-${regionCode.toLowerCase()}`, usedRegionIds);
        const slotId =
          useList.length > 0 ? (providerNameToSlotId.get(useList[0]) ?? ensureDefaultSlot()) : ensureDefaultSlot();
        const test = buildGroupTest(raw);
        regionGroups.push({
          id: regionId,
          name,
          region: regionCode,
          type: groupType,
          slotId,
          ...(includeFilter ? { extraInclude: includeFilter } : {}),
          ...(excludeFilter ? { extraExclude: excludeFilter } : {}),
          ...(test ? { test } : {}),
        });
        nameToRef.set(name, { kind: 'region', regionGroupId: regionId });
        continue;
      }
    }

    const cardId = allocateUniqueId(makeDeterministicSlug(name, 'card'), usedCardIds);
    nameToRef.set(name, { kind: 'card', cardId });
    validNonRegionGroups.push({ raw, name, type: groupType });
  }

  const resolveGroupRef = (groupName: string): PolicyRef => {
    const builtin = parseBuiltinPolicy(groupName);
    if (builtin) return { kind: 'builtin', id: builtin };
    const existing = nameToRef.get(groupName);
    if (existing) return structuredClone(existing);
    const cardId = allocateUniqueId(makeDeterministicSlug(groupName, 'card'), usedCardIds);
    const ref: PolicyRef = { kind: 'card', cardId };
    nameToRef.set(groupName, ref);
    return ref;
  };

  // Build AppCard definitions for declared non-region proxy-groups
  const cardById = new Map<string, AppCard>();
  const declaredCardOrder: string[] = [];

  for (const { raw, name, type } of validNonRegionGroups) {
    const ref = nameToRef.get(name);
    if (!ref || ref.kind !== 'card') continue;

    const candidates: PolicyRef[] = [];
    const proxiesList = asStringArray(raw.proxies);
    let referencedStaticProxy = false;

    for (const member of proxiesList) {
      if (staticProxyNames.has(member)) {
        referencedStaticProxy = true;
        continue;
      }
      candidates.push(resolveGroupRef(member));
    }

    const includeFilter = typeof raw.filter === 'string' && raw.filter.trim() ? raw.filter.trim() : undefined;
    const excludeFilter =
      typeof raw['exclude-filter'] === 'string' && raw['exclude-filter'].trim()
        ? raw['exclude-filter'].trim()
        : undefined;
    const nodeFilter: NodeFilter | undefined =
      includeFilter || excludeFilter
        ? {
            ...(includeFilter ? { include: includeFilter } : {}),
            ...(excludeFilter ? { exclude: excludeFilter } : {}),
          }
        : undefined;

    const useList = asStringArray(raw.use);
    const includeAll = Boolean(raw['include-all'] || raw['include-all-proxies'] || raw['include-all-providers']);

    if (useList.length > 0) {
      for (const provName of useList) {
        const slotId = providerNameToSlotId.get(provName) ?? ensureDefaultSlot();
        candidates.push({
          kind: 'slot',
          slotId,
          ...(nodeFilter ? { filter: nodeFilter } : {}),
        });
      }
    } else if (includeAll || referencedStaticProxy) {
      const targetSlots = slots.length > 0 ? slots.map((s) => s.id) : [ensureDefaultSlot()];
      for (const slotId of targetSlots) {
        candidates.push({
          kind: 'slot',
          slotId,
          ...(nodeFilter ? { filter: nodeFilter } : {}),
        });
      }
    }

    if (candidates.length === 0) {
      candidates.push({ kind: 'slot', slotId: ensureDefaultSlot() });
    }

    const test = buildGroupTest(raw);
    const icon =
      typeof raw.icon === 'string' && raw.icon.trim()
        ? raw.icon.trim()
        : recognizeGroupIcon({ name, groupType: type }).key;

    const card: AppCard = {
      id: ref.cardId,
      slug: ref.cardId,
      name,
      icon,
      category: inferCardCategory(name, []),
      stage: 'app',
      origin: 'user',
      ...(typeof raw.hidden === 'boolean' ? { hidden: raw.hidden } : {}),
      group: {
        type,
        candidates,
        ...(test ? { test } : {}),
      },
      matchers: [],
    };
    cardById.set(card.id, card);
    declaredCardOrder.push(card.id);
  }

  // 6. Parse `rules` in exact evaluation order
  const rawRules = asStringArray(rawDoc.rules);
  const unrecognizedRules: string[] = [];
  let finalPolicy: PolicyRef | undefined;
  const orderedRuleCardIds: string[] = [];
  const attachedCardIds = new Set<string>();
  let lastRuleCardId: string | null = null;
  let importedMatchers = 0;

  const attachMatcher = (targetGroupName: string, matcher: Matcher) => {
    importedMatchers += 1;
    const targetRef = resolveGroupRef(targetGroupName);

    if (targetRef.kind === 'card') {
      let card = cardById.get(targetRef.cardId);
      if (!card) {
        card = {
          id: targetRef.cardId,
          slug: targetRef.cardId,
          name: targetGroupName,
          icon: recognizeGroupIcon({ name: targetGroupName, matchers: [matcher] }).key,
          category: inferCardCategory(targetGroupName, [matcher]),
          stage: 'app',
          origin: 'user',
          group: {
            type: 'select',
            candidates: [{ kind: 'slot', slotId: ensureDefaultSlot() }],
          },
          matchers: [],
        };
        cardById.set(card.id, card);
      }

      if (!attachedCardIds.has(card.id)) {
        card.matchers.push(matcher);
        attachedCardIds.add(card.id);
        orderedRuleCardIds.push(card.id);
        lastRuleCardId = card.id;
      } else if (lastRuleCardId === card.id) {
        card.matchers.push(matcher);
      } else {
        const auxId = allocateUniqueId(`${card.id}-rules`, usedCardIds);
        const auxCard: AppCard = {
          id: auxId,
          slug: auxId,
          name: `${card.name}（分段规则）`,
          icon: card.icon,
          category: inferCardCategory(card.name, [matcher]),
          stage: 'app',
          origin: 'user',
          group: {
            type: 'select',
            candidates: [{ kind: 'card', cardId: card.id }],
          },
          matchers: [matcher],
        };
        cardById.set(auxId, auxCard);
        orderedRuleCardIds.push(auxId);
        lastRuleCardId = auxId;
      }
      return;
    }

    // Builtin (DIRECT / REJECT) or RegionGroup targeted directly
    const prevCard = lastRuleCardId ? cardById.get(lastRuleCardId) : undefined;
    const sameDirectTarget =
      prevCard &&
      prevCard.group.candidates.length === 1 &&
      JSON.stringify(prevCard.group.candidates[0]) === JSON.stringify(targetRef) &&
      !declaredCardOrder.includes(prevCard.id);

    if (sameDirectTarget && prevCard) {
      prevCard.matchers.push(matcher);
    } else {
      const ruleCardId = allocateUniqueId(makeDeterministicSlug(`${targetGroupName}-rules`, 'rules'), usedCardIds);
      const ruleCard: AppCard = {
        id: ruleCardId,
        slug: ruleCardId,
        name: targetGroupName,
        icon: recognizeGroupIcon({ name: targetGroupName, matchers: [matcher] }).key,
        category: inferCardCategory(targetGroupName, [matcher]),
        stage: 'app',
        origin: 'user',
        group: {
          type: 'select',
          candidates: [targetRef],
        },
        matchers: [matcher],
      };
      cardById.set(ruleCardId, ruleCard);
      orderedRuleCardIds.push(ruleCardId);
      lastRuleCardId = ruleCardId;
    }
  };

  rawRules.forEach((rawRule, ruleIdx) => {
    const parts = splitTopLevelCommas(rawRule);
    if (parts.length < 2) {
      skippedCount += 1;
      unrecognizedCount += 1;
      unrecognizedRules.push(rawRule);
      items.push({
        severity: 'warning',
        code: 'YAML_MALFORMED_RULE',
        source: `rules[${ruleIdx}]`,
        raw: rawRule,
        message: `rules[${ruleIdx}] 语法无效，已保留至兼容性报告与客户端补丁。`,
      });
      return;
    }

    const head = parts[0].toUpperCase();

    if (head === 'MATCH' || head === 'FINAL') {
      finalPolicy = resolveGroupRef(parts[1]);
      return;
    }

    if (head === 'RULE-SET' && parts.length >= 3) {
      const providerName = parts[1];
      const targetGroup = parts[2];
      const provider = ruleProviders.get(providerName);
      if (!provider) {
        skippedCount += 1;
        unrecognizedRules.push(rawRule);
        items.push({
          severity: 'warning',
          code: 'YAML_MISSING_RULE_PROVIDER',
          source: `rules[${ruleIdx}]`,
          raw: rawRule,
          message: `RULE-SET 引用的 rule-provider「${providerName}」未定义，已记录到兼容性报告。`,
        });
        return;
      }

      const behavior = parseProviderBehavior(provider.behavior, provider.url);
      if (provider.type === 'inline' && Array.isArray(provider.payload)) {
        const inlineMatcher = parseInlinePayloadLines(asStringArray(provider.payload), behavior);
        if (inlineMatcher) {
          attachMatcher(targetGroup, inlineMatcher);
          return;
        }
      }

      if (typeof provider.url === 'string' && /^https?:\/\//i.test(provider.url)) {
        const interval =
          typeof provider.interval === 'number' &&
          Number.isInteger(provider.interval) &&
          provider.interval >= 60 &&
          provider.interval <= 604_800
            ? provider.interval
            : undefined;
        attachMatcher(targetGroup, {
          kind: 'remote',
          url: provider.url.trim(),
          behavior,
          format: parseProviderFormat(provider.format, provider.url),
          ...(interval !== undefined ? { updateIntervalSec: interval } : {}),
        });
        return;
      }

      skippedCount += 1;
      unrecognizedRules.push(rawRule);
      items.push({
        severity: 'warning',
        code: 'YAML_UNSUPPORTED_RULE_PROVIDER',
        source: `rule-providers.${providerName}`,
        raw: rawRule,
        message: `rule-provider「${providerName}」既无有效 HTTP URL 也无内联 payload，已记录到兼容性报告。`,
      });
      return;
    }

    if (head === 'GEOSITE' && parts.length >= 3) {
      attachMatcher(parts[2], { kind: 'geosite', name: parts[1] });
      return;
    }

    if (head === 'GEOIP' && parts.length >= 3) {
      const noResolve = parts.slice(3).some((opt) => opt.toLowerCase() === 'no-resolve');
      attachMatcher(parts[2], {
        kind: 'geoip',
        name: parts[1],
        ...(noResolve ? { noResolve: true } : {}),
      });
      return;
    }

    if ((head === 'AND' || head === 'OR' || head === 'NOT') && parts.length >= 3) {
      const targetGroup = parts[parts.length - 1];
      const condExpr = `${head},${parts.slice(1, -1).join(',')}`;
      const condition = parseConditionExpr(condExpr);
      if (condition) {
        attachMatcher(targetGroup, { kind: 'inline', conditions: [condition] });
        return;
      }
    }

    // Standard atomic rule: TYPE,VALUE,TARGET[,no-resolve]
    if (parts.length >= 3) {
      const noResolve = parts.slice(3).some((opt) => opt.toLowerCase() === 'no-resolve');
      const inlineRule = parseInlineRuleParts(parts[0], parts[1], noResolve);
      if (inlineRule) {
        attachMatcher(parts[2], { kind: 'inline', conditions: [{ op: 'rule', rule: inlineRule }] });
        return;
      }
    }

    skippedCount += 1;
    unrecognizedCount += 1;
    unrecognizedRules.push(rawRule);
    items.push({
      severity: 'warning',
      code: 'YAML_UNRECOGNIZED_RULE',
      source: `rules[${ruleIdx}]`,
      raw: rawRule,
      message: `规则「${rawRule}」使用未识别类型或语法，已保留至兼容性报告与 mihomo 补丁。`,
    });
  });

  // 7. Parse `dns` and `general` runtime settings
  const hasDns = isRecord(rawDoc.dns);
  const dns: DnsProfile = parseDnsProfile(rawDoc.dns, items);
  const general = parseGeneralSettings(rawDoc);
  const output: 'full' | 'minimal' = !hasDns && !general ? 'minimal' : 'full';

  // 8. Finalize card metadata, stages, and order
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
      card.hidden = card.hidden ?? true;
      card.stage = 'proxy-fallback';
      hubCardIds.push(id);
    }
  }

  for (const id of orderedRuleCardIds) {
    const card = cardById.get(id)!;
    card.category = inferCardCategory(card.name, card.matchers);
    card.stage = inferImportedCardStage(card);
  }

  const finalOrderedIds = [...hubCardIds, ...orderedRuleCardIds, ...trailingFinalIds];
  const cards = finalOrderedIds.map((id) => cardById.get(id)!);
  const cardRefs: TemplateCardRef[] = cards.map((card) => ({ cardId: card.id, enabled: true }));

  if (!finalPolicy) {
    finalPolicy = { kind: 'builtin', id: 'DIRECT' };
    items.push({
      severity: 'warning',
      code: 'YAML_MISSING_FINAL',
      source: 'rules',
      message: '未在 rules 中找到 MATCH / FINAL 兜底规则，已默认指向 DIRECT。',
    });
  }

  // Ensure at least one slot exists when referenced or for consistency
  if (slots.length === 0) {
    ensureDefaultSlot();
  }

  const patchObj: Record<string, unknown> = { ...unrecognizedTopLevel };
  if (unrecognizedRules.length > 0) {
    patchObj['unrecognized-rules'] = unrecognizedRules;
  }
  const mihomoPatch = Object.keys(patchObj).length > 0 ? stringifyYaml(patchObj).trim() : undefined;

  const body: TemplateBody = {
    slots,
    regionGroups,
    cards: cardRefs,
    groupMode: 'select',
    final: finalPolicy,
    output,
    dns,
    ...(general ? { general } : {}),
    modules: [{ id: 'ip-no-resolve', enabled: true }],
    ...(mihomoPatch ? { clientPatches: { mihomo: mihomoPatch } } : {}),
  };

  return {
    baseKind: 'mihomo-yaml',
    name: options?.name?.trim() || '导入的 mihomo 模板',
    body,
    cards,
    report: {
      sourceFormat: 'mihomo-yaml',
      importedCards: cards.length,
      importedRegionGroups: regionGroups.length,
      importedMatchers,
      skippedCount,
      unrecognizedCount,
      items,
    },
  };
}

function buildGroupTest(raw: RawProxyGroup): GroupHealthCheck | undefined {
  const url = typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url.trim()) ? raw.url.trim() : undefined;
  const intervalSec =
    typeof raw.interval === 'number' && Number.isInteger(raw.interval) && raw.interval > 0
      ? Math.min(raw.interval, 86_400)
      : undefined;
  if (!url || !intervalSec) return undefined;
  const toleranceMs =
    typeof raw.tolerance === 'number' && Number.isInteger(raw.tolerance) && raw.tolerance >= 0
      ? Math.min(raw.tolerance, 10_000)
      : undefined;
  return {
    url,
    intervalSec,
    ...(toleranceMs !== undefined ? { toleranceMs } : {}),
  };
}

function parseDnsProfile(rawDns: unknown, items: ImportCompatibilityItem[]): DnsProfile {
  if (!isRecord(rawDns)) {
    return { mode: 'fake-ip', enable: true };
  }

  const enhanced = rawDns['enhanced-mode'];
  const mode: DnsProfile['mode'] = enhanced === 'fake-ip' || enhanced === 'redir-host' ? enhanced : 'custom';

  const custom: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rawDns)) {
    if (!KNOWN_DNS_KEYS.has(key)) {
      custom[key] = val;
      items.push({
        severity: 'info',
        code: 'YAML_DNS_EXTRA_FIELD',
        source: `dns.${key}`,
        message: `DNS 扩展字段 dns.${key} 已保留在 dns.custom 中。`,
      });
    }
  }

  const nameserver = asStringArray(rawDns.nameserver);
  const fallback = asStringArray(rawDns.fallback);
  const defaultNameserver = asStringArray(rawDns['default-nameserver']);
  const fakeIpFilter = asStringArray(rawDns['fake-ip-filter']);

  return {
    mode,
    ...(typeof rawDns.enable === 'boolean' ? { enable: rawDns.enable } : {}),
    ...(typeof rawDns.ipv6 === 'boolean' ? { ipv6: rawDns.ipv6 } : {}),
    ...(nameserver.length > 0 ? { nameserver } : {}),
    ...(fallback.length > 0 ? { fallback } : {}),
    ...(defaultNameserver.length > 0 ? { defaultNameserver } : {}),
    ...(fakeIpFilter.length > 0 ? { fakeIpFilter } : {}),
    ...(typeof rawDns['respect-rules'] === 'boolean' ? { respectRules: rawDns['respect-rules'] } : {}),
    ...(Object.keys(custom).length > 0 ? { custom } : {}),
  };
}

function parseGeneralSettings(rawDoc: Record<string, unknown>): GeneralSettings | undefined {
  const general: GeneralSettings = {};
  if (typeof rawDoc['allow-lan'] === 'boolean') general.allowLan = rawDoc['allow-lan'];
  if (
    typeof rawDoc['mixed-port'] === 'number' &&
    Number.isInteger(rawDoc['mixed-port']) &&
    rawDoc['mixed-port'] >= 1 &&
    rawDoc['mixed-port'] <= 65_535
  ) {
    general.mixedPort = rawDoc['mixed-port'];
  }
  if (typeof rawDoc['log-level'] === 'string' && VALID_LOG_LEVELS.has(rawDoc['log-level'] as LogLevel)) {
    general.logLevel = rawDoc['log-level'] as LogLevel;
  }
  if (typeof rawDoc.ipv6 === 'boolean') general.ipv6 = rawDoc.ipv6;
  return Object.keys(general).length > 0 ? general : undefined;
}
