import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditTokensCss, contrastRatio, WCAG_AA_NORMAL_TEXT } from '../../scripts/check-contrast';

describe('Miku theme WCAG AA contrast audit', () => {
  it('computes known reference contrast ratios accurately', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 2);
    expect(contrastRatio('#39c5bb', '#06201e')).toBeGreaterThanOrEqual(7);
  });

  it('passes WCAG AA (>= 4.5:1) for every foreground/background pair in dark and light themes', async () => {
    const css = await readFile(resolve(process.cwd(), 'src/web/theme/tokens.css'), 'utf8');
    const results = auditTokensCss(css, WCAG_AA_NORMAL_TEXT);
    expect(results.length).toBeGreaterThanOrEqual(50);

    const failures = results.filter((entry) => !entry.pass);
    expect(failures).toEqual([]);
  });
});
