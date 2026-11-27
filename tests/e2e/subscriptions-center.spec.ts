import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { E2E_ORIGIN } from '../helpers/e2e-env';

const ORIGIN = E2E_ORIGIN;
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
    query_id: `e2e-m1a-${userId}-${Date.now()}-${suffix}`,
    user: JSON.stringify({ id: userId, first_name: 'M1aMiniApp', username: `m1a_${userId}` }),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function copiedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as Window & { __copiedTexts?: string[] }).__copiedTexts ?? []);
}

async function openAdvancedFormats(page: Page) {
  const details = page.getByTestId('subscription-other-formats');
  const open = await details.evaluate((element) => (element as HTMLDetailsElement).open);
  if (!open) await details.locator(':scope > summary').click();
  await expect(page.getByTestId('subscription-format-groups')).toBeVisible();
}

async function installClipboardSpy(page: Page, shouldFail = false) {
  await page.addInitScript((fail) => {
    const win = window as Window & { __copiedTexts?: string[] };
    win.__copiedTexts = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (fail) throw new Error('Clipboard blocked');
          win.__copiedTexts?.push(text);
        },
        readText: async () => win.__copiedTexts?.at(-1) ?? '',
      },
    });
  }, shouldFail);
}

test.describe('M1a Navigation, Routing, and Subscription Center', () => {
  test('A1 订阅路径: login -> 订阅 -> 选规则 -> 选软件 Clash Verge Rev -> 复制该软件链接 -> 其他格式（高级）仍可复制 mihomo 链接', async ({
    page,
  }) => {
    await installClipboardSpy(page, false);
    await signInAdmin(page);

    const suffix = Date.now().toString(36);
    const ruleName = `A1-Rule-${suffix}`;
    const createRes = await page.request.post('/api/rulesets', {
      data: { name: ruleName, tokenLinksEnabled: true, publicLinksEnabled: false },
      headers: JSON_HEADERS,
    });
    expect(createRes.status()).toBe(201);
    const createdPayload = (await createRes.json()) as {
      data: { categories: Array<{ id: string; name: string }> };
    };
    const seeded = createdPayload.data.categories.find((c) => c.name === ruleName)!;

    try {
      await page.request.post(`/api/rulesets/${seeded.id}/rules`, {
        data: { value: 'openai.com', type: 'DOMAIN-SUFFIX' },
        headers: JSON_HEADERS,
      });

      const summaryRes = await page.request.get('/api/rulesets?summary=1');
      expect(summaryRes.status()).toBe(200);
      const summary = (await summaryRes.json()) as {
        links: Record<string, Array<{ id: string; recommendedUrl: string }>>;
      };
      const ruleLinks = summary.links[seeded.id] ?? [];
      const expectedClashVergeUrl = ruleLinks.find((link) => link.id === 'clash-verge')?.recommendedUrl;
      const expectedMihomoUrl = ruleLinks.find((link) => link.id === 'mihomo')?.recommendedUrl;
      expect(expectedClashVergeUrl).toBeTruthy();
      expect(expectedMihomoUrl).toBeTruthy();

      // Start from login screen to exercise the full A1 journey
      await page.request.post('/api/auth/logout', { headers: JSON_HEADERS, data: {} });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/admin/login');
      await page.getByTestId('login-password-input').fill('e2e-password');
      await page.getByTestId('login-submit').click();
      await expect(page.getByTestId('dashboard-page')).toBeVisible();

      // 订阅 -> subscription center now starts with "你的软件"
      await page.getByTestId('desktop-sidebar').getByRole('link', { name: '订阅' }).click();
      await expect(page).toHaveURL(/\/admin\/subscriptions\/?$/);
      await expect(page.getByTestId('subscriptions-page')).toContainText('订阅中心');
      await expect(page.getByTestId('subscriptions-page')).toContainText('选好你在用的软件，复制一条地址就能用');
      await expect(page.getByTestId('subscriptions-app-hint')).toContainText('先选你用的软件');

      // Pick Clash Verge Rev once; the list then offers a one-click copy per rule.
      await page.getByTestId('app-option-clash-verge-rev').click();
      await expect(page.getByTestId('subscriptions-app-hint')).toContainText('已记住 Clash Verge Rev');
      await expect(page.getByTestId(`subscription-policy-badge-${seeded.id}`)).toHaveText('私密');
      await expect(page.getByTestId(`subscription-card-${seeded.id}`)).toContainText('1 条启用规则');
      const quickCopy = page.getByTestId(`copy-subscription-quick-${seeded.id}`);
      await expect(quickCopy).toBeEnabled();
      await quickCopy.click();
      expect((await copiedTexts(page)).at(-1)).toBe(expectedClashVergeUrl);

      // Enter the rule detail: the remembered software drives the single recommended link.
      await page.getByTestId(`subscription-card-${seeded.id}`).click();
      await expect(page).toHaveURL(new RegExp(`/admin/subscriptions/${seeded.id}`));
      await expect(page.getByTestId('subscription-detail-title')).toHaveText(`${ruleName} 订阅`);
      await expect(page.getByTestId('subscription-access-banner')).toContainText('当前使用私密地址');
      await expect(page.getByTestId('subscription-app-selector-current')).toHaveText('Clash Verge Rev');
      await expect(page.getByTestId('subscription-app-link-url')).toHaveText(expectedClashVergeUrl!);

      await page.getByTestId('copy-subscription-link-app').click();
      expect((await copiedTexts(page)).at(-1)).toBe(expectedClashVergeUrl);

      // Step-by-step usage for that software.
      const howTo = page.getByTestId('subscription-app-howto');
      await expect(howTo).toContainText('在 Clash Verge Rev 里这样用');
      await expect(howTo.locator('li')).toHaveCount(3);

      // Own-config snippet stays available, in its own fold and with its own test ids.
      const ownConfig = page.getByTestId('subscription-own-config');
      await expect(ownConfig).toContainText('我会自己写配置');
      await ownConfig.locator('summary').first().click();
      const ownExample = page.getByTestId('subscription-own-example-yaml');
      await expect(ownExample).toBeVisible();
      await ownExample.locator('summary').click();
      await expect(page.getByTestId('subscription-own-example-client-yaml')).toBeVisible();
      await expect(page.getByTestId('subscription-own-example-code-yaml')).toContainText('behavior: classical');

      // Advanced "other formats" still exposes the classic mihomo YAML link.
      await openAdvancedFormats(page);
      const yamlToggle = page.getByTestId('subscription-group-toggle-yaml');
      await expect(yamlToggle).toContainText('Clash / mihomo 系');
      await yamlToggle.click();
      await expect(page.getByTestId('subscription-link-mihomo')).toBeVisible();
      await page.getByTestId('copy-subscription-link-mihomo').click();
      expect((await copiedTexts(page)).at(-1)).toBe(expectedMihomoUrl);

      // Disabled policy greys out the app link; public restores it.
      await page.getByTestId('subscription-access-select').selectOption('disabled');
      await expect(page.getByTestId('subscription-links-disabled')).toContainText('此规则当前未开放可用的订阅链接');
      await expect(page.getByTestId('subscription-access-banner')).toContainText('当前未开放订阅访问');
      await expect(page.getByTestId('subscription-app-link')).toHaveCount(0);

      await page.getByTestId('subscription-access-select').selectOption('public');
      await expect(page.getByTestId('subscription-access-banner')).toContainText('当前使用公开地址');
      await expect(page.getByTestId('subscription-app-link-url')).toContainText('/rules/');
      await openAdvancedFormats(page);

      await page.getByTestId('subscription-access-select').selectOption('token');
      await expect(page.getByTestId('subscription-access-banner')).toContainText('当前使用私密地址');

      // Return to the subscription center.
      await page.getByTestId('subscriptions-back-link').click();
      await expect(page).toHaveURL(/\/admin\/subscriptions\/?$/);
    } finally {
      await signInAdmin(page);
      await page.request.delete(`/api/rulesets/${seeded.id}`, { headers: JSON_HEADERS });
    }
  });

  test('switching to Shadowrocket shows the LIST link with 小火箭 usage steps and survives a reload', async ({
    page,
  }) => {
    await installClipboardSpy(page, false);
    await signInAdmin(page);

    const suffix = Date.now().toString(36);
    const ruleName = `R2-Shadowrocket-${suffix}`;
    const createRes = await page.request.post('/api/rulesets', {
      data: { name: ruleName, tokenLinksEnabled: true, publicLinksEnabled: true },
      headers: JSON_HEADERS,
    });
    expect(createRes.status()).toBe(201);
    const createdPayload = (await createRes.json()) as {
      data: { categories: Array<{ id: string; name: string }> };
    };
    const seeded = createdPayload.data.categories.find((c) => c.name === ruleName)!;

    try {
      const summaryRes = await page.request.get('/api/rulesets?summary=1');
      const summary = (await summaryRes.json()) as {
        links: Record<string, Array<{ id: string; recommendedUrl: string }>>;
      };
      const expectedShadowrocketUrl = summary.links[seeded.id]?.find(
        (link) => link.id === 'shadowrocket',
      )?.recommendedUrl;
      expect(expectedShadowrocketUrl).toBeTruthy();
      expect(expectedShadowrocketUrl).toContain('-shadowrocket.list');

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/admin/subscriptions/${seeded.id}`);
      await expect(page.getByTestId('subscription-app-card')).toBeVisible();

      // The picker opens by default with no remembered app; switch to the iPhone tab and pick Shadowrocket.
      await page.getByTestId('app-picker-platform-iphone').click();
      await page.getByTestId('app-option-shadowrocket').click();
      await expect(page.getByTestId('subscription-app-selector-current')).toHaveText('Shadowrocket');
      await expect(page.getByTestId('subscription-app-link-url')).toHaveText(expectedShadowrocketUrl!);

      await page.getByTestId('copy-subscription-link-app').click();
      expect((await copiedTexts(page)).at(-1)).toBe(expectedShadowrocketUrl);

      const howTo = page.getByTestId('subscription-app-howto');
      await expect(howTo).toContainText('在 Shadowrocket 里这样用');
      await expect(howTo.locator('li')).toHaveCount(3);
      await expect(howTo).toContainText('右上角');

      // The choice is remembered across a reload (same browser storage).
      await page.reload();
      await expect(page.getByTestId('subscription-app-selector-current')).toHaveText('Shadowrocket');
      await expect(page.getByTestId('subscription-app-link-url')).toHaveText(expectedShadowrocketUrl!);
      // It also drives the quick-copy button on the subscription center.
      await page.goto('/admin/subscriptions');
      await expect(page.getByTestId(`copy-subscription-quick-${seeded.id}`)).toBeEnabled();
    } finally {
      await signInAdmin(page);
      await page.request.delete(`/api/rulesets/${seeded.id}`, { headers: JSON_HEADERS });
    }
  });

  test('390px: subscription center and detail stay inside the viewport with an app selected', async ({ page }) => {
    await signInAdmin(page);
    const suffix = Date.now().toString(36);
    const ruleName = `R2-Mobile-${suffix}`;
    const createRes = await page.request.post('/api/rulesets', {
      data: { name: ruleName, tokenLinksEnabled: true, publicLinksEnabled: true },
      headers: JSON_HEADERS,
    });
    expect(createRes.status()).toBe(201);
    const createdPayload = (await createRes.json()) as {
      data: { categories: Array<{ id: string; name: string }> };
    };
    const seeded = createdPayload.data.categories.find((c) => c.name === ruleName)!;

    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/admin/subscriptions');
      await expect(page.getByTestId('subscriptions-page')).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.getByTestId('app-picker-platform-iphone').click();
      await page.getByTestId('app-option-shadowrocket').click();
      await expect(page.getByTestId(`copy-subscription-quick-${seeded.id}`)).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.goto(`/admin/subscriptions/${seeded.id}`);
      await expect(page.getByTestId('subscription-app-link')).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await openAdvancedFormats(page);
      await page.getByTestId('subscription-group-toggle-yaml').click();
      await expectNoHorizontalOverflow(page);
    } finally {
      await signInAdmin(page);
      await page.request.delete(`/api/rulesets/${seeded.id}`, { headers: JSON_HEADERS });
    }
  });

  test('clipboard failure selects URL text and shows manual-copy toast, and Telegram session shows read-only access policy', async ({
    page,
  }) => {
    await installClipboardSpy(page, true);
    await signInAdmin(page);

    const suffix = Date.now().toString(36);
    const createRes = await page.request.post('/api/rulesets', {
      data: { name: `Clip-${suffix}`, tokenLinksEnabled: false, publicLinksEnabled: true },
      headers: JSON_HEADERS,
    });
    expect(createRes.status()).toBe(201);
    const createdPayload = (await createRes.json()) as {
      data: { categories: Array<{ id: string; name: string }> };
    };
    const seeded = createdPayload.data.categories.find((c) => c.name === `Clip-${suffix}`)!;

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/admin/subscriptions/${seeded.id}`);
      await openAdvancedFormats(page);
      await page.getByTestId('subscription-group-toggle-yaml').click();
      await page.getByTestId('copy-subscription-link-mihomo').click();

      await expect(page.getByTestId('toast-viewport')).toContainText('复制失败，请手动复制');
      const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
      const renderedUrl = (await page.getByTestId('subscription-link-url-mihomo').textContent())?.trim() ?? '';
      expect(selectedText).toBe(renderedUrl);

      // Switch to Telegram session -> policy is read-only
      await page.request.post('/api/auth/logout', { headers: JSON_HEADERS, data: {} });
      const tgLogin = await page.request.post('/api/telegram/session', {
        data: { initData: buildSignedInitData(2001, 'subs') },
        headers: JSON_HEADERS,
      });
      expect(tgLogin.status()).toBe(201);

      await page.goto(`/admin/subscriptions/${seeded.id}`);
      await expect(page.getByTestId('subscription-access-select')).toHaveCount(0);
      await expect(page.getByTestId('subscription-access-readonly')).toHaveText('公开访问');
    } finally {
      await signInAdmin(page);
      await page.request.delete(`/api/rulesets/${seeded.id}`, { headers: JSON_HEADERS });
    }
  });

  test('390px mobile bottom nav renders all 5 items and template SectionSubNav has 模板/策略组 with old routes redirecting', async ({
    page,
  }) => {
    await signInAdmin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/subscriptions');

    const bottomNav = page.getByTestId('mobile-bottom-nav');
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav.getByRole('link')).toHaveCount(5);
    for (const label of ['概览', '规则', '订阅', '模板', '设置']) {
      await expect(bottomNav.getByRole('link', { name: label })).toBeVisible();
    }

    // Check /rulesets redirect preserves search params
    await page.goto('/admin/rulesets?q=demo&tab=sources');
    await expect(page).toHaveURL(/\/admin\/rules\?q=demo&tab=sources/);

    // Check /admin/templates secondary policy group entry -> 2-tab SectionSubNav (模板 / 策略组)
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin/templates');
    await expect(page.getByTestId('templates-groups-btn')).toHaveText('策略组');
    await page.getByTestId('templates-groups-btn').click();
    await expect(page).toHaveURL(/\/admin\/templates\/groups/);

    const subnav = page.getByTestId('section-subnav-templates');
    await expect(subnav).toBeVisible();
    await expect(subnav.getByRole('link')).toHaveCount(2);
    await expect(subnav.getByTestId('subnav-templates')).toHaveText('模板');
    await expect(subnav.getByTestId('subnav-groups')).toHaveText('策略组');

    await subnav.getByTestId('subnav-templates').click();
    await expect(page).toHaveURL(/\/admin\/templates$/);

    // Check old routes redirect cleanly
    await page.goto('/admin/cards');
    await expect(page).toHaveURL(/\/admin\/templates\/groups/);
    await page.goto('/admin/catalog');
    await expect(page).toHaveURL(/\/admin\/templates\/groups/);
    // Old /templates/scenes route redirects to the renamed policy-group library and keeps its search params
    await page.goto('/admin/templates/scenes?q=ai&origin=builtin');
    await expect(page).toHaveURL(/\/admin\/templates\/groups\?q=ai&origin=builtin/);
    await expect(page.getByTestId('cards-page')).toBeVisible();
    await page.goto('/admin/publications');
    await expect(page).toHaveURL(/\/admin\/templates$/);
  });
});
