import type {
  AppCard,
  CatalogEntry,
  Condition,
  InlineRule,
  Matcher,
  PolicyRef,
  Stage,
} from '../../shared/schemas/card';
import type { TemplateBody } from '../../shared/schemas/template';
import { parseCidrRange } from '../rules/conflicts';
import { resolveTemplateCards, type CardLookup, type ResolvedTemplateCard } from './model';

export type ProbeTargetKind = 'domain' | 'url' | 'ipv4' | 'ipv6';

export type ParsedProbeTarget = {
  raw: string;
  kind: ProbeTargetKind;
  host?: string;
  ip?: string;
  isIpv6?: boolean;
  url?: string;
  dstPort?: number;
};

export type ProbeRuleEntry = Pick<InlineRule, 'type' | 'value' | 'options'>;

export type ProbeRequestMeta = {
  srcIp?: string;
  dstPort?: number;
  srcPort?: number;
  processName?: string;
  userAgent?: string;
  /** Optional caller-supplied DNS resolution IP for a domain/URL probe. */
  resolvedIp?: string;
};

export type ProbeCaches = {
  rulesetRules?: ReadonlyMap<string, readonly ProbeRuleEntry[]>;
  remoteRules?: ReadonlyMap<string, readonly ProbeRuleEntry[]>;
  catalogRules?: ReadonlyMap<string, readonly ProbeRuleEntry[]>;
  catalogIndex?: ReadonlyMap<string, CatalogEntry> | readonly CatalogEntry[];
  geositeRules?: ReadonlyMap<string, readonly ProbeRuleEntry[]>;
  geoipRules?: ReadonlyMap<string, readonly ProbeRuleEntry[]>;
};

export type ProbeInput = {
  target: string;
  body: TemplateBody;
  cards: CardLookup;
  meta?: ProbeRequestMeta;
  caches?: ProbeCaches;
};

export type ProbeMatchedRule = {
  type: string;
  value: string;
  matcherKind: Matcher['kind'] | 'final';
  matcherIndex: number;
  sourceLabel: string;
  summary: string;
  noResolve?: boolean;
};

export type ProbeDnsResolutionPoint = {
  cardId: string;
  cardName: string;
  stage: Stage;
  matcherIndex: number;
  ruleSummary: string;
  noResolve: boolean;
  /** True when the rule does NOT carry `no-resolve` and will actively trigger DNS lookup on a domain. */
  triggersDnsLookup: boolean;
  message: string;
};

export type ProbeUnresolvedSourceReason =
  | 'uncached-remote'
  | 'uncached-catalog'
  | 'uncached-ruleset'
  | 'uncached-geosite'
  | 'uncached-geoip'
  | 'unsupported-asn-lookup';

export type ProbeUnresolvedSource = {
  cardId: string;
  cardName: string;
  stage: Stage;
  matcherIndex: number;
  matcherKind: Matcher['kind'];
  sourceLabel: string;
  reason: ProbeUnresolvedSourceReason;
  message: string;
};

export type ProbePolicyHop = {
  ref: PolicyRef;
  label: string;
  groupType?: string;
};

export type ProbeResult = {
  target: ParsedProbeTarget;
  matched: boolean;
  matchedByFinal: boolean;
  cardId: string | null;
  cardName: string | null;
  stage: Stage;
  matchedRule: ProbeMatchedRule;
  /** Direct policy target (usually the matched card or `body.final`). */
  policy: PolicyRef;
  /** Default policy resolution chain following each group's primary candidate. */
  policyChain: ProbePolicyHop[];
  /** Terminal resolved policy at the end of the default candidate chain. */
  finalPolicy: PolicyRef;
  /** DNS-dependent rules encountered prior to the match that could match earlier once resolved. */
  dnsResolutionPoints: ProbeDnsResolutionPoint[];
  /** Uncached remote/catalog/ruleset/geo sources encountered prior to the match. */
  unresolvedSources: ProbeUnresolvedSource[];
  /** True when an earlier DNS-dependent or uncached source might intercept the target before this result. */
  indeterminate: boolean;
};

const IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const PRIVATE_IPV4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '255.255.255.255/32',
];
const PRIVATE_IPV6_CIDRS = ['::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8'];
const PRIVATE_RANGES = [...PRIVATE_IPV4_CIDRS, ...PRIVATE_IPV6_CIDRS]
  .map((cidr) => parseCidrRange(cidr))
  .filter((range): range is NonNullable<typeof range> => range !== null);

function isValidIpv4(value: string): boolean {
  if (!IPV4_REGEX.test(value)) return false;
  return value.split('.').every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
}

function isValidIpv6(value: string): boolean {
  return parseCidrRange(`${value}/128`) !== null;
}

function parseIpPoint(ip: string): { ipv6: boolean; value: bigint } | null {
  const normalized = ip.trim();
  if (isValidIpv4(normalized)) {
    const range = parseCidrRange(`${normalized}/32`);
    return range ? { ipv6: false, value: range.start } : null;
  }
  if (normalized.includes(':')) {
    const range = parseCidrRange(`${normalized}/128`);
    return range ? { ipv6: true, value: range.start } : null;
  }
  return null;
}

function ipMatchesCidr(ip: string, cidr: string): boolean {
  const point = parseIpPoint(ip);
  if (!point) return false;
  const normalizedCidr = cidr.includes('/') ? cidr : `${cidr}/${cidr.includes(':') ? 128 : 32}`;
  const range = parseCidrRange(normalizedCidr);
  if (!range || range.ipv6 !== point.ipv6) return false;
  return point.value >= range.start && point.value <= range.end;
}

function isPrivateIp(ip: string): boolean {
  const point = parseIpPoint(ip);
  if (!point) return false;
  return PRIVATE_RANGES.some(
    (range) => range.ipv6 === point.ipv6 && point.value >= range.start && point.value <= range.end,
  );
}

function portMatches(port: number | undefined, spec: string): boolean {
  if (port === undefined) return false;
  const [startText, endText = startText] = spec.trim().split('-');
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
  return port >= start && port <= end;
}

function toCatalogMap(
  catalog?: ReadonlyMap<string, CatalogEntry> | readonly CatalogEntry[],
): Map<string, CatalogEntry> {
  if (!catalog) return new Map();
  if ('entries' in catalog && 'get' in catalog) {
    return new Map(catalog);
  }
  return new Map(catalog.map((entry) => [entry.id, entry]));
}

/** Parses a probe input string (domain, URL, IPv4, IPv6, or host:port). */
export function parseProbeTarget(rawInput: string, meta?: ProbeRequestMeta): ParsedProbeTarget {
  const raw = rawInput.trim();
  if (!raw) {
    throw new Error('Probe target must not be empty');
  }

  // Bracketed IPv6 with optional port: [::1]:443
  const bracketedIpv6 = /^\[([0-9a-f:]+)\](?::(\d{1,5}))?$/i.exec(raw);
  if (bracketedIpv6 && isValidIpv6(bracketedIpv6[1])) {
    const ip = bracketedIpv6[1].toLowerCase();
    const port = bracketedIpv6[2] ? Number(bracketedIpv6[2]) : meta?.dstPort;
    return { raw, kind: 'ipv6', ip, isIpv6: true, dstPort: port };
  }

  // Bare IPv4 or IPv6
  if (isValidIpv4(raw)) {
    return { raw, kind: 'ipv4', ip: raw, isIpv6: false, dstPort: meta?.dstPort };
  }
  if (!raw.includes('://') && raw.includes(':') && isValidIpv6(raw)) {
    return { raw, kind: 'ipv6', ip: raw.toLowerCase(), isIpv6: true, dstPort: meta?.dstPort };
  }

  // Full URL with scheme
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const hostname = parsed.hostname
        .replace(/^\[|\]$/g, '')
        .replace(/\.$/, '')
        .toLowerCase();
      const defaultPort = parsed.protocol === 'https:' ? 443 : parsed.protocol === 'http:' ? 80 : undefined;
      const dstPort = parsed.port ? Number(parsed.port) : (meta?.dstPort ?? defaultPort);
      if (isValidIpv4(hostname)) {
        return { raw, kind: 'url', host: hostname, ip: hostname, isIpv6: false, url: raw, dstPort };
      }
      if (hostname.includes(':') && isValidIpv6(hostname)) {
        return { raw, kind: 'url', host: hostname, ip: hostname, isIpv6: true, url: raw, dstPort };
      }
      return { raw, kind: 'url', host: hostname, url: raw, dstPort };
    } catch {
      // Fall through to host parsing
    }
  }

  // Bare host with optional :port or /path
  const hostPortMatch = /^([^/:]+):(\d{1,5})(\/.*)?$/.exec(raw);
  if (hostPortMatch) {
    const host = hostPortMatch[1].replace(/\.$/, '').toLowerCase();
    const dstPort = Number(hostPortMatch[2]);
    if (isValidIpv4(host)) {
      return { raw, kind: 'ipv4', ip: host, isIpv6: false, dstPort };
    }
    const url = hostPortMatch[3] ? `https://${raw}` : undefined;
    return {
      raw,
      kind: url ? 'url' : 'domain',
      host,
      url,
      dstPort,
    };
  }

  if (raw.includes('/')) {
    const slashIdx = raw.indexOf('/');
    const host = raw.slice(0, slashIdx).replace(/\.$/, '').toLowerCase();
    return {
      raw,
      kind: 'url',
      host,
      url: `https://${raw}`,
      dstPort: meta?.dstPort ?? 443,
    };
  }

  return {
    raw,
    kind: 'domain',
    host: raw.replace(/\.$/, '').toLowerCase(),
    dstPort: meta?.dstPort,
  };
}

type RuleEvalOutcome =
  | { status: 'matched'; rule: ProbeRuleEntry }
  | { status: 'not-matched' }
  | { status: 'needs-dns'; rule: ProbeRuleEntry }
  | { status: 'unresolved'; reason: ProbeUnresolvedSourceReason; label: string; message: string };

function evalSingleRule(
  rule: ProbeRuleEntry,
  target: ParsedProbeTarget,
  meta: ProbeRequestMeta | undefined,
  caches: ProbeCaches | undefined,
): RuleEvalOutcome {
  const value = rule.value.trim();
  const lowerValue = value.toLowerCase();
  const effectiveIp = target.ip ?? meta?.resolvedIp;
  const host = target.host;
  const dstPort = target.dstPort ?? meta?.dstPort;

  switch (rule.type) {
    case 'DOMAIN':
      return host && host === lowerValue ? { status: 'matched', rule } : { status: 'not-matched' };

    case 'DOMAIN-SUFFIX':
      return host && (host === lowerValue || host.endsWith(`.${lowerValue}`))
        ? { status: 'matched', rule }
        : { status: 'not-matched' };

    case 'DOMAIN-KEYWORD':
      return host && host.includes(lowerValue) ? { status: 'matched', rule } : { status: 'not-matched' };

    case 'DOMAIN-REGEX': {
      if (!host) return { status: 'not-matched' };
      try {
        const cleaned = value.replace(/^\(\?i\)/, '');
        const regex = new RegExp(cleaned, 'i');
        return regex.test(host) ? { status: 'matched', rule } : { status: 'not-matched' };
      } catch {
        return { status: 'not-matched' };
      }
    }

    case 'URL-REGEX': {
      const candidateUrl = target.url ?? (host ? `https://${host}` : undefined);
      if (!candidateUrl) return { status: 'not-matched' };
      try {
        const cleaned = value.replace(/^\(\?i\)/, '');
        const regex = new RegExp(cleaned, 'i');
        return regex.test(candidateUrl) ? { status: 'matched', rule } : { status: 'not-matched' };
      } catch {
        return { status: 'not-matched' };
      }
    }

    case 'IP-CIDR': {
      if (effectiveIp) {
        return ipMatchesCidr(effectiveIp, value) ? { status: 'matched', rule } : { status: 'not-matched' };
      }
      if (host) {
        return { status: 'needs-dns', rule };
      }
      return { status: 'not-matched' };
    }

    case 'SRC-IP-CIDR':
      return meta?.srcIp && ipMatchesCidr(meta.srcIp, value) ? { status: 'matched', rule } : { status: 'not-matched' };

    case 'IP-ASN': {
      if (host && !effectiveIp) {
        return { status: 'needs-dns', rule };
      }
      return {
        status: 'unresolved',
        reason: 'unsupported-asn-lookup',
        label: `IP-ASN,${value}`,
        message: `无法在离线命中测试中查询 ASN 数据库（IP-ASN,${value}）。`,
      };
    }

    case 'GEOIP': {
      if (effectiveIp) {
        const geoName = lowerValue;
        const cached = caches?.geoipRules?.get(geoName);
        if (cached) {
          for (const entry of cached) {
            if (ipMatchesCidr(effectiveIp, entry.value)) {
              return { status: 'matched', rule };
            }
          }
          return { status: 'not-matched' };
        }
        if (geoName === 'private') {
          return isPrivateIp(effectiveIp) ? { status: 'matched', rule } : { status: 'not-matched' };
        }
        return {
          status: 'unresolved',
          reason: 'uncached-geoip',
          label: `GEOIP,${value}`,
          message: `GEOIP(${value}) 未加载缓存数据，无法离线判定 IP 归属。`,
        };
      }
      if (host) {
        return { status: 'needs-dns', rule };
      }
      return { status: 'not-matched' };
    }

    case 'GEOSITE': {
      const geoName = lowerValue;
      const cached = caches?.geositeRules?.get(geoName);
      if (!cached) {
        return {
          status: 'unresolved',
          reason: 'uncached-geosite',
          label: `GEOSITE,${value}`,
          message: `GEOSITE(${value}) 未加载缓存规则，无法离线判定。`,
        };
      }
      for (const entry of cached) {
        const res = evalSingleRule(entry, target, meta, caches);
        if (res.status === 'matched') return { status: 'matched', rule: entry };
      }
      return { status: 'not-matched' };
    }

    case 'DST-PORT':
      return portMatches(dstPort, value) ? { status: 'matched', rule } : { status: 'not-matched' };

    case 'SRC-PORT':
      return portMatches(meta?.srcPort, value) ? { status: 'matched', rule } : { status: 'not-matched' };

    case 'PROCESS-NAME':
      return meta?.processName && meta.processName.toLowerCase() === lowerValue
        ? { status: 'matched', rule }
        : { status: 'not-matched' };

    case 'USER-AGENT': {
      if (!meta?.userAgent) return { status: 'not-matched' };
      const pattern = value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(`^${pattern}$`, 'i').test(meta.userAgent)
        ? { status: 'matched', rule }
        : { status: 'not-matched' };
    }
  }
}

type ConditionEvalOutcome =
  | { status: 'matched'; summary: string; ruleType: string; ruleValue: string; noResolve?: boolean }
  | { status: 'not-matched' }
  | { status: 'needs-dns'; rules: ProbeRuleEntry[] }
  | { status: 'unresolved'; items: Array<{ reason: ProbeUnresolvedSourceReason; label: string; message: string }> };

function formatConditionSummary(cond: Condition): string {
  if (cond.op === 'rule') {
    const suffix = cond.rule.options?.noResolve ? ',no-resolve' : '';
    return `${cond.rule.type},${cond.rule.value}${suffix}`;
  }
  if (cond.op === 'not') {
    return `NOT,(${formatConditionSummary(cond.item)})`;
  }
  return `${cond.op.toUpperCase()},(${cond.items.map(formatConditionSummary).join(',')})`;
}

function evalCondition(
  cond: Condition,
  target: ParsedProbeTarget,
  meta: ProbeRequestMeta | undefined,
  caches: ProbeCaches | undefined,
): ConditionEvalOutcome {
  if (cond.op === 'rule') {
    const res = evalSingleRule(cond.rule, target, meta, caches);
    if (res.status === 'matched') {
      return {
        status: 'matched',
        summary: formatConditionSummary(cond),
        ruleType: res.rule.type,
        ruleValue: res.rule.value,
        noResolve: res.rule.options?.noResolve,
      };
    }
    if (res.status === 'needs-dns') {
      return { status: 'needs-dns', rules: [res.rule] };
    }
    if (res.status === 'unresolved') {
      return { status: 'unresolved', items: [{ reason: res.reason, label: res.label, message: res.message }] };
    }
    return { status: 'not-matched' };
  }

  if (cond.op === 'not') {
    const inner = evalCondition(cond.item, target, meta, caches);
    if (inner.status === 'matched') return { status: 'not-matched' };
    if (inner.status === 'not-matched') {
      return {
        status: 'matched',
        summary: formatConditionSummary(cond),
        ruleType: 'NOT',
        ruleValue: formatConditionSummary(cond.item),
      };
    }
    return inner;
  }

  if (cond.op === 'and') {
    const dnsRules: ProbeRuleEntry[] = [];
    const unresolved: Array<{ reason: ProbeUnresolvedSourceReason; label: string; message: string }> = [];
    for (const item of cond.items) {
      const res = evalCondition(item, target, meta, caches);
      if (res.status === 'not-matched') return { status: 'not-matched' };
      if (res.status === 'needs-dns') dnsRules.push(...res.rules);
      if (res.status === 'unresolved') unresolved.push(...res.items);
    }
    if (dnsRules.length > 0) return { status: 'needs-dns', rules: dnsRules };
    if (unresolved.length > 0) return { status: 'unresolved', items: unresolved };
    return {
      status: 'matched',
      summary: formatConditionSummary(cond),
      ruleType: 'AND',
      ruleValue: cond.items.map(formatConditionSummary).join(' && '),
    };
  }

  // cond.op === 'or'
  const dnsRules: ProbeRuleEntry[] = [];
  const unresolved: Array<{ reason: ProbeUnresolvedSourceReason; label: string; message: string }> = [];
  for (const item of cond.items) {
    const res = evalCondition(item, target, meta, caches);
    if (res.status === 'matched') {
      return {
        status: 'matched',
        summary: formatConditionSummary(cond),
        ruleType: res.ruleType,
        ruleValue: res.ruleValue,
        noResolve: res.noResolve,
      };
    }
    if (res.status === 'needs-dns') dnsRules.push(...res.rules);
    if (res.status === 'unresolved') unresolved.push(...res.items);
  }
  if (dnsRules.length > 0) return { status: 'needs-dns', rules: dnsRules };
  if (unresolved.length > 0) return { status: 'unresolved', items: unresolved };
  return { status: 'not-matched' };
}

function resolvePolicyChain(
  startPolicy: PolicyRef,
  body: TemplateBody,
  resolvedCardById: ReadonlyMap<string, ResolvedTemplateCard>,
): { policyChain: ProbePolicyHop[]; finalPolicy: PolicyRef } {
  const regionById = new Map(body.regionGroups.map((rg) => [rg.id, rg]));
  const slotById = new Map(body.slots.map((slot) => [slot.id, slot]));
  const chain: ProbePolicyHop[] = [];
  const visitedCards = new Set<string>();
  let current: PolicyRef = startPolicy;

  for (let depth = 0; depth < 32; depth += 1) {
    if (current.kind === 'builtin') {
      chain.push({ ref: current, label: current.id });
      return { policyChain: chain, finalPolicy: current };
    }
    if (current.kind === 'region') {
      const region = regionById.get(current.regionGroupId);
      chain.push({
        ref: current,
        label: region?.name ?? current.regionGroupId,
        groupType: region?.type,
      });
      return { policyChain: chain, finalPolicy: current };
    }
    if (current.kind === 'slot') {
      const slot = slotById.get(current.slotId);
      chain.push({
        ref: current,
        label: slot?.name ?? current.slotId,
      });
      return { policyChain: chain, finalPolicy: current };
    }

    // current.kind === 'card'
    const card = resolvedCardById.get(current.cardId);
    chain.push({
      ref: current,
      label: card?.effective.name ?? current.cardId,
      groupType: card?.effectiveGroupType,
    });
    if (!card || !card.enabled || visitedCards.has(current.cardId)) {
      return { policyChain: chain, finalPolicy: current };
    }
    visitedCards.add(current.cardId);
    const nextCandidate = card.effective.group.candidates[0];
    if (!nextCandidate) {
      return { policyChain: chain, finalPolicy: current };
    }
    current = nextCandidate;
  }

  return { policyChain: chain, finalPolicy: current };
}

function buildRuleListOutcome(
  entries: readonly ProbeRuleEntry[],
  target: ParsedProbeTarget,
  meta: ProbeRequestMeta | undefined,
  caches: ProbeCaches | undefined,
  card: AppCard,
  matcherIndex: number,
  matcherKind: Matcher['kind'],
  sourceLabel: string,
  dnsResolutionPoints: ProbeDnsResolutionPoint[],
): ProbeMatchedRule | null {
  for (const entry of entries) {
    const res = evalSingleRule(entry, target, meta, caches);
    if (res.status === 'matched') {
      return {
        type: entry.type,
        value: entry.value,
        matcherKind,
        matcherIndex,
        sourceLabel,
        summary: `${entry.type},${entry.value}${entry.options?.noResolve ? ',no-resolve' : ''}`,
        noResolve: entry.options?.noResolve,
      };
    }
    if (res.status === 'needs-dns') {
      const noResolve = Boolean(entry.options?.noResolve);
      dnsResolutionPoints.push({
        cardId: card.id,
        cardName: card.name,
        stage: card.stage,
        matcherIndex,
        ruleSummary: `${entry.type},${entry.value}${noResolve ? ',no-resolve' : ''}`,
        noResolve,
        triggersDnsLookup: !noResolve,
        message: noResolve
          ? `规则 ${entry.type},${entry.value},no-resolve 需要解析后的 IP，若域名已解析可能在此处更早命中。`
          : `规则 ${entry.type},${entry.value} 缺少 no-resolve，将触发 DNS 解析并可能在此处更早命中。`,
      });
    }
  }
  return null;
}

/**
 * Pure domain/URL/IP hit test against a template (design §10.8).
 * Evaluates enabled non-hidden cards in template order, records DNS-dependent
 * rules without guessing, and flags uncached remote/catalog/ruleset/geo sources.
 */
export function probeTemplate(input: ProbeInput): ProbeResult {
  const target = parseProbeTarget(input.target, input.meta);
  const resolved = resolveTemplateCards(input.body, input.cards);
  const resolvedCardById = new Map<string, ResolvedTemplateCard>(resolved.cards.map((card) => [card.cardId, card]));
  const catalogMap = toCatalogMap(input.caches?.catalogIndex);
  const dnsResolutionPoints: ProbeDnsResolutionPoint[] = [];
  const unresolvedSources: ProbeUnresolvedSource[] = [];

  for (const resolvedCard of resolved.cards) {
    if (!resolvedCard.enabled) continue;
    const card = resolvedCard.effective;
    if (card.hidden) continue;

    for (let matcherIndex = 0; matcherIndex < card.matchers.length; matcherIndex += 1) {
      const matcher = card.matchers[matcherIndex];

      switch (matcher.kind) {
        case 'inline': {
          for (const cond of matcher.conditions) {
            const outcome = evalCondition(cond, target, input.meta, input.caches);
            if (outcome.status === 'matched') {
              const policy: PolicyRef = { kind: 'card', cardId: card.id };
              const { policyChain, finalPolicy } = resolvePolicyChain(policy, input.body, resolvedCardById);
              return {
                target,
                matched: true,
                matchedByFinal: false,
                cardId: card.id,
                cardName: card.name,
                stage: card.stage,
                matchedRule: {
                  type: outcome.ruleType,
                  value: outcome.ruleValue,
                  matcherKind: 'inline',
                  matcherIndex,
                  sourceLabel: `inline:${card.id}`,
                  summary: outcome.summary,
                  noResolve: outcome.noResolve,
                },
                policy,
                policyChain,
                finalPolicy,
                dnsResolutionPoints,
                unresolvedSources,
                indeterminate: dnsResolutionPoints.length > 0 || unresolvedSources.length > 0,
              };
            }
            if (outcome.status === 'needs-dns') {
              for (const rule of outcome.rules) {
                const noResolve = Boolean(rule.options?.noResolve);
                dnsResolutionPoints.push({
                  cardId: card.id,
                  cardName: card.name,
                  stage: card.stage,
                  matcherIndex,
                  ruleSummary: `${rule.type},${rule.value}${noResolve ? ',no-resolve' : ''}`,
                  noResolve,
                  triggersDnsLookup: !noResolve,
                  message: noResolve
                    ? `规则 ${rule.type},${rule.value},no-resolve 需要解析后的 IP，可能在此处更早命中。`
                    : `规则 ${rule.type},${rule.value} 未加 no-resolve，会触发 DNS 解析并可能在此处更早命中。`,
                });
              }
            }
            if (outcome.status === 'unresolved') {
              for (const item of outcome.items) {
                unresolvedSources.push({
                  cardId: card.id,
                  cardName: card.name,
                  stage: card.stage,
                  matcherIndex,
                  matcherKind: 'inline',
                  sourceLabel: item.label,
                  reason: item.reason,
                  message: item.message,
                });
              }
            }
          }
          break;
        }

        case 'geosite': {
          const geoName = matcher.name.trim().toLowerCase();
          const cached = input.caches?.geositeRules?.get(geoName);
          if (!cached) {
            unresolvedSources.push({
              cardId: card.id,
              cardName: card.name,
              stage: card.stage,
              matcherIndex,
              matcherKind: 'geosite',
              sourceLabel: `GEOSITE,${matcher.name}`,
              reason: 'uncached-geosite',
              message: `GEOSITE(${matcher.name}) 未加载缓存规则，无法离线判定。`,
            });
            break;
          }
          const matchedRule = buildRuleListOutcome(
            cached,
            target,
            input.meta,
            input.caches,
            card,
            matcherIndex,
            'geosite',
            `GEOSITE,${matcher.name}`,
            dnsResolutionPoints,
          );
          if (matchedRule) {
            const policy: PolicyRef = { kind: 'card', cardId: card.id };
            const { policyChain, finalPolicy } = resolvePolicyChain(policy, input.body, resolvedCardById);
            return {
              target,
              matched: true,
              matchedByFinal: false,
              cardId: card.id,
              cardName: card.name,
              stage: card.stage,
              matchedRule,
              policy,
              policyChain,
              finalPolicy,
              dnsResolutionPoints,
              unresolvedSources,
              indeterminate: dnsResolutionPoints.length > 0 || unresolvedSources.length > 0,
            };
          }
          break;
        }

        case 'geoip': {
          const effectiveIp = target.ip ?? input.meta?.resolvedIp;
          const noResolve = Boolean(matcher.noResolve);
          const geoName = matcher.name.trim().toLowerCase();
          if (!effectiveIp) {
            dnsResolutionPoints.push({
              cardId: card.id,
              cardName: card.name,
              stage: card.stage,
              matcherIndex,
              ruleSummary: `GEOIP,${matcher.name}${noResolve ? ',no-resolve' : ''}`,
              noResolve,
              triggersDnsLookup: !noResolve,
              message: noResolve
                ? `GEOIP,${matcher.name},no-resolve 需要域名解析后的 IP，可能在此处更早命中。`
                : `GEOIP,${matcher.name} 未加 no-resolve，会触发 DNS 解析并可能在此处更早命中。`,
            });
            break;
          }

          const cached = input.caches?.geoipRules?.get(geoName);
          const isMatched = cached
            ? cached.some((entry) => ipMatchesCidr(effectiveIp, entry.value))
            : geoName === 'private'
              ? isPrivateIp(effectiveIp)
              : null;

          if (isMatched === null) {
            unresolvedSources.push({
              cardId: card.id,
              cardName: card.name,
              stage: card.stage,
              matcherIndex,
              matcherKind: 'geoip',
              sourceLabel: `GEOIP,${matcher.name}`,
              reason: 'uncached-geoip',
              message: `GEOIP(${matcher.name}) 未加载缓存数据，无法离线判定 IP 归属。`,
            });
            break;
          }

          if (isMatched) {
            const policy: PolicyRef = { kind: 'card', cardId: card.id };
            const { policyChain, finalPolicy } = resolvePolicyChain(policy, input.body, resolvedCardById);
            return {
              target,
              matched: true,
              matchedByFinal: false,
              cardId: card.id,
              cardName: card.name,
              stage: card.stage,
              matchedRule: {
                type: 'GEOIP',
                value: matcher.name,
                matcherKind: 'geoip',
                matcherIndex,
                sourceLabel: `GEOIP,${matcher.name}`,
                summary: `GEOIP,${matcher.name}${noResolve ? ',no-resolve' : ''}`,
                noResolve,
              },
              policy,
              policyChain,
              finalPolicy,
              dnsResolutionPoints,
              unresolvedSources,
              indeterminate: dnsResolutionPoints.length > 0 || unresolvedSources.length > 0,
            };
          }
          break;
        }

        case 'ruleset': {
          const cached = input.caches?.rulesetRules?.get(matcher.ruleSetId);
          if (!cached) {
            unresolvedSources.push({
              cardId: card.id,
              cardName: card.name,
              stage: card.stage,
              matcherIndex,
              matcherKind: 'ruleset',
              sourceLabel: `ruleset:${matcher.ruleSetId}`,
              reason: 'uncached-ruleset',
              message: `规则集 ${matcher.ruleSetId} 未加载规则缓存，无法判定是否命中。`,
            });
            break;
          }
          const matchedRule = buildRuleListOutcome(
            cached,
            target,
            input.meta,
            input.caches,
            card,
            matcherIndex,
            'ruleset',
            `ruleset:${matcher.ruleSetId}`,
            dnsResolutionPoints,
          );
          if (matchedRule) {
            const policy: PolicyRef = { kind: 'card', cardId: card.id };
            const { policyChain, finalPolicy } = resolvePolicyChain(policy, input.body, resolvedCardById);
            return {
              target,
              matched: true,
              matchedByFinal: false,
              cardId: card.id,
              cardName: card.name,
              stage: card.stage,
              matchedRule,
              policy,
              policyChain,
              finalPolicy,
              dnsResolutionPoints,
              unresolvedSources,
              indeterminate: dnsResolutionPoints.length > 0 || unresolvedSources.length > 0,
            };
          }
          break;
        }

        case 'catalog': {
          const catalogEntry = catalogMap.get(matcher.entryId);
          const cached =
            input.caches?.catalogRules?.get(matcher.entryId) ??
            (catalogEntry ? input.caches?.remoteRules?.get(catalogEntry.sourceUrl) : undefined);
          if (!cached) {
            unresolvedSources.push({
              cardId: card.id,
              cardName: card.name,
              stage: card.stage,
              matcherIndex,
              matcherKind: 'catalog',
              sourceLabel: `catalog:${matcher.entryId}`,
              reason: 'uncached-catalog',
              message: `规则目录条目 ${matcher.entryId} 未缓存，无法离线判定是否命中。`,
            });
            break;
          }
          const matchedRule = buildRuleListOutcome(
            cached,
            target,
            input.meta,
            input.caches,
            card,
            matcherIndex,
            'catalog',
            `catalog:${matcher.entryId}`,
            dnsResolutionPoints,
          );
          if (matchedRule) {
            const policy: PolicyRef = { kind: 'card', cardId: card.id };
            const { policyChain, finalPolicy } = resolvePolicyChain(policy, input.body, resolvedCardById);
            return {
              target,
              matched: true,
              matchedByFinal: false,
              cardId: card.id,
              cardName: card.name,
              stage: card.stage,
              matchedRule,
              policy,
              policyChain,
              finalPolicy,
              dnsResolutionPoints,
              unresolvedSources,
              indeterminate: dnsResolutionPoints.length > 0 || unresolvedSources.length > 0,
            };
          }
          break;
        }

        case 'remote': {
          const cached = input.caches?.remoteRules?.get(matcher.url);
          if (!cached) {
            unresolvedSources.push({
              cardId: card.id,
              cardName: card.name,
              stage: card.stage,
              matcherIndex,
              matcherKind: 'remote',
              sourceLabel: matcher.url,
              reason: 'uncached-remote',
              message: `远程规则集 ${matcher.url} 未缓存，无法判定是否命中。`,
            });
            break;
          }
          const matchedRule = buildRuleListOutcome(
            cached,
            target,
            input.meta,
            input.caches,
            card,
            matcherIndex,
            'remote',
            matcher.url,
            dnsResolutionPoints,
          );
          if (matchedRule) {
            const policy: PolicyRef = { kind: 'card', cardId: card.id };
            const { policyChain, finalPolicy } = resolvePolicyChain(policy, input.body, resolvedCardById);
            return {
              target,
              matched: true,
              matchedByFinal: false,
              cardId: card.id,
              cardName: card.name,
              stage: card.stage,
              matchedRule,
              policy,
              policyChain,
              finalPolicy,
              dnsResolutionPoints,
              unresolvedSources,
              indeterminate: dnsResolutionPoints.length > 0 || unresolvedSources.length > 0,
            };
          }
          break;
        }
      }
    }
  }

  // Fallback to FINAL / MATCH
  const { policyChain, finalPolicy } = resolvePolicyChain(input.body.final, input.body, resolvedCardById);
  const finalCardId = input.body.final.kind === 'card' ? input.body.final.cardId : null;
  const finalCardName = finalCardId ? (resolvedCardById.get(finalCardId)?.effective.name ?? finalCardId) : null;

  return {
    target,
    matched: true,
    matchedByFinal: true,
    cardId: finalCardId,
    cardName: finalCardName,
    stage: 'final',
    matchedRule: {
      type: 'FINAL',
      value: finalCardName ?? (input.body.final.kind === 'builtin' ? input.body.final.id : 'FINAL'),
      matcherKind: 'final',
      matcherIndex: -1,
      sourceLabel: 'FINAL',
      summary: 'FINAL (兜底)',
    },
    policy: input.body.final,
    policyChain,
    finalPolicy,
    dnsResolutionPoints,
    unresolvedSources,
    indeterminate: dnsResolutionPoints.length > 0 || unresolvedSources.length > 0,
  };
}
