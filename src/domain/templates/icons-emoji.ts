import { CATEGORY_EMOJI } from '../../shared/app-categories';
import type { CatalogCategory, GroupType, Matcher } from '../../shared/schemas/card';
import { detectNodeRegions } from '../nodes/filter';
import { getRegionDefinition } from '../nodes/regions';

export type IconMatchSource = 'emoji' | 'service' | 'category' | 'region' | 'role' | 'matcher' | 'fallback';

export type IconRecognitionInput = {
  name: string;
  slug?: string;
  category?: CatalogCategory;
  region?: string;
  groupType?: GroupType;
  matchers?: readonly Matcher[];
};

export type EmojiRecognitionResult = {
  /** Canonical semantic icon key (e.g. `openai`, `youtube`, `hk`, `proxy`). */
  key: string;
  /** Extracted or recommended emoji glyph. */
  emoji?: string;
  /** Which priority step in design §10.9 produced the match. */
  source: IconMatchSource;
  /** Candidate icon pack names to search in external icon packs (e.g. QureColor). */
  packAliases: readonly string[];
};

type ServiceIconRule = {
  key: string;
  emoji: string;
  pattern: RegExp;
  packAliases: readonly string[];
};

/**
 * Service word list for icon recognition (design revision r2 §4.2 example services).
 * Order matters: specific brands (Apple Music, YouTube Music, iCloud) come before their
 * umbrella brand (Apple, YouTube). `packAliases` only contains verified Qure names; an empty
 * list means "no verified icon yet" and the category icon is used instead.
 */
export const SERVICE_ICON_RULES: readonly ServiceIconRule[] = [
  // --- Music (before the umbrella video brands) ---
  {
    key: 'apple-music',
    emoji: '🎵',
    pattern: /\bapple\s*music\b|苹果音乐|蘋果音樂/i,
    packAliases: ['Apple', 'Music'],
  },
  {
    key: 'youtube-music',
    emoji: '🎵',
    pattern: /\byoutube\s*music\b|油管音乐|油管音樂/i,
    packAliases: ['YouTube', 'Music'],
  },
  { key: 'spotify', emoji: '🎵', pattern: /\bspotify\b|声田|聲田/i, packAliases: ['Spotify', 'Music'] },
  // --- Apple services (before the generic Apple rule) ---
  {
    key: 'icloud',
    emoji: '☁️',
    pattern: /\bicloud\b|i云|i雲/i,
    packAliases: ['Apple'],
  },
  {
    key: 'app-store',
    emoji: '🛍️',
    pattern: /\bapp\s*store\b|应用商店|應用商店/i,
    packAliases: ['Apple'],
  },
  // --- AI ---
  { key: 'openai', emoji: '🤖', pattern: /\b(openai|chatgpt|gpt)\b/i, packAliases: ['ChatGPT', 'OpenAI', 'Bot', 'AI'] },
  { key: 'claude', emoji: '🧠', pattern: /\b(claude|anthropic)\b/i, packAliases: ['Claude', 'Bot', 'AI'] },
  { key: 'gemini', emoji: '✨', pattern: /\b(gemini|bard)\b/i, packAliases: ['Gemini', 'Google', 'Bot', 'AI'] },
  {
    key: 'ai',
    emoji: '✨',
    pattern: /\b(ai|copilot|perplexity|midjourney)\b|人工智能|AI\s*服务/i,
    packAliases: ['Bot', 'AI', 'ChatGPT'],
  },
  // --- International streaming ---
  { key: 'youtube', emoji: '▶️', pattern: /\byoutube\b|油管/i, packAliases: ['YouTube', 'Media'] },
  { key: 'netflix', emoji: '🎬', pattern: /\bnetflix\b|奈飞|網飛|网飞/i, packAliases: ['Netflix', 'Media'] },
  { key: 'disney', emoji: '🏰', pattern: /\bdisney\+?\b|迪士尼/i, packAliases: ['Disney', 'Disney+', 'Media'] },
  {
    key: 'hbo',
    emoji: '🎬',
    pattern: /\bhbo(?:\s*max)?\b|hbo\s*go/i,
    packAliases: ['Streaming', 'Media'],
  },
  {
    key: 'prime-video',
    emoji: '🎬',
    pattern: /\bprime[-_\s]?video\b|亚马逊视频|亞馬遜視頻/i,
    packAliases: ['Streaming'],
  },
  { key: 'tiktok', emoji: '🎵', pattern: /\btiktok\b|抖音/i, packAliases: ['TikTok', 'Media'] },
  // --- Greater-China streaming ---
  {
    key: 'bilibili',
    emoji: '📺',
    pattern: /\bbilibili\b|哔哩哔哩|嗶哩嗶哩|b站/i,
    packAliases: ['bilibili', 'Bilibili'],
  },
  { key: 'bahamut', emoji: '📺', pattern: /巴哈姆特|\bbahamut\b/i, packAliases: ['Streaming', 'Taiwan'] },
  {
    key: 'tvb',
    emoji: '📺',
    pattern: /\btvb\b|无线电视|無綫電視|翡翠台/i,
    packAliases: ['Streaming', 'Hong_Kong', 'Taiwan'],
  },
  // --- Social & messaging ---
  { key: 'telegram', emoji: '✈️', pattern: /\btelegram\b|\btg\b|电报|電報/i, packAliases: ['Telegram'] },
  { key: 'twitter', emoji: '𝕏', pattern: /\b(twitter|x\.com)\b|推特/i, packAliases: ['Twitter', 'X'] },
  { key: 'discord', emoji: '💬', pattern: /\bdiscord\b/i, packAliases: ['Discord'] },
  { key: 'whatsapp', emoji: '💬', pattern: /\bwhatsapp\b|瓦次艾普/i, packAliases: [] },
  { key: 'line', emoji: '💬', pattern: /\bline\b|ライン/i, packAliases: [] },
  { key: 'instagram', emoji: '📸', pattern: /\binstagram\b|\big\b|インスタ/i, packAliases: [] },
  { key: 'facebook', emoji: '👤', pattern: /\bfacebook\b|\bfb\b|脸书|臉書/i, packAliases: [] },
  // --- Developer ---
  { key: 'github', emoji: '🐙', pattern: /\bgithub\b/i, packAliases: ['GitHub'] },
  { key: 'gitlab', emoji: '🦊', pattern: /\bgitlab\b/i, packAliases: ['GitHub'] },
  { key: 'docker', emoji: '🐳', pattern: /\bdocker\b|docker\s*hub/i, packAliases: ['GitHub'] },
  { key: 'package-registry', emoji: '📦', pattern: /\bnpm\b|\bpypi\b|\bpip\b|包管理器/i, packAliases: ['GitHub'] },
  // --- Cloud & office ---
  {
    key: 'google-fcm',
    emoji: '🔔',
    pattern: /\b(google[-_\s]?fcm|fcm)\b/i,
    packAliases: ['Google_Search', 'Google'],
  },
  { key: 'google', emoji: '🔍', pattern: /\bgoogle\b|谷歌/i, packAliases: ['Google_Search', 'Google'] },
  { key: 'apple', emoji: '🍎', pattern: /\b(apple|appstore)\b|苹果|蘋果/i, packAliases: ['Apple'] },
  { key: 'onedrive', emoji: '☁️', pattern: /\bonedrive\b/i, packAliases: ['OneDrive', 'Microsoft'] },
  { key: 'dropbox', emoji: '☁️', pattern: /\bdropbox\b/i, packAliases: ['OneDrive'] },
  { key: 'notion', emoji: '📝', pattern: /\bnotion\b/i, packAliases: ['OneDrive'] },
  {
    key: 'microsoft',
    emoji: '🪟',
    pattern: /\b(microsoft|bing|outlook|office)\b|微软|微軟/i,
    packAliases: ['Microsoft'],
  },
  // --- Gaming ---
  { key: 'steam', emoji: '🎮', pattern: /\bsteam\b/i, packAliases: ['Steam', 'Game'] },
  { key: 'epic', emoji: '🎮', pattern: /\bepic\b|epic\s*games|虚幻|虛幻/i, packAliases: ['Game', 'Steam'] },
  { key: 'playstation', emoji: '🎮', pattern: /\bplaystation\b|\bps[45]\b|索尼|sony/i, packAliases: ['Game', 'Steam'] },
  { key: 'xbox', emoji: '🎮', pattern: /\bxbox\b|微软游戏|微軟遊戲/i, packAliases: ['Game', 'Microsoft'] },
  { key: 'nintendo', emoji: '🎮', pattern: /\bnintendo\b|任天堂/i, packAliases: ['Game'] },
  {
    key: 'gaming',
    emoji: '🕹️',
    pattern: /\b(game|gaming|blizzard)\b|游戏|遊戲/i,
    packAliases: ['Game', 'Steam'],
  },
  // --- Finance & shopping ---
  { key: 'paypal', emoji: '💳', pattern: /\bpaypal\b/i, packAliases: ['PayPal'] },
  { key: 'stripe', emoji: '💳', pattern: /\bstripe\b/i, packAliases: ['PayPal'] },
  {
    key: 'banking',
    emoji: '🏦',
    pattern: /\b(bank|banking|visa|mastercard|swift)\b|银行|銀行|海外支付/i,
    packAliases: ['PayPal'],
  },
  { key: 'amazon', emoji: '🛒', pattern: /\bamazon\b|亚马逊|亞馬遜/i, packAliases: ['Global'] },
  { key: 'ebay', emoji: '🛒', pattern: /\bebay\b/i, packAliases: ['Global'] },
  // --- Privacy & tools ---
  {
    key: 'advertising',
    emoji: '🛡️',
    pattern: /\b(adblock|adguard|ads?|reject)\b|广告|廣告|拦截|攔截/i,
    packAliases: ['Advertising', 'Reject'],
  },
  { key: 'speedtest', emoji: '⏱️', pattern: /\b(speedtest|fast\.com)\b|测速|測速/i, packAliases: ['Speedtest'] },
  {
    key: 'bt',
    emoji: '🔗',
    pattern: /\b(bt|pt|bittorrent|torrent|qbit|transmission)\b|下载工具|下載工具|种子|種子/i,
    packAliases: [],
  },
  {
    key: 'crypto',
    emoji: '🪙',
    pattern: /\b(crypto|bitcoin|binance|coinbase|okx|bybit)\b|加密货币|加密貨幣|虚拟货币|虛擬貨幣/i,
    packAliases: [],
  },
];

/**
 * Category fallback icons for all 15 strategy-group categories (design revision r2 §4.2),
 * plus the two legacy ids so pre-r2 records keep a sensible icon before normalisation.
 */
export const CATEGORY_ICONS: Record<CatalogCategory, { key: string; emoji: string; packAliases: readonly string[] }> = {
  base: { key: 'base', emoji: CATEGORY_EMOJI.base, packAliases: ['Proxy', 'Auto', 'Direct'] },
  ai: { key: 'ai', emoji: CATEGORY_EMOJI.ai, packAliases: ['Bot', 'AI', 'ChatGPT'] },
  social: { key: 'social', emoji: CATEGORY_EMOJI.social, packAliases: ['Telegram', 'Social'] },
  streaming: { key: 'streaming', emoji: CATEGORY_EMOJI.streaming, packAliases: ['Streaming', 'GlobalMedia', 'Media'] },
  'regional-streaming': {
    key: 'regional-streaming',
    emoji: CATEGORY_EMOJI['regional-streaming'],
    packAliases: ['Streaming', 'Taiwan', 'Hong_Kong'],
  },
  music: { key: 'music', emoji: CATEGORY_EMOJI.music, packAliases: ['Spotify', 'Music'] },
  gaming: { key: 'gaming', emoji: CATEGORY_EMOJI.gaming, packAliases: ['Game', 'Steam'] },
  developer: { key: 'developer', emoji: CATEGORY_EMOJI.developer, packAliases: ['GitHub'] },
  'cloud-office': {
    key: 'cloud-office',
    emoji: CATEGORY_EMOJI['cloud-office'],
    packAliases: ['Microsoft', 'Google', 'OneDrive'],
  },
  apple: { key: 'apple', emoji: CATEGORY_EMOJI.apple, packAliases: ['Apple'] },
  finance: { key: 'finance', emoji: CATEGORY_EMOJI.finance, packAliases: ['PayPal'] },
  shopping: { key: 'shopping', emoji: CATEGORY_EMOJI.shopping, packAliases: ['Global', 'Proxy'] },
  privacy: { key: 'privacy', emoji: CATEGORY_EMOJI.privacy, packAliases: ['Advertising', 'Reject'] },
  domestic: { key: 'domestic', emoji: CATEGORY_EMOJI.domestic, packAliases: ['China_Map', 'China', 'Direct'] },
  other: { key: 'other', emoji: CATEGORY_EMOJI.other, packAliases: ['Final', 'Global'] },
  // Legacy ids kept for type completeness; normalised away before the UI (see card.ts).
  advertising: { key: 'privacy', emoji: CATEGORY_EMOJI.privacy, packAliases: ['Advertising', 'Reject'] },
  infrastructure: { key: 'developer', emoji: CATEGORY_EMOJI.developer, packAliases: ['GitHub'] },
};

/** Category fallback icon metadata for UI section headers (policy-group page, design r2 §4.2). */
export function categoryIcon(category: CatalogCategory): { key: string; emoji: string } {
  const entry = CATEGORY_ICONS[category];
  return { key: entry.key, emoji: entry.emoji };
}

/** Legacy categories that must not win over region/role fallbacks (kept for r2 compatibility). */
const GENERIC_CATEGORIES: ReadonlySet<CatalogCategory> = new Set<CatalogCategory>([
  'other',
  'infrastructure',
  'base',
  'shopping',
]);

/** Uses the category icon when a service has no verified pack name (design r2 §4.3). */
function resolveServiceAliases(rule: ServiceIconRule, category?: CatalogCategory): readonly string[] {
  if (rule.packAliases.length > 0) return rule.packAliases;
  if (!category) return [];
  return CATEGORY_ICONS[category].packAliases;
}

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
    key: 'all-nodes',
    emoji: '🌐',
    pattern: /\ball[-_\s]?nodes\b|全部节点|全部節點/i,
    packAliases: ['Global', 'Server', 'Proxy'],
  },
  {
    key: 'airport',
    emoji: '✈️',
    pattern: /\bairport\b|机场|機場/i,
    packAliases: ['Airport', 'Server'],
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
 * Recognizes a strategy group's emoji, semantic key, and candidate pack aliases
 * without pulling external icon-pack matching tables (safe for lightweight UI paths).
 */
export function recognizeGroupEmoji(input: IconRecognitionInput): EmojiRecognitionResult {
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
    if (input.category && !GENERIC_CATEGORIES.has(input.category)) {
      const cat = CATEGORY_ICONS[input.category];
      return { key: cat.key, packAliases: cat.packAliases };
    }
    return undefined;
  };

  // Step 1: Emoji embedded in name
  const emoji = extractEmojiFromName(input.name);
  if (emoji) {
    const semantic = resolveSemanticAliases();
    return {
      key: semantic?.key ?? 'emoji',
      emoji,
      source: 'emoji',
      packAliases: semantic?.packAliases ?? [input.name],
    };
  }

  // Step 2a: Service match from name / slug
  const serviceMatch = SERVICE_ICON_RULES.find((rule) => rule.pattern.test(combinedName));
  if (serviceMatch) {
    return {
      key: serviceMatch.key,
      emoji: serviceMatch.emoji,
      source: 'service',
      packAliases: resolveServiceAliases(serviceMatch, input.category),
    };
  }

  // Step 3 (checked before generic category if explicit region is set): Region
  if (input.region) {
    const regionDef = getRegionDefinition(input.region);
    if (regionDef) {
      return {
        key: regionDef.code.toLowerCase(),
        emoji: regionDef.flag,
        source: 'region',
        packAliases: [regionDef.nameEn, regionDef.code, regionDef.nameZh],
      };
    }
  }

  // Step 2b: Non-generic category match (specific categories win over region/role fallback)
  if (input.category && !GENERIC_CATEGORIES.has(input.category)) {
    const cat = CATEGORY_ICONS[input.category];
    return {
      key: cat.key,
      emoji: cat.emoji,
      source: 'category',
      packAliases: cat.packAliases,
    };
  }

  // Step 3b: Region inferred from name
  const nameRegions = detectNodeRegions(input.name);
  if (nameRegions.length > 0) {
    const regionDef = getRegionDefinition(nameRegions[0]);
    if (regionDef) {
      return {
        key: regionDef.code.toLowerCase(),
        emoji: regionDef.flag,
        source: 'region',
        packAliases: [regionDef.nameEn, regionDef.code, regionDef.nameZh],
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
    };
  }
  if (input.groupType === 'url-test') {
    return {
      key: 'auto',
      emoji: '⚡',
      source: 'role',
      packAliases: ['Auto', 'Speedtest'],
    };
  }
  if (input.groupType === 'fallback') {
    return {
      key: 'fallback',
      emoji: '🔁',
      source: 'role',
      packAliases: ['Available', 'Fallback'],
    };
  }
  if (input.groupType === 'load-balance') {
    return {
      key: 'load-balance',
      emoji: '⚖️',
      source: 'role',
      packAliases: ['RoundRobin', 'LoadBalance'],
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
        packAliases: resolveServiceAliases(matcherService, input.category),
      };
    }
    const matcherRole = ROLE_ICON_RULES.find((rule) => rule.pattern.test(matcherText));
    if (matcherRole) {
      return {
        key: matcherRole.key,
        emoji: matcherRole.emoji,
        source: 'matcher',
        packAliases: matcherRole.packAliases,
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
    };
  }

  return {
    key: 'proxy',
    emoji: '🌐',
    source: 'fallback',
    packAliases: ['Global', 'Proxy'],
  };
}
