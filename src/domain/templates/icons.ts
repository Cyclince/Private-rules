import type { CatalogCategory, GroupType, Matcher } from '../../shared/schemas/card';
import { detectNodeRegions, getRegionDefinition } from '../nodes';

export type IconPackEntry = {
  name: string;
  url: string;
};

export type IconMatchSource = 'emoji' | 'service' | 'category' | 'region' | 'role' | 'matcher' | 'fallback';

export type IconRecognitionInput = {
  name: string;
  slug?: string;
  category?: CatalogCategory;
  region?: string;
  groupType?: GroupType;
  matchers?: readonly Matcher[];
};

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

type ServiceIconRule = {
  key: string;
  emoji: string;
  pattern: RegExp;
  packAliases: readonly string[];
};

const SERVICE_ICON_RULES: readonly ServiceIconRule[] = [
  { key: 'openai', emoji: '🤖', pattern: /\b(openai|chatgpt|gpt)\b/i, packAliases: ['ChatGPT', 'OpenAI', 'AI'] },
  { key: 'claude', emoji: '🧠', pattern: /\b(claude|anthropic)\b/i, packAliases: ['Claude', 'AI'] },
  { key: 'gemini', emoji: '✨', pattern: /\b(gemini|bard)\b/i, packAliases: ['Gemini', 'Google', 'AI'] },
  {
    key: 'ai',
    emoji: '✨',
    pattern: /\b(ai|copilot|perplexity|midjourney)\b|人工智能|AI\s*服务/i,
    packAliases: ['Bot', 'AI', 'ChatGPT'],
  },
  { key: 'youtube', emoji: '▶️', pattern: /\byoutube\b|油管/i, packAliases: ['YouTube', 'Media'] },
  { key: 'netflix', emoji: '🎬', pattern: /\bnetflix\b|奈飞|網飛|网飞/i, packAliases: ['Netflix', 'Media'] },
  { key: 'disney', emoji: '🏰', pattern: /\bdisney\+?\b|迪士尼/i, packAliases: ['Disney', 'Disney+', 'Media'] },
  {
    key: 'bilibili',
    emoji: '📺',
    pattern: /\bbilibili\b|哔哩哔哩|嗶哩嗶哩|b站/i,
    packAliases: ['bilibili', 'Bilibili'],
  },
  { key: 'spotify', emoji: '🎵', pattern: /\bspotify\b/i, packAliases: ['Spotify', 'Music'] },
  { key: 'tiktok', emoji: '🎵', pattern: /\btiktok\b|抖音/i, packAliases: ['TikTok', 'Media'] },
  { key: 'telegram', emoji: '✈️', pattern: /\btelegram\b|\btg\b|电报|電報/i, packAliases: ['Telegram'] },
  { key: 'twitter', emoji: '𝕏', pattern: /\b(twitter|x\.com)\b|推特/i, packAliases: ['Twitter', 'X'] },
  { key: 'discord', emoji: '💬', pattern: /\bdiscord\b/i, packAliases: ['Discord'] },
  { key: 'github', emoji: '🐙', pattern: /\bgithub\b/i, packAliases: ['GitHub'] },
  { key: 'google-fcm', emoji: '🔔', pattern: /\b(google[-_\s]?fcm|fcm)\b/i, packAliases: ['Google_Search', 'Google'] },
  { key: 'google', emoji: '🔍', pattern: /\bgoogle\b|谷歌/i, packAliases: ['Google_Search', 'Google'] },
  { key: 'apple', emoji: '🍎', pattern: /\b(apple|icloud|appstore)\b|苹果|蘋果/i, packAliases: ['Apple'] },
  { key: 'onedrive', emoji: '☁️', pattern: /\bonedrive\b/i, packAliases: ['OneDrive', 'Microsoft'] },
  {
    key: 'microsoft',
    emoji: '🪟',
    pattern: /\b(microsoft|bing|outlook|office)\b|微软|微軟/i,
    packAliases: ['Microsoft'],
  },
  { key: 'steam', emoji: '🎮', pattern: /\bsteam\b/i, packAliases: ['Steam', 'Game'] },
  {
    key: 'gaming',
    emoji: '🕹️',
    pattern: /\b(game|gaming|epic|playstation|xbox|nintendo|blizzard)\b|游戏|遊戲/i,
    packAliases: ['Game', 'Steam'],
  },
  { key: 'speedtest', emoji: '⏱️', pattern: /\b(speedtest|fast\.com)\b|测速|測速/i, packAliases: ['Speedtest'] },
  {
    key: 'advertising',
    emoji: '🛡️',
    pattern: /\b(adblock|adguard|ads?|reject)\b|广告|廣告|拦截|攔截/i,
    packAliases: ['Advertising', 'Reject'],
  },
  { key: 'paypal', emoji: '💳', pattern: /\bpaypal\b/i, packAliases: ['PayPal'] },
];

const CATEGORY_ICONS: Record<CatalogCategory, { key: string; emoji: string; packAliases: readonly string[] }> = {
  ai: { key: 'ai', emoji: '✨', packAliases: ['Bot', 'ChatGPT', 'AI'] },
  streaming: { key: 'streaming', emoji: '🎬', packAliases: ['Streaming', 'GlobalMedia', 'Media'] },
  social: { key: 'social', emoji: '💬', packAliases: ['Telegram', 'Social'] },
  gaming: { key: 'gaming', emoji: '🎮', packAliases: ['Game', 'Steam'] },
  advertising: { key: 'advertising', emoji: '🛡️', packAliases: ['Advertising', 'Reject'] },
  domestic: { key: 'domestic', emoji: '🇨🇳', packAliases: ['China_Map', 'China', 'Direct'] },
  infrastructure: { key: 'infrastructure', emoji: '🌐', packAliases: ['Global', 'Proxy'] },
  other: { key: 'other', emoji: '📦', packAliases: ['Final', 'Global'] },
};

const ROLE_ICON_RULES: readonly ServiceIconRule[] = [
  { key: 'lan', emoji: '🏠', pattern: /\b(lan|private|local)\b|局域网|私有/i, packAliases: ['Direct', 'Home'] },
  {
    key: 'domestic',
    emoji: '🇨🇳',
    pattern: /\b(direct|domestic|china)\b|国内|國內|直连|直連/i,
    packAliases: ['Direct', 'China_Map'],
  },
  {
    key: 'final',
    emoji: '🐟',
    pattern: /\b(final|match|fallback[-_]?final)\b|漏网之鱼|漏網之魚|兜底/i,
    packAliases: ['Final', 'Fish'],
  },
  {
    key: 'auto',
    emoji: '⚡',
    pattern: /\b(auto|url-test|fastest)\b|自动|自動|测速选择/i,
    packAliases: ['Auto', 'Speedtest'],
  },
  {
    key: 'fallback',
    emoji: '🔁',
    pattern: /\bfallback\b|故障转移|故障轉移/i,
    packAliases: ['Available', 'Fallback', 'Auto'],
  },
  {
    key: 'load-balance',
    emoji: '⚖️',
    pattern: /\bload[-_\s]?balance\b|负载均衡|負載均衡/i,
    packAliases: ['RoundRobin', 'LoadBalance'],
  },
  {
    key: 'proxy',
    emoji: '🚀',
    pattern: /\b(proxy|gfw|select)\b|节点选择|節點選擇|代理/i,
    packAliases: ['Proxy', 'Rocket'],
  },
];

/** Extracts the first emoji (including regional indicator flag pairs) from a group name. */
export function extractEmojiFromName(name: string): string | undefined {
  const flagMatch = name.match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
  if (flagMatch) return flagMatch[0];
  const emojiMatch = name.match(/\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/u);
  return emojiMatch ? emojiMatch[0] : undefined;
}

function normalizeIconName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function matchPackIcon(aliases: readonly string[], packIcons?: readonly IconPackEntry[]): IconPackEntry | undefined {
  if (!packIcons || packIcons.length === 0) return undefined;
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

function extractMatcherText(matchers: readonly Matcher[] | undefined): string {
  if (!matchers || matchers.length === 0) return '';
  const parts: string[] = [];
  for (const matcher of matchers) {
    if (matcher.kind === 'geosite' || matcher.kind === 'geoip') parts.push(matcher.name);
    else if (matcher.kind === 'catalog') parts.push(matcher.entryId);
    else if (matcher.kind === 'ruleset') parts.push(matcher.ruleSetId);
    else if (matcher.kind === 'remote') parts.push(matcher.url);
    else if (matcher.kind === 'inline') {
      const walk = (items: typeof matcher.conditions) => {
        for (const cond of items) {
          if (cond.op === 'rule') parts.push(cond.rule.value);
          else if (cond.op === 'not') walk([cond.item]);
          else walk(cond.items);
        }
      };
      walk(matcher.conditions);
    }
  }
  return parts.join(' ');
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
  const combinedName = `${input.name} ${input.slug ?? ''}`.trim();

  // Helper to resolve secondary aliases for icon packs even when emoji wins step 1.
  const resolveSemanticAliases = (): { key: string; packAliases: readonly string[] } | undefined => {
    const service = SERVICE_ICON_RULES.find((rule) => rule.pattern.test(combinedName));
    if (service) return { key: service.key, packAliases: service.packAliases };
    if (input.region) {
      const def = getRegionDefinition(input.region);
      if (def) return { key: def.code.toLowerCase(), packAliases: [def.nameEn, def.code, def.nameZh] };
    }
    const detectedRegions = detectNodeRegions(input.name);
    if (detectedRegions.length > 0) {
      const def = getRegionDefinition(detectedRegions[0]);
      if (def) return { key: def.code.toLowerCase(), packAliases: [def.nameEn, def.code, def.nameZh] };
    }
    const role = ROLE_ICON_RULES.find((rule) => rule.pattern.test(combinedName));
    if (role) return { key: role.key, packAliases: role.packAliases };
    if (input.category) {
      const cat = CATEGORY_ICONS[input.category];
      return { key: cat.key, packAliases: cat.packAliases };
    }
    return undefined;
  };

  // Step 1: Emoji embedded in name
  const emoji = extractEmojiFromName(input.name);
  if (emoji) {
    const semantic = resolveSemanticAliases();
    const packAliases = semantic?.packAliases ?? [input.name];
    return {
      key: semantic?.key ?? 'emoji',
      emoji,
      source: 'emoji',
      packAliases,
      packIcon: matchPackIcon(packAliases, packIcons),
    };
  }

  // Step 2a: Service match from name / slug
  const serviceMatch = SERVICE_ICON_RULES.find((rule) => rule.pattern.test(combinedName));
  if (serviceMatch) {
    return {
      key: serviceMatch.key,
      emoji: serviceMatch.emoji,
      source: 'service',
      packAliases: serviceMatch.packAliases,
      packIcon: matchPackIcon(serviceMatch.packAliases, packIcons),
    };
  }

  // Step 3 (checked before generic category if explicit region is set): Region
  if (input.region) {
    const regionDef = getRegionDefinition(input.region);
    if (regionDef) {
      const packAliases = [regionDef.nameEn, regionDef.code, regionDef.nameZh];
      return {
        key: regionDef.code.toLowerCase(),
        emoji: regionDef.flag,
        source: 'region',
        packAliases,
        packIcon: matchPackIcon(packAliases, packIcons),
      };
    }
  }

  // Step 2b: Non-generic category match (specific categories win over region/role fallback)
  if (input.category && input.category !== 'other' && input.category !== 'infrastructure') {
    const cat = CATEGORY_ICONS[input.category];
    return {
      key: cat.key,
      emoji: cat.emoji,
      source: 'category',
      packAliases: cat.packAliases,
      packIcon: matchPackIcon(cat.packAliases, packIcons),
    };
  }

  // Step 3b: Region inferred from name
  const nameRegions = detectNodeRegions(input.name);
  if (nameRegions.length > 0) {
    const regionDef = getRegionDefinition(nameRegions[0]);
    if (regionDef) {
      const packAliases = [regionDef.nameEn, regionDef.code, regionDef.nameZh];
      return {
        key: regionDef.code.toLowerCase(),
        emoji: regionDef.flag,
        source: 'region',
        packAliases,
        packIcon: matchPackIcon(packAliases, packIcons),
      };
    }
  }

  // Step 4: Group role (name keywords or groupType)
  const roleMatch = ROLE_ICON_RULES.find((rule) => rule.pattern.test(combinedName));
  if (roleMatch) {
    return {
      key: roleMatch.key,
      emoji: roleMatch.emoji,
      source: 'role',
      packAliases: roleMatch.packAliases,
      packIcon: matchPackIcon(roleMatch.packAliases, packIcons),
    };
  }
  if (input.groupType === 'url-test') {
    return {
      key: 'auto',
      emoji: '⚡',
      source: 'role',
      packAliases: ['Auto', 'Speedtest'],
      packIcon: matchPackIcon(['Auto', 'Speedtest'], packIcons),
    };
  }
  if (input.groupType === 'fallback') {
    return {
      key: 'fallback',
      emoji: '🔁',
      source: 'role',
      packAliases: ['Available', 'Fallback'],
      packIcon: matchPackIcon(['Available', 'Fallback'], packIcons),
    };
  }
  if (input.groupType === 'load-balance') {
    return {
      key: 'load-balance',
      emoji: '⚖️',
      source: 'role',
      packAliases: ['RoundRobin', 'LoadBalance'],
      packIcon: matchPackIcon(['RoundRobin', 'LoadBalance'], packIcons),
    };
  }

  // Step 5: Matchers / rules inside the group
  const matcherText = extractMatcherText(input.matchers);
  if (matcherText) {
    const matcherService = SERVICE_ICON_RULES.find((rule) => rule.pattern.test(matcherText));
    if (matcherService) {
      return {
        key: matcherService.key,
        emoji: matcherService.emoji,
        source: 'matcher',
        packAliases: matcherService.packAliases,
        packIcon: matchPackIcon(matcherService.packAliases, packIcons),
      };
    }
    const matcherRole = ROLE_ICON_RULES.find((rule) => rule.pattern.test(matcherText));
    if (matcherRole) {
      return {
        key: matcherRole.key,
        emoji: matcherRole.emoji,
        source: 'matcher',
        packAliases: matcherRole.packAliases,
        packIcon: matchPackIcon(matcherRole.packAliases, packIcons),
      };
    }
  }

  // Final fallback: generic category or default icon
  if (input.category) {
    const cat = CATEGORY_ICONS[input.category];
    return {
      key: cat.key,
      emoji: cat.emoji,
      source: 'category',
      packAliases: cat.packAliases,
      packIcon: matchPackIcon(cat.packAliases, packIcons),
    };
  }

  return {
    key: 'proxy',
    emoji: '🌐',
    source: 'fallback',
    packAliases: ['Global', 'Proxy'],
    packIcon: matchPackIcon(['Global', 'Proxy'], packIcons),
  };
}
