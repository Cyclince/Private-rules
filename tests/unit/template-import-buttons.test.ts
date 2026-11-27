import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SimpleTemplateView } from '../../src/application/templates';
import type { QuickCreatePublicationLink } from '../../src/application/templates/quick-create';
import { CLIENT_IMPORTS } from '../../src/shared/client-import';
import { TemplateSimpleOutputTab } from '../../src/web/components/templates/TemplateSimpleOutputTab';
import { WizardDoneLinks } from '../../src/web/components/templates/WizardDoneLinks';

vi.mock('../../src/web/i18n', async () => {
  const { zhCN } = await import('../../src/web/i18n/zh-CN');
  return { useI18n: () => ({ locale: 'zh-CN', t: (key: keyof typeof zhCN) => zhCN[key] }) };
});
vi.mock('../../src/web/lib/toast', () => ({ useToast: () => ({ notify: vi.fn() }) }));

const url = 'https://rules.example/t/token%2Bsecret/My%20Config/mihomo.yaml?token=a%26b&other=one';
const name = '流媒体 配置';
const publication: QuickCreatePublicationLink = {
  id: 'output',
  slug: 'My Config',
  client: 'mihomo',
  clientLabel: 'Clash Verge Rev',
  fileName: 'mihomo.yaml',
  supported: true,
  access: 'token',
  experimentalFullConfig: false,
  url,
};

function view(linkUrl: string | null = url, disabled = false): SimpleTemplateView {
  // Only fields consumed by the ordinary output tab are needed for this render test.
  return {
    template: { id: 'tpl', slug: 'My Config', name },
    nodes: { bound: false },
    ruleTokenConfigured: true,
    outputs: [
      {
        id: 'output',
        clients: ['mihomo'],
        hasBindings: false,
        access: disabled ? 'disabled' : 'token',
        links: [{ client: 'mihomo', displayName: 'Clash Verge Rev', supported: true, url: linkUrl }],
      },
    ],
  } as SimpleTemplateView;
}

function renderWizard(linkUrl: string | null = url) {
  return renderToStaticMarkup(
    createElement(WizardDoneLinks, {
      publications: [{ ...publication, url: linkUrl }],
      name,
      copiedKey: null,
      onCopy: vi.fn(),
      onUrlElement: vi.fn(),
    }),
  );
}
function renderOutput(linkUrl: string | null = url, disabled = false) {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(TemplateSimpleOutputTab, { view: view(linkUrl, disabled), readOnly: true }),
    ),
  );
}

function withVerification(verified: boolean, assertion: () => void) {
  const original = CLIENT_IMPORTS.mihomo;
  CLIENT_IMPORTS.mihomo = { ...original, verified };
  try {
    assertion();
  } finally {
    CLIENT_IMPORTS.mihomo = original;
  }
}

function importHref(html: string, testId: string) {
  const anchor = html.match(new RegExp('<a[^>]*data-testid="' + testId + '"[^>]*>'))?.[0];
  expect(anchor).toBeTruthy();
  return anchor!.match(/href="([^"]+)"/)![1].replaceAll('&amp;', '&');
}

describe('template import button verification gate in actual client rows', () => {
  it('does not render a button in either completion or ordinary output rows when unverified', () => {
    withVerification(false, () => {
      expect(renderWizard()).not.toContain('wizard-done-import-mihomo');
      expect(renderOutput()).not.toContain('output-import-mihomo');
    });
  });

  it('temporarily verified metadata renders real anchors with the correct encoded URL and Chinese name in both rows', () => {
    withVerification(true, () => {
      for (const [html, testId] of [
        [renderWizard(), 'wizard-done-import-mihomo'],
        [renderOutput(), 'output-import-mihomo'],
      ]) {
        const href = importHref(html, testId);
        expect(href.startsWith('clash://install-config?url=')).toBe(true);
        const parsed = new URL(href);
        expect(parsed.searchParams.get('url')).toBe(url);
        expect(parsed.searchParams.get('name')).toBe(name);
        expect(html).toContain('一键导入');
        expect(html).not.toContain('target="_blank"');
      }
    });
  });

  it('does not render import links without a usable URL or for disabled outputs', () => {
    withVerification(true, () => {
      expect(renderWizard(null)).not.toContain('wizard-done-import-mihomo');
      expect(renderOutput(null)).not.toContain('output-import-mihomo');
      expect(renderOutput(url, true)).not.toContain('output-import-mihomo');
    });
  });
});
