/**
 * Multi icon pack index matching (beta.3 N3b, design revision r2 §4.3).
 *
 * Everything in this module is pure: no I/O, no network. The server reads the cached
 * icon pack indexes from `icon_pack_cache` and hands them in; the matcher then resolves
 * one entry per strategy group / node pool by keyword, honouring the configured pack
 * priority.
 */
import { rewriteGithubUrl } from '../../lib/github-mirror';
import type { IconPackEntry } from './icons';

export type IconPackKind = 'builtin' | 'custom';

export type IconPackPreset = {
  key: string;
  label: string;
  sourceUrl: string;
};

/** Built-in pack keys; custom packs use their URL as key. */
export const QURE_ICON_PACK_KEY = 'qure';
export const LIGE_ICON_PACK_KEY = 'lige';

export const QURE_ICON_PACK_SOURCE_URL =
  'https://raw.githubusercontent.com/Koolson/Qure/master/Other/QureColor-All.json';
export const LIGE_ICON_PACK_SOURCE_URL = 'https://raw.githubusercontent.com/lige47/lige_icon/main/ligeicon.json';

/**
 * Built-in icon packs shipped with the product. Qure is the 1.0.x default; lige is the
 * classified community pack (01Country / 02Media / ... directories, 1000+ icons).
 * Both are refreshed into `icon_pack_cache`; extension packs stay user-configured URLs.
 */
export const BUILTIN_ICON_PACK_PRESETS: readonly IconPackPreset[] = [
  { key: QURE_ICON_PACK_KEY, label: 'Qure', sourceUrl: QURE_ICON_PACK_SOURCE_URL },
  { key: LIGE_ICON_PACK_KEY, label: 'lige', sourceUrl: LIGE_ICON_PACK_SOURCE_URL },
];

/** Preset keys or custom pack URLs, in priority order. */
export type IconPackPreference = {
  customIconPackUrls?: readonly string[];
  iconPackPriority?: readonly string[];
  iconPackDisabled?: readonly string[];
};

export type ResolvedIconPack = {
  key: string;
  label: string;
  kind: IconPackKind;
  /** Cache key in `icon_pack_cache`; absent only for the built-in Qure fallback list. */
  sourceUrl?: string;
};

const MAX_CUSTOM_PACK_URLS = 20;
const MAX_ICONS_PER_PACK = 5000;
const MAX_ICON_NAME_LENGTH = 160;
const MAX_ICON_URL_LENGTH = 2048;

function cleanKeys(values: readonly string[] | undefined): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const key = value.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= MAX_CUSTOM_PACK_URLS) break;
  }
  return keys;
}

function customPackLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.split('/').filter(Boolean).pop();
    return file ? `${parsed.hostname}/${file}` : parsed.hostname;
  } catch {
    return url;
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Resolves the effective pack order: explicitly configured priority first, then the
 * defaults (built-in presets, then extension URLs in entered order). Disabled packs are
 * dropped. A custom URL that points at a built-in preset is folded into that preset so
 * 1.0.x settings that added the lige/Qure URL by hand keep working without duplicates.
 */
export function resolveIconPackOrder(preference: IconPackPreference = {}): ResolvedIconPack[] {
  const customUrls = cleanKeys(preference.customIconPackUrls).filter(
    (url) => isHttpUrl(url) && !BUILTIN_ICON_PACK_PRESETS.some((preset) => preset.sourceUrl === url),
  );
  const defaults: ResolvedIconPack[] = [
    ...BUILTIN_ICON_PACK_PRESETS.map((preset) => ({
      key: preset.key,
      label: preset.label,
      kind: 'builtin' as const,
      sourceUrl: preset.sourceUrl,
    })),
    ...customUrls.map((url) => ({ key: url, label: customPackLabel(url), kind: 'custom' as const, sourceUrl: url })),
  ];
  const disabled = new Set(cleanKeys(preference.iconPackDisabled));
  const byKey = new Map(defaults.map((pack) => [pack.key, pack]));
  const ordered: ResolvedIconPack[] = [];
  const seen = new Set<string>();
  for (const key of cleanKeys(preference.iconPackPriority)) {
    const pack = byKey.get(key);
    if (!pack || seen.has(key)) continue;
    seen.add(key);
    ordered.push(pack);
  }
  for (const pack of defaults) {
    if (seen.has(pack.key)) continue;
    seen.add(pack.key);
    ordered.push(pack);
  }
  return ordered.filter((pack) => !disabled.has(pack.key));
}

/** Cache URLs that should be refreshed for the given preference (enabled packs only). */
export function listIconPackSourceUrls(preference: IconPackPreference = {}): string[] {
  return resolveIconPackOrder(preference)
    .map((pack) => pack.sourceUrl)
    .filter((url): url is string => Boolean(url));
}

/**
 * Normalizes an icon name (or keyword) for comparison: drops the file extension, a
 * trailing serial number such as `Argentina(1)`, directory prefixes, separators and case.
 */
export function normalizeIconKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/^.*\//, '')
    .replace(/\.(png|svg|webp|jpe?g|ico|gif)$/i, '')
    .replace(/\s*[(（]\s*\d+\s*[)）]\s*$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

/**
 * Common aliases between group keywords and pack entry names. Groups are symmetric: any
 * member matches every other member (so `hk`, `Hong Kong`, `香港` and `Hong_Kong` agree).
 */
const ICON_ALIAS_GROUPS: readonly (readonly string[])[] = [
  // Regions
  ['hongkong', 'hk', '香港'],
  ['taiwan', 'tw', '台湾', '臺灣'],
  ['japan', 'jp', '日本'],
  ['korea', 'kr', 'southkorea', '韩国', '韓國'],
  ['singapore', 'sg', '新加坡'],
  ['unitedstates', 'us', 'usa', 'america', '美国', '美國'],
  ['unitedkingdom', 'uk', 'gb', 'england', 'britain', '英国', '英國'],
  ['germany', 'de', '德国', '德國'],
  ['france', 'fr', '法国', '法國'],
  ['canada', 'ca', '加拿大'],
  ['australia', 'au', '澳大利亚', '澳洲'],
  ['china', 'cn', 'mainland', '中国', '中國'],
  ['netherlands', 'nl', '荷兰', '荷蘭'],
  ['russia', 'ru', '俄罗斯', '俄羅斯'],
  ['india', 'in', '印度'],
  ['brazil', 'br', '巴西'],
  ['turkey', 'tr', '土耳其'],
  ['argentina', 'ar', '阿根廷'],
  ['italy', 'it', '意大利'],
  ['spain', 'es', '西班牙'],
  ['switzerland', 'ch', '瑞士'],
  ['sweden', 'se', '瑞典'],
  ['thailand', 'th', '泰国', '泰國'],
  ['vietnam', 'vn', '越南'],
  ['malaysia', 'my', '马来西亚', '馬來西亞'],
  ['indonesia', 'id', '印度尼西亚'],
  ['philippines', 'ph', '菲律宾', '菲律賓'],
  ['macau', 'mo', '澳门', '澳門'],
  // Services
  ['openai', 'chatgpt', 'gpt'],
  ['claude', 'anthropic'],
  ['gemini', 'bard'],
  ['youtube', 'yt', '油管'],
  ['telegram', 'tg', '电报', '電報'],
  ['twitter', 'x', '推特'],
  ['netflix', '奈飞', '網飛', '网飞'],
  ['disney', 'disneyplus', '迪士尼'],
  ['bilibili', '哔哩哔哩', 'b站'],
  ['spotify', '声田', '聲田'],
  ['github', 'gh'],
  ['paypal', '贝宝', '貝寶'],
  ['onedrive', '微软网盘', '微軟網盤'],
  ['icloud', 'i云', 'i雲'],
  ['gaming', 'game', '游戏', '遊戲'],
  ['streaming', 'media', '流媒体', '流媒體'],
  ['music', '音乐', '音樂'],
  // Roles
  ['advertising', 'ads', 'ad', '广告', '廣告'],
  ['final', '漏网之鱼', '漏網之魚'],
  ['direct', '直连', '直連'],
  ['reject', 'block', '拦截', '攔截'],
  ['proxy', '节点选择', '節點選擇'],
  ['roundrobin', 'loadbalance', '负载均衡', '負載均衡'],
];

const ALIAS_LOOKUP: ReadonlyMap<string, readonly string[]> = (() => {
  const lookup = new Map<string, string[]>();
  for (const group of ICON_ALIAS_GROUPS) {
    const normalized = group.map(normalizeIconKey).filter(Boolean);
    for (const member of normalized) {
      const existing = lookup.get(member) ?? [];
      lookup.set(member, [...new Set([...existing, ...normalized])]);
    }
  }
  return lookup;
})();

/** Expands one keyword into the normalized names it may match in a pack index. */
export function iconKeywordVariants(keyword: string): string[] {
  const base = normalizeIconKey(keyword);
  if (!base) return [];
  const group = ALIAS_LOOKUP.get(base);
  if (!group) return [base];
  return [base, ...group.filter((member) => member !== base)];
}

/** All normalized names a pack entry answers to (full name plus serial-free variants). */
function iconEntryVariants(name: string): string[] {
  const variants = new Set<string>();
  const base = normalizeIconKey(name);
  if (base) variants.add(base);
  return [...variants];
}

export type IconPackBuildInput = {
  order: readonly ResolvedIconPack[];
  /** Cached entries per pack key (read-only `icon_pack_cache` rows). */
  cached: ReadonlyMap<string, readonly IconPackEntry[]>;
  /** Built-in Qure fallback list, appended to the Qure pack so icons work before a refresh. */
  defaultQureEntries?: readonly IconPackEntry[];
  githubMirrorUrl?: string;
  /** Keyword matching across pack priority (on by default; off keeps the 1.0.x output byte-identical). */
  indexMatching: boolean;
};

function makeUrlRewriter(githubMirrorUrl?: string): (url: string) => string {
  const mirror = githubMirrorUrl?.trim() ?? '';
  if (!mirror) return (url: string) => url;
  return (url: string) => {
    try {
      return rewriteGithubUrl(url, mirror);
    } catch {
      return url;
    }
  };
}

function dedupeEntries(entries: readonly IconPackEntry[]): IconPackEntry[] {
  const seen = new Set<string>();
  const result: IconPackEntry[] = [];
  for (const entry of entries) {
    const key = normalizeIconKey(entry.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ name: entry.name, url: entry.url });
  }
  return result;
}

/**
 * Builds the flat entry list handed to compilers.
 *
 * - `indexMatching: true` (the default) tags every entry with its pack key, so
 *   `recognizeGroupIcon` can match keywords in pack-priority order; Qure first means groups
 *   that already resolved keep their icon and only previously icon-less groups gain one.
 * - `indexMatching: false` (user opt-out) keeps the 1.0.x/beta.2 precedence: extension packs
 *   first, then the cached Qure pack, then the built-in Qure fallback list (untagged, alias
 *   matching only).
 */
export function buildIconPackEntries(input: IconPackBuildInput): IconPackEntry[] {
  const rewrite = makeUrlRewriter(input.githubMirrorUrl);
  const packs = input.order
    .map((pack) => {
      const cached = (input.cached.get(pack.key) ?? []).map((entry) => ({ name: entry.name, url: entry.url }));
      const extra = pack.key === QURE_ICON_PACK_KEY ? (input.defaultQureEntries ?? []) : [];
      return { pack, entries: dedupeEntries([...cached, ...extra]) };
    })
    .filter(({ entries }) => entries.length > 0);

  if (input.indexMatching) {
    return packs.flatMap(({ pack, entries }) =>
      entries.map((entry) => ({
        name: entry.name,
        url: rewrite(entry.url),
        pack: pack.key,
        packLabel: pack.label,
      })),
    );
  }

  const legacyOrder = [
    ...packs.filter(({ pack }) => pack.kind === 'custom'),
    ...packs.filter(({ pack }) => pack.kind === 'builtin'),
  ];
  return legacyOrder.flatMap(({ entries }) => entries.map((entry) => ({ name: entry.name, url: rewrite(entry.url) })));
}

/** Parses a Qure/Sub-Store/Quantumult X icon pack payload (`{ name, description, icons: [...] }`). */
export function parseIconPackPayload(payload: unknown): { name: string; url: string }[] {
  let values: unknown[] = [];
  if (Array.isArray(payload)) values = payload;
  else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.icons)) values = record.icons;
    else values = Object.entries(record).map(([name, url]) => ({ name, url }));
  }
  return values
    .flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const icon = value as Record<string, unknown>;
      if (typeof icon.name !== 'string' || typeof icon.url !== 'string' || !isHttpUrl(icon.url)) return [];
      return [{ name: icon.name.slice(0, MAX_ICON_NAME_LENGTH), url: icon.url.slice(0, MAX_ICON_URL_LENGTH) }];
    })
    .slice(0, MAX_ICONS_PER_PACK);
}

export type IconPackMatch = {
  packKey: string;
  packLabel: string;
  entry: IconPackEntry;
  keyword: string;
};

type PackLookup = {
  key: string;
  label: string;
  entries: Map<string, IconPackEntry>;
};

const lookupCache = new WeakMap<readonly IconPackEntry[], readonly PackLookup[]>();

/** True when entries carry pack keys, i.e. the caller opted into index matching. */
export function hasIconPackTags(entries: readonly IconPackEntry[]): boolean {
  for (const entry of entries) if (typeof entry.pack === 'string' && entry.pack.trim()) return true;
  return false;
}

function packLookups(entries: readonly IconPackEntry[]): readonly PackLookup[] {
  const cached = lookupCache.get(entries);
  if (cached) return cached;
  const order: string[] = [];
  const byKey = new Map<string, PackLookup>();
  for (const entry of entries) {
    const key = entry.pack?.trim();
    if (!key) continue;
    let lookup = byKey.get(key);
    if (!lookup) {
      lookup = { key, label: entry.packLabel?.trim() || key, entries: new Map() };
      byKey.set(key, lookup);
      order.push(key);
    }
    for (const variant of iconEntryVariants(entry.name)) {
      if (!lookup.entries.has(variant)) lookup.entries.set(variant, entry);
    }
  }
  const result = order.map((key) => byKey.get(key)!).filter(Boolean);
  lookupCache.set(entries, result);
  return result;
}

/**
 * Returns the first entry hit walking packs in priority order, then keywords in the order
 * produced by `iconSearchKeywords` (legacy aliases first, then extra name/region terms).
 */
export function matchIconPackEntry(
  keywords: readonly string[],
  entries: readonly IconPackEntry[],
): IconPackMatch | undefined {
  if (!keywords.length || !entries.length) return undefined;
  const packs = packLookups(entries);
  if (!packs.length) return undefined;
  for (const pack of packs) {
    for (const keyword of keywords) {
      for (const variant of iconKeywordVariants(keyword)) {
        const entry = pack.entries.get(variant);
        if (entry) return { packKey: pack.key, packLabel: pack.label, entry, keyword };
      }
    }
  }
  return undefined;
}
