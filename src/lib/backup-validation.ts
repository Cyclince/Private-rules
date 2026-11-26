import { RULE_TYPES } from './rule-types';

const SOURCE_TYPES = new Set(['url', 'geosite', 'geoip']);
const RULE_TYPE_SET = new Set<string>(RULE_TYPES);
const MAX_ERRORS = 20;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const optionalString = (value: unknown) => value === undefined || value === null || typeof value === 'string';
const optionalBoolean = (value: unknown) => value === undefined || value === null || typeof value === 'boolean';
const optionalNumber = (value: unknown) => value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value));

/**
 * Validates the shape of a backup before anything is deleted. Returns a list of
 * human-readable problems; an empty list means the backup is safe to import.
 */
export function validateBackup(input: unknown): string[] {
  const errors: string[] = [];
  const push = (message: string) => { if (errors.length < MAX_ERRORS) errors.push(message); };

  if (!isObject(input)) return ['备份内容必须是 JSON 对象。'];
  if (!isObject(input.settings)) push('缺少 settings 对象。');
  if (!Array.isArray(input.categories)) {
    push('缺少 categories 数组。');
    return errors;
  }

  const categoryIds = new Set<string>();
  const slugs = new Set<string>();
  input.categories.forEach((category, index) => {
    const at = `categories[${index}]`;
    if (!isObject(category)) return push(`${at} 必须是对象。`);
    if (typeof category.name !== 'string' || !category.name.trim()) push(`${at}.name 必须是非空字符串。`);
    for (const key of ['id', 'slug', 'icon', 'description', 'note', 'createdAt', 'updatedAt']) {
      if (!optionalString(category[key])) push(`${at}.${key} 必须是字符串。`);
    }
    for (const key of ['enabled', 'publicLinksEnabled', 'tokenLinksEnabled']) {
      if (!optionalBoolean(category[key])) push(`${at}.${key} 必须是布尔值。`);
    }
    if (!optionalNumber(category.sortOrder)) push(`${at}.sortOrder 必须是数字。`);
    if (typeof category.id === 'string' && category.id) {
      if (categoryIds.has(category.id)) push(`${at}.id 重复：${category.id}`);
      categoryIds.add(category.id);
    }
    if (typeof category.slug === 'string' && category.slug) {
      if (slugs.has(category.slug)) push(`${at}.slug 重复：${category.slug}`);
      slugs.add(category.slug);
    }

    if (!Array.isArray(category.rules)) push(`${at}.rules 必须是数组。`);
    else category.rules.forEach((rule, ruleIndex) => {
      const ruleAt = `${at}.rules[${ruleIndex}]`;
      if (!isObject(rule)) return push(`${ruleAt} 必须是对象。`);
      if (typeof rule.value !== 'string' || !rule.value.trim()) push(`${ruleAt}.value 必须是非空字符串。`);
      if (typeof rule.type !== 'string' || !RULE_TYPE_SET.has(rule.type)) push(`${ruleAt}.type 无效：${String(rule.type)}`);
      if (!optionalBoolean(rule.enabled)) push(`${ruleAt}.enabled 必须是布尔值。`);
      for (const key of ['id', 'note', 'displayType', 'createdAt', 'updatedAt', 'sourceId']) {
        if (!optionalString(rule[key])) push(`${ruleAt}.${key} 必须是字符串。`);
      }
      if (!optionalNumber(rule.sortOrder)) push(`${ruleAt}.sortOrder 必须是数字。`);
    });

    if (category.sources !== undefined && category.sources !== null) {
      if (!Array.isArray(category.sources)) push(`${at}.sources 必须是数组。`);
      else category.sources.forEach((source, sourceIndex) => {
        const sourceAt = `${at}.sources[${sourceIndex}]`;
        if (!isObject(source)) return push(`${sourceAt} 必须是对象。`);
        const sourceType = source.sourceType ?? 'url';
        if (typeof sourceType !== 'string' || !SOURCE_TYPES.has(sourceType)) push(`${sourceAt}.sourceType 无效：${String(source.sourceType)}`);
        for (const key of ['id', 'name', 'url', 'geositeName', 'geoipName', 'userAgent', 'lastSyncedAt', 'lastStatus', 'lastError', 'ruleOptimization']) {
          if (!optionalString(source[key])) push(`${sourceAt}.${key} 必须是字符串。`);
        }
        if (sourceType === 'url' && (typeof source.url !== 'string' || !source.url)) push(`${sourceAt}.url 必须是非空字符串。`);
        if (sourceType === 'geosite' && !source.url && !source.geositeName) push(`${sourceAt} 缺少 geositeName 或 url。`);
        if (sourceType === 'geoip' && !source.url && !source.geoipName) push(`${sourceAt} 缺少 geoipName 或 url。`);
      });
    }
  });

  return errors;
}
