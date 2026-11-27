import type { ClientId, ClientLink, RuleCategory } from '../../../types/domain-rules';
import type { MessageKey } from '../../i18n';

export type AccessPolicy = 'token' | 'public' | 'disabled';
export type CategorySortKey = 'alpha' | 'count' | 'created' | 'modified';
export type SortDirection = 'asc' | 'desc';
export type FormatGroupId = 'yaml' | 'list' | 'json' | 'txt';

export type FormatLinkEntry = {
  id: string;
  titleKey?: MessageKey;
  fallbackTitle: string;
  descriptionKey?: MessageKey;
  fallbackDescription: string;
  suffix: string;
  tone: 'primary' | 'accent' | 'warning' | 'success';
  link: ClientLink;
};

export type FormatLinkGroup = {
  id: FormatGroupId;
  titleKey: MessageKey;
  formats: FormatLinkEntry[];
};

const SORT_STORAGE_KEY = 'private-rules-sort-subscriptions';
const VALID_SORT_KEYS = new Set<CategorySortKey>(['alpha', 'count', 'created', 'modified']);

/**
 * Resolves the display/effective access policy for a ruleset following 1.0.7
 * links-panel.tsx precedence: tokenLinksEnabled !== false -> token, else
 * publicLinksEnabled !== false -> public, else disabled.
 */
export function resolveAccessPolicy(
  category: Pick<RuleCategory, 'tokenLinksEnabled' | 'publicLinksEnabled'>,
): AccessPolicy {
  if (category.tokenLinksEnabled !== false) return 'token';
  if (category.publicLinksEnabled !== false) return 'public';
  return 'disabled';
}

/**
 * Converts a selected access policy to the PATCH payload matching 1.0.7
 * links-panel.tsx line 50.
 */
export function accessPolicyToPatch(policy: AccessPolicy): {
  tokenLinksEnabled: boolean;
  publicLinksEnabled: boolean;
} {
  return {
    tokenLinksEnabled: policy === 'token',
    publicLinksEnabled: policy === 'public',
  };
}

export function readStoredSubscriptionSort(): { key: CategorySortKey; direction: SortDirection } {
  if (typeof window === 'undefined') return { key: 'alpha', direction: 'asc' };
  try {
    const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (!saved) return { key: 'alpha', direction: 'asc' };
    const [rawKey, rawDir] = saved.split(':');
    const key = VALID_SORT_KEYS.has(rawKey as CategorySortKey) ? (rawKey as CategorySortKey) : 'alpha';
    const direction: SortDirection = rawDir === 'desc' ? 'desc' : 'asc';
    return { key, direction };
  } catch {
    return { key: 'alpha', direction: 'asc' };
  }
}

export function writeStoredSubscriptionSort(key: CategorySortKey, direction: SortDirection): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, `${key}:${direction}`);
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

export function nextSortDirection(
  currentKey: CategorySortKey,
  currentDirection: SortDirection,
  nextKey: CategorySortKey,
): SortDirection {
  if (nextKey === currentKey) {
    return currentDirection === 'desc' ? 'asc' : 'desc';
  }
  return nextKey === 'alpha' ? 'asc' : 'desc';
}

export function sortSubscriptionCategories(
  categories: readonly RuleCategory[],
  key: CategorySortKey,
  direction: SortDirection,
): RuleCategory[] {
  const sign = direction === 'desc' ? -1 : 1;
  return [...categories].sort((a, b) => {
    if (key === 'alpha') {
      return a.name.localeCompare(b.name, 'zh-CN') * sign;
    }
    if (key === 'count') {
      const aCount = a.ruleCount ?? a.rules.length;
      const bCount = b.ruleCount ?? b.rules.length;
      return (aCount - bCount) * sign;
    }
    const aTime = key === 'created' ? a.createdAt : a.updatedAt;
    const bTime = key === 'created' ? b.createdAt : b.updatedAt;
    return (new Date(aTime ?? 0).getTime() - new Date(bTime ?? 0).getTime()) * sign;
  });
}

export function getEnabledRuleCount(category: RuleCategory): number {
  if (typeof category.enabledRuleCount === 'number') return category.enabledRuleCount;
  return category.rules.filter((rule) => rule.enabled).length;
}

export function preferHttpsLink(url: string): string {
  if (!url || typeof window === 'undefined' || window.location.protocol !== 'https:') return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:') parsed.protocol = 'https:';
    return parsed.toString();
  } catch {
    return url;
  }
}

type FormatMeta = {
  group: FormatGroupId;
  titleKey?: MessageKey;
  descriptionKey: MessageKey;
  suffix: string;
  tone: FormatLinkEntry['tone'];
};

const FORMAT_META: Partial<Record<ClientId, FormatMeta>> = {
  'yaml-classical': {
    group: 'yaml',
    titleKey: 'subscriptions.format.yaml-classical.title',
    descriptionKey: 'subscriptions.format.yaml-classical.desc',
    suffix: '_Classical.yaml',
    tone: 'primary',
  },
  'yaml-domain': {
    group: 'yaml',
    titleKey: 'subscriptions.format.yaml-domain.title',
    descriptionKey: 'subscriptions.format.yaml-domain.desc',
    suffix: '_Domain.yaml',
    tone: 'primary',
  },
  'yaml-ipcidr': {
    group: 'yaml',
    titleKey: 'subscriptions.format.yaml-ipcidr.title',
    descriptionKey: 'subscriptions.format.yaml-ipcidr.desc',
    suffix: '_IPCIDR.yaml',
    tone: 'primary',
  },
  mihomo: {
    group: 'yaml',
    descriptionKey: 'subscriptions.format.mihomo.desc',
    suffix: '.yaml',
    tone: 'primary',
  },
  clash: {
    group: 'yaml',
    descriptionKey: 'subscriptions.format.clash.desc',
    suffix: '.yaml',
    tone: 'primary',
  },
  openclash: {
    group: 'yaml',
    descriptionKey: 'subscriptions.format.openclash.desc',
    suffix: '.yaml',
    tone: 'primary',
  },
  'clash-verge': {
    group: 'yaml',
    descriptionKey: 'subscriptions.format.clash-verge.desc',
    suffix: '.yaml',
    tone: 'primary',
  },
  stash: {
    group: 'yaml',
    descriptionKey: 'subscriptions.format.stash.desc',
    suffix: '.yaml',
    tone: 'primary',
  },
  general: {
    group: 'list',
    titleKey: 'subscriptions.format.general.title',
    descriptionKey: 'subscriptions.format.general.desc',
    suffix: '.list',
    tone: 'accent',
  },
  loon: {
    group: 'list',
    titleKey: 'subscriptions.format.loon.title',
    descriptionKey: 'subscriptions.format.loon.desc',
    suffix: '-loon.list',
    tone: 'accent',
  },
  'quantumult-x': {
    group: 'list',
    titleKey: 'subscriptions.format.quantumult-x.title',
    descriptionKey: 'subscriptions.format.quantumult-x.desc',
    suffix: '-qx.list',
    tone: 'accent',
  },
  shadowrocket: {
    group: 'list',
    descriptionKey: 'subscriptions.format.shadowrocket.desc',
    suffix: '-shadowrocket.list',
    tone: 'accent',
  },
  surge: {
    group: 'list',
    descriptionKey: 'subscriptions.format.surge.desc',
    suffix: '-surge.list',
    tone: 'accent',
  },
  'surge-mac': {
    group: 'list',
    descriptionKey: 'subscriptions.format.surge-mac.desc',
    suffix: '-surge.list',
    tone: 'accent',
  },
  egern: {
    group: 'list',
    descriptionKey: 'subscriptions.format.egern.desc',
    suffix: '-egern.list',
    tone: 'accent',
  },
  surfboard: {
    group: 'list',
    descriptionKey: 'subscriptions.format.surfboard.desc',
    suffix: '-surfboard.list',
    tone: 'accent',
  },
  v2ray: {
    group: 'list',
    descriptionKey: 'subscriptions.format.v2ray.desc',
    suffix: '-v2ray.list',
    tone: 'accent',
  },
  json: {
    group: 'json',
    titleKey: 'subscriptions.format.json.title',
    descriptionKey: 'subscriptions.format.json.desc',
    suffix: '.json',
    tone: 'warning',
  },
  'sing-box': {
    group: 'json',
    descriptionKey: 'subscriptions.format.sing-box.desc',
    suffix: '-sing-box.json',
    tone: 'warning',
  },
  url: {
    group: 'txt',
    titleKey: 'subscriptions.format.url.title',
    descriptionKey: 'subscriptions.format.url.desc',
    suffix: '.txt',
    tone: 'success',
  },
};

const GROUP_DEFINITIONS: ReadonlyArray<{
  id: FormatGroupId;
  titleKey: MessageKey;
  preferredOrder: readonly ClientId[];
  defaultTone: FormatLinkEntry['tone'];
}> = [
  {
    id: 'yaml',
    titleKey: 'subscriptions.groupYaml',
    preferredOrder: [
      'yaml-classical',
      'yaml-domain',
      'yaml-ipcidr',
      'mihomo',
      'clash',
      'openclash',
      'clash-verge',
      'stash',
    ],
    defaultTone: 'primary',
  },
  {
    id: 'list',
    titleKey: 'subscriptions.groupList',
    preferredOrder: [
      'general',
      'loon',
      'quantumult-x',
      'shadowrocket',
      'surge',
      'surge-mac',
      'egern',
      'surfboard',
      'v2ray',
    ],
    defaultTone: 'accent',
  },
  {
    id: 'json',
    titleKey: 'subscriptions.groupJson',
    preferredOrder: ['json', 'sing-box'],
    defaultTone: 'warning',
  },
  {
    id: 'txt',
    titleKey: 'subscriptions.groupTxt',
    preferredOrder: ['url'],
    defaultTone: 'success',
  },
];

function inferGroupId(link: ClientLink): FormatGroupId {
  const meta = FORMAT_META[link.id];
  if (meta) return meta.group;
  const lower = link.fileName.toLowerCase();
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.txt')) return 'txt';
  return 'list';
}

function inferSuffix(link: ClientLink): string {
  const meta = FORMAT_META[link.id];
  if (meta) return meta.suffix;
  const dot = link.fileName.lastIndexOf('.');
  return dot >= 0 ? link.fileName.slice(dot) : '';
}

/**
 * Groups summary endpoint `ClientLink[]` into the 4 client families matching
 * 1.0.7's subscription center hierarchy (YAML / LIST / JSON / TXT).
 */
/** Builds the single-format group used by "我会自己写配置：查看引用片段" on the app-first view. */
export function formatEntryForLink(link: ClientLink): FormatLinkEntry {
  const meta = FORMAT_META[link.id];
  const groupId = inferGroupId(link);
  const groupDef = GROUP_DEFINITIONS.find((group) => group.id === groupId)!;
  return {
    id: link.id,
    titleKey: meta?.titleKey,
    fallbackTitle: link.name,
    descriptionKey: meta?.descriptionKey,
    fallbackDescription: link.description,
    suffix: inferSuffix(link),
    tone: meta?.tone ?? groupDef.defaultTone,
    link,
  };
}

export function formatGroupForLink(link: ClientLink): FormatLinkGroup {
  const groupId = inferGroupId(link);
  const groupDef = GROUP_DEFINITIONS.find((group) => group.id === groupId)!;
  return { id: groupId, titleKey: groupDef.titleKey, formats: [formatEntryForLink(link)] };
}

/** Whether a link can be copied, used by the list page's quick-copy button and the detail card. */
export function linkCopyState(link: ClientLink | null | undefined): { displayUrl: string; canCopy: boolean } {
  const rawUrl = link?.recommendedUrl ?? '';
  return { displayUrl: rawUrl ? preferHttpsLink(rawUrl) : '', canCopy: Boolean(rawUrl) };
}

export function buildSubscriptionFormatGroups(links: readonly ClientLink[]): FormatLinkGroup[] {
  const byId = new Map<string, ClientLink>();
  for (const link of links) {
    byId.set(link.id, link);
  }

  const assigned = new Set<string>();
  const buckets: Record<FormatGroupId, FormatLinkEntry[]> = {
    yaml: [],
    list: [],
    json: [],
    txt: [],
  };

  const toEntry = (link: ClientLink, defaultTone: FormatLinkEntry['tone']): FormatLinkEntry => {
    const meta = FORMAT_META[link.id];
    return {
      id: link.id,
      titleKey: meta?.titleKey,
      fallbackTitle: link.name,
      descriptionKey: meta?.descriptionKey,
      fallbackDescription: link.description,
      suffix: inferSuffix(link),
      tone: meta?.tone ?? defaultTone,
      link,
    };
  };

  for (const groupDef of GROUP_DEFINITIONS) {
    for (const id of groupDef.preferredOrder) {
      const found = byId.get(id);
      if (!found) continue;
      assigned.add(id);
      buckets[groupDef.id].push(toEntry(found, groupDef.defaultTone));
    }
  }

  for (const link of links) {
    if (assigned.has(link.id)) continue;
    const groupId = inferGroupId(link);
    const groupDef = GROUP_DEFINITIONS.find((g) => g.id === groupId)!;
    buckets[groupId].push(toEntry(link, groupDef.defaultTone));
  }

  return GROUP_DEFINITIONS.map((groupDef) => ({
    id: groupDef.id,
    titleKey: groupDef.titleKey,
    formats: buckets[groupDef.id],
  }));
}
