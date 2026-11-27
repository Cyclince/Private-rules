import { expect, test, type Page } from '@playwright/test';
import { E2E_ORIGIN } from '../helpers/e2e-env';

async function signInPreview(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { password: 'e2e-password' },
    headers: { origin: E2E_ORIGIN, 'content-type': 'application/json' },
  });
  expect(res.status()).toBe(200);
}

test.describe('M2.2 /admin 3-viewport layout, URL search state, and query deduplication', () => {
  test('desktop (1280x800): fixed sidebar + topbar, no overlap, no horizontal overflow, single /api/auth/me request', async ({
    page,
  }) => {
    await signInPreview(page);
    let authMeCount = 0;
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/auth/me') authMeCount += 1;
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin');
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('sidebar-section-rules')).toContainText('分流规则');
    await expect(page.getByTestId('sidebar-section-templates')).toContainText('配置模板');
    await expect(page.getByTestId('desktop-sidebar').getByRole('navigation').getByRole('link')).toHaveCount(5);
    await expect(page.getByTestId('app-topbar')).toBeVisible();
    await expect(page.getByTestId('app-topbar').getByTestId('locale-toggle')).toHaveCount(0);
    await expect(page.getByTestId('app-topbar').getByTestId('theme-toggle')).toHaveCount(0);
    await expect(page.getByTestId('session-status-badge')).toBeVisible();
    await expect(page.getByTestId('logout-button')).toBeVisible();
    await expect(page.getByTestId('mobile-bottom-nav')).toBeHidden();
    await expect(page.getByTestId('tablet-sidebar-toggle')).toBeHidden();

    const sidebarBox = await page.getByTestId('desktop-sidebar').boundingBox();
    const mainBox = await page.getByTestId('app-main').boundingBox();
    expect(sidebarBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    expect(sidebarBox!.width).toBeGreaterThanOrEqual(220);
    expect(mainBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width - 1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Wait briefly to confirm auth guard + Topbar + DashboardPage share one deduplicated /api/auth/me fetch
    await page.waitForTimeout(300);
    expect(authMeCount).toBe(1);
  });

  test('tablet (834x1024): collapsible sidebar toggles cleanly with no overflow', async ({ page }) => {
    await signInPreview(page);
    await page.setViewportSize({ width: 834, height: 1024 });
    await page.goto('/admin');

    await expect(page.getByTestId('desktop-sidebar')).toBeHidden();
    await expect(page.getByTestId('mobile-bottom-nav')).toBeHidden();
    await expect(page.getByTestId('tablet-sidebar-toggle')).toBeVisible();

    await page.getByTestId('tablet-sidebar-toggle').click();
    const drawer = page.getByTestId('tablet-sidebar-drawer');
    await expect(drawer).toBeVisible();
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.x).toBeGreaterThanOrEqual(0);
    expect(drawerBox!.x + drawerBox!.width).toBeLessThanOrEqual(834);

    // Navigate via drawer to /admin/settings and verify drawer auto-closes
    await drawer.getByRole('link', { name: '设置' }).click();
    await expect(page).toHaveURL(/\/admin\/settings/);
    await expect(drawer).toBeHidden();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('mobile (390x844): 5-tab bottom nav, zero horizontal overflow, and URL search params survive reload', async ({
    page,
  }) => {
    await signInPreview(page);
    await page.setViewportSize({ width: 390, height: 844 });

    // Seed a real ruleset before initial page load so QueryClient's first summary fetch includes it
    const seededName = `AI Mobile ${Date.now().toString(36)}`;
    const created = await page.request.post('/api/rulesets', {
      data: { name: seededName, tokenLinksEnabled: true, publicLinksEnabled: false },
      headers: { origin: E2E_ORIGIN, 'content-type': 'application/json' },
    });
    expect(created.status()).toBe(201);
    const createdPayload = (await created.json()) as { data: { categories: Array<{ id: string; name: string }> } };
    const seeded = createdPayload.data.categories.find((item) => item.name === seededName)!;

    try {
      await page.goto('/admin');

      await expect(page.getByTestId('desktop-sidebar')).toBeHidden();
      await expect(page.getByTestId('tablet-sidebar-toggle')).toBeHidden();
      await expect(page.getByTestId('app-topbar').getByTestId('locale-toggle')).toHaveCount(0);
      await expect(page.getByTestId('app-topbar').getByTestId('theme-toggle')).toHaveCount(0);
      await expect(page.getByTestId('session-status-badge')).toBeVisible();
      await expect(page.getByTestId('logout-button')).toBeVisible();
      const bottomNav = page.getByTestId('mobile-bottom-nav');
      await expect(bottomNav).toBeVisible();
      await expect(bottomNav.getByRole('link')).toHaveCount(5);
      for (const label of ['概览', '规则', '订阅', '模板', '设置']) {
        await expect(bottomNav.getByRole('link', { name: label })).toBeVisible();
      }

      const navBox = await bottomNav.boundingBox();
      expect(navBox).not.toBeNull();
      expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(845);
      expect(navBox!.width).toBeLessThanOrEqual(390);

      // Navigate to rules, set search filter, reload and verify URL param persistence, then open detail
      await bottomNav.getByRole('link', { name: '规则' }).click();
      await expect(page).toHaveURL(/\/admin\/rules$/);
      await page.getByTestId('all-rules-search-input').fill('AI');
      await expect(page).toHaveURL(/q=AI/);

      await page.reload();
      await expect(page.getByTestId('all-rules-search-input')).toHaveValue('AI');

      await page.getByTestId(`ruleset-item-${seeded.id}`).click();
      await expect(page).toHaveURL(new RegExp(`/admin/rules/${seeded.id}$`));
      await expect(page.getByTestId('rule-detail-title')).toHaveText(seededName);

      await page.reload();
      await expect(page.getByTestId('rule-detail-title')).toHaveText(seededName);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await page.request.delete(`/api/rulesets/${seeded.id}`, {
        headers: { origin: E2E_ORIGIN, 'content-type': 'application/json' },
      });
    }
  });
});
