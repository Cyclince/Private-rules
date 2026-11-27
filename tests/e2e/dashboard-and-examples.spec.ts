import { expect, test, type Page } from '@playwright/test';
import { E2E_ORIGIN } from '../helpers/e2e-env';

const headers = { origin: E2E_ORIGIN, 'content-type': 'application/json' };
async function signIn(page: Page) {
  expect((await page.request.post('/api/auth/login', { headers, data: { password: 'e2e-password' } })).status()).toBe(
    200,
  );
}

for (const width of [1280, 390]) {
  test(`dashboard at ${width}px separates modules, handles empty templates and expands real error states`, async ({
    page,
  }) => {
    await signIn(page);
    await page.setViewportSize({ width, height: 844 });
    const category = {
      id: 'dashboard-rule',
      name: 'Dashboard Rule',
      slug: 'Dashboard-Rule',
      rules: [],
      ruleCount: 12,
      sources: [],
      enabled: true,
    };
    const summary = { data: { categories: [category], settings: {}, lastSyncedAt: '2026-11-27T00:00:00Z' }, links: {} };
    await page.route('**/api/rulesets?summary=1', (route) => route.fulfill({ json: summary }));
    await page.route('**/api/templates?*', (route) =>
      route.fulfill({ json: { templates: [], total: 0, starters: [], hasMore: false, nextCursor: null } }),
    );
    await page.route('**/api/publications?*', (route) =>
      route.fulfill({ json: { publications: [], total: 0, hasMore: false, nextCursor: null } }),
    );
    await page.goto('/admin');
    await expect(page.getByTestId('dashboard-rules-panel')).toContainText('分流规则');
    await expect(page.getByTestId('stat-rulesets-count')).toHaveText('1');
    await expect(page.getByTestId('stat-rules-count')).toHaveText('12');
    await expect(page.getByTestId('dashboard-templates-empty')).toBeVisible();
    await expect(page.getByTestId('dashboard-copy-template-link')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-manage-rulesets')).toHaveAttribute('href', '/admin/rules');
    await expect(page.getByTestId('dashboard-copy-subscription')).toHaveAttribute('href', '/admin/subscriptions');
    await expect(page.getByTestId('dashboard-new-template')).toHaveAttribute('href', '/admin/templates/new');
    await expect(page.getByTestId('dashboard-page').locator('img')).toBeVisible();
    await expect(page.getByTestId('dashboard-recent-errors')).toHaveJSProperty('open', false);

    await page.unroute('**/api/rulesets?summary=1');
    await page.unroute('**/api/templates?*');
    await page.unroute('**/api/publications?*');
    await page.route('**/api/rulesets?summary=1', (route) =>
      route.fulfill({
        json: {
          ...summary,
          data: {
            ...summary.data,
            categories: [
              {
                ...category,
                sources: [
                  {
                    id: 'broken',
                    categoryId: category.id,
                    name: 'Local mock source',
                    lastStatus: 'error',
                    lastError: 'Mock failure',
                  },
                ],
              },
            ],
          },
        },
      }),
    );
    await page.route('**/api/templates?*', (route) =>
      route.fulfill({
        json: {
          templates: [
            { id: 'tpl-ok', baseBody: {} },
            { id: 'tpl-bad', baseBody: {} },
          ],
          total: 2,
          hasMore: false,
          nextCursor: null,
        },
      }),
    );
    await page.route('**/api/publications?*', (route) =>
      route.fulfill({
        json: {
          publications: [
            {
              templateId: 'tpl-ok',
              clients: ['mihomo', 'surge'],
              bindings: [{ needsRebind: false, lastStatus: 'ok' }],
            },
            { templateId: 'tpl-bad', clients: ['stash'], bindings: [{ needsRebind: true }] },
          ],
          total: 2,
          hasMore: false,
          nextCursor: null,
        },
      }),
    );
    await page.reload();
    await expect(page.getByTestId('dashboard-template-count')).toHaveText('2');
    await expect(page.getByTestId('dashboard-output-count')).toHaveText('3');
    await expect(page.getByTestId('dashboard-airport-status')).toContainText('1 个正常');
    await expect(page.getByTestId('dashboard-airport-status')).toContainText('1 个异常');
    await expect(page.getByTestId('dashboard-recent-errors')).toHaveJSProperty('open', true);
    await expect(page.getByTestId('dashboard-error-broken')).toContainText('Mock failure');
    await expect(page.getByTestId('dashboard-copy-template-link')).toHaveAttribute('href', '/admin/templates');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
    await page.route('**/api/sync', (route) => route.fulfill({ json: { results: [] } }));
    await page.getByTestId('dashboard-sync-all').click();
    await expect(page.getByTestId('toast-viewport')).toContainText('同步已完成');
  });
}

test('subscription examples match current private/public addresses, file behavior and default policy', async ({
  page,
}) => {
  await signIn(page);
  const settings = (await (await page.request.get('/api/settings')).json()) as { settings: { policyName: string } };
  expect(
    (await page.request.patch('/api/settings', { headers, data: { policyName: 'Custom Outbound' } })).status(),
  ).toBe(200);
  const name = `My Streaming Rules ${Date.now()}`;
  const created = await page.request.post('/api/rulesets', { headers, data: { name } });
  expect(created.status()).toBe(201);
  const body = (await created.json()) as { data: { categories: Array<{ id: string; name: string; slug: string }> } };
  const category = body.data.categories.find((item) => item.name === name)!;
  try {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as unknown as { copiedExample: string }).copiedExample = text;
          },
        },
      }),
    );
    await page.goto(`/admin/subscriptions/${category.id}`);
    await page.getByTestId('subscription-group-toggle-yaml').click();
    await page.getByTestId('subscription-example-yaml').locator('summary').click();
    await page.getByTestId('subscription-example-client-yaml').selectOption('yaml-domain');
    const yamlCode = page.getByTestId('subscription-example-code-yaml');
    await expect(yamlCode).toContainText('behavior: domain');
    await expect(yamlCode).toContainText('format: yaml');
    await expect(yamlCode).toContainText(`/sub/e2e-rule-token/${category.slug}_Domain.yaml`);
    await expect(yamlCode).toContainText('Custom Outbound');
    await page.getByTestId('subscription-example-copy-yaml').click();
    expect(await page.evaluate(() => (window as unknown as { copiedExample: string }).copiedExample)).toBe(
      await yamlCode.textContent(),
    );
    await page.getByTestId('subscription-example-client-yaml').selectOption('yaml-ipcidr');
    await expect(yamlCode).toContainText('behavior: classical');

    await page.getByTestId('subscription-group-toggle-list').click();
    await page.getByTestId('subscription-example-list').locator('summary').click();
    await page.getByTestId('subscription-example-client-list').selectOption('surge');
    await expect(page.getByTestId('subscription-example-code-list')).toContainText('RULE-SET,');
    await page.getByTestId('subscription-example-client-list').selectOption('quantumult-x');
    await expect(page.getByTestId('subscription-example-code-list')).toContainText('[filter_remote]');
    await expect(page.getByTestId('subscription-example-code-list')).toContainText('force-policy=Custom Outbound');

    await page.getByTestId('subscription-group-toggle-json').click();
    await page.getByTestId('subscription-example-json').locator('summary').click();
    const jsonCode = JSON.parse((await page.getByTestId('subscription-example-code-json').textContent())!);
    expect(jsonCode.route.rule_set[0].format).toBe('source');
    expect(jsonCode.route.rules[0]).toMatchObject({ action: 'route', outbound: 'Custom Outbound' });
    await page.getByTestId('subscription-group-toggle-txt').click();
    await expect(page.getByTestId('subscription-example-txt')).toHaveCount(0);

    await page.getByTestId('subscription-access-select').selectOption('public');
    await expect(yamlCode).toContainText(`/rules/${category.slug}_IPCIDR.yaml`);
    await expect(yamlCode).not.toContainText('/sub/');
    await page.getByTestId('subscription-access-select').selectOption('disabled');
    await expect(page.getByTestId('subscription-example-yaml')).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/rulesets/${category.id}`, { headers });
    await page.request.patch('/api/settings', { headers, data: { policyName: settings.settings.policyName } });
  }
});
