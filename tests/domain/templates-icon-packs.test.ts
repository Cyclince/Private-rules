import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS } from '../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../src/builtin/catalog';
import { buildStarterTemplate } from '../../src/builtin/templates';
import {
  LIGE_ICON_PACK_SOURCE_URL,
  QURE_ICON_PACK_SOURCE_URL,
  buildDefaultIconPack,
  buildIconPackEntries,
  compileTemplate,
  hasIconPackTags,
  iconKeywordVariants,
  normalizeIconKey,
  parseIconPackPayload,
  recognizeGroupIcon,
  resolveIconPackOrder,
  type IconPackEntry,
  type ResolvedIconPack,
} from '../../src/domain/templates';

const FIXTURES_DIR = resolve(process.cwd(), 'tests/fixtures/icon-packs');

function readPackFixture(file: string): IconPackEntry[] {
  return parseIconPackPayload(JSON.parse(readFileSync(resolve(FIXTURES_DIR, file), 'utf8')));
}

// About 50 hand-copied entries per pack in the real Qure / lige payload format. No network.
const QURE_PACK = readPackFixture('qure-sample.json');
const LIGE_PACK = readPackFixture('lige-sample.json');
const CUSTOM_PACK: IconPackEntry[] = [
  { name: 'Netflix', url: 'https://cdn.example.com/icons/netflix.png' },
  { name: 'Proxy', url: 'https://cdn.example.com/icons/proxy.png' },
];

const ORDER_QURE_FIRST: ResolvedIconPack[] = [
  { key: 'qure', label: 'Qure', kind: 'builtin', sourceUrl: QURE_ICON_PACK_SOURCE_URL },
  { key: 'lige', label: 'lige', kind: 'builtin', sourceUrl: LIGE_ICON_PACK_SOURCE_URL },
];

function buildEntries(input: {
  order?: readonly ResolvedIconPack[];
  cached?: Map<string, readonly IconPackEntry[]>;
  indexMatching: boolean;
  githubMirrorUrl?: string;
}): IconPackEntry[] {
  return buildIconPackEntries({
    order: input.order ?? ORDER_QURE_FIRST,
    cached: input.cached ?? new Map(),
    defaultQureEntries: buildDefaultIconPack(),
    githubMirrorUrl: input.githubMirrorUrl,
    indexMatching: input.indexMatching,
  });
}

function cachedBoth(): Map<string, readonly IconPackEntry[]> {
  return new Map([
    ['qure', QURE_PACK],
    ['lige', LIGE_PACK],
  ]);
}

describe('icon pack payloads (Qure / lige fixtures)', () => {
  it('parses both packs in the Sub-Store / Quantumult X icon pack format', () => {
    expect(QURE_PACK.length).toBeGreaterThanOrEqual(50);
    expect(LIGE_PACK.length).toBeGreaterThanOrEqual(50);
    expect(QURE_PACK.find((entry) => entry.name === 'Hong_Kong')?.url).toMatch(
      /Qure\/master\/IconSet\/Color\/Hong_Kong\.png$/,
    );
    expect(LIGE_PACK.find((entry) => entry.name === '01Country/Argentina(1)')?.url).toMatch(
      /lige_icon\/main\/svg\/01Country\/Argentina\(1\)\.svg$/,
    );
    // Bare maps (`{ "Name": "url" }`) and arrays are accepted too.
    expect(parseIconPackPayload({ Proxy: 'https://icons.example/proxy.png' })).toEqual([
      { name: 'Proxy', url: 'https://icons.example/proxy.png' },
    ]);
    expect(parseIconPackPayload([{ name: 'NoUrl' }, { name: 'Bad', url: 'ftp://x/y.png' }])).toEqual([]);
  });

  it('normalizes extensions, serial numbers, directories and case', () => {
    expect(normalizeIconKey('01Country/Argentina(1)')).toBe('argentina');
    expect(normalizeIconKey('Hong_Kong')).toBe('hongkong');
    expect(normalizeIconKey('United Kingdom(2).svg')).toBe('unitedkingdom');
    expect(normalizeIconKey('Netflix（3）')).toBe('netflix');
    expect(iconKeywordVariants('HK')).toEqual(expect.arrayContaining(['hk', 'hongkong', '香港']));
  });
});

describe('icon pack order (built-in Qure / lige + extension URLs)', () => {
  it('defaults to Qure then lige, and appends extension packs last', () => {
    const order = resolveIconPackOrder({ customIconPackUrls: ['https://cdn.example.com/icons.json'] });
    expect(order.map((pack) => pack.key)).toEqual(['qure', 'lige', 'https://cdn.example.com/icons.json']);
    expect(order.map((pack) => pack.kind)).toEqual(['builtin', 'builtin', 'custom']);
  });

  it('honours a custom priority and drops disabled packs', () => {
    const order = resolveIconPackOrder({
      customIconPackUrls: ['https://cdn.example.com/icons.json'],
      iconPackPriority: ['https://cdn.example.com/icons.json', 'lige', 'qure'],
      iconPackDisabled: ['qure'],
    });
    expect(order.map((pack) => pack.key)).toEqual(['https://cdn.example.com/icons.json', 'lige']);
  });

  it('keeps 1.0.x settings compatible by folding a preset URL added by hand into the built-in pack', () => {
    const order = resolveIconPackOrder({ customIconPackUrls: [LIGE_ICON_PACK_SOURCE_URL] });
    expect(order.map((pack) => pack.key)).toEqual(['qure', 'lige']);
    expect(order.filter((pack) => pack.kind === 'custom')).toEqual([]);
  });

  it('falls back to the default order for unknown or duplicated priority keys', () => {
    const order = resolveIconPackOrder({ iconPackPriority: ['unknown', 'lige', 'lige'], iconPackDisabled: [] });
    expect(order.map((pack) => pack.key)).toEqual(['lige', 'qure']);
  });
});

describe('icon pack entry building (legacy vs keyword matching)', () => {
  it('keeps the 1.0.x precedence when keyword matching is off (extension packs first, untagged)', () => {
    const cached = cachedBoth();
    cached.set('https://cdn.example.com/icons.json', CUSTOM_PACK);
    const order = resolveIconPackOrder({ customIconPackUrls: ['https://cdn.example.com/icons.json'] });
    const entries = buildEntries({ order, cached, indexMatching: false });

    expect(hasIconPackTags(entries)).toBe(false);
    expect(entries[0]).toEqual(CUSTOM_PACK[0]);
    expect(entries.some((entry) => entry.url.includes('Qure/master'))).toBe(true);
    // Built-in Qure fallback is still appended so icons work before the first refresh.
    expect(entries.some((entry) => entry.name === 'YouTube' && entry.url.includes('Qure'))).toBe(true);
  });

  it('tags entries with pack priority when keyword matching is on', () => {
    const entries = buildEntries({ cached: cachedBoth(), indexMatching: true });
    expect(hasIconPackTags(entries)).toBe(true);
    expect(entries.every((entry) => typeof entry.pack === 'string')).toBe(true);
    const packSequence = [...new Set(entries.map((entry) => entry.pack))];
    expect(packSequence).toEqual(['qure', 'lige']);
    // lige keeps its classified directory names intact for diagnostics.
    expect(entries.find((entry) => entry.pack === 'lige')?.name).toBe('01Country/Argentina(1)');
  });
});

describe('keyword matching across icon packs', () => {
  it('uses the first pack in priority order that has a hit', () => {
    const cached = cachedBoth();
    const qureFirst = buildEntries({ cached, indexMatching: true });
    expect(recognizeGroupIcon({ name: '🎬 Netflix', category: 'streaming' }, qureFirst).packIcon?.url).toContain(
      'Qure/master/IconSet/Color/Netflix.png',
    );

    const ligeFirst = buildEntries({
      order: [
        { key: 'lige', label: 'lige', kind: 'builtin', sourceUrl: LIGE_ICON_PACK_SOURCE_URL },
        { key: 'qure', label: 'Qure', kind: 'builtin', sourceUrl: QURE_ICON_PACK_SOURCE_URL },
      ],
      cached,
      indexMatching: true,
    });
    expect(recognizeGroupIcon({ name: '🎬 Netflix', category: 'streaming' }, ligeFirst).packIcon?.url).toContain(
      '02Media/Netflix.svg',
    );
  });

  it('falls through to a lower priority pack when the first one has no match', () => {
    const entries = buildEntries({ cached: cachedBoth(), indexMatching: true });
    const recognized = recognizeGroupIcon({ name: '🇦🇷 阿根廷', region: 'AR', groupType: 'url-test' }, entries);
    // The flag emoji wins the emoji step, but the pack still resolves through the region aliases.
    expect(recognized.source).toBe('emoji');
    expect(recognized.packIcon?.url).toContain('01Country/Argentina(1).svg');
  });

  it('matches aliases, region names and serial-numbered entry names', () => {
    const ligeOnly = buildEntries({
      order: [{ key: 'lige', label: 'lige', kind: 'builtin', sourceUrl: LIGE_ICON_PACK_SOURCE_URL }],
      cached: new Map([['lige', LIGE_PACK]]),
      indexMatching: true,
    });
    expect(recognizeGroupIcon({ name: 'HK 高速' }, ligeOnly).packIcon?.url).toContain('01Country/Hong%20Kong(1).svg');
    expect(recognizeGroupIcon({ name: '香港 01' }, ligeOnly).packIcon?.url).toContain('01Country/Hong%20Kong(1).svg');
    expect(recognizeGroupIcon({ name: 'United States' }, ligeOnly).packIcon?.url).toContain(
      '01Country/United%20States(1).svg',
    );
    // `Argentina` has no unsuffixed entry in the pack — the serial name still matches.
    expect(recognizeGroupIcon({ name: 'Argentina' }, ligeOnly).packIcon?.url).toContain('01Country/Argentina(1).svg');
  });

  it('keeps the recognized source when no pack entry matches (no icon invented)', () => {
    const sparse = buildEntries({
      order: [{ key: 'lige', label: 'lige', kind: 'builtin', sourceUrl: LIGE_ICON_PACK_SOURCE_URL }],
      cached: new Map([['lige', [{ name: 'Argentina(1)', url: 'https://icons.example/ar.svg' }]]]),
      indexMatching: true,
    });
    const recognized = recognizeGroupIcon({ name: 'Netflix 视频', category: 'streaming' }, sparse);
    expect(recognized.source).toBe('service');
    expect(recognized.key).toBe('netflix');
    expect(recognized.packIcon).toBeUndefined();
  });

  it('ignores disabled packs entirely', () => {
    const order = resolveIconPackOrder({ iconPackPriority: ['lige', 'qure'], iconPackDisabled: ['lige'] });
    const entries = buildEntries({ order, cached: cachedBoth(), indexMatching: true });
    expect(entries.every((entry) => entry.pack === 'qure')).toBe(true);
    expect(recognizeGroupIcon({ name: '🎬 Netflix' }, entries).packIcon?.url).toContain('Qure/master');
  });

  it('applies the GitHub mirror to icon URLs from every pack', () => {
    const entries = buildEntries({
      cached: cachedBoth(),
      indexMatching: true,
      githubMirrorUrl: 'https://ghproxy.example.com',
    });
    expect(entries.every((entry) => entry.url.startsWith('https://ghproxy.example.com/https://'))).toBe(true);
    expect(recognizeGroupIcon({ name: 'HK 高速' }, entries).packIcon?.url).toBe(
      'https://ghproxy.example.com/https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Hong_Kong.png',
    );
  });
});

describe('compiled mihomo icons with Qure as the top priority pack', () => {
  const FIXED_GENERATED_AT = '2026-01-01T00:00:00.000Z';
  const FIXED_BASE_URL = 'https://rules.example.com';

  function compileIcons(iconPack: readonly IconPackEntry[]): Record<string, string> {
    const template = buildStarterTemplate('recommended', { output: 'full' });
    const compiled = compileTemplate('mihomo', {
      body: template.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      generatedAt: FIXED_GENERATED_AT,
      iconPack,
    });
    const doc = parseYaml(compiled.content) as Record<string, unknown>;
    const groups = (doc['proxy-groups'] ?? []) as Array<Record<string, unknown>>;
    const icons: Record<string, string> = {};
    for (const group of groups) {
      if (typeof group.icon === 'string') icons[String(group.name)] = group.icon;
    }
    return icons;
  }

  it('matches the legacy output byte-for-byte when Qure is the only enabled pack', () => {
    const cached = new Map<string, readonly IconPackEntry[]>([['qure', QURE_PACK]]);
    const legacy = compileIcons(buildEntries({ cached, indexMatching: false }));
    const keyword = compileIcons(buildEntries({ cached, indexMatching: true }));

    expect(keyword).toEqual(legacy);
    expect(keyword).toMatchInlineSnapshot(`
      {
        "⏱️ 测速工具": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Speedtest.png",
        "▶️ YouTube": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/YouTube.png",
        "⚡ 自动选择": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Auto.png",
        "✈️ Telegram": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Telegram.png",
        "✨ AI 服务": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Bot.png",
        "🇨🇳 国内直连": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Direct.png",
        "🌐 GFW 代理": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Proxy.png",
        "🎬 Netflix": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Netflix.png",
        "🎵 Spotify": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Spotify.png",
        "🎵 TikTok": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/TikTok.png",
        "🏠 局域网直连": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Direct.png",
        "🏰 Disney+": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Disney.png",
        "🐟 漏网之鱼": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Final.png",
        "🚀 节点选择": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Proxy.png",
        "🛡️ 广告拦截": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Advertising.png",
        "🤖 OpenAI / ChatGPT": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Bot.png",
        "🧭 常用服务 IP": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Proxy.png",
        "🧭 常用直连补充": "https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Direct.png",
      }
    `);
  });

  it('keeps the built-in Qure concatenation path unchanged when no pack is handed in', () => {
    const template = buildStarterTemplate('recommended', { output: 'full' });
    const base = {
      body: template.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      generatedAt: FIXED_GENERATED_AT,
    };
    const withoutPack = compileTemplate('mihomo', base).content;
    const withDefaultPack = compileTemplate('mihomo', { ...base, iconPack: buildDefaultIconPack() }).content;

    expect(withDefaultPack).toBe(withoutPack);
    expect(withoutPack).toContain('https://raw.githubusercontent.com/Koolson/Qure/master/IconSet/Color/Proxy.png');
  });
});
