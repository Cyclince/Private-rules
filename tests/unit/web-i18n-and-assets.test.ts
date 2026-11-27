import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertToZhTW, fullZhCNSource } from '../../scripts/generate-zh-tw';
import { ERROR_CODES, type ErrorCode } from '../../src/shared/errors';
import { en } from '../../src/web/i18n/en';
import { getDictionary, loadLocaleDictionary, resolveLocale, translateErrorCode } from '../../src/web/i18n';
import { zhTW } from '../../src/web/i18n/zh-TW';

const ROOT = resolve(process.cwd());
const WEB_DIR = join(ROOT, 'src/web');
const MAX_WEBP_BYTES = 150 * 1024;

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

describe('M2.1 build-time i18n, zero runtime OpenCC, and WebP assets', () => {
  it('keeps zh-CN, zh-TW, and en dictionaries in exact key parity and covers all ERROR_CODES', async () => {
    await Promise.all([loadLocaleDictionary('zh-TW'), loadLocaleDictionary('en')]);
    const cnKeys = Object.keys(fullZhCNSource()).sort();
    const twKeys = Object.keys(zhTW).sort();
    const enKeys = Object.keys(en).sort();
    expect(twKeys).toEqual(cnKeys);
    expect(enKeys).toEqual(cnKeys);

    for (const code of Object.keys(ERROR_CODES) as ErrorCode[]) {
      expect(translateErrorCode(code, 'zh-CN')).toBeTruthy();
      expect(translateErrorCode(code, 'zh-TW')).toBeTruthy();
      expect(translateErrorCode(code, 'en')).toBeTruthy();
    }
    expect(getDictionary('zh-TW')['lang.zh-TW']).toBe('繁體中文');
    expect(resolveLocale('zh-Hant-TW')).toBe('zh-TW');
    expect(resolveLocale('en-US')).toBe('en');
    expect(resolveLocale('zh-CN')).toBe('zh-CN');

    // Ensure English dictionary contains no stray Chinese characters (excluding native locale names)
    for (const [key, value] of Object.entries(en)) {
      if (key === 'lang.zh-CN' || key === 'lang.zh-TW') continue;
      expect(value, `Unexpected Han character in en[${key}]`).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });

  it('keeps generated zh-TW.ts in sync with generate-zh-tw.ts and applies manual terminology overrides', () => {
    expect(zhTW).toEqual(convertToZhTW(fullZhCNSource()));
    expect(zhTW['preview.toastDescription']).toContain('快取');
    expect(zhTW['error.INTERNAL']).toContain('伺服器');
    expect(zhTW['auth.logout']).toBe('登出');
  });

  it('never imports opencc-js inside src/web runtime code', async () => {
    const files = (await listFilesRecursive(WEB_DIR)).filter((file) => /\.(ts|tsx)$/.test(file));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content, `Unexpected opencc-js reference in ${file}`).not.toMatch(
        /from\s+['"]opencc-js['"]|import\(['"]opencc-js['"]\)/,
      );
    }
  });

  it('stores valid WebP assets in src/web/assets/ each <= 150KB and documents licenses in THIRD-PARTY-NOTICES.md', async () => {
    const assetsDir = join(WEB_DIR, 'assets');
    const files = (await readdir(assetsDir)).filter((name) => name.endsWith('.webp')).sort();
    expect(files).toEqual([
      'miku-about-emblem.webp',
      'miku-dashboard-banner.webp',
      'miku-empty-state.webp',
      'miku-login-bg.webp',
    ]);

    for (const name of files) {
      const fullPath = join(assetsDir, name);
      const info = await stat(fullPath);
      expect(info.size, `${name} exceeds 150KB limit`).toBeLessThanOrEqual(MAX_WEBP_BYTES);
      expect(info.size).toBeGreaterThan(1024);
      const header = await readFile(fullPath);
      expect(header.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(header.subarray(8, 12).toString('ascii')).toBe('WEBP');
    }

    const notices = await readFile(join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8');
    expect(notices).toContain('Piapro Character License');
    expect(notices).toContain('Crypton Future Media');
  });
});
