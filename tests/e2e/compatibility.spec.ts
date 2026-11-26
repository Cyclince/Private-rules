import { expect, test, type Page } from '@playwright/test';

const CSRF_HEADERS = { origin: 'http://127.0.0.1:5180', 'content-type': 'application/json' };

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

for (const locale of ['zh-CN', 'zh-TW', 'en']) {
  test(`subscription groups, animation and separate Loon link (${locale})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const category = await createCategory(page);
    await page.addInitScript((locale) => localStorage.setItem('private-rules-locale', locale), locale);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin?view=links&category=${category.id}`);
    const groups = page.locator('.subscription-format-group');
    await expect(groups).toHaveCount(4);
    expect(await groups.locator('.subscription-format-content').evaluateAll((elements) => elements.every((element) => element.getAttribute('aria-hidden') === 'true' && element.hasAttribute('inert')))).toBe(true);
    const yaml = page.locator('[data-format-group="yaml"]');
    await expect(yaml.locator('.subscription-format-content')).toHaveCSS('grid-template-rows', '0px');
    await expect(yaml.locator('.subscription-format-content')).not.toHaveCSS('transition-duration', '0s');
    await yaml.getByRole('button').first().click();
    const ipTitle = locale === 'en' ? 'YAML · IP/Port' : locale === 'zh-TW' ? 'YAML · IP/連接埠' : 'YAML · IP/端口';
    await expect(yaml.getByRole('heading', { name: ipTitle, exact: true })).toBeVisible();
    const domainTitle = locale === 'en' ? 'YAML · Domain' : locale === 'zh-TW' ? 'YAML · 網域' : 'YAML · 域名';
    await expect(yaml.getByRole('heading', { name: domainTitle, exact: true })).toBeVisible();
    await expect(yaml.locator('code').filter({ hasText: '_Domain.yaml' })).toBeVisible();
    const list = page.locator('[data-format-group="list"]');
    await expect(yaml.locator('.subscription-format-content')).not.toHaveCSS('grid-template-rows', '0px');
    await yaml.getByRole('button').first().click();
    await expect(yaml.locator('.subscription-format-content')).toHaveCSS('grid-template-rows', '0px');
    await list.getByRole('button').first().click();
    await expect(list.getByText(locale === 'en' ? 'iOS family · LIST' : 'iOS 系列 · LIST', { exact: true })).toBeVisible();
    await expect(list.getByRole('heading', { name: 'Loon LIST', exact: true })).toBeVisible();
    await expect(list.getByRole('heading', { name: 'Quantumult X', exact: true })).toBeVisible();
    await expect(list.getByRole('checkbox')).toHaveCount(0);
    await expect(list.locator('.format-file-name')).toHaveText([/\.list$/, /-loon\.list$/, /-qx\.list$/]);
    if (locale === 'en') expect((await groups.allTextContents()).join(' ')).not.toMatch(/[\u3400-\u9fff]/u);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/subscriptions-${locale}.png`, fullPage: true });
    await page.request.delete(`/api/categories/${category.id}`, { headers: CSRF_HEADERS });
  });
}

for (const viewport of [{ width: 390, height: 667 }, { width: 667, height: 375 }, { width: 320, height: 480 }]) {
  test(`bulk import remains scrollable with reachable actions at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const category = await createCategory(page);
    await page.addInitScript(() => localStorage.setItem('private-rules-locale', 'zh-CN'));
    await page.setViewportSize(viewport);
    await page.goto(`/admin?view=rules&category=${category.id}`);
    await page.locator('.bulk-card textarea').fill(Array.from({ length: 100 }, (_, i) => `mobile-${i}.example.com`).join('\n'));
    await page.getByRole('button', { name: '预览规则', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '批量导入预览' });
    const confirm = dialog.getByRole('button', { name: '确认导入 100 条', exact: true });
    await expect(confirm).toBeInViewport({ ratio: 1 });
    const content = dialog.locator('.bulk-preview-content');
    expect(await content.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await content.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(dialog.getByText('mobile-99.example.com', { exact: true })).toBeInViewport();
    await expect(confirm).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `test-results/bulk-${viewport.width}x${viewport.height}.png` });
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    const result = await page.request.get('/api/categories');
    const payload = await result.json();
    expect(payload.data.categories.find((item: { id: string }) => item.id === category.id).ruleCount).toBe(100);
    await page.request.delete(`/api/categories/${category.id}`, { headers: CSRF_HEADERS });
  });
}
