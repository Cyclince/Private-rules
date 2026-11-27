import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:5180';
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' };
const BOT_TOKEN = '123456:e2e-test-token';

async function signInAdmin(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { password: 'e2e-password' },
    headers: JSON_HEADERS,
  });
  expect(res.status()).toBe(200);
}

function buildSignedInitData(userId: number, suffix: string): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `e2e-m31-${userId}-${Date.now()}-${suffix}`,
    user: JSON.stringify({ id: userId, first_name: 'M31MiniApp', username: `m31_${userId}` }),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

async function createRulesetViaApi(page: Page, name: string) {
  const res = await page.request.post('/api/rulesets', {
    data: { name, tokenLinksEnabled: true, publicLinksEnabled: false },
    headers: JSON_HEADERS,
  });
  expect(res.status()).toBe(201);
  const payload = (await res.json()) as { data: { categories: Array<{ id: string; name: string }> } };
  return payload.data.categories.find((item) => item.name === name)!;
}

async function deleteRulesetViaApi(page: Page, id: string) {
  await page.request.delete(`/api/rulesets/${id}`, { headers: JSON_HEADERS });
}

test.describe('M3.1 & M1b Rules Library, Rule Detail, Friendly Rules, Bulk Add, Telegram & 10k Scale', () => {
  test('desktop (1280x800): overview stats, ruleset CRUD + sort toolbar + rollback + subscription links, single/bulk rules + conflicts + batch', async ({
    page,
  }) => {
    await signInAdmin(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    const createdIds: string[] = [];
    const suffix = Date.now().toString(36);
    const setAName = `Alpha-${suffix}`;
    const setBName = `Beta-${suffix}`;

    try {
      // 1. Overview page renders real stats
      await page.goto('/admin');
      await expect(page.getByTestId('dashboard-page')).toBeVisible();
      await expect(page.getByTestId('stat-card-rulesets')).toBeVisible();
      await expect(page.getByTestId('stat-card-rules')).toBeVisible();
      await expect(page.getByTestId('stat-card-sources')).toBeVisible();
      await expect(page.getByTestId('dashboard-recent-errors')).toBeVisible();

      // 2. Navigate to Rules Library and create two rulesets via 1.0.7 create dialog
      await page.getByTestId('dashboard-manage-rulesets').click();
      await expect(page).toHaveURL(/\/admin\/rules$/);
      await expect(page.getByTestId('rules-source-stats')).toBeVisible();

      await page.getByTestId('create-ruleset-btn').click();
      await expect(page.getByTestId('ruleset-form-dialog')).toBeVisible();
      await expect(page.getByTestId('create-rule-footer-status')).toContainText('默认私密访问');
      await page.getByTestId('ruleset-form-name').fill(setAName);
      await page.getByTestId('ruleset-form-description').fill('Primary ruleset');
      await page.getByTestId('ruleset-form-submit').click();
      await expect(page.getByTestId('ruleset-form-dialog')).toBeHidden();
      await expect(page).toHaveURL(/\/admin\/rules\/[^/]+$/);
      await expect(page.getByTestId('rule-detail-title')).toHaveText(setAName);
      const setAId = page.url().split('/').pop()!;
      createdIds.push(setAId);

      await page.getByTestId('back-to-rules-btn').click();
      await expect(page).toHaveURL(/\/admin\/rules$/);

      await page.getByTestId('create-ruleset-btn').click();
      await page.getByTestId('ruleset-form-name').fill(setBName);
      await page.getByTestId('ruleset-form-submit').click();
      await expect(page).toHaveURL(/\/admin\/rules\/[^/]+$/);
      await expect(page.getByTestId('rule-detail-title')).toHaveText(setBName);
      const setBId = page.url().split('/').pop()!;
      createdIds.push(setBId);

      // 3. Edit ruleset B
      await page.getByTestId('edit-ruleset-btn').click();
      await page.getByTestId('ruleset-form-description').fill('Edited description');
      await page.getByTestId('ruleset-form-submit').click();
      await expect(page.getByTestId('ruleset-form-dialog')).toBeHidden();
      await expect(page.getByTestId('rule-detail-header')).toContainText('Edited description');

      // 4. Sort toolbar on Rules Library: toggle alpha asc -> desc and verify persistence after reload
      await page.getByTestId('back-to-rules-btn').click();
      await expect(page).toHaveURL(/\/admin\/rules$/);
      await expect(page.getByTestId('rules-sort-toolbar')).toBeVisible();

      const ascOrder = await page
        .getByTestId('rulesets-list')
        .locator('[data-testid^="ruleset-row-"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
      expect(ascOrder.indexOf(`ruleset-row-${setAId}`)).toBeLessThan(ascOrder.indexOf(`ruleset-row-${setBId}`));

      await page.getByTestId('rules-sort-alpha').click();
      await page.reload();
      await expect(page.getByTestId(`ruleset-row-${setBId}`)).toBeVisible();
      const descOrder = await page
        .getByTestId('rulesets-list')
        .locator('[data-testid^="ruleset-row-"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
      expect(descOrder.indexOf(`ruleset-row-${setBId}`)).toBeLessThan(descOrder.indexOf(`ruleset-row-${setAId}`));

      // Quick "Copy link" icon button on category card jumps to /subscriptions/$id
      await page.getByTestId(`ruleset-copy-link-${setBId}`).click();
      await expect(page).toHaveURL(new RegExp(`/admin/subscriptions/${setBId}`));
      await expect(page.getByTestId('subscription-detail-page')).toBeVisible();

      // Open rule detail for setB
      await page.goto(`/admin/rules/${setBId}`);
      await expect(page.getByTestId('rule-detail-title')).toHaveText(setBName);

      // 5. Optimistic rollback on failed PATCH + localized error toast
      await page.route(`**/api/rulesets/${setBId}`, async (route) => {
        if (route.request().method() === 'PATCH') {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ ok: false, code: 'INTERNAL', error: 'Simulated failure' }),
          });
          return;
        }
        await route.continue();
      });
      await expect(page.getByTestId('ruleset-enabled-toggle')).toHaveAttribute('data-state', 'checked');
      await page.getByTestId('ruleset-enabled-toggle').click();
      await expect(page.getByTestId('toast-danger')).toBeVisible();
      await expect(page.getByTestId('ruleset-enabled-toggle')).toHaveAttribute('data-state', 'checked');
      await page.unroute(`**/api/rulesets/${setBId}`);

      // 6. Navigate to Subscription Center from rule detail & verify policy links
      await page.getByTestId('ruleset-open-links-btn').click();
      await expect(page).toHaveURL(new RegExp(`/admin/subscriptions/${setBId}`));
      await expect(page.getByTestId('subscription-detail-page')).toBeVisible();

      // Switch policy to public and verify valid public link
      await page.getByTestId('subscription-access-select').selectOption('public');
      await page.getByTestId('subscription-group-toggle-yaml').click();
      const mihomoLink = page.getByTestId('subscription-link-url-mihomo');
      await expect(mihomoLink).toBeVisible();
      await expect(mihomoLink).toContainText('/rules/');
      await expect(mihomoLink).not.toContainText('/sub/');

      // Switch policy to disabled -> subscription page must show disabled notice
      await page.getByTestId('subscription-access-select').selectOption('disabled');
      await expect(page.getByTestId('subscription-links-disabled')).toBeVisible();

      // Back to rule detail for setB
      await page.goto(`/admin/rules/${setBId}`);

      // 7. Manual Rule CRUD (Single add IP-CIDR with default no-resolve, friendly subtitle, view raw, edit, toggle)
      await page.getByTestId('single-rule-value').fill('198.51.100.0/24');
      await expect(page.getByTestId('single-rule-preview')).toContainText('IP / IP 段');
      await page.getByTestId('single-rule-more-options').locator('summary').click();
      await expect(page.getByTestId('single-rule-no-resolve')).toHaveAttribute('data-state', 'checked');
      await page.getByTestId('single-rule-note').fill('CIDR note');
      await page.getByTestId('single-rule-submit').click();

      await expect(page.getByTestId('rules-list')).toContainText('198.51.100.0/24');
      await expect(page.getByTestId('rules-list')).toContainText('no-resolve');
      await expect(page.getByTestId('rules-list')).toContainText('CIDR note');
      await expect(page.getByTestId('rules-list')).not.toContainText('IP-CIDR,');

      // Inspect raw rule syntax via ⋯ menu -> 查看原文
      const cidrRow = page.getByTestId('rules-list').locator('[data-testid^="rule-row-"]').first();
      const cidrRuleId = (await cidrRow.getAttribute('data-testid'))!.replace('rule-row-', '');
      await page.getByTestId(`rule-menu-${cidrRuleId}`).click();
      await page.getByTestId(`rule-view-raw-${cidrRuleId}`).click();
      await expect(page.getByTestId(`rule-raw-${cidrRuleId}`)).toHaveText('IP-CIDR,198.51.100.0/24,no-resolve');

      // Edit rule note via ⋯ menu -> 编辑
      await page.getByTestId(`rule-menu-${cidrRuleId}`).click();
      await page.getByTestId(`rule-edit-${cidrRuleId}`).click();
      await expect(page.getByTestId('rule-form-dialog')).toBeVisible();
      await page.getByTestId('rule-form-note').fill('CIDR edited');
      await page.getByTestId('rule-form-submit').click();
      await expect(page.getByTestId('rule-form-dialog')).toBeHidden();
      await expect(page.getByTestId(`rule-subtitle-${cidrRuleId}`)).toContainText('CIDR edited');

      // Toggle rule off and back on
      await page.getByTestId(`rule-toggle-${cidrRuleId}`).click();
      await expect(page.getByTestId(`rule-toggle-${cidrRuleId}`)).toHaveAttribute('data-state', 'unchecked');
      await page.getByTestId(`rule-toggle-${cidrRuleId}`).click();
      await expect(page.getByTestId(`rule-toggle-${cidrRuleId}`)).toHaveAttribute('data-state', 'checked');

      // Add a domain rule to trigger conflict during Bulk Add
      await page.getByTestId('single-rule-value').fill(`conflict-${suffix}.example`);
      await page.getByTestId('single-rule-submit').click();
      await expect(page.getByTestId('rules-list')).toContainText(`conflict-${suffix}.example`);

      // Trigger single-add conflict to verify exact 1.0.7 copy
      await page.getByTestId('single-rule-value').fill(`sub.conflict-${suffix}.example`);
      await page.getByTestId('single-rule-submit').click();
      await expect(page.getByTestId('single-rule-conflicts')).toContainText(
        '新规则会与以下现有自定义规则产生重复匹配。替换后，旧规则将被移除并在当前分类保存新规则。',
      );
      await page.getByTestId('single-rule-value').fill('');

      // 8. Inline 3-step Bulk Add with conflict detection & replacement
      await page
        .getByTestId('bulk-import-textarea')
        .fill(
          [
            `DOMAIN,api.conflict-${suffix}.example`,
            `DOMAIN-SUFFIX,fresh-${suffix}.example`,
            `DOMAIN,extra-${suffix}.example`,
          ].join('\n'),
        );
      await page.getByTestId('bulk-import-preview-btn').click();
      await expect(page.getByTestId('bulk-import-preview-step')).toBeVisible();
      await expect(page.getByTestId('bulk-import-conflict-count')).toHaveText('1');
      await expect(page.getByTestId('bulk-import-conflicts')).toBeVisible();
      await expect(page.getByTestId('bulk-import-confirm-btn')).toBeDisabled();

      // Enable replaceConflicts and confirm
      await page.getByTestId('bulk-import-replace-toggle').click();
      await expect(page.getByTestId('bulk-import-confirm-btn')).toBeEnabled();
      await page.getByTestId('bulk-import-confirm-btn').click();
      await expect(page.getByTestId('bulk-import-done-step')).toBeVisible();
      await page.getByTestId('bulk-import-close-btn').click();

      await expect(page.getByTestId('rules-list')).toContainText(`fresh-${suffix}.example`);
      await expect(page.getByTestId('rules-list')).toContainText(`api.conflict-${suffix}.example`);

      // 9. Batch operations via "管理规则 · 批量选择与维护"
      await page.getByTestId('manage-rules-toggle-btn').click();
      await expect(page.getByTestId('batch-action-bar')).toBeVisible();
      await page.getByTestId('select-all-page-checkbox').click();
      await page.getByTestId('batch-disable-btn').click();
      await expect(page.getByTestId('toast-viewport')).toContainText('已批量停用所选规则');

      await page.getByTestId('select-all-page-checkbox').click();
      await page.getByTestId('batch-enable-btn').click();
      await expect(page.getByTestId('toast-viewport')).toContainText('已批量启用所选规则');

      await page.getByTestId('select-all-page-checkbox').click();
      await page.getByTestId('batch-delete-btn').click();
      await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
      await page.getByTestId('delete-confirm-submit').click();
      await expect(page.getByTestId('rules-empty')).toBeVisible();

      // 10. Delete ruleset B with 2-step confirmation -> returns to /admin/rules
      await page.getByTestId('delete-ruleset-btn').click();
      await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
      await page.getByTestId('delete-confirm-submit').click();
      await expect(page).toHaveURL(/\/admin\/rules$/);
      await expect(page.getByTestId(`ruleset-row-${setBId}`)).toHaveCount(0);

      // Verify zero horizontal overflow on desktop
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      for (const id of createdIds) {
        await deleteRulesetViaApi(page, id);
      }
    }
  });

  test('A2: create rule from scratch -> single add chatgpt.com without changing type -> friendly subtitle', async ({
    page,
  }) => {
    await signInAdmin(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    const name = `OpenAI-${Date.now().toString(36)}`;
    let createdId = '';

    try {
      await page.goto('/admin/rules');
      await page.getByTestId('create-ruleset-btn').click();
      await expect(page.getByTestId('ruleset-form-dialog')).toBeVisible();
      await expect(page.getByTestId('create-mode-manual')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('create-rule-footer-status')).toContainText('默认私密访问，创建后可在订阅页修改');

      await page.getByTestId('ruleset-form-name').fill(name);
      await page.getByTestId('ruleset-form-submit').click();
      await expect(page).toHaveURL(/\/admin\/rules\/[^/]+$/);
      createdId = page.url().split('/').pop()!;

      // Verify default private access (matches 1.0.7)
      const listRes = await page.request.get('/api/rulesets?summary=1');
      const listPayload = (await listRes.json()) as {
        data: { categories: Array<{ id: string; tokenLinksEnabled?: boolean; publicLinksEnabled?: boolean }> };
      };
      const createdCat = listPayload.data.categories.find((c) => c.id === createdId)!;
      expect(createdCat.tokenLinksEnabled).toBe(true);
      expect(createdCat.publicLinksEnabled).toBe(false);

      // Add chatgpt.com without changing rule type (stays AUTO)
      await expect(page.getByTestId('single-rule-type')).toHaveValue('AUTO');
      await page.getByTestId('single-rule-value').fill('chatgpt.com');
      await expect(page.getByTestId('single-rule-preview')).toContainText(
        '将添加为：域名后缀 · chatgpt.com 及其子域名',
      );
      await page.getByTestId('single-rule-submit').click();

      const row = page.getByTestId('rules-list').locator('[data-testid^="rule-row-"]').first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('chatgpt.com');
      await expect(row).toContainText('域名后缀 · chatgpt.com 及其子域名 · 手动维护');
      await expect(row).not.toContainText('DOMAIN-SUFFIX');
    } finally {
      if (createdId) await deleteRulesetViaApi(page, createdId);
    }
  });

  test('A3: create rule from upstream -> Geo DB -> search telegram -> select geosite + geoip -> initial sync result & counts (offline mocked)', async ({
    page,
  }) => {
    await signInAdmin(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    const catName = `TelegramGeo-${Date.now().toString(36)}`;
    const syntheticId = `cat-geo-${Date.now().toString(36)}`;
    const syncedAt = new Date().toISOString();
    let capturedCreateBody: Record<string, unknown> | null = null;
    let created = false;

    const syntheticSources = [
      {
        id: 'src-geosite-tg',
        categoryId: syntheticId,
        name: 'geosite:telegram',
        url: '',
        enabled: true,
        sourceType: 'geosite',
        geositeName: 'telegram',
        syncIntervalMinutes: 60,
        lastStatus: 'success',
        lastCount: 18,
        lastOriginalCount: 18,
        lastSyncedAt: syncedAt,
        ruleOptimization: 'none',
      },
      {
        id: 'src-geoip-tg',
        categoryId: syntheticId,
        name: 'geoip:telegram',
        url: '',
        enabled: true,
        sourceType: 'geoip',
        geoipName: 'telegram',
        syncIntervalMinutes: 60,
        lastStatus: 'success',
        lastCount: 9,
        lastOriginalCount: 9,
        lastSyncedAt: syncedAt,
        ruleOptimization: 'none',
      },
    ];

    const syntheticCategory = {
      id: syntheticId,
      name: catName,
      slug: catName.toLowerCase(),
      description: 'Telegram Geo upstream',
      enabled: true,
      publicLinksEnabled: true,
      tokenLinksEnabled: false,
      rules: [],
      sources: syntheticSources,
      createdAt: syncedAt,
      updatedAt: syncedAt,
      lastSyncedAt: syncedAt,
      ruleCount: 27,
      enabledRuleCount: 27,
      manualRuleCount: 0,
      urlRuleCount: 0,
      geoRuleCount: 27,
    };

    await page.route('**/api/geo/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            { name: 'telegram', sourceType: 'geosite', recommended: true, description: 'Telegram domains' },
            { name: 'telegram', sourceType: 'geoip', recommended: true, description: 'Telegram IP ranges' },
          ],
        }),
      });
    });

    await page.route('**/api/rulesets', async (route) => {
      if (route.request().method() === 'POST') {
        capturedCreateBody = route.request().postDataJSON() as Record<string, unknown>;
        created = true;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              version: 1,
              settings: {},
              categories: [syntheticCategory],
              updatedAt: syncedAt,
              lastSyncedAt: syncedAt,
            },
            links: {},
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.route('**/api/rulesets?summary=1', async (route) => {
      if (!created) {
        await route.continue();
        return;
      }
      const upstream = await route.fetch();
      const json = (await upstream.json()) as { data: { categories: unknown[] }; links: Record<string, unknown> };
      json.data.categories = [syntheticCategory, ...json.data.categories];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(json),
      });
    });

    await page.route(`**/api/rulesets/${syntheticId}/sources`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sources: syntheticSources }),
      });
    });

    await page.route(`**/api/rulesets/${syntheticId}/rules**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('source') === 'upstream') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rules: [
              {
                id: 'r-tg-1',
                categoryId: syntheticId,
                type: 'DOMAIN-SUFFIX',
                value: 'telegram.org',
                enabled: true,
                sourceId: 'src-geosite-tg',
                sourceName: 'geosite:telegram',
                createdAt: syncedAt,
                updatedAt: syncedAt,
              },
              {
                id: 'r-tg-2',
                categoryId: syntheticId,
                type: 'IP-CIDR',
                value: '149.154.160.0/20',
                options: { noResolve: true },
                enabled: true,
                sourceId: 'src-geoip-tg',
                sourceName: 'geoip:telegram',
                createdAt: syncedAt,
                updatedAt: syncedAt,
              },
            ],
            total: 27,
            nextCursor: null,
            hasMore: false,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rules: [], total: 0, nextCursor: null, hasMore: false }),
      });
    });

    await page.goto('/admin/rules');
    await page.getByTestId('create-ruleset-btn').click();
    await expect(page.getByTestId('ruleset-form-dialog')).toBeVisible();

    await page.getByTestId('create-mode-upstream').click();
    await page.getByTestId('ruleset-form-name').fill(catName);
    await page.getByTestId('upstream-kind-geo').click();
    await page.getByTestId('create-geo-search-input').fill('telegram');

    const geositeOpt = page.getByTestId('create-geo-option-geosite-telegram');
    const geoipOpt = page.getByTestId('create-geo-option-geoip-telegram');
    await expect(geositeOpt).toBeVisible();
    await expect(geositeOpt).toContainText('域名规则');
    await expect(geoipOpt).toBeVisible();
    await expect(geoipOpt).toContainText('IP 规则');

    await geositeOpt.click();
    await geoipOpt.click();
    await expect(page.getByTestId('create-rule-footer-status')).toContainText(
      '默认公开访问 · 已选择 1 个 GeoSite 与 1 个 GeoIP',
    );

    await page.getByTestId('ruleset-form-submit').click();
    await expect(page.getByTestId('toast-viewport')).toContainText('规则已创建并完成首次上游同步');
    await expect(page).toHaveURL(new RegExp(`/admin/rules/${syntheticId}$`));

    expect(capturedCreateBody).not.toBeNull();
    expect(capturedCreateBody!.geositeNames).toEqual(['telegram']);
    expect(capturedCreateBody!.geoipNames).toEqual(['telegram']);
    expect(capturedCreateBody!.tokenLinksEnabled).toBe(false);
    expect(capturedCreateBody!.publicLinksEnabled).toBe(true);

    // Verify initial sync results and counts on rule detail page
    await expect(page.getByTestId('sources-list')).toContainText('geosite:telegram');
    await expect(page.getByTestId('sources-list')).toContainText('18 条规则');
    await expect(page.getByTestId('sources-list')).toContainText('geoip:telegram');
    await expect(page.getByTestId('sources-list')).toContainText('9 条规则');
    await expect(page.getByTestId('upstream-mirror-count')).toHaveText('27');

    // Expand mirror rules drawer and verify plain-language mirror rules render
    await page.getByTestId('upstream-mirror-rules-toggle').click();
    await expect(page.getByTestId('upstream-mirror-rules-list')).toContainText('telegram.org');
    await expect(page.getByTestId('upstream-mirror-rules-list')).toContainText('149.154.160.0/20');
  });

  test('tablet (834x1024) & mobile (390x844): rules overview & detail, server search, subscription links, zero horizontal overflow', async ({
    page,
  }) => {
    await signInAdmin(page);
    const seeded = await createRulesetViaApi(page, `ViewportSet-${Date.now().toString(36)}`);
    try {
      await page.request.post(`/api/rulesets/${seeded.id}/rules`, {
        data: { value: 'viewport-check.example', type: 'DOMAIN-SUFFIX' },
        headers: JSON_HEADERS,
      });

      for (const viewport of [
        { width: 834, height: 1024 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);

        // Overview page zero horizontal overflow
        await page.goto('/admin/rules');
        await expect(page.getByTestId(`ruleset-item-${seeded.id}`)).toBeVisible();
        const overviewOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overviewOverflow).toBeLessThanOrEqual(0);

        // Legacy ?selected= redirects directly to /rules/$id
        await page.goto(`/admin/rules?selected=${seeded.id}`);
        await expect(page).toHaveURL(new RegExp(`/admin/rules/${seeded.id}$`));
        await expect(page.getByTestId('rule-detail-title')).toHaveText(seeded.name);
        await expect(page.getByTestId('rules-list')).toContainText('viewport-check.example');

        // Server search
        await page.getByTestId('rules-search-input').fill('viewport-check');
        await expect(page.getByTestId('rules-total-badge')).toHaveText('1');

        const detailOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(detailOverflow).toBeLessThanOrEqual(0);

        // Open subscription center detail page for this ruleset
        await page.getByTestId('ruleset-open-links-btn').click();
        await expect(page).toHaveURL(new RegExp(`/admin/subscriptions/${seeded.id}`));
        await expect(page.getByTestId('subscription-detail-page')).toBeVisible();
      }
    } finally {
      await deleteRulesetViaApi(page, seeded.id);
    }
  });

  test('Telegram Mini App session: disables create/edit/delete/add on rules while keeping enabled switch active', async ({
    page,
  }) => {
    await signInAdmin(page);
    const seeded = await createRulesetViaApi(page, `TgRestrict-${Date.now().toString(36)}`);

    try {
      // Logout admin & sign in as Telegram Mini App user
      await page.request.post('/api/auth/logout', { headers: JSON_HEADERS });
      const initData = buildSignedInitData(2001, 'restrict');
      const tgLogin = await page.request.post('/api/telegram/session', {
        data: { initData },
        headers: JSON_HEADERS,
      });
      expect(tgLogin.status()).toBe(201);

      await page.setViewportSize({ width: 390, height: 844 });

      // Overview: create button disabled + Telegram notice shown
      await page.goto('/admin/rules');
      await expect(page.getByTestId('rulesets-telegram-notice')).toBeVisible();
      await expect(page.getByTestId('create-ruleset-btn')).toBeDisabled();

      // Detail page: edit/delete/add disabled, enabled switch remains active and works against server
      await page.goto(`/admin/rules/${seeded.id}`);
      await expect(page.getByTestId('telegram-restriction-banner')).toBeVisible();
      await expect(page.getByTestId('edit-ruleset-btn')).toBeDisabled();
      await expect(page.getByTestId('delete-ruleset-btn')).toBeDisabled();
      await expect(page.getByTestId('add-source-btn')).toBeDisabled();
      await expect(page.getByTestId('single-rule-submit')).toBeDisabled();

      await expect(page.getByTestId('ruleset-enabled-toggle')).toBeEnabled();
      await page.getByTestId('ruleset-enabled-toggle').click();
      await expect(page.getByTestId('ruleset-enabled-toggle')).toHaveAttribute('data-state', 'unchecked');
      await page.getByTestId('ruleset-enabled-toggle').click();
      await expect(page.getByTestId('ruleset-enabled-toggle')).toHaveAttribute('data-state', 'checked');
    } finally {
      await signInAdmin(page);
      await deleteRulesetViaApi(page, seeded.id);
    }
  });

  test('10,000-rule ruleset: cursor pagination on first screen and SPA route transition < 200ms', async ({ page }) => {
    test.setTimeout(60_000);
    await signInAdmin(page);
    const seeded = await createRulesetViaApi(page, `Scale10K-${Date.now().toString(36)}`);

    try {
      // Seed 10,000 manual rules via real bulk import API (2 x 5,000 chunks)
      for (let chunk = 0; chunk < 2; chunk += 1) {
        const lines = Array.from(
          { length: 5000 },
          (_, i) => `DOMAIN-SUFFIX,perf-${String(chunk * 5000 + i).padStart(5, '0')}.scale10k.test`,
        ).join('\n');
        const res = await page.request.post(`/api/rulesets/${seeded.id}/rules/import`, {
          data: { text: lines, confirm: true, replaceConflicts: true },
          headers: JSON_HEADERS,
        });
        expect(res.status()).toBe(200);
      }

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/admin');
      await expect(page.getByTestId('dashboard-page')).toBeVisible();

      // Warm lazy route chunk once so measurement isolates steady-state route transition with 10,000 rules
      await page.getByTestId('desktop-sidebar').getByRole('link', { name: '规则' }).click();
      await expect(page).toHaveURL(/\/admin\/rules$/);
      await page.getByTestId(`ruleset-item-${seeded.id}`).click();
      await expect(page).toHaveURL(new RegExp(`/admin/rules/${seeded.id}$`));
      await expect(page.getByTestId('rules-total-badge')).toHaveText('10,000');

      // Navigate back to Overview, then measure real click -> 50 paginated rows visible on 10,000-rule ruleset
      await page.getByTestId('desktop-sidebar').getByRole('link', { name: '概览' }).click();
      await expect(page.getByTestId('dashboard-page')).toBeVisible();

      const startMs = await page.evaluate(() => performance.now());
      await page.getByTestId('dashboard-ruleset-snapshot').getByRole('link', { name: seeded.name }).click();
      await expect(page.getByTestId('rules-total-badge')).toHaveText('10,000');
      await expect(page.getByTestId('rules-list').locator('[data-testid^="rule-row-"]')).toHaveCount(50);
      const elapsedMs = await page.evaluate((start) => performance.now() - start, startMs);

      console.info(`[M3.1 perf] 10,000-rule ruleset route transition: ${elapsedMs.toFixed(1)}ms`);
      const budgetMs = process.env.CI ? 600 : 200;
      expect(elapsedMs).toBeLessThan(budgetMs);

      // Verify cursor pagination advances to page 2 and server search finds rule #9999
      await expect(page.getByTestId('rules-list').locator('[data-testid^="rule-row-"]').first()).toContainText(
        'perf-00000.scale10k.test',
      );
      await page.getByTestId('rules-next-page').click();
      await expect(page.getByTestId('rules-pagination')).toContainText('2');
      await expect(page.getByTestId('rules-list').locator('[data-testid^="rule-row-"]').first()).toContainText(
        'perf-00050.scale10k.test',
      );

      await page.getByTestId('rules-search-input').fill('perf-09999');
      await expect(page.getByTestId('rules-total-badge')).toHaveText('1');
      await expect(page.getByTestId('rules-list')).toContainText('perf-09999.scale10k.test');
    } finally {
      await deleteRulesetViaApi(page, seeded.id);
    }
  });
});
