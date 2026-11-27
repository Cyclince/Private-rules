import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ClientId } from '../../src/types/domain-rules';
import { SubscriptionExample } from '../../src/web/components/subscriptions/SubscriptionExample';
import type { FormatLinkGroup } from '../../src/web/components/subscriptions/subscription-helpers';

const state = vi.hoisted(() => ({ locale: 'zh-CN' as 'zh-CN' | 'zh-TW' | 'en' }));
vi.mock('../../src/web/i18n', async () => {
  const { zhCN } = await import('../../src/web/i18n/zh-CN');
  const { zhTW } = await import('../../src/web/i18n/zh-TW');
  const { en } = await import('../../src/web/i18n/en');
  const dictionaries = { 'zh-CN': zhCN, 'zh-TW': zhTW, en };
  return { useI18n: () => ({ t: (key: keyof typeof zhCN) => dictionaries[state.locale][key] }) };
});
vi.mock('../../src/web/lib/toast', () => ({ useToast: () => ({ notify: vi.fn() }) }));

function group(client: ClientId): FormatLinkGroup {
  const json = client === 'json' || client === 'sing-box';
  return {
    id: json ? 'json' : client === 'surge' ? 'list' : 'yaml',
    titleKey: json
      ? 'subscriptions.groupJson'
      : client === 'surge'
        ? 'subscriptions.groupList'
        : 'subscriptions.groupYaml',
    formats: [
      {
        id: client,
        fallbackTitle: client,
        fallbackDescription: '',
        suffix: json ? '.json' : '.yaml',
        tone: 'primary',
        link: {
          id: client,
          name: client,
          icon: '',
          description: '',
          fileName: 'My-Rules.json',
          publicUrl: '',
          tokenUrl: 'https://rules.example/sub/token/My-Rules.json',
          recommendedUrl: 'https://rules.example/sub/token/My-Rules.json',
          supported: true,
        },
      },
    ],
  };
}

function codeFrom(html: string): string {
  return html
    .match(/<code[^>]*>([\s\S]*?)<\/code>/)![1]
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

const locales = [
  ['zh-CN', '把 PROXY 换成你客户端里实际的策略组名称'],
  ['zh-TW', '把 PROXY 換成你客戶端裡實際的策略組名稱'],
  ['en', 'Replace PROXY with the actual policy group name in your client.'],
] as const;

describe('localized subscription example guidance', () => {
  it.each(locales)('%s shows the hint above comment-free sing-box JSON', (locale, hint) => {
    state.locale = locale;
    for (const client of ['json', 'sing-box'] as const) {
      const html = renderToStaticMarkup(createElement(SubscriptionExample, { group: group(client), name: 'My Rules' }));
      expect(html).toContain('data-testid="subscription-example-policy-hint-json"');
      expect(html).toContain(hint);
      expect(html.indexOf(hint)).toBeLessThan(html.indexOf('<pre'));
      const code = codeFrom(html);
      expect(code).not.toContain(hint);
      expect(code).not.toContain('#');
      const parsed = JSON.parse(code);
      expect(parsed.route.rule_set[0]).not.toHaveProperty('download_detour');
      expect(parsed.route.rules[0].outbound).toBe('PROXY');
    }
  });

  it.each(locales)('%s passes the localized hint into YAML/INI comments', (locale, hint) => {
    state.locale = locale;
    for (const client of ['mihomo', 'surge'] as const) {
      const html = renderToStaticMarkup(createElement(SubscriptionExample, { group: group(client), name: 'My Rules' }));
      expect(html).not.toContain('subscription-example-policy-hint-json');
      expect(codeFrom(html).startsWith('# ' + hint + '\n')).toBe(true);
    }
  });

  it('mentions the actual configured policy rather than a hard-coded PROXY', () => {
    state.locale = 'zh-CN';
    const html = renderToStaticMarkup(
      createElement(SubscriptionExample, { group: group('sing-box'), name: 'My Rules', policyName: 'My Outbound' }),
    );
    expect(html).toContain('把 My Outbound 换成你客户端里实际的策略组名称');
    const parsed = JSON.parse(codeFrom(html));
    expect(parsed.route.rules[0].outbound).toBe('My Outbound');
    expect(parsed.route.rule_set[0]).not.toHaveProperty('download_detour');
  });
});
