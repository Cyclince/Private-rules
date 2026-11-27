import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { QrCodeButton } from '../../src/web/components/ui/QrCodeButton';
import { generateQrCodeSvg } from '../../src/web/components/ui/QrCodeDialog';
import { I18nProvider, loadPageTranslations } from '../../src/web/i18n';

describe('Q1 local QR code SVG generation and lazy QrCodeButton', () => {
  it('generates a non-empty local SVG matching uqr encode() matrix for the target URL', () => {
    const url = 'https://rules.example.com/t/secret-token/ai/mihomo.yaml';
    const svg = generateQrCodeSvg(url);
    const encoded = encode(url, { ecc: 'M', border: 2 });
    const expectedSize = encoded.size * 10;

    expect(svg).toBeTruthy();
    expect(svg).toContain(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${expectedSize} ${expectedSize}">`);
    expect(svg).toContain(`<rect fill="#ffffff" width="${expectedSize}" height="${expectedSize}"/>`);
    expect(svg).toContain('<path fill="#000000" d="');
    expect(svg).not.toMatch(/https?:\/\/[^"]*\.png|api\.qrserver|chart\.googleapis/i);

    const expectedPaths: string[] = [];
    for (let row = 0; row < encoded.size; row++) {
      for (let col = 0; col < encoded.size; col++) {
        if (encoded.data[row][col]) {
          expectedPaths.push(`M${col * 10},${row * 10}h10v10h-10z`);
        }
      }
    }
    expect(svg).toContain(`d="${expectedPaths.join('')}"`);

    const otherSvg = generateQrCodeSvg('https://rules.example.com/t/other-token/proxy/shadowrocket.list');
    expect(otherSvg).not.toBe(svg);
    expect(generateQrCodeSvg('')).toBe('');
    expect(generateQrCodeSvg('   ')).toBe('');
  });

  it('renders QrCodeButton without eagerly mounting the lazy QR dialog', async () => {
    await loadPageTranslations();
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { initialLocale: 'zh-CN' },
        createElement(QrCodeButton, {
          url: 'https://rules.example.com/rules/ai-mihomo.yaml',
          title: 'Clash Verge Rev',
          testId: 'qr-test-btn',
        }),
      ),
    );

    expect(html).toContain('data-testid="qr-test-btn"');
    expect(html).toContain('二维码');
    expect(html).not.toContain('data-testid="qr-code-dialog"');
    expect(html).not.toContain('用手机扫码导入');
  });
});
