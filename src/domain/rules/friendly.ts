import type { DomainRule, DomainRuleType } from '../../types/domain-rules';
import { parseRuleInput } from './parser';
import { RULE_TYPES } from './rule-types';

export type FriendlyRuleTypeKey =
  | 'ruleType.DOMAIN'
  | 'ruleType.DOMAIN-SUFFIX'
  | 'ruleType.DOMAIN-KEYWORD'
  | 'ruleType.DOMAIN-REGEX'
  | 'ruleType.IP-CIDR'
  | 'ruleType.IP-CIDR-SINGLE'
  | 'ruleType.SRC-IP-CIDR'
  | 'ruleType.IP-ASN'
  | 'ruleType.DST-PORT'
  | 'ruleType.SRC-PORT'
  | 'ruleType.GEOSITE'
  | 'ruleType.GEOIP'
  | 'ruleType.PROCESS-NAME'
  | 'ruleType.USER-AGENT'
  | 'ruleType.URL-REGEX';

export type FriendlyRuleTypeDescKey =
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
  | 'ruleTypeDesc.URL-REGEX';

export type FriendlyRuleInlineKey =
  'ruleInline.domainSuffix' | 'ruleInline.domainKeyword' | 'ruleInline.singleIp' | 'ruleInline.typedValue';

export type FriendlyRuleDescriptor = {
  typeKey: FriendlyRuleTypeKey;
  descriptionKey: FriendlyRuleTypeDescKey;
  inlineKey: FriendlyRuleInlineKey;
  params: {
    value: string;
    displayValue: string;
  };
};

export type RuleTypeOptionDescriptor = {
  type: DomainRuleType;
  labelKey: FriendlyRuleTypeKey;
  descriptionKey: FriendlyRuleTypeDescKey;
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
};

export function isIpCidrRuleType(type: DomainRuleType | 'IP-CIDR6' | 'AUTO' | '' | undefined): boolean {
  return type === 'IP-CIDR' || type === 'IP-CIDR6' || type === 'SRC-IP-CIDR';
}

export function isSingleHostCidr(type: DomainRuleType, value: string): boolean {
  if (type !== 'IP-CIDR') return false;
  return value.endsWith('/32') || value.endsWith('/128');
}

function stripSingleHostSuffix(value: string): string {
  if (value.endsWith('/32')) return value.slice(0, -3);
  if (value.endsWith('/128')) return value.slice(0, -4);
  return value;
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

  if (isSingleHostCidr(rule.type, rule.value)) {
    const displayValue = stripSingleHostSuffix(rule.value);
    return {
      typeKey: 'ruleType.IP-CIDR-SINGLE',
      descriptionKey,
      inlineKey: 'ruleInline.singleIp',
      params: { value: rule.value, displayValue },
    };
  }

  return {
    typeKey: TYPE_KEY_MAP[rule.type],
    descriptionKey,
    inlineKey: 'ruleInline.typedValue',
    params: { value: rule.value, displayValue: rule.value },
  };
}

export function getRuleTypeOption(type: DomainRuleType): RuleTypeOptionDescriptor {
  return {
    type,
    labelKey: TYPE_KEY_MAP[type],
    descriptionKey: TYPE_DESC_KEY_MAP[type],
  };
}

export function getAllRuleTypeOptions(): ReadonlyArray<RuleTypeOptionDescriptor> {
  return RULE_TYPES.map((type) => getRuleTypeOption(type));
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
