import type { DomainRule, DomainRuleType, ImportPreview } from '../../types/domain-rules';
import { FRIENDLY_RULE_TYPE, RULE_TYPES } from './rule-types';
import { id } from './slug';

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,}$/i;
const KEYWORD_PATTERN = /^[a-z0-9_-]+$/i;
const IP_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const CIDR_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[1-2][0-9]|3[0-2])$/;
const IPV6_PATTERN = /^[0-9a-f:]+$/i;
const IPV6_CIDR_PATTERN = /^[0-9a-f:]+\/(?:\d|[1-9]\d|1[01]\d|12[0-8])$/i;
const PORT_PATTERN = /^\d{1,5}(?:-\d{1,5})?$/;

function validIp(value: string) {
  const [ip] = value.split('/');
  return ip.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function validIpv6(value: string) {
  const address = value.split('/')[0];
  if (!address.includes(':') || (address.match(/::/g)?.length ?? 0) > 1) return false;
  const groups = address.split(':').filter(Boolean);
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return false;
  return address.includes('::') ? groups.length < 8 : groups.length === 8;
}

function validDestinationPort(value: string) {
  if (!PORT_PATTERN.test(value)) return false;
  const [startText, endText = startText] = value.split('-');
  const start = Number(startText);
  const end = Number(endText);
  return start >= 1 && end <= 65535 && start <= end;
}

export function normalizeRuleValue(value: string) {
  let normalized = value
    .trim()
    .replace(/^https?:\/\//i, '')
    .toLowerCase();
  if (normalized.includes('/') && !/^[0-9a-f:.]+\/\d+$/i.test(normalized)) {
    normalized = normalized.replace(/\/.*$/, '');
  }
  if (normalized.startsWith('*.')) normalized = normalized.slice(2);
  if (normalized.startsWith('+.')) normalized = normalized.slice(2);
  if (normalized.startsWith('.')) normalized = normalized.slice(1);
  return normalized;
}

const CASE_SENSITIVE_TYPES = new Set<DomainRuleType>(['DOMAIN-REGEX', 'PROCESS-NAME', 'USER-AGENT', 'URL-REGEX']);

function professional(
  input: string,
): { type: DomainRuleType; value: string; options?: { noResolve?: boolean } } | null {
  const [rawType, ...rest] = input.split(',');
  const upper = rawType.trim().toUpperCase();
  const normalizedType = upper === 'IP-CIDR6' ? 'IP-CIDR' : (upper as DomainRuleType);
  if (!RULE_TYPES.includes(normalizedType)) return null;
  const joined = rest.join(',').trim();
  const hasNoResolve = /,no-resolve$/i.test(joined);
  const rawValue = joined.replace(/,no-resolve$/i, '').trim();
  if (!rawValue) return null;
  const value = CASE_SENSITIVE_TYPES.has(normalizedType) ? rawValue : normalizeRuleValue(rawValue);
  return {
    type: normalizedType,
    value,
    ...(hasNoResolve ? { options: { noResolve: true } } : {}),
  };
}

export function parseRuleInput(
  input: string,
  forcedType?: DomainRuleType,
  note?: string,
  forcedOptions?: { noResolve?: boolean },
): DomainRule {
  const raw = input.trim();
  if (!raw) throw new Error('请输入域名、关键词或 IP');
  if (raw.startsWith('#')) throw new Error('注释行不能单独保存为规则');

  const fromProfessional = professional(raw);
  const effectiveType = forcedType || fromProfessional?.type;
  const normalized =
    fromProfessional?.value ??
    (effectiveType && CASE_SENSITIVE_TYPES.has(effectiveType) ? raw : normalizeRuleValue(raw));
  const wildcard = /^[+*]?\./.test(raw);
  let type = effectiveType;

  if (!type) {
    if (
      ((CIDR_PATTERN.test(normalized) || IP_PATTERN.test(normalized)) && validIp(normalized)) ||
      ((IPV6_PATTERN.test(normalized) || IPV6_CIDR_PATTERN.test(normalized)) && validIpv6(normalized))
    ) {
      type = 'IP-CIDR';
    } else if (validDestinationPort(normalized)) {
      type = 'DST-PORT';
    } else if (DOMAIN_PATTERN.test(normalized)) {
      type = 'DOMAIN-SUFFIX';
    } else if (KEYWORD_PATTERN.test(normalized)) {
      type = 'DOMAIN-KEYWORD';
    }
  }

  if (!type) throw new Error('没有识别出有效规则，请检查输入内容');

  let value = normalized;
  if ((type === 'IP-CIDR' || type === 'SRC-IP-CIDR') && IP_PATTERN.test(value)) value = `${value}/32`;
  if ((type === 'IP-CIDR' || type === 'SRC-IP-CIDR') && IPV6_PATTERN.test(value) && validIpv6(value)) {
    value = `${value}/128`;
  }
  const validNetwork =
    (CIDR_PATTERN.test(value) && validIp(value)) || (IPV6_CIDR_PATTERN.test(value) && validIpv6(value));
  if ((type === 'IP-CIDR' || type === 'SRC-IP-CIDR') && !validNetwork) {
    throw new Error('IP 或 IP 段格式不正确');
  }
  if ((type === 'DOMAIN' || type === 'DOMAIN-SUFFIX') && !DOMAIN_PATTERN.test(value)) {
    throw new Error('域名格式不正确');
  }
  if (type === 'DOMAIN-KEYWORD' && !KEYWORD_PATTERN.test(value)) {
    throw new Error('关键词只能包含字母、数字、短横线或下划线');
  }
  if ((type === 'DST-PORT' || type === 'SRC-PORT') && !validDestinationPort(value)) {
    throw new Error(`${type === 'DST-PORT' ? '目标' : '来源'}端口格式不正确，请输入 1-65535 范围内的端口或端口区间`);
  }

  let displayType: string;
  if (wildcard && type === 'DOMAIN-SUFFIX') displayType = '通配域名';
  else if (type === 'IP-CIDR' && value.endsWith('/32')) displayType = '单个 IP';
  else if (type === 'IP-CIDR') displayType = 'IP 段';
  else displayType = FRIENDLY_RULE_TYPE[type];

  const options = forcedOptions ?? fromProfessional?.options;
  const now = new Date().toISOString();
  return {
    id: id('rule'),
    value,
    type,
    displayType,
    ...(options && Object.keys(options).length > 0 ? { options } : {}),
    enabled: true,
    note,
    createdAt: now,
    updatedAt: now,
  };
}

export function parseBulkImport(text: string, existing: Pick<DomainRule, 'type' | 'value'>[]): ImportPreview {
  const existingKeys = new Set(existing.map((rule) => `${rule.type}:${rule.value}`.toLowerCase()));
  const nextKeys = new Set<string>();
  const rules: DomainRule[] = [];
  const duplicateValues: string[] = [];
  const invalidValues: string[] = [];
  const comments: string[] = [];
  let pendingNote = '';

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      pendingNote = trimmed.replace(/^#+\s*/, '').trim();
      if (pendingNote) comments.push(pendingNote);
      continue;
    }
    try {
      const rule = parseRuleInput(trimmed, undefined, pendingNote || undefined);
      const key = `${rule.type}:${rule.value}`.toLowerCase();
      if (existingKeys.has(key) || nextKeys.has(key)) {
        duplicateValues.push(rule.value);
        continue;
      }
      nextKeys.add(key);
      rules.push(rule);
      pendingNote = '';
    } catch {
      invalidValues.push(trimmed);
    }
  }

  return { rules, duplicateValues, invalidValues, comments };
}
