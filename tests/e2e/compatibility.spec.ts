import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { E2E_ORIGIN } from '../helpers/e2e-env';

const CSRF_HEADERS = { origin: E2E_ORIGIN, 'content-type': 'application/json' };

async function createCategory(page: Page) {
  await page.request.post('/api/auth/login', { data: { password: 'e2e-password' }, headers: CSRF_HEADERS });
  const name = `Compatibility-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const response = await page.request.post('/api/categories', {
    data: { name, tokenLinksEnabled: false, publicLinksEnabled: true },
    headers: CSRF_HEADERS,
  });
  expect(response.status()).toBe(201);
  const { data } = await response.json();
  return data.categories.find((category: { name: string }) => category.name === name) as { id: string; name: string };
}

function buildTelegramInitData(suffix: string) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `compat-tg-${Date.now()}-${suffix}`,
    user: JSON.stringify({ id: 2001, first_name: 'Compat', username: 'compat' }),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('123456:e2e-test-token').digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

test.describe('M3.3 1.0.x parity checklist compatibility suite', () => {
  test('legacy ?view= deep links and /preview redirects resolve cleanly to /admin routes', async ({ page }) => {
    const category = await createCategory(page);
    try {
      await page.goto('/admin?view=dashboard');
      await expect(page.getByTestId('dashboard-page')).toBeVisible();

      await page.goto(`/admin?view=rules&category=${category.id}`);
      await expect(page).toHaveURL(new RegExp(`/admin/rules/${category.id}$`));
      await expect(page.getByTestId('rule-detail-title')).toHaveText(category.name);

      await page.goto(`/admin?view=sources&category=${category.id}`);
      await expect(page).toHaveURL(new RegExp(`/admin/rules/${category.id}$`));
      await expect(page.getByTestId('sources-panel')).toBeVisible();

      await page.goto(`/admin/rules?selected=${category.id}`);
      await expect(page).toHaveURL(new RegExp(`/admin/rules/${category.id}$`));
      await expect(page.getByTestId('rule-detail-title')).toHaveText(category.name);

      await page.goto(`/admin?view=links&category=${category.id}`);
      await expect(page).toHaveURL(new RegExp(`/admin/subscriptions/${category.id}`));
      await expect(page.getByTestId('subscription-detail-page')).toBeVisible();

      await page.goto('/admin?view=settings');
      await expect(page).toHaveURL(/\/admin\/settings/);
      await expect(page.getByTestId('settings-general-tab')).toBeVisible();

      // Transition /preview and /admin/rulesets URLs redirect cleanly to /admin/rules/$id
      await page.goto(`/preview/rulesets?selected=${category.id}`);
      await expect(page).toHaveURL(new RegExp(`/admin/rules/${category.id}$`));
    } finally {
      await page.request.delete(`/api/categories/${category.id}`, { headers: CSRF_HEADERS });
    }
  });

  for (const locale of ['zh-CN', 'zh-TW', 'en'] as const) {
    test(`subscription links cover YAML/Loon/QX/Surge/sing-box with clean ${locale} localization`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const category = await createCategory(page);
      try {
        await page.addInitScript((loc) => localStorage.setItem('private-rules-locale', loc), locale);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/admin?view=links&category=${category.id}`);

        const detailPage = page.getByTestId('subscription-detail-page');
        await expect(detailPage).toBeVisible();
        for (const groupId of ['yaml', 'list', 'json', 'txt']) {
          await page.getByTestId(`subscription-group-toggle-${groupId}`).click();
        }
        await expect(page.getByTestId('subscription-link-yaml-classical')).toContainText('.yaml');
        await expect(page.getByTestId('subscription-link-yaml-domain')).toContainText('_Domain.yaml');
        await expect(page.getByTestId('subscription-link-yaml-ipcidr')).toContainText('_IPCIDR.yaml');
        await expect(page.getByTestId('subscription-link-loon')).toContainText('-loon.list');
        await expect(page.getByTestId('subscription-link-quantumult-x')).toContainText('-qx.list');
        await expect(page.getByTestId('subscription-link-surge')).toContainText('.list');
        await expect(page.getByTestId('subscription-link-sing-box')).toContainText('.json');

        if (locale === 'en') {
          expect(await detailPage.textContent()).not.toMatch(/[\u3400-\u9fff]/u);
        }
        expect(errors).toEqual([]);
      } finally {
        await page.request.delete(`/api/categories/${category.id}`, { headers: CSRF_HEADERS });
      }
    });
  }

  for (const viewport of [
    { width: 390, height: 667 },
    { width: 667, height: 375 },
    { width: 320, height: 480 },
  ]) {
    test(`bulk import wizard stays usable and imports 100 rules at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      const category = await createCategory(page);
      try {
        await page.addInitScript(() => localStorage.setItem('private-rules-locale', 'zh-CN'));
        await page.setViewportSize(viewport);
        await page.goto(`/admin/rulesets?selected=${category.id}`);
        await expect(page).toHaveURL(new RegExp(`/admin/rules/${category.id}$`));

        await page
          .getByTestId('bulk-import-textarea')
          .fill(Array.from({ length: 100 }, (_, i) => `mobile-${i}.example.com`).join('\n'));
        await page.getByTestId('bulk-import-preview-btn').click();

        await expect(page.getByTestId('bulk-import-preview-step')).toBeVisible();
        await expect(page.getByTestId('bulk-import-valid-count')).toHaveText('100');
        await page.getByTestId('bulk-import-confirm-btn').click();
        await expect(page.getByTestId('bulk-import-done-step')).toBeVisible();
        await page.getByTestId('bulk-import-close-btn').click();

        const result = await page.request.get('/api/categories');
        const payload = (await result.json()) as { data: { categories: Array<{ id: string; ruleCount: number }> } };
        expect(payload.data.categories.find((item) => item.id === category.id)?.ruleCount).toBe(100);
      } finally {
        await page.request.delete(`/api/categories/${category.id}`, { headers: CSRF_HEADERS });
      }
    });
  }

  test('Mini App hides high-risk UI entries AND server rejects backup/data/infra writes with 403', async ({ page }) => {
    const initData = buildTelegramInitData('parity');
    const tgLogin = await page.request.post('/api/telegram/session', {
      data: { initData },
      headers: CSRF_HEADERS,
    });
    expect(tgLogin.status()).toBe(201);

    // Server-side 403 checks under Telegram session
    expect((await page.request.get('/api/backup')).status()).toBe(403);
    expect((await page.request.get('/api/data')).status()).toBe(403);
    expect(
      (
        await page.request.patch('/api/settings', {
          data: { baseUrl: 'https://blocked.example', githubMirrorUrl: 'https://blocked.mirror' },
          headers: CSRF_HEADERS,
        })
      ).status(),
    ).toBe(403);

    // UI hides API keys, backup, and infra settings
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/settings');
    await expect(page.getByTestId('settings-tab-api-keys')).toHaveCount(0);
    await expect(page.getByTestId('settings-tab-backup')).toHaveCount(0);
    await expect(page.getByTestId('settings-infra-fields')).toHaveCount(0);
  });
});
