import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';

function telegramInitData() {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `e2e-${Date.now()}`,
    user: JSON.stringify({ id: 2001, first_name: 'Admin', username: 'admin' }),
  });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('123456:e2e-test-token').digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

test('admin login, session persistence, SPA refresh, and logout', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByPlaceholder('使用后台密码登录').fill('wrong-password');
  await page.getByRole('button', { name: '进入后台' }).click();
  await expect(page.getByText('密码不正确。')).toBeVisible();
  await page.getByPlaceholder('使用后台密码登录').fill('e2e-password');
  await page.getByRole('button', { name: '进入后台' }).click();
  await expect(page).toHaveURL(/\/admin\?view=dashboard$/);
  consoleErrors.length = 0;
  await page.reload();
  await expect(page.getByText('规则控制台').first()).toBeVisible();
  await page.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('button', { name: /退出登录/ }).click();
  await page.getByRole('button', { name: '确认退出' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(consoleErrors).toEqual([]);
});

test('unknown API is not served by the SPA fallback', async ({ request }) => {
  const response = await request.get('/api/does-not-exist');
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain('<html');
});

test('PWA install page and install metadata are available without authentication', async ({ page, request }) => {
  await page.goto('/pwa-install');
  await expect(page.getByRole('heading', { name: '把规则中心装进口袋' })).toBeVisible();
  await expect(page.getByRole('button', { name: /立即安装|查看安装方法/ })).toBeVisible();
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  await expect(manifest.json()).resolves.toMatchObject({ name: 'Private Rules', display: 'standalone', start_url: '/admin?source=pwa' });
  expect((await request.get('/sw.js')).status()).toBe(200);
  expect((await request.get('/pwa-icon-192.png')).status()).toBe(200);
  expect((await request.get('/apple-touch-icon.png')).status()).toBe(200);
});

test('private Telegram session, theme, deep links, and write access', async ({ page, request }) => {
  await request.post('/api/auth/login', { data: { password: 'e2e-password' } });
  const name = `Telegram-${Date.now()}`;
  const created = await request.post('/api/categories', { data: { name, tokenLinksEnabled: false, publicLinksEnabled: true } });
  expect(created.status()).toBe(201);
  const payload = await created.json() as { data: { categories: Array<{ id: string; name: string }> } };
  const category = payload.data.categories.find((item) => item.name === name)!;
  await request.post('/api/auth/logout');

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
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`/admin?view=sources&category=${category.id}`);
  await expect(page.getByRole('heading', { name: '上游来源' })).toBeVisible();
  expect(await page.locator('html').getAttribute('data-telegram')).toBe('true');
  expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
  await expect(page.getByRole('button', { name: /新增来源/ })).toBeVisible();
  const allowed = await page.evaluate(async () => (await fetch('/api/sync', { method: 'POST' })).status);
  expect(allowed).toBe(200);
  errors.length = 0;
  await page.goto('/admin?view=links&category=missing-category');
  await expect(page.getByRole('heading', { name: '订阅中心' })).toBeVisible();
  expect(errors).toEqual([]);
});
