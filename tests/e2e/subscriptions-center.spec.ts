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
  test('A1 订阅路径: login -> 订阅 -> rule detail -> expand Mihomo -> copy exact summary mihomo link -> disable & restore policy', async ({
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
      const expectedMihomoUrl = summary.links[seeded.id]?.find((l) => l.id === 'mihomo')?.recommendedUrl;
      expect(expectedMihomoUrl).toBeTruthy();

      // Start from login screen to exercise full A1 journey
      await page.request.post('/api/auth/logout', { headers: JSON_HEADERS, data: {} });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/admin/login');
      await page.getByTestId('login-password-input').fill('e2e-password');
      await page.getByTestId('login-submit').click();
      await expect(page.getByTestId('dashboard-page')).toBeVisible();

      // Click "订阅" in desktop sidebar
      await page.getByTestId('desktop-sidebar').getByRole('link', { name: '订阅' }).click();
      await expect(page).toHaveURL(/\/admin\/subscriptions\/?$/);
      await expect(page.getByTestId('subscriptions-page')).toContainText('订阅中心');
      await expect(page.getByTestId('subscriptions-page')).toContainText(
        '选择规则与文件格式，每种格式对应一个通用地址',
      );
      await expect(page.getByTestId(`subscription-policy-badge-${seeded.id}`)).toHaveText('私密');
      await expect(page.getByTestId(`subscription-card-${seeded.id}`)).toContainText('1 条启用规则');

      // Enter rule detail
      await page.getByTestId(`subscription-card-${seeded.id}`).click();
      await expect(page).toHaveURL(new RegExp(`/admin/subscriptions/${seeded.id}`));
      await expect(page.getByTestId('subscription-detail-title')).toHaveText(`${ruleName} 订阅`);
      await expect(page.getByTestId('subscription-access-banner')).toContainText('当前使用私密地址');

      // Expand Mihomo family and copy mihomo link
      const yamlToggle = page.getByTestId('subscription-group-toggle-yaml');
      await expect(yamlToggle).toContainText('Mihomo 系列 · YAML');
      await yamlToggle.click();
      await expect(page.getByTestId('subscription-link-mihomo')).toBeVisible();
      await page.getByTestId('copy-subscription-link-mihomo').click();

      const copied = await page.evaluate(() => (window as Window & { __copiedTexts?: string[] }).__copiedTexts ?? []);
      expect(copied.at(-1)).toBe(expectedMihomoUrl);

      // Switch policy to disabled -> verify disabled notice
      await page.getByTestId('subscription-access-select').selectOption('disabled');
      await expect(page.getByTestId('subscription-links-disabled')).toContainText('此规则当前未开放可用的订阅链接');
      await expect(page.getByTestId('subscription-access-banner')).toContainText('当前未开放订阅访问');

      // Switch back to public -> verify links return with public banner
      await page.getByTestId('subscription-access-select').selectOption('public');
      await expect(page.getByTestId('subscription-access-banner')).toContainText('当前使用公开地址');
      await expect(page.getByTestId('subscription-format-groups')).toBeVisible();

      // Switch back to token
      await page.getByTestId('subscription-access-select').selectOption('token');
      await expect(page.getByTestId('subscription-access-banner')).toContainText('当前使用私密地址');

      // Return to subscription center
      await page.getByTestId('subscriptions-back-link').click();
      await expect(page).toHaveURL(/\/admin\/subscriptions\/?$/);
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

  test('390px mobile bottom nav renders all 5 items and template SectionSubNav reaches 场景库/规则目录/发布', async ({
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

    // Check templates SectionSubNav links on desktop & mobile
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin/templates');
    const subnav = page.getByTestId('section-subnav-templates');
    await expect(subnav).toBeVisible();
    await expect(subnav.getByTestId('subnav-templates')).toHaveText('模板');
    await expect(subnav.getByTestId('subnav-cards')).toHaveText('场景库');
    await expect(subnav.getByTestId('subnav-catalog')).toHaveText('规则目录');
    await expect(subnav.getByTestId('subnav-publications')).toHaveText('发布');

    await subnav.getByTestId('subnav-cards').click();
    await expect(page).toHaveURL(/\/admin\/cards/);
    await page.getByTestId('subnav-catalog').click();
    await expect(page).toHaveURL(/\/admin\/catalog/);
    await page.getByTestId('subnav-publications').click();
    await expect(page).toHaveURL(/\/admin\/publications/);
  });
});
