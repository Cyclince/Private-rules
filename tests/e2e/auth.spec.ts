import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

function telegramInitData() {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `e2e-${Date.now()}`,
    user: JSON.stringify({ id: 2001, first_name: 'Admin', username: 'admin' }),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('123456:e2e-test-token').digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

test('admin login, session persistence, SPA refresh, and logout', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/');
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByTestId('login-password-input').fill('wrong-password');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toContainText('密码不正确');

  await page.getByTestId('login-password-input').fill('e2e-password');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.getByTestId('dashboard-page')).toBeVisible();

  consoleErrors.length = 0;
  await page.reload();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();

  await page.getByTestId('logout-button').click();
  await expect(page).toHaveURL(/\/admin\/login/);
  expect(consoleErrors).toEqual([]);
});

test('unknown API is not served by the SPA fallback', async ({ request }) => {
  const response = await request.get('/api/does-not-exist');
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain('<html');
});

test('PWA install page and install metadata are available without authentication', async ({ page, request }) => {
  await page.goto('/pwa-install');
  await expect(page.getByTestId('pwa-install-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: '把规则中心装进口袋' })).toBeVisible();
  await expect(page.getByTestId('pwa-install-action')).toBeVisible();

  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  await expect(manifest.json()).resolves.toMatchObject({
    name: 'Private Rules',
    display: 'standalone',
    start_url: '/admin?source=pwa',
    theme_color: '#0b1418',
  });

  const swRes = await request.get('/sw.js');
  expect(swRes.status()).toBe(200);
  const swText = await swRes.text();
  expect(swText).toContain('private-rules-pwa-v4');
  expect(swText).toContain('api|rules|sub');

  expect((await request.get('/pwa-icon-192.png')).status()).toBe(200);
  expect((await request.get('/pwa-icon-512.png')).status()).toBe(200);
  const appleIcon = await request.get('/apple-touch-icon-1.1.0.png');
  expect(appleIcon.status()).toBe(200);
  expect(appleIcon.headers()['content-type']).toContain('image/png');
});

test('private Telegram session, theme, deep links, and write access', async ({ page, request }) => {
  const originHeaders = { origin: 'http://127.0.0.1:5180', 'content-type': 'application/json' };
  await request.post('/api/auth/login', { data: { password: 'e2e-password' }, headers: originHeaders });
  const name = `Telegram-${Date.now()}`;
  const created = await request.post('/api/categories', {
    data: { name, tokenLinksEnabled: false, publicLinksEnabled: true },
    headers: originHeaders,
  });
  expect(created.status()).toBe(201);
  const payload = (await created.json()) as { data: { categories: Array<{ id: string; name: string }> } };
  const category = payload.data.categories.find((item) => item.name === name)!;
  await request.post('/api/auth/logout', { headers: originHeaders, data: {} });

  try {
    const initData = telegramInitData();
    await page.addInitScript((value) => {
      (window as Window & { Telegram: unknown }).Telegram = {
        WebApp: {
          initData: value,
          colorScheme: 'dark',
          themeParams: { bg_color: '#101010', text_color: '#f5f5f5', secondary_bg_color: '#202020' },
          ready() {},
          expand() {},
        },
      };
    }, initData);

    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
    });

    await page.goto(`/admin?view=sources&category=${category.id}`);
    await expect(page).toHaveURL(new RegExp(`/admin/rules.*selected=${category.id}.*tab=sources`));
    await expect(page.getByTestId('sources-panel')).toBeVisible();
    expect(await page.locator('html').getAttribute('data-telegram')).toBe('true');
    expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
    await expect(page.getByTestId('add-source-btn')).toBeVisible();

    const allowed = await page.evaluate(
      async () =>
        (await fetch('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
          .status,
    );
    expect(allowed).toBe(200);

    errors.length = 0;
    await page.goto('/admin?view=links&category=missing-category');
    await expect(page).toHaveURL(/\/admin\/subscriptions\/missing-category/);
    await expect(page.getByTestId('subscription-not-found')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await request.post('/api/auth/login', { data: { password: 'e2e-password' }, headers: originHeaders });
    await request.delete(`/api/categories/${category.id}`, { headers: originHeaders });
  }
});
