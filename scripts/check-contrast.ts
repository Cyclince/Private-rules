import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ThemeName = 'dark' | 'light';

export type ContrastCheckResult = {
  theme: ThemeName;
  pair: string;
  foreground: string;
  background: string;
  ratio: number;
  pass: boolean;
};

export const WCAG_AA_NORMAL_TEXT = 4.5;

function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) {
    throw new Error(`Unsupported hex color: ${hex}`);
  }
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function linearizeChannel(channel255: number): number {
  const srgb = channel255 / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexColor(hex);
  return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
}

export function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function extractCssVars(blockBody: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const matches = blockBody.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi);
  for (const match of matches) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

export function parseThemeTokens(css: string): Record<ThemeName, Record<string, string>> {
  const darkMatch = css.match(/:root\s*,\s*\[data-theme=['"]dark['"]\]\s*\{([\s\S]*?)\}/);
  const lightMatch = css.match(/\[data-theme=['"]light['"]\]\s*\{([\s\S]*?)\}/);
  if (!darkMatch || !lightMatch) {
    throw new Error('Could not locate dark and light theme blocks in tokens.css');
  }
  return {
    dark: extractCssVars(darkMatch[1]),
    light: extractCssVars(lightMatch[1]),
  };
}

const SURFACE_BACKGROUNDS = ['--bg', '--surface', '--surface-muted'] as const;
const TEXT_AND_SEMANTIC_FOREGROUND_TOKENS = [
  '--text',
  '--text-muted',
  '--primary',
  '--accent',
  '--success',
  '--warning',
  '--danger',
] as const;

const FILL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--primary-foreground', '--primary'],
  ['--accent-foreground', '--accent'],
  ['--success-foreground', '--success'],
  ['--warning-foreground', '--warning'],
  ['--danger-foreground', '--danger'],
];

export function auditTokensCss(css: string, minRatio = WCAG_AA_NORMAL_TEXT): ContrastCheckResult[] {
  const themes = parseThemeTokens(css);
  const results: ContrastCheckResult[] = [];

  for (const theme of ['dark', 'light'] as const) {
    const vars = themes[theme];
    for (const bgToken of SURFACE_BACKGROUNDS) {
      const bg = vars[bgToken];
      if (!bg) throw new Error(`Missing token ${bgToken} in ${theme} theme`);
      for (const fgToken of TEXT_AND_SEMANTIC_FOREGROUND_TOKENS) {
        const fg = vars[fgToken];
        if (!fg) throw new Error(`Missing token ${fgToken} in ${theme} theme`);
        const ratio = contrastRatio(fg, bg);
        results.push({
          theme,
          pair: `${fgToken} on ${bgToken}`,
          foreground: fg,
          background: bg,
          ratio: Number(ratio.toFixed(2)),
          pass: ratio >= minRatio,
        });
      }
    }

    for (const [fgToken, bgToken] of FILL_PAIRS) {
      const fg = vars[fgToken];
      const bg = vars[bgToken];
      if (!fg || !bg) throw new Error(`Missing token ${fgToken} or ${bgToken} in ${theme} theme`);
      const ratio = contrastRatio(fg, bg);
      results.push({
        theme,
        pair: `${fgToken} on ${bgToken}`,
        foreground: fg,
        background: bg,
        ratio: Number(ratio.toFixed(2)),
        pass: ratio >= minRatio,
      });
    }
  }

  return results;
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const tokensPath = resolve(process.cwd(), 'src/web/theme/tokens.css');
  const css = await readFile(tokensPath, 'utf8');
  const results = auditTokensCss(css);
  const failed = results.filter((item) => !item.pass);
  for (const item of results) {
    const mark = item.pass ? 'PASS' : 'FAIL';
    console.info(
      `[contrast:${mark}] ${item.theme.padEnd(5)} ${item.pair.padEnd(36)} ${item.ratio.toFixed(2)}:1 (${item.foreground} / ${item.background})`,
    );
  }
  if (failed.length > 0) {
    console.error(
      `WCAG AA contrast check failed: ${failed.length}/${results.length} pairs below ${WCAG_AA_NORMAL_TEXT}:1.`,
    );
    process.exit(1);
  }
  console.info(
    `All ${results.length} foreground/background token combinations pass WCAG AA (>= ${WCAG_AA_NORMAL_TEXT}:1).`,
  );
}
