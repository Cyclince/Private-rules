import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('M3.5 unified motion tokens and reduced-motion rules', () => {
  it('defines three duration tokens and two easing curves in tokens.css', async () => {
    const css = await readFile(resolve(process.cwd(), 'src/web/theme/tokens.css'), 'utf8');

    expect(css).toMatch(/--motion-fast\s*:\s*120ms\s*;/);
    expect(css).toMatch(/--motion-base\s*:\s*200ms\s*;/);
    expect(css).toMatch(/--motion-slow\s*:\s*320ms\s*;/);
    expect(css).toMatch(/--ease-out\s*:\s*cubic-bezier\(\s*0?\.16\s*,\s*1\s*,\s*0?\.3\s*,\s*1\s*\)\s*;/);
    expect(css).toMatch(/--ease-in\s*:\s*cubic-bezier\(\s*0?\.4\s*,\s*0\s*,\s*1\s*,\s*1\s*\)\s*;/);
  });

  it('defines core enter/exit keyframes without blur or layout-triggering properties', async () => {
    const css = await readFile(resolve(process.cwd(), 'src/web/theme/tokens.css'), 'utf8');

    for (const name of ['fade-in', 'fade-out', 'scale-in', 'scale-out', 'slide-up-in', 'slide-up-out']) {
      expect(css).toContain(`@keyframes ${name}`);
    }

    const keyframeBlocks = [...css.matchAll(/@keyframes\s+[a-z0-9-]+\s*\{([\s\S]*?\n\})/gi)].map((m) => m[1]);
    expect(keyframeBlocks.length).toBeGreaterThanOrEqual(6);

    for (const block of keyframeBlocks) {
      expect(block).not.toMatch(/blur\(/i);
      expect(block).not.toMatch(/(?:^|[;\s])(?:width|height|top|left|right|bottom|margin|padding)\s*:/i);
    }
  });

  it('includes a prefers-reduced-motion: reduce rule covering tokens, animations, and transitions', async () => {
    const css = await readFile(resolve(process.cwd(), 'src/web/theme/tokens.css'), 'utf8');
    const mediaIndex = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(mediaIndex).toBeGreaterThan(-1);

    const reducedBlock = css.slice(mediaIndex);
    expect(reducedBlock).toMatch(/--motion-fast\s*:\s*0(?:\.01)?ms/);
    expect(reducedBlock).toMatch(/--motion-base\s*:\s*0(?:\.01)?ms/);
    expect(reducedBlock).toMatch(/--motion-slow\s*:\s*0(?:\.01)?ms/);
    expect(reducedBlock).toMatch(/animation-duration\s*:\s*0(?:\.01)?ms\s*!important/);
    expect(reducedBlock).toMatch(/transition-duration\s*:\s*0(?:\.01)?ms\s*!important/);
    expect(reducedBlock).toMatch(/transform\s*:\s*none\s*!important/);
  });
});
