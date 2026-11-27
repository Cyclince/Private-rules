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

async function signInAdmin(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { password: 'e2e-password' },
    headers: JSON_HEADERS,
  });
  expect(res.status()).toBe(200);
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

async function assertQrDialogWorks(page: Page, trigger: Locator, expectedUrl: string) {
  await trigger.click();
  const dialog = page.getByTestId('qr-code-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('qr-code-scan-hint')).toHaveText('用手机扫码导入');
  await expect(page.getByTestId('qr-code-url')).toHaveText(expectedUrl);

  const svgEl = page.getByTestId('qr-code-svg').locator('svg');
  await expect(svgEl).toBeVisible();
  const box = await svgEl.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(100);
  expect(box!.height).toBeGreaterThan(100);

  await page.getByTestId('qr-code-copy-btn').click();
  const copied = await page.evaluate(() => (window as Window & { __copiedTexts?: string[] }).__copiedTexts ?? []);
  expect(copied.at(-1)).toBe(expectedUrl);

  await page.getByTestId('qr-code-close-btn').click();
  await expect(dialog).toBeHidden();
}

test.describe('Q1 QR Code Dialog on Subscription Detail, Wizard Done, and Reduced Motion', () => {
  test('subscription detail QR buttons open local SVG dialog, copy link, and close cleanly', async ({ page }) => {
    await installClipboardSpy(page);
    await signInAdmin(page);

    const suffix = Date.now().toString(36);
    const ruleName = `QR-Sub-${suffix}`;
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
      const summaryRes = await page.request.get('/api/rulesets?summary=1');
      const summary = (await summaryRes.json()) as {
        links: Record<string, Array<{ id: string; recommendedUrl: string }>>;
      };
      const ruleLinks = summary.links[seeded.id] ?? [];
      const expectedClashVergeUrl = ruleLinks.find((link) => link.id === 'clash-verge')!.recommendedUrl;
      const expectedMihomoUrl = ruleLinks.find((link) => link.id === 'mihomo')!.recommendedUrl;

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/admin/subscriptions/${seeded.id}`);
      await page.getByTestId('app-picker-platform-mac').click();
      await page.getByTestId('app-option-clash-verge-rev').click();

      await assertQrDialogWorks(page, page.getByTestId('qr-subscription-link-app'), expectedClashVergeUrl);

      const otherFormats = page.getByTestId('subscription-other-formats');
      await otherFormats.locator(':scope > summary').click();
      await page.getByTestId('subscription-group-toggle-yaml').click();
      await assertQrDialogWorks(page, page.getByTestId('qr-subscription-link-mihomo'), expectedMihomoUrl);

      // Escape also closes the dialog
      await page.getByTestId('qr-subscription-link-app').click();
      await expect(page.getByTestId('qr-code-dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('qr-code-dialog')).toBeHidden();
    } finally {
      await page.request.delete(`/api/rulesets/${seeded.id}`, { headers: JSON_HEADERS });
    }
  });

  test('wizard done import cards expose QR buttons and respect prefers-reduced-motion: reduce', async ({ page }) => {
    test.setTimeout(60_000);
    await installClipboardSpy(page);
    await signInAdmin(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 800 });

    let createdTemplateId: string | null = null;
    try {
      await page.goto('/admin/templates/new');
      await expect(page.getByTestId('wizard-step-1')).toBeVisible();
      await page.getByTestId('app-picker-platform-mac').click();
      const vergeOption = page.getByTestId('app-option-clash-verge-rev');
      if ((await vergeOption.getAttribute('aria-selected')) !== 'true') {
        await vergeOption.click();
      }
      await page.getByTestId('app-picker-platform-iphone').click();
      const rocketOption = page.getByTestId('app-option-shadowrocket');
      if ((await rocketOption.getAttribute('aria-selected')) !== 'true') {
        await rocketOption.click();
      }
      await page.getByTestId('wizard-next-btn').click();

      await page.getByTestId('wizard-skip-sub').check();
      await page.getByTestId('wizard-next-btn').click();
      await page.getByTestId('wizard-next-btn').click();
      await page.getByTestId('wizard-next-btn').click();
      await page.getByTestId('wizard-name-input').fill(`QR-Wizard-${Date.now().toString(36)}`);
      await page.getByTestId('wizard-generate-btn').click();

      await expect(page.getByTestId('wizard-done')).toBeVisible();
      const viewHref = await page.getByTestId('wizard-done-view-btn').getAttribute('href');
      createdTemplateId = viewHref?.split('/').pop() ?? null;

      const mihomoUrl = (await page.getByTestId('wizard-done-url-mihomo').innerText()).trim();
      const rocketUrl = (await page.getByTestId('wizard-done-url-shadowrocket').innerText()).trim();

      await page.getByTestId('wizard-done-qr-mihomo').click();
      const dialog = page.getByTestId('qr-code-dialog');
      await expectNearZeroMotion(dialog);
      await expectNearZeroMotion(page.getByTestId('qr-code-close-btn'));
      await expectNearZeroMotion(page.getByTestId('qr-code-copy-btn'));
      await expect(page.getByTestId('qr-code-scan-hint')).toHaveText('用手机扫码导入');
      await expect(page.getByTestId('qr-code-url')).toHaveText(mihomoUrl);
      await expect(page.getByTestId('qr-code-svg').locator('svg')).toBeVisible();
      await page.getByTestId('qr-code-close-btn').click();
      await expect(dialog).toBeHidden();

      await assertQrDialogWorks(page, page.getByTestId('wizard-done-qr-shadowrocket'), rocketUrl);
    } finally {
      if (createdTemplateId) {
        const pubsRes = await page.request.get('/api/publications');
        if (pubsRes.ok()) {
          const pubsData = (await pubsRes.json()) as {
            publications: Array<{ id: string; templateId?: string }>;
          };
          for (const pub of pubsData.publications) {
            if (pub.templateId === createdTemplateId) {
              await page.request.delete(`/api/publications/${pub.id}`, { headers: JSON_HEADERS }).catch(() => {});
            }
          }
        }
        await page.request.delete(`/api/templates/${createdTemplateId}`, { headers: JSON_HEADERS }).catch(() => {});
      }
    }
  });
});
