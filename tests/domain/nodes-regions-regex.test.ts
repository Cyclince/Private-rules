import { describe, expect, it } from 'vitest';
import { TEMPLATE_CLIENT_IDS } from '../../src/shared/clients';
import {
  buildExcludeInfoRegex,
  buildRegionRegex,
  detectNodeRegions,
  detectRegexDialectIssues,
  filterNodes,
  getRegionDefinition,
  isInfoNode,
  matchNodeFilter,
  matchRegion,
} from '../../src/domain/nodes';

function toJsRegExp(pattern: string, flags: string): RegExp {
  const inlineCase = pattern.startsWith('(?i)');
  const stripped = inlineCase ? pattern.slice(4) : pattern;
  const effectiveFlags = inlineCase && !flags.includes('i') ? `${flags}i` : flags;
  return new RegExp(stripped, effectiveFlags);
}

describe('built-in region dictionary, boundaries, and exclusion words', () => {
  it('matches authentic region names, flags, cities, and bounded ISO/IATA codes', () => {
    expect(matchRegion('🇭🇰 香港 IEPL 01', 'HK')).toBe(true);
    expect(matchRegion('HK01 | BGP', 'HK')).toBe(true);
    expect(matchRegion('JP-02 东京软银', 'JP')).toBe(true);
    expect(matchRegion('专线-日03', 'JP')).toBe(true);
    expect(matchRegion('日本 01 | 每日高速', 'JP')).toBe(true);
    expect(matchRegion('NRT-01 Premium', 'JP')).toBe(true);
    expect(matchRegion('🇸🇬 狮城 SG05', 'SG')).toBe(true);
    expect(matchRegion('新 02', 'SG')).toBe(true);
    expect(matchRegion('🇺🇸 洛杉矶 LAX-01', 'US')).toBe(true);
    expect(matchRegion('德克萨斯 01', 'US')).toBe(true);
    expect(matchRegion('🇹🇼 台北 Hinet', 'TW')).toBe(true);
    expect(matchRegion('🇲🇴 澳门 01', 'MO')).toBe(true);
    expect(matchRegion('🇳🇬 尼日利亚 01', 'NG')).toBe(true);
    expect(matchRegion('🇳🇿 新西兰 01', 'NZ')).toBe(true);
    expect(matchRegion('🇮🇩 印尼 01', 'ID')).toBe(true);
  });

  it('prevents false positives via exclusion words and ASCII letter boundaries', () => {
    // `尼日利亚` / `尼日尔` / `到期日` / `日志` MUST NOT match JP (`日`)
    expect(matchRegion('🇳🇬 尼日利亚 01', 'JP')).toBe(false);
    expect(matchRegion('尼日利亚 02', 'JP')).toBe(false);
    expect(matchRegion('尼日尔 01', 'JP')).toBe(false);
    expect(matchRegion('到期日: 2026-12-31', 'JP')).toBe(false);
    expect(matchRegion('每日日志节点', 'JP')).toBe(false);

    // `新西兰` / `新疆` / `最新` MUST NOT match SG (`新`)
    expect(matchRegion('🇳🇿 新西兰 01', 'SG')).toBe(false);
    expect(matchRegion('新疆中转 01', 'SG')).toBe(false);
    expect(matchRegion('最新官网地址', 'SG')).toBe(false);

    // `平台` / `后台` / `烟台` MUST NOT match TW (`台`)
    expect(matchRegion('后台管理测试', 'TW')).toBe(false);
    expect(matchRegion('跨平台专线', 'TW')).toBe(false);
    expect(matchRegion('烟台中转', 'TW')).toBe(false);

    // `连云港` / `空港` MUST NOT match HK (`港`)
    expect(matchRegion('连云港 BGP', 'HK')).toBe(false);
    expect(matchRegion('国际空港', 'HK')).toBe(false);

    // `澳门` MUST NOT match AU (`澳`); `印尼` / `印度尼西亚` MUST NOT match IN (`印度`)
    expect(matchRegion('🇲🇴 澳门 01', 'AU')).toBe(false);
    expect(matchRegion('🇮🇩 印尼 01', 'IN')).toBe(false);
    expect(matchRegion('🇮🇩 印度尼西亚 01', 'IN')).toBe(false);

    // Strict-case code `MY`: uppercase `MY01` matches Malaysia, title-case `My Server` does not
    expect(matchRegion('MY01 | BGP', 'MY')).toBe(true);
    expect(matchRegion('My Custom Server', 'MY')).toBe(false);

    // `德州` / `德克萨斯` MUST NOT match DE (`德`); `法兰克福` MUST NOT match FR (`法`)
    expect(matchRegion('德州达拉斯 01', 'DE')).toBe(false);
    expect(matchRegion('德克萨斯 01', 'DE')).toBe(false);
    expect(matchRegion('🇩🇪 法兰克福 01', 'FR')).toBe(false);
    expect(matchRegion('🇩🇪 法兰克福 01', 'DE')).toBe(true);

    // ASCII letter boundary: `HK`/`US`/`DE`/`KR`/`SG` inside English words must NOT match
    expect(matchRegion('SHOCK-Server-01', 'HK')).toBe(false);
    expect(matchRegion('MUSIC-Stream-01', 'US')).toBe(false);
    expect(matchRegion('NODE-Fast-01', 'DE')).toBe(false);
    expect(matchRegion('Ukraine-01', 'KR')).toBe(false);
    expect(matchRegion('MSG-Relay-01', 'SG')).toBe(false);

    expect(detectNodeRegions('🇳🇬 尼日利亚 01')).toEqual(['NG']);
    expect(detectNodeRegions('🇳🇿 新西兰 01')).toEqual(['NZ']);
  });

  it('excludes non-node info banners and filters node lists cleanly', () => {
    const nodes = [
      { name: '剩余流量：88.5 GB' },
      { name: '套餐到期：2027-01-01' },
      { name: '🇭🇰 香港 IEPL 01' },
      { name: '🇭🇰 香港 普通 02' },
      { name: '🇯🇵 日本 东京 01' },
      { name: '🇳🇬 尼日利亚 01' },
    ];

    expect(isInfoNode('剩余流量：88.5 GB')).toBe(true);
    expect(isInfoNode('🇭🇰 香港 IEPL 01')).toBe(false);

    const jpOnly = filterNodes(nodes, { regions: ['JP'] }, { excludeInfo: true });
    expect(jpOnly.map((n) => n.name)).toEqual(['🇯🇵 日本 东京 01']);

    const hkIepl = filterNodes(nodes, { regions: ['HK'], include: 'IEPL', exclude: '普通' }, { excludeInfo: true });
    expect(hkIepl.map((n) => n.name)).toEqual(['🇭🇰 香港 IEPL 01']);

    expect(matchNodeFilter('到期日 2026-12-01', { regions: ['JP'] }, { excludeInfo: true })).toBe(false);
  });
});

describe('client-dialect regex generation across all 7 clients', () => {
  it.each(TEMPLATE_CLIENT_IDS)('generates valid, safe JP regex for %s', (client) => {
    const compiled = buildRegionRegex('JP', client);
    expect(compiled.client).toBe(client);
    expect(getRegionDefinition('JP')).toBeDefined();

    if (client === 'sing-box') {
      // JS RegExp must NOT embed inline (?i)
      expect(compiled.include.startsWith('(?i)')).toBe(false);
      expect(compiled.flags).toBe('i');
    } else {
      expect(compiled.include.startsWith('(?i)')).toBe(true);
    }

    if (client === 'quantumult-x') {
      // RE2-safe dialect must not emit lookahead or lookbehind assertions
      expect(compiled.include).not.toMatch(/\(\?[<!=]/);
      expect(compiled.warnings.some((w) => w.code === 'SHORTHAND_OMITTED_FOR_SAFETY')).toBe(true);
    }

    const regex = toJsRegExp(compiled.combined, compiled.flags);
    expect(regex.test('🇯🇵 日本 东京 01')).toBe(true);
    expect(regex.test('JP01-BGP')).toBe(true);
    expect(regex.test('Tokyo-02')).toBe(true);
    // False positives MUST be rejected across EVERY client dialect
    expect(regex.test('🇳🇬 尼日利亚 01')).toBe(false);
    expect(regex.test('到期日: 2026-12-01')).toBe(false);
    expect(regex.test('AJPB-Relay')).toBe(false);
  });

  it('handles extraExclude per dialect and detects incompatible regex constructs', () => {
    const surgeRegex = buildRegionRegex('HK', 'surge', { extraExclude: '家宽|高倍率' });
    expect(surgeRegex.combined).toContain('(?!.*(?:家宽|高倍率))');
    expect(surgeRegex.warnings).toEqual([]);

    const compiledSurge = toJsRegExp(surgeRegex.combined, surgeRegex.flags);
    expect(compiledSurge.test('🇭🇰 香港 01')).toBe(true);
    expect(compiledSurge.test('🇭🇰 香港 家宽 01')).toBe(false);

    const qxRegex = buildRegionRegex('HK', 'quantumult-x', { extraExclude: '家宽' });
    expect(qxRegex.exclude).toBe('(?i)家宽');
    expect(qxRegex.warnings.some((w) => w.code === 'EXCLUDE_REQUIRES_LOOKAHEAD')).toBe(true);

    const mihomoExcludeInfo = buildExcludeInfoRegex('mihomo');
    const infoCheck = toJsRegExp(mihomoExcludeInfo.combined, mihomoExcludeInfo.flags);
    expect(infoCheck.test('🇭🇰 香港 01')).toBe(true);
    expect(infoCheck.test('剩余流量 50GB')).toBe(false);
    expect(infoCheck.test('Traffic Reset: 1st')).toBe(false);

    expect(detectRegexDialectIssues('(?<!尼)日', 'quantumult-x').map((w) => w.code)).toContain(
      'LOOKBEHIND_UNSUPPORTED',
    );
    expect(detectRegexDialectIssues('(?i)hongkong', 'sing-box').map((w) => w.code)).toContain(
      'INLINE_FLAG_UNSUPPORTED',
    );
    expect(detectRegexDialectIssues('[unclosed', 'mihomo').map((w) => w.code)).toContain('INVALID_REGEX');
  });
});
