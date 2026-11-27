import { expect, test, type Locator, type Page } from '@playwright/test';
import { E2E_ORIGIN } from '../helpers/e2e-env';

const JSON_HEADERS = { origin: E2E_ORIGIN, 'content-type': 'application/json' };

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

test.describe('M3.5 reduced-motion accessibility across key routes and overlays', () => {
  test('prefers-reduced-motion: reduce eliminates lingering animations on login, shell, rules, dialogs, menus, and subscriptions', async ({
    page,
    request,
  }) => {
    // Seed a temporary ruleset + rule via isolated API request before UI login so SPA cache includes it
    const loginRes = await request.post('/api/auth/login', {
      data: { password: 'e2e-password' },
      headers: JSON_HEADERS,
    });
    expect(loginRes.status()).toBe(200);

    const name = `ReducedMotion-${Date.now().toString(36)}`;
    const createRes = await request.post('/api/rulesets', {
      data: { name, tokenLinksEnabled: true, publicLinksEnabled: false },
      headers: JSON_HEADERS,
    });
    expect(createRes.status()).toBe(201);
    const createdBody = (await createRes.json()) as { data: { categories: Array<{ id: string; name: string }> } };
    const ruleset = createdBody.data.categories.find((item) => item.name === name)!;

    const addRuleRes = await request.post(`/api/rulesets/${ruleset.id}/rules`, {
      data: { value: 'reduced-motion.example.com', type: 'DOMAIN-SUFFIX', enabled: true },
      headers: JSON_HEADERS,
    });
    expect(addRuleRes.status()).toBe(201);

    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1280, height: 800 });

      // 1. Login page
      await page.goto('/admin/login');
      await expect(page.getByTestId('login-page')).toBeVisible();
      await expectReducedTokens(page);
      await expectNearZeroMotion(page.locator('.login-card'));
      await expectNearZeroMotion(page.getByTestId('login-submit'));

      // Sign in through real UI -> verify no lingering arrival animations on shell & overview
      await page.getByTestId('login-password-input').fill('e2e-password');
      await page.getByTestId('login-submit').click();
      await expect(page).toHaveURL(/\/admin\/?$/);
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await expectNearZeroMotion(page.getByTestId('desktop-sidebar'));
      await expectNearZeroMotion(page.getByTestId('app-main'));
      await expectNearZeroMotion(page.locator('.motion-page'));

      // 2. Rules summary page + create rule dialog
      await page.getByTestId('desktop-sidebar').getByRole('link', { name: '规则' }).click();
      await expect(page).toHaveURL(/\/admin\/rules$/);
      await expectNearZeroMotion(page.locator('.motion-page'));
      await expectNearZeroMotion(page.getByTestId(`ruleset-item-${ruleset.id}`));

      await page.getByTestId('create-ruleset-btn').click();
      await expectNearZeroMotion(page.getByTestId('ruleset-form-dialog'));
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('ruleset-form-dialog')).toBeHidden();

      // 3. Rule detail page: row toggle, batch bar, dropdown menu
      await page.getByTestId(`ruleset-item-${ruleset.id}`).click();
      await expect(page).toHaveURL(new RegExp(`/admin/rules/${ruleset.id}$`));
      await expectNearZeroMotion(page.locator('.motion-page'));

      const firstRow = page.getByTestId('rules-list').locator('[data-testid^="rule-row-"]').first();
      const ruleId = (await firstRow.getAttribute('data-testid'))!.replace('rule-row-', '');
      await expectNearZeroMotion(firstRow);

      await page.getByTestId('manage-rules-toggle-btn').click();
      await expectNearZeroMotion(page.getByTestId('batch-action-bar'));
      await page.getByTestId('batch-exit-btn').click();
      await expect(page.getByTestId('batch-action-bar')).toBeHidden();

      await page.getByTestId(`rule-menu-${ruleId}`).click();
      await expectNearZeroMotion(page.getByRole('menu'));
      await page.keyboard.press('Escape');

      // 4. Subscriptions page transition
      await page.getByTestId('desktop-sidebar').getByRole('link', { name: '订阅' }).click();
      await expect(page).toHaveURL(/\/admin\/subscriptions$/);
      await expectNearZeroMotion(page.locator('.motion-page'));
    } finally {
      await request.delete(`/api/rulesets/${ruleset.id}`, { headers: JSON_HEADERS });
    }
  });
});
