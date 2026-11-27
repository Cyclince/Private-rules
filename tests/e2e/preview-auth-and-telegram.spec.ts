import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

function buildSignedTelegramInitData(suffix = '') {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `preview-tg-${Date.now()}${suffix}`,
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

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 834, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

test.describe('M2.3 /admin login, auth guard, theme/language persistence, and Telegram Mini App', () => {
  for (const viewport of VIEWPORTS) {
    test(`auth guard, wrong password, login success, and logout across ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/admin/rulesets');
      await expect(page).toHaveURL(/\/admin\/login/);
      await expect(page.getByTestId('login-page')).toBeVisible();

      const overflowLogin = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflowLogin).toBeLessThanOrEqual(0);

      // Wrong password shows localized error
      await page.getByTestId('login-password-input').fill('wrong-password');
      await page.getByTestId('login-submit').click();
      await expect(page.getByTestId('login-error')).toContainText('密码不正确');

      // Correct password signs in and redirects back to requested protected route
      await page.getByTestId('login-password-input').fill('e2e-password');
      await page.getByTestId('login-submit').click();
      await expect(page).toHaveURL(/\/admin\/rules/);
      await expect(page.getByTestId('app-topbar')).toBeVisible();

      // Logout clears session & Query cache and returns to /admin/login
      await page.getByTestId('logout-button').click();
      await expect(page).toHaveURL(/\/admin\/login/);

      // Re-visiting protected route immediately redirects to login (no stale Query cache)
      await page.goto('/admin');
      await expect(page).toHaveURL(/\/admin\/login/);
    });
  }

  test('displays live lockout countdown on 429 LOGIN_LOCKED and preserves it across reload', async ({ page }) => {
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: '登录失败次数过多，请 15 分钟后再试。', code: 'LOGIN_LOCKED' }),
      });
    });

    await page.goto('/admin/login');
    await page.getByTestId('login-password-input').fill('wrong-again');
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('login-lockout-alert')).toBeVisible();
    await expect(page.getByTestId('login-lockout-countdown')).toHaveText(/^(?:14:5\d|15:00)$/);
    await expect(page.getByTestId('login-submit')).toBeDisabled();

    // Countdown survives reload via sessionStorage
    await page.reload();
    await expect(page.getByTestId('login-lockout-alert')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeDisabled();
  });

  test('switches language on login page, removes theme/locale buttons from topbar, and switches system/light/dark theme and zh-CN/zh-TW/en locales in Settings with zero flash on reload', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/admin/login');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Login page retains small locale toggle and omits theme toggle
    await expect(page.getByTestId('locale-toggle')).toBeVisible();
    await expect(page.getByTestId('theme-toggle')).toHaveCount(0);

    // Cycle language on login page: zh-CN -> zh-TW -> en -> zh-CN
    await page.getByTestId('locale-toggle').click();
    await expect(page.getByTestId('login-submit')).toHaveText('登入');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');

    await page.getByTestId('locale-toggle').click();
    await expect(page.getByTestId('login-submit')).toHaveText('Sign In');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.getByTestId('locale-toggle').click();
    await expect(page.getByTestId('login-submit')).toHaveText('登录');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

    // Sign in and verify topbar only keeps title, session badge, and logout (no locale/theme buttons)
    await page.getByTestId('login-password-input').fill('e2e-password');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('app-topbar')).toBeVisible();
    await expect(page.getByTestId('app-topbar').getByTestId('locale-toggle')).toHaveCount(0);
    await expect(page.getByTestId('app-topbar').getByTestId('theme-toggle')).toHaveCount(0);
    await expect(page.getByTestId('session-status-badge')).toBeVisible();
    await expect(page.getByTestId('logout-button')).toBeVisible();

    // Open Settings -> General: Appearance & Language card is at the top
    await page.goto('/admin/settings');
    const appearanceCard = page.getByTestId('settings-appearance-card');
    await expect(appearanceCard).toBeVisible();
    await expect(appearanceCard).toContainText('外观与语言');

    // Default theme preference is 'system' and follows OS color scheme live
    await expect(page.getByTestId('settings-theme-system')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Explicit theme selection: light -> dark -> light
    await page.getByTestId('settings-theme-light').click();
    await expect(page.getByTestId('settings-theme-light')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveClass(/light/);
    expect(await page.evaluate(() => localStorage.getItem('private-rules-theme'))).toBe('light');

    await page.getByTestId('settings-theme-dark').click();
    await expect(page.getByTestId('settings-theme-dark')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('private-rules-theme'))).toBe('dark');

    await page.getByTestId('settings-theme-light').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Language 3-way switch in Settings: zh-CN -> zh-TW -> en
    await page.getByTestId('settings-locale-zh-TW').click();
    await expect(page.getByTestId('settings-locale-zh-TW')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
    await expect(appearanceCard).toContainText('外觀與語言');

    await page.getByTestId('settings-locale-en').click();
    await expect(page.getByTestId('settings-locale-en')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(appearanceCard).toContainText('Appearance & Language');
    expect(await page.evaluate(() => localStorage.getItem('private-rules-locale'))).toBe('en');

    // Reload: inline script sets data-theme="light" and lang="en" immediately before hydration
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveClass(/light/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('settings-theme-light')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('settings-locale-en')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('settings-appearance-card')).toContainText('Appearance & Language');
  });

  test('Telegram Mini App authenticates initData, maps themeParams while keeping Miku cyan --primary, and hides/blocks high-risk settings', async ({
    page,
  }) => {
    const initData = buildSignedTelegramInitData('-m23');
    await page.addInitScript((value) => {
      (window as Window & { Telegram?: unknown }).Telegram = {
        WebApp: {
          initData: value,
          colorScheme: 'dark',
          themeParams: {
            bg_color: '#111822',
            secondary_bg_color: '#1a2430',
            text_color: '#eef6f8',
            hint_color: '#8fa9b0',
            button_color: '#ff0000',
          },
          ready() {},
          expand() {},
        },
      };
    }, initData);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin');

    // Automatically authenticated into AppShell (never stuck on login page)
    await expect(page).not.toHaveURL(/\/admin\/login/);
    await expect(page.getByTestId('app-topbar')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-telegram', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Verify themeParams mapped while --primary remains Miku cyan (#39c5bb)
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        bg: style.getPropertyValue('--bg').trim().toLowerCase(),
        surface: style.getPropertyValue('--surface').trim().toLowerCase(),
        text: style.getPropertyValue('--text').trim().toLowerCase(),
        primary: style.getPropertyValue('--primary').trim().toLowerCase(),
      };
    });
    expect(tokens.bg).toBe('#111822');
    expect(tokens.surface).toBe('#1a2430');
    expect(tokens.text).toBe('#eef6f8');
    expect(tokens.primary).toBe('#39c5bb');

    // High-risk settings (API Key, Backup) hidden in UI and blocked by route guard; theme follows Telegram
    await page.goto('/admin/settings');
    await expect(page.getByTestId('settings-tab-general')).toBeVisible();
    await expect(page.getByTestId('settings-tab-about')).toBeVisible();
    await expect(page.getByTestId('settings-tab-api-keys')).toHaveCount(0);
    await expect(page.getByTestId('settings-theme-telegram-note')).toBeVisible();
    await expect(page.getByTestId('settings-theme-group')).toHaveCount(0);
    await expect(page.getByTestId('settings-locale-group')).toBeVisible();
    await expect(page.getByTestId('settings-tab-backup')).toHaveCount(0);
    await expect(page.getByTestId('telegram-restricted-notice')).toBeVisible();

    await page.goto('/admin/settings?tab=api-keys');
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(page.getByTestId('settings-tab-api-keys')).toHaveCount(0);

    await page.goto('/admin/settings?tab=backup');
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(page.getByTestId('settings-tab-backup')).toHaveCount(0);
  });
});
