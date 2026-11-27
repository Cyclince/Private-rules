import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { E2E_ORIGIN } from '../helpers/e2e-env';

const ORIGIN = E2E_ORIGIN;
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' };
const BASELINE_DIR = join(process.cwd(), '.baseline', 'r5');

// Reused verbatim from tests/unit/beginner-copy.test.ts (F7 ordinary-page Chinese copy)
const BEGINNER_FORBIDDEN_REGEX =
  /槽位|组件|发布|full|minimal|Fork|overlay|DOMAIN-|IP-CIDR|no-resolve|内核|语法|格式|YAML|LIST|JSON/i;

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

type ViewportSpec = (typeof VIEWPORTS)[number];

async function signInAdminApi(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { password: 'e2e-password' },
    headers: JSON_HEADERS,
  });
  expect(res.status()).toBe(200);
}

async function signInAdminUi(page: Page) {
  await page.goto('/admin/login');
  await expect(page.getByTestId('login-page')).toBeVisible();
  await page.getByTestId('login-password-input').fill('e2e-password');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
}

async function navigateSection(page: Page, viewport: ViewportSpec, label: '概览' | '规则' | '订阅' | '模板' | '设置') {
  if (viewport.name === 'desktop') {
    await page.getByTestId('desktop-sidebar').getByRole('link', { name: label }).click();
  } else {
    await page.getByTestId('mobile-bottom-nav').getByRole('link', { name: label }).click();
  }
}

async function installClipboardSpy(page: Page) {
  await page.addInitScript(() => {
    const win = window as Window & { __copiedTexts?: string[] };
    win.__copiedTexts = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          win.__copiedTexts?.push(text);
        },
        readText: async () => win.__copiedTexts?.at(-1) ?? '',
      },
    });
  });
}

async function copiedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as Window & { __copiedTexts?: string[] }).__copiedTexts ?? []);
}

async function expectNoHorizontalOverflow(page: Page, stageLabel: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `[${stageLabel}] horizontal overflow`).toBeLessThanOrEqual(0);
}

async function captureBaselineScreenshot(page: Page, filename: string) {
  // Let the 200ms step transition settle before capturing the baseline screenshot.
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(BASELINE_DIR, filename), fullPage: true });
}

async function expectNoBeginnerForbiddenWords(page: Page, stageLabel: string) {
  const text = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    // Subscription URLs displayed in <code> legitimately end with `.yaml` (e.g. `/t/.../mihomo.yaml`).
    for (const codeEl of clone.querySelectorAll('code[data-testid^="wizard-done-url-"]')) {
      codeEl.remove();
    }
    return clone.innerText;
  });
  const match = text.match(BEGINNER_FORBIDDEN_REGEX);
  expect(match, `[${stageLabel}] matched forbidden term "${match?.[0] ?? ''}" in:\n${text}`).toBeNull();
}

async function clearAllTemplatesAndPublications(page: Page) {
  const pubsRes = await page.request.get('/api/publications');
  if (pubsRes.ok()) {
    const pubsData = (await pubsRes.json()) as { publications: Array<{ id: string }> };
    for (const pub of pubsData.publications) {
      await page.request.delete(`/api/publications/${pub.id}`, { headers: JSON_HEADERS }).catch(() => {});
    }
  }
  const tplRes = await page.request.get('/api/templates');
  if (tplRes.ok()) {
    const tplData = (await tplRes.json()) as { templates: Array<{ id: string }> };
    for (const tpl of tplData.templates) {
      await page.request.delete(`/api/templates/${tpl.id}`, { headers: JSON_HEADERS }).catch(() => {});
    }
  }
}

async function pickSingleApp(page: Page, platform: 'mac' | 'iphone', appId: string) {
  await page.getByTestId(`app-picker-platform-${platform}`).click();
  const option = page.getByTestId(`app-option-${appId}`);
  await expect(option).toBeVisible();
  await option.click();
}

async function ensureAppSelected(page: Page, platform: 'mac' | 'iphone', appId: string) {
  await page.getByTestId(`app-picker-platform-${platform}`).click();
  const option = page.getByTestId(`app-option-${appId}`);
  await expect(option).toBeVisible();
  if ((await option.getAttribute('aria-selected')) !== 'true') {
    await option.click();
  }
  await expect(option).toHaveAttribute('aria-selected', 'true');
}

async function mockPreviewSubscription(page: Page) {
  await page.route('**/api/templates/preview-subscription', async (route) => {
    const body = route.request().postDataJSON() as { subscriptionUrl?: string } | null;
    const isBackup = body?.subscriptionUrl?.includes('backup');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        isBackup
          ? {
              nodeCount: 24,
              totalParsedCount: 25,
              infoNodeCount: 1,
              format: 'clash-yaml',
              regions: [
                { code: 'JP', name: '日本', emoji: '🇯🇵', count: 14 },
                { code: 'SG', name: '新加坡', emoji: '🇸🇬', count: 10 },
              ],
              regionCounts: { JP: 14, SG: 10 },
              checkedAt: new Date().toISOString(),
            }
          : {
              nodeCount: 64,
              totalParsedCount: 66,
              infoNodeCount: 2,
              format: 'clash-yaml',
              regions: [
                { code: 'HK', name: '香港', emoji: '🇭🇰', count: 24 },
                { code: 'JP', name: '日本', emoji: '🇯🇵', count: 22 },
                { code: 'US', name: '美国', emoji: '🇺🇸', count: 18 },
              ],
              regionCounts: { HK: 24, JP: 22, US: 18 },
              checkedAt: new Date().toISOString(),
            },
      ),
    });
  });
}

function parseMaxDurationMs(raw: string): number {
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  let maxMs = 0;
  for (const part of parts) {
    if (part.endsWith('ms')) {
      const value = Number.parseFloat(part.slice(0, -2));
      if (Number.isFinite(value)) maxMs = Math.max(maxMs, value);
    } else if (part.endsWith('s')) {
      const value = Number.parseFloat(part.slice(0, -1)) * 1000;
      if (Number.isFinite(value)) maxMs = Math.max(maxMs, value);
    }
  }
  return maxMs;
}

async function expectNearZeroMotion(locator: Locator) {
  await expect(locator).toBeVisible();
  const timing = await locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(parseMaxDurationMs(timing.animationDuration)).toBeLessThanOrEqual(1);
  expect(parseMaxDurationMs(timing.transitionDuration)).toBeLessThanOrEqual(1);
}

async function expectNoHoverDisplacement(locator: Locator) {
  await expectNearZeroMotion(locator);
  await locator.hover();
  const transform = await locator.evaluate((el) => getComputedStyle(el).transform);
  expect(transform).toBe('none');
}

async function expectReducedTokens(page: Page) {
  const values = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      fast: style.getPropertyValue('--motion-fast').trim(),
      base: style.getPropertyValue('--motion-base').trim(),
      slow: style.getPropertyValue('--motion-slow').trim(),
    };
  });
  expect(parseMaxDurationMs(values.fast)).toBeLessThanOrEqual(1);
  expect(parseMaxDurationMs(values.base)).toBeLessThanOrEqual(1);
  expect(parseMaxDurationMs(values.slow)).toBeLessThanOrEqual(1);
}

test.describe('R5 beta.3 Beginner Acceptance Suite (A1–A9, Desktop 1280 & Mobile 390)', () => {
  test.describe.configure({ mode: 'serial' });

  for (const viewport of VIEWPORTS) {
    test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
      test('A1: 1.0.x legacy user -> 订阅 -> pick Clash Verge Rev -> copy link matches pre-upgrade URL & YAML', async ({
        page,
      }) => {
        test.setTimeout(60_000);
        await installClipboardSpy(page);
        await signInAdminApi(page);
        const backupRes = await page.request.get('/api/backup');
        expect(backupRes.status()).toBe(200);
        const originalBackup = await backupRes.json();

        // Import a 1.0.x (v1) backup matching legacy-runtime-1.0.7.db slugs & rules
        const legacyPrivateId = 'cat_legacy_private';
        const legacyPublicId = 'cat_legacy_public';
        const legacyV1Backup = {
          settings: {
            baseUrl: '',
            policyName: 'PROXY',
            githubMirrorUrl: '',
            publicLinksEnabled: true,
            tokenLinksEnabled: true,
          },
          categories: [
            {
              id: legacyPrivateId,
              name: 'Private Proxy',
              slug: 'private-proxy',
              description: 'Legacy 1.0.x private ruleset',
              note: 'Proxy note',
              enabled: true,
              publicLinksEnabled: false,
              tokenLinksEnabled: true,
              rules: [
                {
                  id: 'rule_legacy_chatgpt',
                  value: 'chatgpt.com',
                  type: 'DOMAIN-SUFFIX',
                  note: 'AI',
                  enabled: true,
                },
                {
                  id: 'rule_legacy_openai',
                  value: 'openai.com',
                  type: 'DOMAIN-SUFFIX',
                  enabled: true,
                },
              ],
              sources: [],
            },
            {
              id: legacyPublicId,
              name: 'Public Direct',
              slug: 'public-direct',
              description: 'Legacy 1.0.x public ruleset',
              enabled: true,
              publicLinksEnabled: true,
              tokenLinksEnabled: false,
              rules: [
                {
                  id: 'rule_legacy_cn',
                  value: 'qq.com',
                  type: 'DOMAIN-SUFFIX',
                  enabled: true,
                },
              ],
              sources: [],
            },
          ],
        };

        try {
          const restoreRes = await page.request.put('/api/backup', {
            data: legacyV1Backup,
            headers: JSON_HEADERS,
          });
          expect(restoreRes.status()).toBe(200);

          await page.request.post('/api/auth/logout', { headers: JSON_HEADERS, data: {} });
          await page.addInitScript(() => {
            localStorage.removeItem('private-rules-selected-app');
            localStorage.removeItem('private-rules-app-platform');
            localStorage.setItem('private-rules-locale', 'zh-CN');
          });
          await page.setViewportSize({ width: viewport.width, height: viewport.height });

          await signInAdminUi(page);
          await navigateSection(page, viewport, '订阅');
          await expect(page).toHaveURL(/\/admin\/subscriptions\/?$/);
          await expectNoHorizontalOverflow(page, `A1-${viewport.name}-subs-list`);

          const toggleBtn = page.getByTestId('subscriptions-app-selector-toggle');
          if ((await toggleBtn.getAttribute('aria-expanded')) !== 'true') {
            await toggleBtn.click();
          }
          await pickSingleApp(page, 'mac', 'clash-verge-rev');
          await expect(page.getByTestId('subscriptions-app-hint')).toContainText('已记住 Clash Verge Rev');

          const expectedPrivateUrl = `${ORIGIN}/sub/e2e-rule-token/private-proxy.yaml`;
          const expectedPublicUrl = `${ORIGIN}/rules/public-direct.yaml`;

          await page.getByTestId(`copy-subscription-quick-${legacyPrivateId}`).click();
          expect((await copiedTexts(page)).at(-1)).toBe(expectedPrivateUrl);

          await page.getByTestId(`copy-subscription-quick-${legacyPublicId}`).click();
          expect((await copiedTexts(page)).at(-1)).toBe(expectedPublicUrl);

          // Also verify via rule subscription detail page
          await page.getByTestId(`subscription-card-${legacyPrivateId}`).click();
          await expect(page).toHaveURL(new RegExp(`/admin/subscriptions/${legacyPrivateId}$`));
          await expectNoHorizontalOverflow(page, `A1-${viewport.name}-subs-detail`);
          await expect(page.getByTestId('subscription-app-link-url')).toHaveText(expectedPrivateUrl);
          await page.getByTestId('copy-subscription-link-app').click();
          expect((await copiedTexts(page)).at(-1)).toBe(expectedPrivateUrl);

          const rulePayloadRes = await page.request.get(expectedPrivateUrl);
          expect(rulePayloadRes.status()).toBe(200);
          const ruleYaml = await rulePayloadRes.text();
          expect(ruleYaml).toContain('payload:');
          expect(ruleYaml).toContain('- DOMAIN-SUFFIX,chatgpt.com');
          expect(ruleYaml).toContain('- DOMAIN-SUFFIX,openai.com');
        } finally {
          await signInAdminApi(page);
          await page.request.put('/api/backup', { data: originalBackup, headers: JSON_HEADERS });
        }
      });

      test('A2: create ruleset -> single add chatgpt.com without changing type -> shows 域名后缀 · chatgpt.com 及其子域名', async ({
        page,
      }) => {
        await signInAdminApi(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });

        const ruleName = `A2-ChatGPT-${viewport.name}-${Date.now().toString(36)}`;
        let createdId = '';

        try {
          await page.goto('/admin');
          await expect(page.getByTestId('dashboard-page')).toBeVisible();
          await navigateSection(page, viewport, '规则');
          await expect(page).toHaveURL(/\/admin\/rules$/);
          await expectNoHorizontalOverflow(page, `A2-${viewport.name}-rules-list`);

          await page.getByTestId('create-ruleset-btn').click();
          await expect(page.getByTestId('ruleset-form-dialog')).toBeVisible();
          await page.getByTestId('ruleset-form-name').fill(ruleName);
          await page.getByTestId('ruleset-form-submit').click();
          await expect(page).toHaveURL(/\/admin\/rules\/[^/]+$/);
          createdId = page.url().split('/').pop()!;
          await expectNoHorizontalOverflow(page, `A2-${viewport.name}-rule-detail`);

          await expect(page.getByTestId('single-rule-type')).toHaveValue('AUTO');
          await page.getByTestId('single-rule-value').fill('chatgpt.com');
          await expect(page.getByTestId('single-rule-preview')).toContainText('域名后缀 · chatgpt.com 及其子域名');
          await page.getByTestId('single-rule-submit').click();

          const row = page.getByTestId('rules-list').locator('[data-testid^="rule-row-"]').first();
          await expect(row).toBeVisible();
          await expect(row).toContainText('chatgpt.com');
          await expect(row).toContainText('域名后缀 · chatgpt.com 及其子域名');
          await expect(row).not.toContainText('DOMAIN-SUFFIX');
        } finally {
          if (createdId) {
            await page.request.delete(`/api/rulesets/${createdId}`, { headers: JSON_HEADERS }).catch(() => {});
          }
        }
      });

      test('A3: Geo rule telegram creation and initial sync (offline mocked)', async ({ page }) => {
        await signInAdminApi(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });

        const catName = `A3-TelegramGeo-${viewport.name}-${Date.now().toString(36)}`;
        const syntheticId = `cat-geo-r5-${viewport.name}-${Date.now().toString(36)}`;
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
        await expect(geoipOpt).toBeVisible();
        await geositeOpt.click();
        await geoipOpt.click();

        await page.getByTestId('ruleset-form-submit').click();
        await expect(page.getByTestId('toast-viewport')).toContainText('规则已创建并完成首次上游同步');
        await expect(page).toHaveURL(new RegExp(`/admin/rules/${syntheticId}$`));
        await expectNoHorizontalOverflow(page, `A3-${viewport.name}-geo-detail`);

        expect(capturedCreateBody).not.toBeNull();
        expect(capturedCreateBody!.geositeNames).toEqual(['telegram']);
        expect(capturedCreateBody!.geoipNames).toEqual(['telegram']);

        await expect(page.getByTestId('sources-list')).toContainText('geosite:telegram');
        await expect(page.getByTestId('sources-list')).toContainText('18 条规则');
        await expect(page.getByTestId('sources-list')).toContainText('geoip:telegram');
        await expect(page.getByTestId('sources-list')).toContainText('9 条规则');
        await expect(page.getByTestId('upstream-mirror-count')).toHaveText('27');

        await page.getByTestId('upstream-mirror-rules-toggle').click();
        await expect(page.getByTestId('upstream-mirror-rules-list')).toContainText('telegram.org');
        await expect(page.getByTestId('upstream-mirror-rules-list')).toContainText('149.154.160.0/20');
      });

      test('A4: brand-new library -> new template -> simple wizard (Clash Verge Rev, 1 mock airport, simple) -> done link, <= 4 Next clicks, zero forbidden copy, .baseline/r5 screenshots', async ({
        page,
      }) => {
        test.setTimeout(90_000);
        await mkdir(BASELINE_DIR, { recursive: true });
        await installClipboardSpy(page);
        await signInAdminApi(page);

        const backupRes = await page.request.get('/api/backup');
        expect(backupRes.status()).toBe(200);
        const originalBackup = await backupRes.json();

        await clearAllTemplatesAndPublications(page);
        // Simulate a completely brand-new empty library (no rulesets, no templates, no publications)
        const emptyRestoreRes = await page.request.put('/api/backup', {
          data: {
            version: 2,
            settings: { baseUrl: '', policyName: 'PROXY', githubMirrorUrl: '' },
            categories: [],
            cards: [],
            templates: [],
            publications: [],
          },
          headers: JSON_HEADERS,
        });
        expect(emptyRestoreRes.status()).toBe(200);

        await page.addInitScript(() => {
          localStorage.removeItem('private-rules-selected-app');
          localStorage.removeItem('private-rules-app-platform');
          localStorage.setItem('private-rules-locale', 'zh-CN');
        });
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await mockPreviewSubscription(page);

        let nextClickCount = 0;
        const clickWizardNext = async () => {
          const btn = page.getByTestId('wizard-next-btn');
          await expect(btn).toBeVisible();
          await expect(btn).toContainText('下一步');
          await btn.click();
          nextClickCount += 1;
        };

        try {
          await page.goto('/admin');
          await expect(page.getByTestId('dashboard-page')).toBeVisible();
          await navigateSection(page, viewport, '模板');
          await expect(page).toHaveURL(/\/admin\/templates$/);
          await expect(page.getByTestId('templates-empty-state')).toBeVisible();
          await expectNoBeginnerForbiddenWords(page, `A4-${viewport.name}-empty`);
          await expectNoHorizontalOverflow(page, `A4-${viewport.name}-empty`);
          await captureBaselineScreenshot(page, `a4-empty-${viewport.name}.png`);

          await page.getByTestId('templates-new-btn').click();
          await expect(page).toHaveURL(/\/admin\/templates\/new$/);

          // Step 1: Select Clash Verge Rev
          await expect(page.getByTestId('wizard-step-1')).toBeVisible();
          await ensureAppSelected(page, 'mac', 'clash-verge-rev');
          await expectNoBeginnerForbiddenWords(page, `A4-${viewport.name}-step-1`);
          await expectNoHorizontalOverflow(page, `A4-${viewport.name}-step-1`);
          await captureBaselineScreenshot(page, `a4-step-1-${viewport.name}.png`);
          await clickWizardNext();

          // Step 2: Fill 1 mock airport
          await expect(page.getByTestId('wizard-step-2')).toBeVisible();
          await page.getByTestId('wizard-sub-input-0').fill('https://mock-airport.example/sub?token=r5a4');
          await page.getByTestId('wizard-sub-check-btn-0').click();
          await expect(page.getByTestId('wizard-sub-preview-ok-0')).toBeVisible();
          await expectNoBeginnerForbiddenWords(page, `A4-${viewport.name}-step-2`);
          await expectNoHorizontalOverflow(page, `A4-${viewport.name}-step-2`);
          await captureBaselineScreenshot(page, `a4-step-2-${viewport.name}.png`);
          await clickWizardNext();

          // Step 3: Simple tier selected
          await expect(page.getByTestId('wizard-step-3')).toBeVisible();
          const simpleCard = page.getByTestId('wizard-tier-simple');
          if ((await simpleCard.getAttribute('aria-pressed')) !== 'true') {
            await simpleCard.click();
          }
          await expect(simpleCard).toHaveAttribute('aria-pressed', 'true');
          await expectNoBeginnerForbiddenWords(page, `A4-${viewport.name}-step-3`);
          await expectNoHorizontalOverflow(page, `A4-${viewport.name}-step-3`);
          await captureBaselineScreenshot(page, `a4-step-3-${viewport.name}.png`);
          await clickWizardNext();

          // Step 5: My rules (Step 4 skipped)
          await expect(page.getByTestId('wizard-step-5')).toBeVisible();
          await expectNoBeginnerForbiddenWords(page, `A4-${viewport.name}-step-5`);
          await expectNoHorizontalOverflow(page, `A4-${viewport.name}-step-5`);
          await captureBaselineScreenshot(page, `a4-step-5-${viewport.name}.png`);
          await clickWizardNext();

          // Step 8: Summary (Steps 6 & 7 skipped)
          await expect(page.getByTestId('wizard-step-8')).toBeVisible();
          await expectNoBeginnerForbiddenWords(page, `A4-${viewport.name}-step-8`);
          await expectNoHorizontalOverflow(page, `A4-${viewport.name}-step-8`);
          await captureBaselineScreenshot(page, `a4-step-8-${viewport.name}.png`);

          // Generate (not a "下一步" click)
          expect(nextClickCount).toBeLessThanOrEqual(4);
          await page.getByTestId('wizard-generate-btn').click();

          // Done page
          await expect(page.getByTestId('wizard-done')).toBeVisible();
          await expectNoBeginnerForbiddenWords(page, `A4-${viewport.name}-done`);
          await expectNoHorizontalOverflow(page, `A4-${viewport.name}-done`);
          await captureBaselineScreenshot(page, `a4-done-${viewport.name}.png`);

          const mihomoUrl = (await page.getByTestId('wizard-done-url-mihomo').innerText()).trim();
          expect(mihomoUrl).toContain('/t/');
          expect(mihomoUrl).toContain('/mihomo.yaml');
          await page.getByTestId('wizard-done-copy-mihomo').click();
          expect((await copiedTexts(page)).at(-1)).toBe(mihomoUrl);

          const yamlRes = await page.request.get(mihomoUrl);
          expect(yamlRes.status()).toBe(200);
          const doc = parseYaml(await yamlRes.text()) as { 'proxy-groups': Array<{ name: string }> };
          expect(doc['proxy-groups'].some((g) => g.name.includes('代理'))).toBe(true);
          expect(doc['proxy-groups'].some((g) => g.name.includes('直连'))).toBe(true);
          expect(doc['proxy-groups'].some((g) => g.name.includes('拦截'))).toBe(true);
        } finally {
          await clearAllTemplatesAndPublications(page);
          await page.request.put('/api/backup', { data: originalBackup, headers: JSON_HEADERS });
        }
      });

      test('A5: advanced tier -> AI routes to US pool, Emby_Direct ruleset set to direct compiles first pointing to DIRECT', async ({
        page,
      }) => {
        test.setTimeout(90_000);
        await signInAdminApi(page);
        await clearAllTemplatesAndPublications(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await mockPreviewSubscription(page);

        const rsRes = await page.request.post('/api/rulesets', {
          data: { name: 'Emby_Direct', tokenLinksEnabled: true, publicLinksEnabled: false },
          headers: JSON_HEADERS,
        });
        expect(rsRes.status()).toBe(201);
        const rsJson = (await rsRes.json()) as { data: { categories: Array<{ id: string; name: string }> } };
        const embyId = rsJson.data.categories.find((c) => c.name === 'Emby_Direct')!.id;

        const addRuleRes = await page.request.post(`/api/rulesets/${embyId}/rules`, {
          data: { value: 'emby.example.com', type: 'DOMAIN-SUFFIX' },
          headers: JSON_HEADERS,
        });
        expect(addRuleRes.status()).toBe(201);

        try {
          await page.goto('/admin/templates/new');
          await expect(page.getByTestId('wizard-step-1')).toBeVisible();
          await ensureAppSelected(page, 'mac', 'clash-verge-rev');
          await page.getByTestId('wizard-next-btn').click();

          // Step 2: mock airport with HK, JP, US
          await expect(page.getByTestId('wizard-step-2')).toBeVisible();
          await page.getByTestId('wizard-sub-input-0').fill('https://mock-airport.example/a5');
          await page.getByTestId('wizard-sub-check-btn-0').click();
          await expect(page.getByTestId('wizard-sub-preview-ok-0')).toBeVisible();
          await page.getByTestId('wizard-next-btn').click();

          // Step 3: Advanced tier
          await expect(page.getByTestId('wizard-step-3')).toBeVisible();
          await page.getByTestId('wizard-tier-advanced').click();
          await page.getByTestId('wizard-next-btn').click();

          // Step 4: AI enabled -> route to US pool
          await expect(page.getByTestId('wizard-step-4')).toBeVisible();
          const aiToggle = page.getByTestId('wizard-scenario-toggle-ai');
          if ((await aiToggle.getAttribute('aria-checked')) !== 'true') {
            await aiToggle.click();
          }
          await page.getByTestId('wizard-scenario-route-ai').selectOption('region:US');
          await page.getByTestId('wizard-next-btn').click();

          // Step 5: Emby_Direct -> check & set direct
          await expect(page.getByTestId('wizard-step-5')).toBeVisible();
          await page.getByTestId(`wizard-ruleset-toggle-${embyId}`).check();
          await page.getByTestId(`wizard-ruleset-route-${embyId}`).selectOption('direct');
          await page.getByTestId('wizard-next-btn').click();

          // Step 6: Ensure US pool is checked
          await expect(page.getByTestId('wizard-step-6')).toBeVisible();
          await expect(page.getByTestId('wizard-pool-region-toggle-US')).toBeChecked();
          await page.getByTestId('wizard-next-btn').click();

          // Step 7: Modules (readonly)
          await expect(page.getByTestId('wizard-step-7')).toBeVisible();
          await page.getByTestId('wizard-next-btn').click();

          // Step 8: Name & generate
          await expect(page.getByTestId('wizard-step-8')).toBeVisible();
          await page.getByTestId('wizard-name-input').fill(`A5 进阶配置 ${viewport.name}`);
          await page.getByTestId('wizard-generate-btn').click();

          await expect(page.getByTestId('wizard-done')).toBeVisible();
          const mihomoUrl = (await page.getByTestId('wizard-done-url-mihomo').innerText()).trim();
          const yamlRes = await page.request.get(mihomoUrl);
          expect(yamlRes.status()).toBe(200);

          const doc = parseYaml(await yamlRes.text()) as {
            rules: string[];
            'proxy-groups': Array<{ name: string; proxies?: string[] }>;
          };

          expect(doc.rules[0]).toMatch(/^RULE-SET,[^,]+,Emby_Direct$/);
          const embyGroup = doc['proxy-groups'].find((g) => g.name === 'Emby_Direct');
          expect(embyGroup?.proxies?.[0]).toBe('DIRECT');

          const openaiGroup = doc['proxy-groups'].find((g) => g.name.includes('OpenAI'));
          const aiServicesGroup = doc['proxy-groups'].find((g) => g.name.includes('AI 服务'));
          expect(openaiGroup?.proxies?.[0]).toContain('美国节点');
          expect(aiServicesGroup?.proxies?.[0]).toContain('美国节点');

          await expectNoHorizontalOverflow(page, `A5-${viewport.name}-done`);
        } finally {
          await clearAllTemplatesAndPublications(page);
          await page.request.delete(`/api/rulesets/${embyId}`, { headers: JSON_HEADERS }).catch(() => {});
        }
      });

      test('A6: template detail -> 输出 -> add Shadowrocket without re-entering airport', async ({ page }) => {
        test.setTimeout(90_000);
        await signInAdminApi(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });

        const suffix = `${viewport.name}-${Date.now().toString(36)}`;
        const qcRes = await page.request.post('/api/templates/quick-create', {
          data: {
            name: `A6 模板 ${suffix}`,
            complexity: 'advanced',
            clients: ['mihomo'],
            clientDisplayNames: ['Clash Verge Rev'],
            clientLabels: { mihomo: 'Clash Verge Rev' },
            scenarios: [
              { id: 'domestic-direct', enabled: true },
              { id: 'ad-block', enabled: true },
              { id: 'ai', enabled: true, route: 'proxy' },
            ],
            rulesets: [],
            groupMode: 'region',
            subscriptionUrl: `https://airport-a6.example.test/sub?token=${suffix}`,
            detectedRegions: ['HK', 'JP', 'US'],
            previewSummary: {
              nodeCount: 30,
              regions: { HK: 10, JP: 10, US: 10 },
              status: 'ok',
              checkedAt: new Date().toISOString(),
            },
          },
          headers: JSON_HEADERS,
        });
        expect(qcRes.status()).toBe(201);
        const qcJson = (await qcRes.json()) as {
          template: { id: string };
          publications: Array<{ id: string }>;
        };
        const templateId = qcJson.template.id;
        const pubIds = [qcJson.publications[0].id];

        try {
          await page.goto(`/admin/templates/${templateId}`);
          await expect(page.getByTestId('template-detail-page')).toBeVisible();
          await page.getByTestId('template-tab-output').click();
          await expect(page.getByTestId('simple-output-tab')).toBeVisible();
          await expectNoHorizontalOverflow(page, `A6-${viewport.name}-output`);

          await page.getByTestId('output-add-client-btn').click();
          const dialog = page.getByTestId('add-client-dialog');
          await expect(dialog).toBeVisible();
          // Confirm no subscription URL input is requested
          await expect(dialog.locator('input[type="url"]')).toHaveCount(0);

          await ensureAppSelected(page, 'iphone', 'shadowrocket');
          const addPubResPromise = page.waitForResponse(
            (res) => res.url().endsWith('/api/publications') && res.request().method() === 'POST',
          );
          await page.getByTestId('add-client-confirm-btn').click();
          const addPubRes = await addPubResPromise;
          expect(addPubRes.status()).toBe(201);
          const added = (await addPubRes.json()) as { publication: { id: string } };
          pubIds.push(added.publication.id);

          await expect(dialog).toBeHidden();
          await expect(page.getByTestId('simple-output-row-shadowrocket')).toBeVisible();
          const srUrl = (await page.getByTestId('simple-output-url-shadowrocket').innerText()).trim();
          expect(srUrl).toContain('/shadowrocket.conf');

          const srRes = await page.request.get(srUrl);
          expect(srRes.status()).toBe(200);
          const srText = await srRes.text();
          expect(srText).toContain('[Proxy Group]');
          expect(srText).toContain('[Rule]');
          await expectNoHorizontalOverflow(page, `A6-${viewport.name}-after-add`);
        } finally {
          for (const pubId of pubIds) {
            await page.request.delete(`/api/publications/${pubId}`, { headers: JSON_HEADERS }).catch(() => {});
          }
          await page.request.delete(`/api/templates/${templateId}`, { headers: JSON_HEADERS }).catch(() => {});
        }
      });

      test('A7: toggle advanced editing -> existing editor (cards, lint, probe, preview, patches, versions) works', async ({
        page,
      }) => {
        test.setTimeout(90_000);
        await signInAdminApi(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });

        const suffix = `${viewport.name}-${Date.now().toString(36)}`;
        const createRes = await page.request.post('/api/templates', {
          data: {
            name: `A7 高级编辑 ${suffix}`,
            starterTier: 'light',
            groupMode: 'select',
            output: 'full',
          },
          headers: JSON_HEADERS,
        });
        expect(createRes.status()).toBe(201);
        const templateId = ((await createRes.json()) as { template: { id: string } }).template.id;

        try {
          await page.goto(`/admin/templates/${templateId}`);
          await expect(page.getByTestId('template-detail-page')).toBeVisible();

          const advToggle = page.getByTestId('template-advanced-toggle');
          if ((await advToggle.getAttribute('aria-checked')) !== 'true') {
            await advToggle.click();
          }
          await expect(advToggle).toHaveAttribute('aria-checked', 'true');
          await expect(page.getByTestId('template-editor-page')).toBeVisible();
          await expect(page.getByTestId('editor-version-badge')).toHaveText('v1');
          await expectNoHorizontalOverflow(page, `A7-${viewport.name}-editor`);

          const switchMobileStep = async (step: 'catalog' | 'editor' | 'inspect') => {
            if (viewport.width < 1024) {
              await page.getByTestId(`editor-step-${step}`).click();
            }
          };

          // Rules list & patches editor
          await switchMobileStep(viewport.width < 1024 ? 'editor' : 'editor');
          await expect(page.getByTestId('template-card-row-domestic-direct')).toBeVisible();
          await page.getByTestId('editor-center-tab-patches').click();
          await expect(page.getByTestId('editor-patch-codemirror').locator('.cm-content')).toBeVisible();

          // Inspector: Lint -> Probe -> Preview -> Versions
          await switchMobileStep('inspect');
          await page.getByTestId('editor-panel-tab-lint').click();
          await expect(page.getByTestId('editor-lint-panel')).toBeVisible();

          await page.getByTestId('editor-panel-tab-probe').click();
          await page.getByTestId('probe-target-input').fill('api.openai.com');
          await page.getByTestId('probe-submit-btn').click();
          await expect(page.getByTestId('probe-result-card')).toBeVisible();
          await expect(page.getByTestId('probe-matched-rule')).not.toBeEmpty();

          await page.getByTestId('editor-panel-tab-preview').click();
          const cmContent = page.getByTestId('editor-preview-codemirror').locator('.cm-content');
          await expect(cmContent).toContainText('# Generated by Private Rules');

          await page.getByTestId('editor-panel-tab-versions').click();
          await expect(page.getByTestId('editor-versions-panel')).toBeVisible();
          await expect(page.getByTestId('version-item-v1')).toBeVisible();
          await expectNoHorizontalOverflow(page, `A7-${viewport.name}-inspect`);

          // Turn advanced mode off cleanly
          await advToggle.click();
          await expect(advToggle).toHaveAttribute('aria-checked', 'false');
        } finally {
          await page.request.delete(`/api/templates/${templateId}`, { headers: JSON_HEADERS }).catch(() => {});
        }
      });

      test('A8: pro tier -> 2 airports + low-rate trait pool + disable-quic module -> 2 provider prefixes, low-rate pool, no DIRECT in speed-test groups, QUIC rule present, no TUN', async ({
        page,
      }) => {
        test.setTimeout(90_000);
        await signInAdminApi(page);
        await clearAllTemplatesAndPublications(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await mockPreviewSubscription(page);

        try {
          await page.goto('/admin/templates/new');
          await expect(page.getByTestId('wizard-step-1')).toBeVisible();
          await ensureAppSelected(page, 'mac', 'clash-verge-rev');
          await page.getByTestId('wizard-next-btn').click();

          // Step 2: 2 airports
          await expect(page.getByTestId('wizard-step-2')).toBeVisible();
          await page.getByTestId('wizard-sub-name-0').fill('主力机场');
          await page.getByTestId('wizard-sub-input-0').fill('https://mock-airport.example/main');
          await page.getByTestId('wizard-sub-check-btn-0').click();
          await expect(page.getByTestId('wizard-sub-preview-ok-0')).toBeVisible();

          await page.getByTestId('wizard-sub-add-btn').click();
          await page.getByTestId('wizard-sub-name-1').fill('备用机场');
          await page.getByTestId('wizard-sub-input-1').fill('https://mock-airport.example/backup');
          await page.getByTestId('wizard-sub-check-btn-1').click();
          await expect(page.getByTestId('wizard-sub-preview-ok-1')).toBeVisible();
          await page.getByTestId('wizard-next-btn').click();

          // Step 3: Pro tier
          await expect(page.getByTestId('wizard-step-3')).toBeVisible();
          await page.getByTestId('wizard-tier-pro').click();
          await page.getByTestId('wizard-next-btn').click();

          // Step 4 & 5
          await expect(page.getByTestId('wizard-step-4')).toBeVisible();
          await page.getByTestId('wizard-next-btn').click();
          await expect(page.getByTestId('wizard-step-5')).toBeVisible();
          await page.getByTestId('wizard-next-btn').click();

          // Step 6: Ensure low-rate trait pool is enabled
          await expect(page.getByTestId('wizard-step-6')).toBeVisible();
          await expect(page.getByTestId('wizard-pool-traits-section')).toBeVisible();
          const lowRateCheckbox = page.getByTestId('wizard-pool-trait-toggle-pool-trait-low-rate');
          if (!(await lowRateCheckbox.isChecked())) {
            await lowRateCheckbox.check();
          }
          await expect(lowRateCheckbox).toBeChecked();
          await page.getByTestId('wizard-next-btn').click();

          // Step 7: Ensure disable-quic is enabled and tun-mode stays disabled
          await expect(page.getByTestId('wizard-step-7')).toBeVisible();
          const disableQuicSwitch = page.getByTestId('wizard-module-switch-disable-quic');
          if ((await disableQuicSwitch.getAttribute('aria-checked')) !== 'true') {
            await disableQuicSwitch.click();
          }
          await expect(disableQuicSwitch).toHaveAttribute('aria-checked', 'true');
          await expect(page.getByTestId('wizard-module-switch-tun-mode')).toHaveAttribute('aria-checked', 'false');
          await page.getByTestId('wizard-next-btn').click();

          // Step 8: Generate
          await expect(page.getByTestId('wizard-step-8')).toBeVisible();
          await page.getByTestId('wizard-name-input').fill(`A8 专业双机场 ${viewport.name}`);
          await page.getByTestId('wizard-generate-btn').click();

          await expect(page.getByTestId('wizard-done')).toBeVisible();
          await expectNoHorizontalOverflow(page, `A8-${viewport.name}-done`);

          const mihomoUrl = (await page.getByTestId('wizard-done-url-mihomo').innerText()).trim();
          const yamlRes = await page.request.get(mihomoUrl);
          expect(yamlRes.status()).toBe(200);
          const yamlText = await yamlRes.text();

          const doc = parseYaml(yamlText) as {
            tun?: unknown;
            'proxy-providers': Record<string, { override?: { 'additional-prefix'?: string } }>;
            'proxy-groups': Array<{ name: string; type: string; proxies?: string[]; filter?: string }>;
            rules: string[];
          };

          // 1. Two provider prefixes
          const prefixes = Object.values(doc['proxy-providers']).map((p) => p.override?.['additional-prefix']);
          expect(prefixes).toHaveLength(2);
          expect(prefixes).toContain('主力机场 · ');
          expect(prefixes).toContain('备用机场 · ');

          // 2. Low-rate trait pool present
          const lowRateGroup = doc['proxy-groups'].find((g) => g.name.includes('低倍率'));
          expect(lowRateGroup).toBeDefined();
          expect(lowRateGroup?.type).toBe('url-test');
          expect(lowRateGroup?.filter).toBeTruthy();

          // 3. Speed-test groups must never contain DIRECT
          const speedTestGroups = doc['proxy-groups'].filter(
            (g) => g.type === 'url-test' || g.type === 'fallback' || g.type === 'load-balance',
          );
          expect(speedTestGroups.length).toBeGreaterThan(0);
          for (const group of speedTestGroups) {
            expect(group.proxies ?? [], `speed-test group "${group.name}" must not contain DIRECT`).not.toContain(
              'DIRECT',
            );
          }

          // 4. QUIC rule present and its group points to REJECT
          expect(doc.rules).toContain('AND,((NETWORK,UDP),(DST-PORT,443)),🛑 禁用 QUIC');
          const quicGroup = doc['proxy-groups'].find((g) => g.name === '🛑 禁用 QUIC');
          expect(quicGroup?.proxies?.[0]).toBe('REJECT');

          // 5. TUN does not appear
          expect(doc.tun).toBeUndefined();
          expect(yamlText).not.toMatch(/^tun:/m);
        } finally {
          await clearAllTemplatesAndPublications(page);
        }
      });

      test('A9: reduced-motion eliminates lingering animations across key pages', async ({ page }) => {
        test.setTimeout(60_000);
        await signInAdminApi(page);

        const suffix = `${viewport.name}-${Date.now().toString(36)}`;
        const rsRes = await page.request.post('/api/rulesets', {
          data: { name: `A9-Motion-${suffix}`, tokenLinksEnabled: true, publicLinksEnabled: false },
          headers: JSON_HEADERS,
        });
        expect(rsRes.status()).toBe(201);
        const ruleset = ((await rsRes.json()) as { data: { categories: Array<{ id: string; name: string }> } }).data
          .categories[0];

        const qcRes = await page.request.post('/api/templates/quick-create', {
          data: {
            name: `A9 动效模板 ${suffix}`,
            complexity: 'simple',
            clients: ['mihomo'],
            scenarios: [
              { id: 'domestic-direct', enabled: true },
              { id: 'ad-block', enabled: true },
            ],
            rulesets: [],
            groupMode: 'auto',
          },
          headers: JSON_HEADERS,
        });
        expect(qcRes.status()).toBe(201);
        const templateId = ((await qcRes.json()) as { template: { id: string } }).template.id;

        try {
          await page.request.post('/api/auth/logout', { headers: JSON_HEADERS, data: {} });
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.setViewportSize({ width: viewport.width, height: viewport.height });

          // Login
          await page.goto('/admin/login');
          await expect(page.getByTestId('login-page')).toBeVisible();
          await expectReducedTokens(page);
          await expectNearZeroMotion(page.locator('.login-card'));
          await expectNearZeroMotion(page.getByTestId('login-submit'));

          await page.getByTestId('login-password-input').fill('e2e-password');
          await page.getByTestId('login-submit').click();
          await expect(page.getByTestId('dashboard-page')).toBeVisible();
          await expectNearZeroMotion(page.locator('[data-testid="app-main"] > .motion-page'));
          await expectNoHoverDisplacement(page.getByTestId('dashboard-manage-rulesets'));

          // Rules
          await navigateSection(page, viewport, '规则');
          await expect(page).toHaveURL(/\/admin\/rules$/);
          await expectNearZeroMotion(page.locator('[data-testid="app-main"] > .motion-page'));
          await expectNearZeroMotion(page.getByTestId(`ruleset-row-${ruleset.id}`));

          // Subscriptions
          await navigateSection(page, viewport, '订阅');
          await expect(page).toHaveURL(/\/admin\/subscriptions$/);
          await expectNearZeroMotion(page.locator('[data-testid="app-main"] > .motion-page'));
          await expectNoHoverDisplacement(page.getByTestId(`subscription-card-${ruleset.id}`));

          // Templates list & detail & wizard
          await navigateSection(page, viewport, '模板');
          await expect(page).toHaveURL(/\/admin\/templates$/);
          await expectNearZeroMotion(page.locator('[data-testid="app-main"] > .motion-page'));

          await page.goto(`/admin/templates/${templateId}`);
          await expect(page.getByTestId('template-detail-page')).toBeVisible();
          await expectNearZeroMotion(page.locator('[data-testid="app-main"] > .motion-page'));
          await expectNearZeroMotion(page.getByTestId('template-detail-tab-indicator'));

          await page.goto('/admin/templates/new');
          await expect(page.getByTestId('wizard-step-1')).toBeVisible();
          await expectNearZeroMotion(page.getByTestId('wizard-step-panel'));

          // Settings
          await navigateSection(page, viewport, '设置');
          await expect(page).toHaveURL(/\/admin\/settings$/);
          await expectNearZeroMotion(page.locator('[data-testid="app-main"] > .motion-page'));
          await expectNearZeroMotion(page.getByTestId('settings-tab-indicator'));
        } finally {
          await signInAdminApi(page);
          await clearAllTemplatesAndPublications(page);
          await page.request.delete(`/api/rulesets/${ruleset.id}`, { headers: JSON_HEADERS }).catch(() => {});
        }
      });
    });
  }
});
