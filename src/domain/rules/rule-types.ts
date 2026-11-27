import type { DomainRule, DomainRuleType } from '../../types/domain-rules';

export const RULE_TYPES: DomainRuleType[] = [
  'DOMAIN',
  'DOMAIN-SUFFIX',
  'DOMAIN-KEYWORD',
  'DOMAIN-REGEX',
  'IP-CIDR',
  'SRC-IP-CIDR',
  'IP-ASN',
  'DST-PORT',
  'SRC-PORT',
  'GEOSITE',
  'GEOIP',
  'PROCESS-NAME',
  'USER-AGENT',
  'URL-REGEX',
];

export const FRIENDLY_RULE_TYPE: Record<DomainRuleType, string> = {
  DOMAIN: '完整域名',
  'DOMAIN-SUFFIX': '域名后缀',
  'DOMAIN-KEYWORD': '域名关键词',
  'DOMAIN-REGEX': '域名正则',
  'IP-CIDR': 'IP 地址 / 地址段',
  'SRC-IP-CIDR': '设备 IP',
  'IP-ASN': '运营商网络（ASN）',
  'DST-PORT': '目标端口',
  'SRC-PORT': '来源端口',
  GEOSITE: '域名分类库（GeoSite）',
  GEOIP: '国家 / 地区 IP（GeoIP）',
  'PROCESS-NAME': '程序名',
  'USER-AGENT': '应用标识（User-Agent）',
  'URL-REGEX': '网址正则',
};

export const FRIENDLY_RULE_TYPES = [
  { type: '', label: '自动识别', description: '根据你输入的内容自动判断类型，大多数情况选它就行' },
  ...RULE_TYPES.map((type) => ({ type, label: FRIENDLY_RULE_TYPE[type], description: ruleTypeDescription(type) })),
] as const;

function ruleTypeDescription(type: DomainRuleType) {
  const descriptions: Record<DomainRuleType, string> = {
    DOMAIN: '只匹配这一个网址，不含子域名。例：www.google.com 不会匹配 mail.google.com',
    'DOMAIN-SUFFIX': '匹配这个域名和它的所有子域名。例：google.com 也会匹配 mail.google.com',
    'DOMAIN-KEYWORD': '网址里含有这个词就匹配，范围很大，可能误伤。例：google 也会匹配 google.com.hk',
    'DOMAIN-REGEX': '用正则表达式匹配域名，适合熟悉正则的用户',
    'IP-CIDR': '匹配要访问的服务器 IP。只填一个 IP 就行，不需要懂网段。例：1.2.3.4',
    'SRC-IP-CIDR': '按发起连接的设备匹配，例如让家里某台电视直连。例：192.168.1.20',
    'IP-ASN': '匹配某家公司或运营商的全部 IP。例：AS13335 是 Cloudflare',
    'DST-PORT': '按要访问的端口匹配。例：22 是 SSH，443 是 HTTPS',
    'SRC-PORT': '按本机发出连接的端口匹配，很少用到',
    GEOSITE: '引用社区整理好的网站分组。例：netflix',
    GEOIP: '按 IP 所属国家或地区匹配。例：CN 表示中国大陆',
    'PROCESS-NAME': '按电脑上的程序匹配，手机客户端不生效。例：Telegram.exe',
    'USER-AGENT': '按 App 发出的标识匹配，只有少数客户端支持',
    'URL-REGEX': '按完整网址匹配，主要用于 iOS 客户端，适合熟悉正则的用户',
  };
  return descriptions[type];
}

export function getFriendlyRuleType(rule: Pick<DomainRule, 'type' | 'value'>) {
  if (rule.type === 'IP-CIDR' && (rule.value.endsWith('/32') || rule.value.endsWith('/128'))) return 'IP 地址';
  if (rule.type === 'IP-CIDR') return 'IP 段';
  if (rule.type === 'SRC-IP-CIDR' && !(rule.value.endsWith('/32') || rule.value.endsWith('/128'))) return '设备 IP 段';
  return FRIENDLY_RULE_TYPE[rule.type] ?? '地址规则';
}

export function getFriendlyRuleDescription(rule: Pick<DomainRule, 'type' | 'value'>) {
  if (rule.type === 'DOMAIN-SUFFIX') return `${rule.value} 及其子域名`;
  if (rule.type === 'DOMAIN-KEYWORD') return rule.value;
  if (rule.type === 'IP-CIDR' && rule.value.endsWith('/32')) return rule.value.slice(0, -3);
  if (rule.type === 'IP-CIDR' && rule.value.endsWith('/128')) return rule.value.slice(0, -4);
  return `${getFriendlyRuleType(rule)}：${rule.value}`;
}
