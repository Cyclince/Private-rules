import { rewriteGithubUrl } from '../../lib/github-mirror';
import { detectNodeRegions } from '../nodes/filter';
import { getRegionDefinition } from '../nodes/regions';
import { hasIconPackTags, matchIconPackEntry } from './icon-packs';
import {
  categoryIcon,
  extractEmojiFromName,
  recognizeGroupEmoji,
  type IconMatchSource,
  type IconRecognitionInput,
} from './icons-emoji';

export { categoryIcon, extractEmojiFromName };
export type { IconMatchSource, IconRecognitionInput };

export type IconPackEntry = {
  name: string;
  url: string;
  /** Icon pack key this entry came from; present only when multi-pack index matching is enabled. */
  pack?: string;
  /** Human readable pack label, used for diagnostics. */
  packLabel?: string;
};

const QURE_COLOR_BASE_URL = 'https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color';

/**
 * Built-in default icon pack entries sourced from Koolson/Qure (`QureColor-All.json`)
 * so mihomo configs include icons out-of-the-box even before the icon-pack cache is refreshed.
 * Custom icon packs configured in settings always take precedence over this fallback.
 */
export const DEFAULT_QURE_ICON_PACK: readonly IconPackEntry[] = [
  'Advertising.png',
  'Airport.png',
  'Apple.png',
  'Australia.png',
  'Auto.png',
  'Available.png',
  'bilibili.png',
  'Bot.png',
  'Canada.png',
  'China.png',
  'China_Map.png',
  'Direct.png',
  'Discord.png',
  'Disney.png',
  'Domestic.png',
  'Final.png',
  'France.png',
  'Game.png',
  'Germany.png',
  'GitHub.png',
  'Global.png',
  'Google.png',
  'Google_Search.png',
  'Hong_Kong.png',
  'Japan.png',
  'Korea.png',
  'Microsoft.png',
  'Netflix.png',
  'OneDrive.png',
  'PayPal.png',
  'Proxy.png',
  'Reject.png',
  'Round_Robin.png',
  'Server.png',
  'Singapore.png',
  'Speedtest.png',
  'Spotify.png',
  'Steam.png',
  'Streaming.png',
  'Taiwan.png',
  'Telegram.png',
  'TikTok.png',
  'Twitter.png',
  'United_Kingdom.png',
  'United_States.png',
  'YouTube.png',
].map((file) => ({
  name: file.replace(/\.png$/i, ''),
  url: `${QURE_COLOR_BASE_URL}/${file}`,
}));

/**
 * Returns the default QureColor icon pack entries, optionally rewritten through
 * a configured GitHub mirror URL (pure function, no I/O).
 */
export function buildDefaultIconPack(githubMirrorUrl?: string): IconPackEntry[] {
  const mirror = githubMirrorUrl?.trim() ?? '';
  if (!mirror) return DEFAULT_QURE_ICON_PACK.map((entry) => ({ ...entry }));
  return DEFAULT_QURE_ICON_PACK.map((entry) => ({
    name: entry.name,
    url: rewriteGithubUrl(entry.url, mirror),
  }));
}

export type IconRecognitionResult = {
  /** Canonical semantic icon key (e.g. `openai`, `youtube`, `hk`, `proxy`). */
  key: string;
  /** Extracted or recommended emoji glyph. */
  emoji?: string;
  /** Which priority step in design §10.9 produced the match. */
  source: IconMatchSource;
  /** Candidate icon pack names to search in external icon packs (e.g. QureColor). */
  packAliases: readonly string[];
  /** Matched entry from the provided icon pack, if any. */
  packIcon?: IconPackEntry;
};

/**
 * Pack names this repository can verify offline: everything shipped in the built-in QureColor
 * fallback pack plus names that pre-r2 mappings already referenced. New service rules may only
 * use names from this list; services without a verified icon fall back to their category icon
 * (design revision r2 §4.3). Enforced by tests/domain/templates-stages-icons-planner.test.ts.
 */
const VERIFIED_PACK_ICON_NAMES = [
  'AI',
  'Advertising',
  'Airport',
  'Apple',
  'Australia',
  'Auto',
  'Available',
  'Bilibili',
  'Bot',
  'Canada',
  'ChatGPT',
  'China',
  'China_Map',
  'Claude',
  'Direct',
  'Discord',
  'Disney',
  'Disney+',
  'Domestic',
  'Fallback',
  'Final',
  'Fish',
  'France',
  'Game',
  'Gemini',
  'Germany',
  'GitHub',
  'Global',
  'GlobalMedia',
  'Google',
  'Google_Search',
  'Home',
  'Hong_Kong',
  'Japan',
  'Korea',
  'LoadBalance',
  'Media',
  'Microsoft',
  'Music',
  'Netflix',
  'OneDrive',
  'OpenAI',
  'PayPal',
  'Proxy',
  'Reject',
  'Rocket',
  'Round_Robin',
  'RoundRobin',
  'Server',
  'Singapore',
  'Social',
  'Speedtest',
  'Spotify',
  'Steam',
  'Streaming',
  'Taiwan',
  'Telegram',
  'TikTok',
  'Twitter',
  'United_Kingdom',
  'United_States',
  'X',
  'YouTube',
  'bilibili',
] as const;

export const VERIFIED_PACK_ICON_NAME_SET: ReadonlySet<string> = new Set(VERIFIED_PACK_ICON_NAMES);

function normalizeIconName(name: string): string {
  return name
    .replace(/\.(png|svg|webp|jpe?g|ico|gif)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Keywords used for multi icon pack matching (beta.3 N3b): the legacy alias list first (so
 * resolved results stay stable), then region terms (code / English / Chinese), then the
 * group name and slug tokens, then the category key.
 */
export function iconSearchKeywords(input: IconRecognitionInput, aliases: readonly string[] = []): string[] {
  const keywords: string[] = [];
  const push = (value?: string | null) => {
    const trimmed = value?.trim();
    if (trimmed) keywords.push(trimmed);
  };

  for (const alias of aliases) push(alias);

  const regionCodes = [input.region, ...detectNodeRegions(input.name)].filter(
    (code): code is string => typeof code === 'string' && code.length > 0,
  );
  for (const code of regionCodes) {
    const definition = getRegionDefinition(code);
    if (!definition) continue;
    push(definition.code);
    push(definition.nameEn);
    push(definition.nameZh);
  }

  for (const token of nameTokens(input.name)) push(token);
  for (const token of nameTokens(input.slug)) push(token);
  if (input.category) push(input.category);

  const seen = new Set<string>();
  return keywords.filter((keyword) => {
    const key = keyword.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Generic words that never identify an icon (group/pool scaffolding around a brand name). */
const KEYWORD_STOPWORDS: ReadonlySet<string> = new Set([
  'group',
  'groups',
  'policy',
  'policies',
  'node',
  'nodes',
  'rule',
  'rules',
  'list',
  'pool',
  'pools',
  'proxy',
  'proxies',
  'select',
  '节点',
  '節點',
  '策略',
  '分组',
  '分組',
  '规则',
  '規則',
  '节点池',
  '節點池',
  '地区',
  '地區',
]);

function nameTokens(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token))
    .filter((token) => !KEYWORD_STOPWORDS.has(token.toLowerCase()));
}

function matchPackIcon(
  aliases: readonly string[],
  packIcons?: readonly IconPackEntry[],
  keywords?: readonly string[],
): IconPackEntry | undefined {
  if (!packIcons || packIcons.length === 0) return undefined;
  if (keywords && keywords.length > 0 && hasIconPackTags(packIcons)) {
    const matched = matchIconPackEntry(keywords, packIcons);
    if (matched) return matched.entry;
  }
  const normalizedPack = new Map<string, IconPackEntry>();
  for (const icon of packIcons) {
    const normalized = normalizeIconName(icon.name);
    if (normalized && !normalizedPack.has(normalized)) {
      normalizedPack.set(normalized, icon);
    }
  }
  for (const alias of aliases) {
    const exact = normalizedPack.get(normalizeIconName(alias));
    if (exact) return exact;
  }
  return undefined;
}

/**
 * Recognizes a strategy group's icon following the exact 5-step priority order
 * defined in design §10.9:
 *   1. Embedded emoji in name
 *   2. Service keyword / explicit category
 *   3. Region code or region name
 *   4. Group role (proxy / auto / fallback / direct / final / reject)
 *   5. Rules / matchers inside the group
 */
export function recognizeGroupIcon(
  input: IconRecognitionInput,
  packIcons?: readonly IconPackEntry[],
): IconRecognitionResult {
  const core = recognizeGroupEmoji(input);
  const packIcon = matchPackIcon(core.packAliases, packIcons, iconSearchKeywords(input, core.packAliases));
  return { ...core, packIcon };
}
