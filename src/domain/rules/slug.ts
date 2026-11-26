export function slugify(value: string) {
  const source = value.trim();
  const ascii = source
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '');

  return ascii || 'rule';
}

/** Category / rule set names are used to derive portable subscription file names. */
export function validateCategoryName(value: string) {
  const name = value.trim();
  if (!name) return '请输入分类名称。';
  if (!/^[\x20-\x7E]+$/.test(name) || !/[a-z0-9]/i.test(name)) {
    return '分类名称仅支持英文字母、数字、空格和英文标点，且至少包含一个字母或数字。';
  }
  return '';
}

export function id(prefix = 'id') {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}-${Date.now().toString(36)}-${Array.from(random, (item) => item.toString(36)).join('')}`;
}
