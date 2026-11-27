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

  it('guards disabled states on .motion-card and applies unified motion classes across M3.5b targets', async () => {
    const css = await readFile(resolve(process.cwd(), 'src/web/theme/tokens.css'), 'utf8');
    expect(css).toContain(".motion-card:hover:not(:disabled):not([aria-disabled='true'])");
    expect(css).toContain(".motion-card:active:not(:disabled):not([aria-disabled='true'])");
    expect(css).toMatch(
      /\.motion-card:disabled,\s*\.motion-card\[aria-disabled='true'\]\s*\{\s*transform:\s*none;\s*\}/,
    );

    const [subs, templates, wizard, wizardSteps, wizardMotionCss, nodesTab, overview] = await Promise.all([
      readFile(resolve(process.cwd(), 'src/web/routes/subscriptions.index.tsx'), 'utf8'),
      readFile(resolve(process.cwd(), 'src/web/routes/templates.index.tsx'), 'utf8'),
      readFile(resolve(process.cwd(), 'src/web/components/templates/QuickCreateWizard.tsx'), 'utf8'),
      Promise.all(
        [
          'WizardStepSubscriptions.tsx',
          'WizardStepComplexity.tsx',
          'WizardStepPolicyGroups.tsx',
          'WizardStepNodePools.tsx',
          'WizardStepModules.tsx',
        ].map((file) => readFile(resolve(process.cwd(), 'src/web/components/templates/wizard', file), 'utf8')),
      ).then((contents) => contents.join('\n')),
      readFile(resolve(process.cwd(), 'src/web/components/templates/wizard/wizard-motion.css'), 'utf8'),
      readFile(resolve(process.cwd(), 'src/web/components/templates/TemplateSimpleNodesTab.tsx'), 'utf8'),
      readFile(resolve(process.cwd(), 'src/web/routes/index.tsx'), 'utf8'),
    ]);

    expect(subs).toContain('motion-card');
    expect(templates).toMatch(/<Card[^>]*\binteractive\b/);
    expect((`${wizard}\n${wizardSteps}`.match(/motion-card/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(wizardMotionCss).toContain('--motion-base');
    expect(wizardMotionCss).toContain('--ease-out');
    expect(wizardMotionCss).toContain('prefers-reduced-motion: reduce');
    expect(wizardMotionCss).not.toMatch(/blur\(/i);
    expect(nodesTab).toContain('motion-card');
    expect(overview).toContain('motion-btn motion-btn-lift');
    expect(overview).toContain('motion-card');
    expect(overview).not.toContain('components/ui/button');
  });
});
