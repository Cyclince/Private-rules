import { BUILTIN_CARDS, BUILTIN_CATALOG, CATALOG_PROVIDERS, type CatalogProviderMetadata } from '../../builtin';
import { createRepositories } from '../../data/repositories';
import { AppError } from '../../shared/errors';
import type {
  CatalogCategory,
  CatalogDefaultRoute,
  CatalogEntry,
  RemoteRuleBehavior,
  RemoteRuleFormat,
} from '../../shared/schemas/card';
import type { Env } from '../../types';

export type CatalogItemKind = 'builtin' | 'ruleset' | 'geosite' | 'geoip';

export type CatalogItem = {
  id: string;
  kind: CatalogItemKind;
  provider: string;
  parentId?: string;
  name: string;
  aliases: string[];
  category: CatalogCategory;
  defaultRoute: CatalogDefaultRoute;
  sourceUrl?: string;
  behavior?: RemoteRuleBehavior;
  format?: RemoteRuleFormat;
  ruleCount?: number | null;
  ruleSetId?: string;
  ruleSetSlug?: string;
  geoName?: string;
};

export type ListCatalogOptions = {
  query?: string;
  category?: CatalogCategory;
  provider?: string;
  kind?: CatalogItemKind;
  cursor?: string;
  limit?: number;
};

export type ListCatalogResult = {
  items: CatalogItem[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
  providers: Readonly<Record<string, CatalogProviderMetadata>>;
};

const CURATED_GEOSITE_NAMES: ReadonlyArray<{
  name: string;
  label: string;
  category: CatalogCategory;
  defaultRoute: CatalogDefaultRoute;
}> = [
  { name: 'cn', label: 'GeoSite: 中国大陆域名 (cn)', category: 'domestic', defaultRoute: 'direct' },
  { name: 'private', label: 'GeoSite: 私有与局域网 (private)', category: 'infrastructure', defaultRoute: 'direct' },
  {
    name: 'geolocation-!cn',
    label: 'GeoSite: 非中国大陆域名 (geolocation-!cn)',
    category: 'other',
    defaultRoute: 'proxy',
  },
  { name: 'gfw', label: 'GeoSite: GFW 列表 (gfw)', category: 'other', defaultRoute: 'proxy' },
  {
    name: 'category-ads-all',
    label: 'GeoSite: 广告拦截 (category-ads-all)',
    category: 'advertising',
    defaultRoute: 'reject',
  },
  { name: 'category-ai-!cn', label: 'GeoSite: AI 服务 (category-ai-!cn)', category: 'ai', defaultRoute: 'proxy' },
  { name: 'openai', label: 'GeoSite: OpenAI (openai)', category: 'ai', defaultRoute: 'proxy' },
  { name: 'anthropic', label: 'GeoSite: Anthropic (anthropic)', category: 'ai', defaultRoute: 'proxy' },
  { name: 'google', label: 'GeoSite: Google (google)', category: 'infrastructure', defaultRoute: 'proxy' },
  { name: 'youtube', label: 'GeoSite: YouTube (youtube)', category: 'streaming', defaultRoute: 'proxy' },
  { name: 'netflix', label: 'GeoSite: Netflix (netflix)', category: 'streaming', defaultRoute: 'proxy' },
  { name: 'disney', label: 'GeoSite: Disney+ (disney)', category: 'streaming', defaultRoute: 'proxy' },
  { name: 'spotify', label: 'GeoSite: Spotify (spotify)', category: 'streaming', defaultRoute: 'proxy' },
  { name: 'tiktok', label: 'GeoSite: TikTok (tiktok)', category: 'streaming', defaultRoute: 'proxy' },
  { name: 'bilibili', label: 'GeoSite: Bilibili (bilibili)', category: 'streaming', defaultRoute: 'direct' },
  { name: 'telegram', label: 'GeoSite: Telegram (telegram)', category: 'social', defaultRoute: 'proxy' },
  { name: 'twitter', label: 'GeoSite: X / Twitter (twitter)', category: 'social', defaultRoute: 'proxy' },
  { name: 'discord', label: 'GeoSite: Discord (discord)', category: 'social', defaultRoute: 'proxy' },
  { name: 'github', label: 'GeoSite: GitHub (github)', category: 'infrastructure', defaultRoute: 'proxy' },
  { name: 'apple', label: 'GeoSite: Apple (apple)', category: 'infrastructure', defaultRoute: 'direct' },
  { name: 'microsoft', label: 'GeoSite: Microsoft (microsoft)', category: 'infrastructure', defaultRoute: 'direct' },
  { name: 'onedrive', label: 'GeoSite: OneDrive (onedrive)', category: 'infrastructure', defaultRoute: 'proxy' },
  { name: 'steam', label: 'GeoSite: Steam (steam)', category: 'gaming', defaultRoute: 'proxy' },
  { name: 'category-games', label: 'GeoSite: 游戏平台 (category-games)', category: 'gaming', defaultRoute: 'proxy' },
  {
    name: 'category-games@cn',
    label: 'GeoSite: 游戏国服与下载 (category-games@cn)',
    category: 'gaming',
    defaultRoute: 'direct',
  },
];

const CURATED_GEOIP_NAMES: ReadonlyArray<{
  name: string;
  label: string;
  category: CatalogCategory;
  defaultRoute: CatalogDefaultRoute;
}> = [
  { name: 'cn', label: 'GeoIP: 中国大陆 IP (cn)', category: 'domestic', defaultRoute: 'direct' },
  { name: 'private', label: 'GeoIP: 私有与局域网 IP (private)', category: 'infrastructure', defaultRoute: 'direct' },
  { name: 'telegram', label: 'GeoIP: Telegram IP (telegram)', category: 'social', defaultRoute: 'proxy' },
  { name: 'google', label: 'GeoIP: Google IP (google)', category: 'infrastructure', defaultRoute: 'proxy' },
  { name: 'twitter', label: 'GeoIP: Twitter IP (twitter)', category: 'social', defaultRoute: 'proxy' },
  { name: 'facebook', label: 'GeoIP: Facebook IP (facebook)', category: 'social', defaultRoute: 'proxy' },
  { name: 'netflix', label: 'GeoIP: Netflix IP (netflix)', category: 'streaming', defaultRoute: 'proxy' },
  { name: 'cloudflare', label: 'GeoIP: Cloudflare IP (cloudflare)', category: 'infrastructure', defaultRoute: 'proxy' },
];

function buildCuratedGeoItems(): CatalogItem[] {
  const seenGeosite = new Set<string>();
  const seenGeoip = new Set<string>();
  const items: CatalogItem[] = [];

  for (const entry of CURATED_GEOSITE_NAMES) {
    seenGeosite.add(entry.name.toLowerCase());
    items.push({
      id: `geosite:${entry.name}`,
      kind: 'geosite',
      provider: 'geosite',
      name: entry.label,
      aliases: [entry.name, 'geosite'],
      category: entry.category,
      defaultRoute: entry.defaultRoute,
      geoName: entry.name,
    });
  }

  for (const entry of CURATED_GEOIP_NAMES) {
    seenGeoip.add(entry.name.toLowerCase());
    items.push({
      id: `geoip:${entry.name}`,
      kind: 'geoip',
      provider: 'geoip',
      name: entry.label,
      aliases: [entry.name, 'geoip'],
      category: entry.category,
      defaultRoute: entry.defaultRoute,
      geoName: entry.name,
    });
  }

  for (const card of BUILTIN_CARDS) {
    for (const matcher of card.matchers) {
      if (matcher.kind === 'geosite') {
        const key = matcher.name.toLowerCase();
        if (!seenGeosite.has(key)) {
          seenGeosite.add(key);
          items.push({
            id: `geosite:${matcher.name}`,
            kind: 'geosite',
            provider: 'geosite',
            name: `GeoSite: ${matcher.name}`,
            aliases: [matcher.name, 'geosite'],
            category: card.category,
            defaultRoute: 'proxy',
            geoName: matcher.name,
          });
        }
      } else if (matcher.kind === 'geoip') {
        const key = matcher.name.toLowerCase();
        if (!seenGeoip.has(key)) {
          seenGeoip.add(key);
          items.push({
            id: `geoip:${matcher.name}`,
            kind: 'geoip',
            provider: 'geoip',
            name: `GeoIP: ${matcher.name}`,
            aliases: [matcher.name, 'geoip'],
            category: card.category,
            defaultRoute: 'proxy',
            geoName: matcher.name,
          });
        }
      }
    }
  }

  return items;
}

const CURATED_GEO_ITEMS: readonly CatalogItem[] = buildCuratedGeoItems();

function decodeOffsetCursor(raw?: string): number {
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError('VALIDATION_FAILED', '分页游标无效。');
  }
  return parsed;
}

/**
 * Loads the merged rule catalog index (`BUILTIN_CATALOG` + any DB rows in
 * `catalog_entries`) for template planning, linting, probing, and compilation.
 */
export async function loadCatalogIndexMap(env: Env): Promise<Map<string, CatalogEntry>> {
  const dbEntries = await createRepositories(env.DB).catalog.listAll();
  const map = new Map<string, CatalogEntry>();
  for (const entry of BUILTIN_CATALOG) {
    map.set(entry.id, entry);
  }
  for (const row of dbEntries) {
    const builtin = map.get(row.id);
    map.set(row.id, {
      ...builtin,
      ...row,
      behavior: row.behavior ?? builtin?.behavior,
      format: row.format ?? builtin?.format,
    });
  }
  return map;
}

/**
 * Lists the unified rule catalog merging built-in community index entries,
 * the user's own rule sets, and GeoSite / GeoIP names (design §8.3, §12.2).
 */
export async function listCatalog(env: Env, options: ListCatalogOptions = {}): Promise<ListCatalogResult> {
  const repos = createRepositories(env.DB);
  const [catalogMap, rulesets, counts] = await Promise.all([
    loadCatalogIndexMap(env),
    repos.rulesets.listAll(),
    repos.rules.getCountsByCategory(),
  ]);

  const builtinItems: CatalogItem[] = [...catalogMap.values()].map((entry) => ({
    ...entry,
    kind: 'builtin',
  }));

  const rulesetItems: CatalogItem[] = rulesets.map((row) => ({
    id: `ruleset:${row.id}`,
    kind: 'ruleset',
    provider: 'self',
    name: row.name,
    aliases: [row.slug, row.id],
    category: 'other',
    defaultRoute: 'proxy',
    ruleCount: counts.get(row.id)?.enabledRuleCount ?? 0,
    ruleSetId: row.id,
    ruleSetSlug: row.slug,
  }));

  let merged: CatalogItem[] = [...rulesetItems, ...builtinItems, ...CURATED_GEO_ITEMS];

  if (options.kind) {
    merged = merged.filter((item) => item.kind === options.kind);
  }
  if (options.category) {
    merged = merged.filter((item) => item.category === options.category);
  }
  if (options.provider) {
    const targetProvider = options.provider.trim().toLowerCase();
    merged = merged.filter((item) => item.provider.toLowerCase() === targetProvider);
  }
  const query = options.query?.trim().toLowerCase();
  if (query) {
    merged = merged.filter((item) => {
      const haystacks = [
        item.id,
        item.name,
        item.provider,
        item.category,
        item.ruleSetSlug ?? '',
        item.geoName ?? '',
        ...item.aliases,
      ];
      return haystacks.some((field) => field.toLowerCase().includes(query));
    });
  }

  const total = merged.length;
  const offset = decodeOffsetCursor(options.cursor);
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 200));
  const items = merged.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < total;

  return {
    items,
    total,
    nextCursor: hasMore ? String(nextOffset) : null,
    hasMore,
    providers: CATALOG_PROVIDERS,
  };
}

export async function getCatalogEntry(env: Env, entryId: string): Promise<CatalogItem> {
  const trimmed = entryId.trim();
  if (!trimmed) throw new AppError('NOT_FOUND', '规则目录条目不存在。');

  const catalogMap = await loadCatalogIndexMap(env);
  const builtin = catalogMap.get(trimmed);
  if (builtin) {
    return { ...builtin, kind: 'builtin' };
  }

  if (trimmed.startsWith('ruleset:')) {
    const ruleSetId = trimmed.slice('ruleset:'.length);
    const repos = createRepositories(env.DB);
    const row = (await repos.rulesets.findById(ruleSetId)) ?? (await repos.rulesets.findBySlug(ruleSetId));
    if (row) {
      const counts = await repos.rules.getCountsByCategory();
      return {
        id: `ruleset:${row.id}`,
        kind: 'ruleset',
        provider: 'self',
        name: row.name,
        aliases: [row.slug, row.id],
        category: 'other',
        defaultRoute: 'proxy',
        ruleCount: counts.get(row.id)?.enabledRuleCount ?? 0,
        ruleSetId: row.id,
        ruleSetSlug: row.slug,
      };
    }
  }

  if (trimmed.startsWith('geosite:')) {
    const geoName = trimmed.slice('geosite:'.length).trim();
    const curated = CURATED_GEO_ITEMS.find(
      (item) => item.kind === 'geosite' && item.geoName?.toLowerCase() === geoName.toLowerCase(),
    );
    if (curated) return curated;
    if (/^[a-z0-9_!@.-]+$/i.test(geoName)) {
      return {
        id: `geosite:${geoName}`,
        kind: 'geosite',
        provider: 'geosite',
        name: `GeoSite: ${geoName}`,
        aliases: [geoName, 'geosite'],
        category: 'other',
        defaultRoute: 'proxy',
        geoName,
      };
    }
  }

  if (trimmed.startsWith('geoip:')) {
    const geoName = trimmed.slice('geoip:'.length).trim();
    const curated = CURATED_GEO_ITEMS.find(
      (item) => item.kind === 'geoip' && item.geoName?.toLowerCase() === geoName.toLowerCase(),
    );
    if (curated) return curated;
    if (/^[a-z0-9_.-]+$/i.test(geoName)) {
      return {
        id: `geoip:${geoName}`,
        kind: 'geoip',
        provider: 'geoip',
        name: `GeoIP: ${geoName}`,
        aliases: [geoName, 'geoip'],
        category: 'other',
        defaultRoute: 'proxy',
        geoName,
      };
    }
  }

  throw new AppError('NOT_FOUND', '规则目录条目不存在。');
}
