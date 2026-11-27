import type { DomainRule, DomainRuleType } from '../../types/domain-rules';
import { parseRuleInput } from './parser';
import { RULE_TYPES } from './rule-types';

export type FriendlyRuleTypeKey =
  | 'ruleType.DOMAIN'
  | 'ruleType.DOMAIN-SUFFIX'
  | 'ruleType.DOMAIN-SUFFIX-OPTION'
  | 'ruleType.DOMAIN-KEYWORD'
  | 'ruleType.DOMAIN-REGEX'
  | 'ruleType.IP-CIDR'
  | 'ruleType.IP-CIDR-SINGLE'
  | 'ruleType.IP-CIDR-RANGE'
  | 'ruleType.SRC-IP-CIDR'
  | 'ruleType.SRC-IP-CIDR-RANGE'
  | 'ruleType.IP-ASN'
  | 'ruleType.DST-PORT'
  | 'ruleType.SRC-PORT'
  | 'ruleType.GEOSITE'
  | 'ruleType.GEOIP'
  | 'ruleType.PROCESS-NAME'
  | 'ruleType.USER-AGENT'
  | 'ruleType.URL-REGEX'
  | 'ruleType.NETWORK';

export type FriendlyRuleTypeDescKey =
  | 'ruleTypeDesc.AUTO'
  | 'ruleTypeDesc.DOMAIN'
  | 'ruleTypeDesc.DOMAIN-SUFFIX'
  | 'ruleTypeDesc.DOMAIN-KEYWORD'
  | 'ruleTypeDesc.DOMAIN-REGEX'
  | 'ruleTypeDesc.IP-CIDR'
  | 'ruleTypeDesc.SRC-IP-CIDR'
  | 'ruleTypeDesc.IP-ASN'
  | 'ruleTypeDesc.DST-PORT'
  | 'ruleTypeDesc.SRC-PORT'
  | 'ruleTypeDesc.GEOSITE'
  | 'ruleTypeDesc.GEOIP'
  | 'ruleTypeDesc.PROCESS-NAME'
  | 'ruleTypeDesc.USER-AGENT'
  | 'ruleTypeDesc.URL-REGEX'
  | 'ruleTypeDesc.NETWORK';

export type FriendlyRuleInlineKey =
  | 'ruleInline.domainSuffix'
  | 'ruleInline.domainKeyword'
  | 'ruleInline.singleIp'
  | 'ruleInline.ipv4RangeExact'
  | 'ruleInline.ipv4RangeTenThousands'
  | 'ruleInline.ipv4RangeHundredMillions'
  | 'ruleInline.ipv6Range'
  | 'ruleInline.typedValue';

export type IpCidrCountScale = 'exact' | 'tenThousands' | 'hundredMillions';

export type IpCidrInfo =
  | {
      kind: 'single';
      version: 4 | 6;
      address: string;
      prefix: 32 | 128;
      count: 1;
    }
  | {
      kind: 'ipv4-range';
      version: 4;
      start: string;
      end: string;
      prefix: number;
      count: number;
      countScale: IpCidrCountScale;
      zhCount: string;
      enCount: string;
    }
  | {
      kind: 'ipv6-range';
      version: 6;
      prefixAddress: string;
      prefix: number;
    };

export type FriendlyRuleDescriptor = {
  typeKey: FriendlyRuleTypeKey;
  descriptionKey: FriendlyRuleTypeDescKey;
  inlineKey: FriendlyRuleInlineKey;
  params: {
    value: string;
    displayValue: string;
    start?: string;
    end?: string;
    count?: string;
    zhCount?: string;
    enCount?: string;
    prefix?: string;
  };
};

export type RuleTypeOptionGroup = 'common' | 'advanced';

export type RuleTypeOptionDescriptor = {
  type: DomainRuleType;
  labelKey: FriendlyRuleTypeKey;
  optionLabelKey: FriendlyRuleTypeKey;
  descriptionKey: FriendlyRuleTypeDescKey;
  group: RuleTypeOptionGroup;
};

export type RuleInputPreview =
  | {
      ok: true;
      type: DomainRuleType;
      value: string;
      isIpType: boolean;
      hasNoResolve: boolean;
      friendly: FriendlyRuleDescriptor;
    }
  | {
      ok: false;
      error: string;
    };

export const COMMON_RULE_TYPES: ReadonlyArray<DomainRuleType> = [
  'DOMAIN-SUFFIX',
  'DOMAIN',
  'DOMAIN-KEYWORD',
  'IP-CIDR',
  'PROCESS-NAME',
];

const COMMON_RULE_TYPE_SET = new Set<DomainRuleType>(COMMON_RULE_TYPES);

export const ADVANCED_RULE_TYPES: ReadonlyArray<DomainRuleType> = RULE_TYPES.filter(
  (type) => !COMMON_RULE_TYPE_SET.has(type),
);

const TYPE_KEY_MAP: Record<DomainRuleType, FriendlyRuleTypeKey> = {
  DOMAIN: 'ruleType.DOMAIN',
  'DOMAIN-SUFFIX': 'ruleType.DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD': 'ruleType.DOMAIN-KEYWORD',
  'DOMAIN-REGEX': 'ruleType.DOMAIN-REGEX',
  'IP-CIDR': 'ruleType.IP-CIDR',
  'SRC-IP-CIDR': 'ruleType.SRC-IP-CIDR',
  'IP-ASN': 'ruleType.IP-ASN',
  'DST-PORT': 'ruleType.DST-PORT',
  'SRC-PORT': 'ruleType.SRC-PORT',
  GEOSITE: 'ruleType.GEOSITE',
  GEOIP: 'ruleType.GEOIP',
  'PROCESS-NAME': 'ruleType.PROCESS-NAME',
  'USER-AGENT': 'ruleType.USER-AGENT',
  'URL-REGEX': 'ruleType.URL-REGEX',
  NETWORK: 'ruleType.NETWORK',
};

const OPTION_LABEL_KEY_MAP: Record<DomainRuleType, FriendlyRuleTypeKey> = {
  ...TYPE_KEY_MAP,
  'DOMAIN-SUFFIX': 'ruleType.DOMAIN-SUFFIX-OPTION',
};

const TYPE_DESC_KEY_MAP: Record<DomainRuleType, FriendlyRuleTypeDescKey> = {
  DOMAIN: 'ruleTypeDesc.DOMAIN',
  'DOMAIN-SUFFIX': 'ruleTypeDesc.DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD': 'ruleTypeDesc.DOMAIN-KEYWORD',
  'DOMAIN-REGEX': 'ruleTypeDesc.DOMAIN-REGEX',
  'IP-CIDR': 'ruleTypeDesc.IP-CIDR',
  'SRC-IP-CIDR': 'ruleTypeDesc.SRC-IP-CIDR',
  'IP-ASN': 'ruleTypeDesc.IP-ASN',
  'DST-PORT': 'ruleTypeDesc.DST-PORT',
  'SRC-PORT': 'ruleTypeDesc.SRC-PORT',
  GEOSITE: 'ruleTypeDesc.GEOSITE',
  GEOIP: 'ruleTypeDesc.GEOIP',
  'PROCESS-NAME': 'ruleTypeDesc.PROCESS-NAME',
  'USER-AGENT': 'ruleTypeDesc.USER-AGENT',
  'URL-REGEX': 'ruleTypeDesc.URL-REGEX',
  NETWORK: 'ruleTypeDesc.NETWORK',
};

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;
const IPV6_GROUP_REGEX = /^[0-9a-f]{1,4}$/i;

function parseIpv4Int(octets: [number, number, number, number]): number | null {
  for (const part of octets) {
    if (!Number.isInteger(part) || part < 0 || part > 255) return null;
  }
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function intToIpv4(value: number): string {
  return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

function formatCompactDecimal(value: number): string {
  const truncated = Math.floor(value * 10) / 10;
  return Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(1);
}

function formatEnglishCompactCount(count: number): string {
  if (count >= 1_000_000_000) {
    const billions = Math.floor(count / 10_000_000) / 100;
    return `${billions.toFixed(2).replace(/\.?0+$/, '')}B`;
  }
  if (count >= 1_000_000) {
    return `${formatCompactDecimal(count / 1_000_000)}M`;
  }
  if (count >= 100_000) {
    return `${Math.floor(count / 1_000)}K`;
  }
  return count.toLocaleString('en-US');
}

function parseIpv6ToBigInt(address: string): bigint | null {
  if (!address.includes(':')) return null;
  const doubleColonParts = address.split('::');
  if (doubleColonParts.length > 2) return null;

  let groups: string[];
  if (doubleColonParts.length === 1) {
    groups = address.split(':');
    if (groups.length !== 8) return null;
  } else {
    const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
    const right = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  }

  let result = 0n;
  for (const group of groups) {
    if (!IPV6_GROUP_REGEX.test(group)) return null;
    result = (result << 16n) | BigInt(parseInt(group, 16));
  }
  return result;
}

function formatIpv6FromBigInt(value: bigint): string {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i -= 1) {
    groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));
  }

  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i += 1) {
    if (groups[i] === 0) {
      if (curStart === -1) curStart = i;
      curLen += 1;
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestLen < 2) {
    return groups.map((g) => g.toString(16)).join(':');
  }

  const left = groups
    .slice(0, bestStart)
    .map((g) => g.toString(16))
    .join(':');
  const right = groups
    .slice(bestStart + bestLen)
    .map((g) => g.toString(16))
    .join(':');
  return `${left}::${right}`;
}

/**
 * Pure CIDR parser/converter that translates IPv4 and IPv6 addresses or CIDR
 * blocks into beginner-friendly single-host or start–end range metadata.
 */
export function describeIpCidr(rawValue: string): IpCidrInfo | null {
  const trimmed = rawValue.trim().toLowerCase();
  if (!trimmed) return null;

  const v4Match = IPV4_REGEX.exec(trimmed);
  if (v4Match) {
    const ipInt = parseIpv4Int([Number(v4Match[1]), Number(v4Match[2]), Number(v4Match[3]), Number(v4Match[4])]);
    if (ipInt === null) return null;
    const prefix = v4Match[5] === undefined ? 32 : Number(v4Match[5]);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;

    if (prefix === 32) {
      return {
        kind: 'single',
        version: 4,
        address: intToIpv4(ipInt),
        prefix: 32,
        count: 1,
      };
    }

    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const startInt = (ipInt & mask) >>> 0;
    const hostMask = prefix === 0 ? 0xffffffff : (0xffffffff >>> prefix) >>> 0;
    const endInt = (startInt | hostMask) >>> 0;
    const count = 2 ** (32 - prefix);

    let countScale: IpCidrCountScale;
    let zhCount: string;
    if (count >= 100_000_000) {
      countScale = 'hundredMillions';
      zhCount = formatCompactDecimal(count / 100_000_000);
    } else if (count >= 100_000) {
      countScale = 'tenThousands';
      zhCount = String(Math.floor(count / 10_000));
    } else {
      countScale = 'exact';
      zhCount = count.toLocaleString('en-US');
    }

    return {
      kind: 'ipv4-range',
      version: 4,
      start: intToIpv4(startInt),
      end: intToIpv4(endInt),
      prefix,
      count,
      countScale,
      zhCount,
      enCount: formatEnglishCompactCount(count),
    };
  }

  const slashIdx = trimmed.indexOf('/');
  const addressPart = slashIdx === -1 ? trimmed : trimmed.slice(0, slashIdx);
  const prefixPart = slashIdx === -1 ? undefined : trimmed.slice(slashIdx + 1);
  if (prefixPart !== undefined && !/^\d{1,3}$/.test(prefixPart)) return null;

  const v6Int = parseIpv6ToBigInt(addressPart);
  if (v6Int === null) return null;
  const prefix = prefixPart === undefined ? 128 : Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;

  if (prefix === 128) {
    return {
      kind: 'single',
      version: 6,
      address: formatIpv6FromBigInt(v6Int),
      prefix: 128,
      count: 1,
    };
  }

  const shift = BigInt(128 - prefix);
  const masked = prefix === 0 ? 0n : (v6Int >> shift) << shift;
  return {
    kind: 'ipv6-range',
    version: 6,
    prefixAddress: formatIpv6FromBigInt(masked),
    prefix,
  };
}

export function isIpCidrRuleType(type: DomainRuleType | 'IP-CIDR6' | 'AUTO' | '' | undefined): boolean {
  return type === 'IP-CIDR' || type === 'IP-CIDR6' || type === 'SRC-IP-CIDR';
}

export function isSingleHostCidr(type: DomainRuleType, value: string): boolean {
  if (type !== 'IP-CIDR' && type !== 'SRC-IP-CIDR') return false;
  const info = describeIpCidr(value);
  return info?.kind === 'single';
}

/**
 * Pure domain mapping from a rule's canonical type + value to i18n message keys
 * and interpolation parameters for plain-language display.
 */
export function describeRuleFriendly(rule: Pick<DomainRule, 'type' | 'value'>): FriendlyRuleDescriptor {
  const descriptionKey = TYPE_DESC_KEY_MAP[rule.type];

  if (rule.type === 'DOMAIN-SUFFIX') {
    return {
      typeKey: 'ruleType.DOMAIN-SUFFIX',
      descriptionKey,
      inlineKey: 'ruleInline.domainSuffix',
      params: { value: rule.value, displayValue: rule.value },
    };
  }

  if (rule.type === 'DOMAIN-KEYWORD') {
    return {
      typeKey: 'ruleType.DOMAIN-KEYWORD',
      descriptionKey,
      inlineKey: 'ruleInline.domainKeyword',
      params: { value: rule.value, displayValue: rule.value },
    };
  }

  if (rule.type === 'IP-CIDR' || rule.type === 'SRC-IP-CIDR') {
    const isSrc = rule.type === 'SRC-IP-CIDR';
    const ipInfo = describeIpCidr(rule.value);

    if (ipInfo?.kind === 'single') {
      return {
        typeKey: isSrc ? 'ruleType.SRC-IP-CIDR' : 'ruleType.IP-CIDR-SINGLE',
        descriptionKey,
        inlineKey: 'ruleInline.singleIp',
        params: { value: rule.value, displayValue: ipInfo.address },
      };
    }

    if (ipInfo?.kind === 'ipv4-range') {
      const inlineKey: FriendlyRuleInlineKey =
        ipInfo.countScale === 'hundredMillions'
          ? 'ruleInline.ipv4RangeHundredMillions'
          : ipInfo.countScale === 'tenThousands'
            ? 'ruleInline.ipv4RangeTenThousands'
            : 'ruleInline.ipv4RangeExact';

      return {
        typeKey: isSrc ? 'ruleType.SRC-IP-CIDR-RANGE' : 'ruleType.IP-CIDR-RANGE',
        descriptionKey,
        inlineKey,
        params: {
          value: rule.value,
          displayValue: rule.value,
          start: ipInfo.start,
          end: ipInfo.end,
          count: ipInfo.zhCount,
          zhCount: ipInfo.zhCount,
          enCount: ipInfo.enCount,
        },
      };
    }

    if (ipInfo?.kind === 'ipv6-range') {
      return {
        typeKey: isSrc ? 'ruleType.SRC-IP-CIDR-RANGE' : 'ruleType.IP-CIDR-RANGE',
        descriptionKey,
        inlineKey: 'ruleInline.ipv6Range',
        params: {
          value: rule.value,
          displayValue: rule.value,
          prefix: ipInfo.prefixAddress,
        },
      };
    }
  }

  return {
    typeKey: TYPE_KEY_MAP[rule.type],
    descriptionKey,
    inlineKey: 'ruleInline.typedValue',
    params: { value: rule.value, displayValue: rule.value },
  };
}

export function getRuleTypeDescriptionKey(type: DomainRuleType | 'AUTO'): FriendlyRuleTypeDescKey {
  if (type === 'AUTO') return 'ruleTypeDesc.AUTO';
  return TYPE_DESC_KEY_MAP[type];
}

export function getRuleTypeOption(type: DomainRuleType): RuleTypeOptionDescriptor {
  return {
    type,
    labelKey: TYPE_KEY_MAP[type],
    optionLabelKey: OPTION_LABEL_KEY_MAP[type],
    descriptionKey: TYPE_DESC_KEY_MAP[type],
    group: COMMON_RULE_TYPE_SET.has(type) ? 'common' : 'advanced',
  };
}

export function getAllRuleTypeOptions(): ReadonlyArray<RuleTypeOptionDescriptor> {
  return RULE_TYPES.map((type) => getRuleTypeOption(type));
}

export function getGroupedRuleTypeOptions(): {
  common: ReadonlyArray<RuleTypeOptionDescriptor>;
  advanced: ReadonlyArray<RuleTypeOptionDescriptor>;
} {
  return {
    common: COMMON_RULE_TYPES.map((type) => getRuleTypeOption(type)),
    advanced: ADVANCED_RULE_TYPES.map((type) => getRuleTypeOption(type)),
  };
}

/**
 * Formats a rule in canonical raw syntax (e.g. `DOMAIN-SUFFIX,chatgpt.com` or
 * `IP-CIDR,198.51.100.0/24,no-resolve`) for tooltips and "View raw" inspection.
 */
export function formatRawRuleLine(rule: Pick<DomainRule, 'type' | 'value' | 'options'>): string {
  const suffix = rule.options?.noResolve ? ',no-resolve' : '';
  return `${rule.type},${rule.value}${suffix}`;
}

/**
 * Runs the existing AUTO rule parser on live user input and returns a friendly
 * descriptor so the add-rule form can display plain-language recognition hints.
 */
export function previewRuleInputFriendly(
  input: string,
  forcedType?: DomainRuleType | 'IP-CIDR6' | 'AUTO',
): RuleInputPreview | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const effectiveForced: DomainRuleType | undefined =
    !forcedType || forcedType === 'AUTO' ? undefined : forcedType === 'IP-CIDR6' ? 'IP-CIDR' : forcedType;

  try {
    const parsed = parseRuleInput(trimmed, effectiveForced);
    return {
      ok: true,
      type: parsed.type,
      value: parsed.value,
      isIpType: isIpCidrRuleType(parsed.type),
      hasNoResolve: Boolean(parsed.options?.noResolve),
      friendly: describeRuleFriendly(parsed),
    };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'Invalid rule input',
    };
  }
}
