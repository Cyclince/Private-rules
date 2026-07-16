import type { DomainRule, DomainRuleType } from '../types/domain-rules';

export const RULE_TYPES: DomainRuleType[] = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'IP-CIDR',
  'SRC-IP-CIDR',
  'IP-ASN',
  'DST-PORT',
  'GEOSITE',
  'GEOIP',
];

export const FRIENDLY_RULE_TYPE: Record<DomainRuleType, string> = {
  DOMAIN: '完整域名',
  'DOMAIN-SUFFIX': '域名后缀',
  'DOMAIN-KEYWORD': '关键词',
  'IP-CIDR': 'IP / IP 段',
  'SRC-IP-CIDR': '源 IP 段',
  'IP-ASN': 'ASN',
  'DST-PORT': '目标端口',
  GEOSITE: '站点集合',
  GEOIP: '国家 / 地区 IP',
};

export const FRIENDLY_RULE_TYPES = [
  { type: '', label: '自动识别', description: '系统根据输入内容自动判断' },
  ...RULE_TYPES.map((type) => ({ type, label: FRIENDLY_RULE_TYPE[type], description: ruleTypeDescription(type) })),
] as const;

function ruleTypeDescription(type: DomainRuleType) {
  const descriptions: Record<DomainRuleType, string> = {
    DOMAIN: '只匹配完整域名',
    'DOMAIN-SUFFIX': '匹配该域名及其子域名',
    'DOMAIN-KEYWORD': '匹配包含该关键词的域名',
    'IP-CIDR': '匹配 IP 地址或网段',
    'SRC-IP-CIDR': '匹配来源 IP 网段',
    'IP-ASN': '匹配网络自治系统编号',
    'DST-PORT': '匹配目标端口或端口范围',
    GEOSITE: '匹配客户端内置的站点集合',
    GEOIP: '匹配客户端内置的国家或地区 IP',
  };
  return descriptions[type];
}

export function getFriendlyRuleType(rule: Pick<DomainRule, 'type' | 'value'>) {
  if (rule.type === 'IP-CIDR' && rule.value.endsWith('/32')) return '单个 IP';
  return FRIENDLY_RULE_TYPE[rule.type] ?? '地址规则';
}

export function getFriendlyRuleDescription(rule: Pick<DomainRule, 'type' | 'value'>) {
  if (rule.type === 'DOMAIN-SUFFIX') return `${rule.value} 及其子域名`;
  if (rule.type === 'DOMAIN-KEYWORD') return `关键词：${rule.value}`;
  if (rule.type === 'IP-CIDR' && rule.value.endsWith('/32')) return `单个 IP：${rule.value.slice(0, -3)}`;
  return `${getFriendlyRuleType(rule)}：${rule.value}`;
}
