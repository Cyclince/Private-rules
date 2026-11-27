import { describe, expect, it } from 'vitest';
import { previewPoolMatch } from '../../src/domain/nodes/pool-preview';

const NAMES = ['🇭🇰 香港 01', '🇯🇵 日本 01', '🇯🇵 东京 IEPL 0.5x', '🇺🇸 美国 家宽 01', '剩余流量：10GB'];

describe('node pool live preview', () => {
  it('matches include and removes exclude, case-insensitively', () => {
    const result = previewPoolMatch(NAMES, '日本|日本语', 'IEPL');
    expect(result.invalid).toBeUndefined();
    expect(result.total).toBe(5);
    expect(result.matched).toEqual(['🇯🇵 日本 01']);
  });

  it('treats an empty include pattern as "every cached node"', () => {
    const result = previewPoolMatch(NAMES, '', '日本');
    expect(result.matched).toHaveLength(4);
    expect(result.matched).not.toContain('🇯🇵 日本 01');
  });

  it('supports exclusion-only pools and case-insensitive literals', () => {
    const result = previewPoolMatch(NAMES, null, '家宽');
    expect(result.matched).toHaveLength(4);
    expect(previewPoolMatch(['HK Premium'], 'hk').matched).toEqual(['HK Premium']);
  });

  it('deduplicates names and honours the display limit', () => {
    const result = previewPoolMatch(['A', 'A', 'B', 'C'], undefined, undefined, { limit: 2 });
    expect(result.total).toBe(3);
    expect(result.matched).toEqual(['A', 'B']);
  });

  it('reports an invalid include/exclude regex instead of throwing', () => {
    const include = previewPoolMatch(NAMES, '([a-z');
    expect(include.invalid).toBe('include');
    expect(include.matched).toEqual([]);
    expect(include.error).toBeTruthy();

    const exclude = previewPoolMatch(NAMES, '', '(?<');
    expect(exclude.invalid).toBe('exclude');
  });

  it('returns an empty match list for an empty pool preview (empty-pool hint)', () => {
    const result = previewPoolMatch(NAMES, '新加坡');
    expect(result.matched).toEqual([]);
    expect(result.total).toBe(5);
  });
});
