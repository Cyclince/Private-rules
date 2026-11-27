import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import type { SimpleTemplateView } from '../../src/application/templates';
import { TemplateSimpleOutputTab } from '../../src/web/components/templates/TemplateSimpleOutputTab';
import { QrCodeButton } from '../../src/web/components/ui/QrCodeButton';
import { generateQrCodeSvg } from '../../src/web/components/ui/QrCodeDialog';
import { I18nProvider, loadPageTranslations } from '../../src/web/i18n';
import { ToastStateProvider } from '../../src/web/lib/toast';

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

  it('keeps the compact label for large screens only while the aria-label names the action on phones', async () => {
    await loadPageTranslations();
    const compact = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { initialLocale: 'zh-CN' },
        createElement(QrCodeButton, { url: 'https://rules.example.com/x.yaml', testId: 'qr-compact', compact: true }),
      ),
    );
    const regular = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { initialLocale: 'zh-CN' },
        createElement(QrCodeButton, { url: 'https://rules.example.com/x.yaml', testId: 'qr-regular' }),
      ),
    );

    expect(compact).toContain('class="hidden sm:inline"');
    expect(regular).not.toContain('hidden sm:inline');
    for (const html of [compact, regular]) {
      expect(html).toContain('aria-label="二维码"');
      expect(html).not.toContain('data-testid="qr-code-dialog"');
    }
  });

  it('puts a lazily loading QR button beside every copy link on the template output tab', async () => {
    await loadPageTranslations();
    const view = {
      template: {
        id: 'tpl-1',
        slug: 'qr-output',
        name: 'QR 输出模板',
        description: '',
        currentVersion: 1,
        baseKind: 'simple',
        complexity: 'simple',
        updatedAt: new Date(0).toISOString(),
        createdAt: new Date(0).toISOString(),
        createdByWizard: true,
      },
      routing: {},
      nodes: { bound: true, subscriptions: [], nodeNames: [] },
      ruleTokenConfigured: true,
      outputs: [
        {
          id: 'pub-1',
          slug: 'qr-output',
          clients: ['mihomo'],
          access: 'token',
          output: 'full',
          experimentalFullConfig: false,
          pinnedVersion: null,
          hasBindings: false,
          slotsCount: 0,
          updatedAt: new Date(0).toISOString(),
          links: [
            {
              client: 'mihomo',
              label: 'Clash Verge Rev',
              displayName: 'Clash Verge Rev',
              fileName: 'qr-output.yaml',
              supported: true,
              url: 'https://rules.example.com/t/token/qr-output.yaml',
            },
            {
              client: 'shadowrocket',
              label: 'Shadowrocket',
              displayName: 'Shadowrocket',
              fileName: 'qr-output.list',
              supported: true,
              url: null,
            },
          ],
        },
      ],
    } as unknown as SimpleTemplateView;

    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { initialLocale: 'zh-CN' },
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(ToastStateProvider, null, createElement(TemplateSimpleOutputTab, { view, readOnly: false })),
        ),
      ),
    );

    const qrButton = (testId: string) => {
      const index = html.indexOf(`data-testid="${testId}"`);
      expect(index, testId).toBeGreaterThan(-1);
      return html.slice(html.lastIndexOf('<button', index), html.indexOf('>', index) + 1);
    };

    const isDisabled = (tag: string) => /\sdisabled(?:=""|\s|>)/.test(tag);

    // The token link gets an enabled QR button next to its copy button.
    expect(qrButton('output-qr-mihomo')).toContain('aria-label="二维码"');
    expect(isDisabled(qrButton('output-qr-mihomo'))).toBe(false);
    expect(isDisabled(qrButton('output-copy-mihomo'))).toBe(false);
    // A client without a URL keeps the button visible but disabled instead of hiding it.
    expect(isDisabled(qrButton('output-qr-shadowrocket'))).toBe(true);
    expect(isDisabled(qrButton('output-copy-shadowrocket'))).toBe(true);
    // No dialog markup on the first render: the dialog only arrives on the first click.
    expect(html).not.toContain('data-testid="qr-code-dialog"');
    expect(html).not.toContain('用手机扫码导入');
  });
});
