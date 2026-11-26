import { expect, test, type Page } from '@playwright/test';

async function signInPreview(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { password: 'e2e-password' },
    headers: { origin: 'http://127.0.0.1:5180', 'content-type': 'application/json' },
  });
  expect(res.status()).toBe(200);
}

test.describe('M2.2 /preview 3-viewport layout, URL search state, and query deduplication', () => {
  test('desktop (1280x800): fixed sidebar + topbar, no overlap, no horizontal overflow, single /api/auth/me request', async ({
    page,
  }) => {
    await signInPreview(page);
    let authMeCount = 0;
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/auth/me') authMeCount += 1;
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/preview');
    await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
    await expect(page.getByTestId('app-topbar')).toBeVisible();
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
    await page.goto('/preview');

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

    // Navigate via drawer to /preview/settings and verify drawer auto-closes
    await drawer.getByRole('link', { name: '设置' }).click();
    await expect(page).toHaveURL(/\/preview\/settings/);
    await expect(drawer).toBeHidden();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('mobile (390x844): 4-tab bottom nav, zero horizontal overflow, and URL search params survive reload', async ({
    page,
  }) => {
    await signInPreview(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/preview');

    await expect(page.getByTestId('desktop-sidebar')).toBeHidden();
    await expect(page.getByTestId('tablet-sidebar-toggle')).toBeHidden();
    const bottomNav = page.getByTestId('mobile-bottom-nav');
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav.getByRole('link')).toHaveCount(4);

    const navBox = await bottomNav.boundingBox();
    expect(navBox).not.toBeNull();
    expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(845);
    expect(navBox!.width).toBeLessThanOrEqual(390);

    // Navigate to rulesets, set search filter + selection, reload and verify persistence
    await bottomNav.getByRole('link', { name: '规则集' }).click();
    await expect(page).toHaveURL(/\/preview\/rulesets/);
    await page.getByTestId('rulesets-search-input').fill('ai');
    await page.getByTestId('ruleset-item-ai').click();
    await expect(page).toHaveURL(/q=ai/);
    await expect(page).toHaveURL(/selected=ai/);

    await page.reload();
    await expect(page.getByTestId('rulesets-search-input')).toHaveValue('ai');
    await expect(page.getByTestId('rulesets-selected-value')).toHaveText('ai');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
