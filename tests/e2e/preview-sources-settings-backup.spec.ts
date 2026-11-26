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
    query_id: `e2e-m32-${userId}-${Date.now()}-${suffix}`,
    user: JSON.stringify({ id: userId, first_name: 'M32MiniApp', username: `m32_${userId}` }),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

test.describe('M3.2 Rule Sources, Settings, API Keys, Backup & Restore, About, and Telegram Restrictions', () => {
  test('desktop (1280x800): rule sources preview/geo-search/CRUD/toggle/sync', async ({ page }) => {
    await signInAdmin(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    const suffix = Date.now().toString(36);
    const created = await page.request.post('/api/rulesets', {
      data: { name: `Sources-${suffix}`, tokenLinksEnabled: true, publicLinksEnabled: false },
      headers: JSON_HEADERS,
    });
    expect(created.status()).toBe(201);
    const ruleset = (
      (await created.json()) as { data: { categories: Array<{ id: string; name: string }> } }
    ).data.categories.find((c) => c.name === `Sources-${suffix}`)!;

    try {
      // Intercept external-bound preview, geo search, and sync endpoints for deterministic offline verification
      await page.route(`**/api/rulesets/${ruleset.id}/sources/preview`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            preview: {
              count: 2,
              originalCount: 3,
              optimized: true,
              invalidCount: 0,
              rules: [
                { type: 'DOMAIN-SUFFIX', value: 'openai.com' },
                { type: 'DOMAIN', value: 'api.anthropic.com' },
              ],
            },
          }),
        });
      });
      await page.route('**/api/geo/search**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [
              { name: 'openai', sourceType: 'geosite', recommended: true, description: 'OpenAI domains' },
              { name: 'cn', sourceType: 'geoip', recommended: false, description: 'CN IP ranges' },
            ],
          }),
        });
      });

      await page.goto(`/admin/rulesets?selected=${ruleset.id}&tab=sources`);
      await expect(page.getByTestId('sources-panel')).toBeVisible();

      // 1. Add remote URL source: preview first, then save
      await page.getByTestId('add-source-btn').click();
      await expect(page.getByTestId('source-form-dialog')).toBeVisible();
      await page.getByTestId('source-form-url').fill('https://rules.example.com/ai.yaml');
      await page.getByTestId('source-form-optimization').selectOption('conservative');
      await page.getByTestId('source-preview-btn').click();
      await expect(page.getByTestId('source-preview-result')).toBeVisible();
      await expect(page.getByTestId('source-preview-result')).toContainText('openai.com');

      await page.getByTestId('source-form-submit').click();
      await expect(page.getByTestId('source-form-dialog')).toBeHidden();
      await expect(page.getByTestId('sources-list')).toContainText('https://rules.example.com/ai.yaml');

      // Find created source ID and test toggle + mocked manual sync
      const sourceRow = page.getByTestId('sources-list').locator('[data-testid^="source-row-"]').first();
      const sourceId = (await sourceRow.getAttribute('data-testid'))!.replace('source-row-', '');

      await page.route(`**/api/rulesets/${ruleset.id}/sources/${sourceId}/sync`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            result: {
              sourceId,
              categoryId: ruleset.id,
              name: 'ai.yaml',
              ok: true,
              count: 42,
              syncedAt: new Date().toISOString(),
            },
          }),
        });
      });
      await page.getByTestId(`source-sync-${sourceId}`).click();
      await expect(page.getByTestId('toast-viewport')).toContainText('来源同步完成');

      // Toggle source off and back on
      await page.getByTestId(`source-toggle-${sourceId}`).click();
      await expect(page.getByTestId(`source-toggle-${sourceId}`)).toHaveAttribute('data-state', 'unchecked');
      await page.getByTestId(`source-toggle-${sourceId}`).click();
      await expect(page.getByTestId(`source-toggle-${sourceId}`)).toHaveAttribute('data-state', 'checked');

      // 2. Add GeoSite source via Geo name search
      await page.getByTestId('add-source-btn').click();
      await page.getByTestId('source-type-geosite').click();
      await page.getByTestId('source-geo-search-input').fill('openai');
      await page.getByTestId('source-geo-search-btn').click();
      await expect(page.getByTestId('geo-suggestion-geosite-openai')).toBeVisible();
      await page.getByTestId('geo-suggestion-geosite-openai').click();
      await expect(page.getByTestId('source-form-geosite')).toHaveValue('openai');
      await page.getByTestId('source-form-submit').click();
      await expect(page.getByTestId('sources-list')).toContainText('geosite:openai');

      // Delete first source with 2-step confirmation
      await page.getByTestId(`source-delete-${sourceId}`).click();
      await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
      await page.getByTestId('delete-confirm-submit').click();
      await expect(page.getByTestId(`source-row-${sourceId}`)).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/rulesets/${ruleset.id}`, { headers: JSON_HEADERS });
    }
  });

  test('desktop (1280x800): general settings, manual rule optimization, API key lifecycle, invalid & valid backup restore, and About page', async ({
    page,
  }) => {
    await signInAdmin(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Capture current backup snapshot so we leave DB clean after restore test
    const initialBackupRes = await page.request.get('/api/backup');
    expect(initialBackupRes.status()).toBe(200);
    const initialBackup = (await initialBackupRes.json()) as Record<string, unknown>;

    const sentinelName = `Sentinel-${Date.now().toString(36)}`;
    const sentinelCreate = await page.request.post('/api/rulesets', {
      data: { name: sentinelName, tokenLinksEnabled: true, publicLinksEnabled: false },
      headers: JSON_HEADERS,
    });
    expect(sentinelCreate.status()).toBe(201);

    try {
      // 1. General Settings: save policyName + mirror + preview manual optimization + see Telegram cards
      await page.goto('/admin/settings');
      await expect(page.getByTestId('settings-general-tab')).toBeVisible();
      await page.getByTestId('settings-policy-name').fill('PROXY');
      await page.getByTestId('settings-github-mirror').fill('https://ghfast.top');
      await page.getByTestId('settings-save-btn').click();
      await expect(page.getByTestId('toast-viewport')).toContainText('设置已保存');

      await page.getByTestId('settings-opt-preview-btn').click();
      await expect(page.getByTestId('settings-opt-result')).toBeVisible();
      await expect(page.getByTestId('settings-telegram-notify-card')).toBeVisible();
      await expect(page.getByTestId('settings-telegram-audit-card')).toBeVisible();

      // 2. API Key lifecycle: create (shown once) -> reload (secret gone) -> edit note -> delete
      await page.getByTestId('settings-tab-api-keys').click();
      await expect(page.getByTestId('settings-api-keys-tab')).toBeVisible();
      const keyNote = `CI-Key-${Date.now().toString(36)}`;
      await page.getByTestId('api-key-note-input').fill(keyNote);
      await page.getByTestId('api-key-create-btn').click();

      await expect(page.getByTestId('api-key-secret-once')).toBeVisible();
      const plaintext = (await page.getByTestId('api-key-plaintext').textContent())!.trim();
      expect(plaintext).toMatch(/^prk_/);

      // Reload: plaintext secret must no longer be shown, while prefix + note remain
      await page.reload();
      await expect(page.getByTestId('api-key-secret-once')).toHaveCount(0);
      await expect(page.getByTestId('api-keys-list')).toContainText(keyNote);

      const keyRow = page.getByTestId('api-keys-list').locator('[data-testid^="api-key-row-"]', { hasText: keyNote });
      const keyId = (await keyRow.getAttribute('data-testid'))!.replace('api-key-row-', '');

      const updatedNote = `${keyNote}-renamed`;
      await page.getByTestId(`api-key-edit-btn-${keyId}`).click();
      await page.getByTestId(`api-key-edit-input-${keyId}`).fill(updatedNote);
      await page.getByTestId(`api-key-edit-save-${keyId}`).click();
      await expect(page.getByTestId(`api-key-note-${keyId}`)).toHaveText(updatedNote);

      await page.getByTestId(`api-key-delete-btn-${keyId}`).click();
      await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
      await page.getByTestId('delete-confirm-submit').click();
      await expect(page.getByTestId(`api-key-row-${keyId}`)).toHaveCount(0);

      // 3. Backup tab: invalid backup fails validation without corrupting sentinel data
      await page.getByTestId('settings-tab-backup').click();
      await expect(page.getByTestId('settings-backup-tab')).toBeVisible();

      await page.getByTestId('backup-json-textarea').fill('{"version": 2, "categories": "not-an-array"}');
      await page.getByTestId('backup-validate-btn').click();
      await expect(page.getByTestId('backup-validation-error')).toBeVisible();
      await expect(page.getByTestId('backup-confirm-import-btn')).toHaveCount(0);

      // Confirm sentinel ruleset is still completely intact
      const afterInvalid = await page.request.get('/api/rulesets?summary=1');
      const afterInvalidPayload = (await afterInvalid.json()) as { data: { categories: Array<{ name: string }> } };
      expect(afterInvalidPayload.data.categories.map((c) => c.name)).toContain(sentinelName);

      // 4. Valid backup validate -> diff preview -> confirm restore
      const restoredName = `Restored-${Date.now().toString(36)}`;
      const validBackup = {
        version: 2,
        settings: { policyName: 'DIRECT', baseUrl: '', githubMirrorUrl: '' },
        categories: [
          {
            name: restoredName,
            tokenLinksEnabled: true,
            publicLinksEnabled: false,
            rules: [{ value: 'restored.example', type: 'DOMAIN-SUFFIX', enabled: true }],
            sources: [],
          },
        ],
      };
      await page.getByTestId('backup-json-textarea').fill(JSON.stringify(validBackup));
      await page.getByTestId('backup-validate-btn').click();
      await expect(page.getByTestId('backup-validation-preview')).toBeVisible();
      await expect(page.getByTestId('backup-validation-preview')).toContainText('v2');
      await page.getByTestId('backup-confirm-import-btn').click();
      await expect(page.getByTestId('toast-viewport')).toContainText('备份已成功恢复');

      const afterRestore = await page.request.get('/api/rulesets?summary=1');
      const afterRestorePayload = (await afterRestore.json()) as { data: { categories: Array<{ name: string }> } };
      expect(afterRestorePayload.data.categories.map((c) => c.name)).toEqual([restoredName]);

      // 5. About tab: APP_VERSION and PCL + OSS license links
      await page.getByTestId('settings-tab-about').click();
      await expect(page.getByTestId('settings-about-tab')).toBeVisible();
      await expect(page.getByTestId('about-app-version')).toContainText('1.1.0');
      await expect(page.getByTestId('about-pcl-link')).toHaveAttribute('href', 'https://piapro.jp/license/pcl');
    } finally {
      // Restore initial snapshot cleanly so other E2E specs are unaffected
      await page.request.put('/api/backup', {
        data: initialBackup,
        headers: JSON_HEADERS,
      });
    }
  });

  test('tablet (834x1024) & mobile (390x844): settings tabs & about render with zero horizontal overflow, and Telegram hides infra/API/backup', async ({
    page,
  }) => {
    await signInAdmin(page);

    for (const viewport of [
      { width: 834, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const tab of ['general', 'api-keys', 'backup', 'about']) {
        await page.goto(tab === 'general' ? '/admin/settings' : `/admin/settings?tab=${tab}`);
        await expect(page.getByTestId(`settings-${tab}-tab`)).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      }
    }

    // Telegram Mini App session hides API keys, backup, and infrastructure settings
    await page.request.post('/api/auth/logout', { headers: JSON_HEADERS });
    const initData = buildSignedInitData(2001, 'settings');
    const tgRes = await page.request.post('/api/telegram/session', {
      data: { initData },
      headers: JSON_HEADERS,
    });
    expect(tgRes.status()).toBe(201);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/settings?tab=backup');
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(page.getByTestId('settings-tab-api-keys')).toHaveCount(0);
    await expect(page.getByTestId('settings-tab-backup')).toHaveCount(0);
    await expect(page.getByTestId('settings-telegram-infra-hidden')).toBeVisible();
    await expect(page.getByTestId('settings-infra-fields')).toHaveCount(0);
    await expect(page.getByTestId('settings-optimization-card')).toHaveCount(0);
    await expect(page.getByTestId('settings-telegram-notify-card')).toHaveCount(0);
    await expect(page.getByTestId('settings-telegram-audit-card')).toHaveCount(0);
    await expect(page.getByTestId('settings-policy-name')).toBeVisible();

    // About tab still accessible under Telegram
    await page.getByTestId('settings-tab-about').click();
    await expect(page.getByTestId('settings-about-tab')).toBeVisible();
  });
});
