import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:5180';
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' };
const BOT_TOKEN = '123456:e2e-test-token';

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 834, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const SAMPLE_ACL4SSR_INI = [
  '[custom]',
  'custom_proxy_group=🚀 节点选择`select`[]⚡ 自动选择`[]DIRECT`.*',
  'custom_proxy_group=⚡ 自动选择`url-test`.*`http://www.gstatic.com/generate_204`300,,50',
  'custom_proxy_group=🤖 OpenAI`select`[]🚀 节点选择`[]DIRECT',
  'ruleset=🎯 全球直连,[]GEOIP,LAN',
  'ruleset=🤖 OpenAI,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Ruleset/OpenAi.list',
  'ruleset=🎯 全球直连,[]GEOIP,CN',
  'ruleset=🚀 节点选择,[]FINAL',
  'unknown_directive=legacy_value',
].join('\n');

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
    query_id: `e2e-m44b-${userId}-${Date.now()}-${suffix}`,
    user: JSON.stringify({ id: userId, first_name: 'M44bMiniApp', username: `m44b_${userId}` }),
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

async function switchMobileStep(page: Page, width: number, step: 'catalog' | 'editor' | 'inspect') {
  if (width < 1024) {
    await page.getByTestId(`editor-step-${step}`).click();
  }
}

test.describe('M4.4b Template List & Visual Template Editor', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} (${viewport.width}x${viewport.height}): starter create -> keyboard drag reorder -> inspector lint -> hit probe -> preview -> save version -> rollback -> import wizard`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await signInAdmin(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const suffix = `${viewport.name}-${Date.now().toString(36)}`;
      const createdTemplateIds: string[] = [];

      try {
        // ============================================================
        // 1. TEMPLATES LIST: verify M2a list + create a light starter template via API and open editor
        // ============================================================
        await page.goto('/admin/templates');
        await expect(page.getByTestId('templates-page')).toBeVisible();
        await expect(page.getByTestId('templates-new-btn')).toBeVisible();
        await expect(page.getByTestId('templates-scenes-btn')).toBeVisible();
        await expect(page.getByTestId('templates-import-btn')).toBeVisible();
        await expectNoHorizontalOverflow(page);

        const createdStarterRes = await page.request.post('/api/templates', {
          data: {
            name: `Editor Light ${suffix}`,
            starterTier: 'light',
            groupMode: 'select',
            output: 'full',
          },
          headers: JSON_HEADERS,
        });
        expect(createdStarterRes.status()).toBe(201);
        const createdStarter = (await createdStarterRes.json()) as { template: { id: string } };
        const starterTemplateId = createdStarter.template.id;
        createdTemplateIds.push(starterTemplateId);

        await page.goto(`/admin/templates/${starterTemplateId}`);
        await expect(page.getByTestId('template-editor-page')).toBeVisible();
        await expect(page.getByTestId('editor-version-badge')).toHaveText('v1');
        await expectNoHorizontalOverflow(page);

        // ============================================================
        // 2. STRATIFIED KEYBOARD DRAG REORDER + CROSS-LAYER WARNING
        // ============================================================
        await switchMobileStep(page, viewport.width, 'editor');
        const domesticRow = page.getByTestId('template-card-row-domestic-direct');
        await expect(domesticRow).toBeVisible();
        const initialDomesticIdx = Number(await domesticRow.getAttribute('data-card-index'));

        // Keyboard drag: Space (grab) -> wait active -> ArrowUp (cross domestic -> earlier stage) -> Space (drop)
        const dragHandle = page.getByTestId('drag-handle-domestic-direct');
        await dragHandle.scrollIntoViewIfNeeded();
        await dragHandle.focus();
        await page.keyboard.press('Space');
        await expect(domesticRow).toHaveAttribute('data-dragging', 'true');
        await page.waitForTimeout(80);
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(80);
        await page.keyboard.press('Space');
        await expect(domesticRow).not.toHaveAttribute('data-dragging', 'true');

        await expect
          .poll(async () => Number(await domesticRow.getAttribute('data-card-index')))
          .toBeLessThan(initialDomesticIdx);

        // Cross-layer drag warning banner appears immediately
        await expect(page.getByTestId('editor-cross-stage-warning')).toBeVisible();
        await expect(page.getByTestId('editor-dirty-badge')).toBeVisible();

        // ============================================================
        // 3. INSPECTOR LINT (12-ITEM LIVE CHECKER)
        // ============================================================
        await switchMobileStep(page, viewport.width, 'inspect');
        await page.getByTestId('editor-panel-tab-lint').click();
        await expect(page.getByTestId('editor-lint-panel')).toBeVisible();
        await expect(page.getByTestId('lint-issue-stage-order-violation').first()).toBeVisible();
        await expectNoHorizontalOverflow(page);

        // ============================================================
        // 4. ENHANCEMENT MODULE CONFLICT BLOCKING
        // ============================================================
        await switchMobileStep(page, viewport.width, 'editor');
        await page.getByTestId('editor-center-tab-modules').click();
        await expect(page.getByTestId('editor-modules-tab')).toBeVisible();

        const dnsLeakSwitch = page.getByTestId('editor-module-switch-dns-leak-guard');
        const blockDohSwitch = page.getByTestId('editor-module-switch-block-encrypted-dns');
        await dnsLeakSwitch.click();
        await expect(dnsLeakSwitch).toHaveAttribute('aria-checked', 'true');

        // Attempting to enable mutually exclusive block-encrypted-dns must be blocked with reason
        await blockDohSwitch.click();
        await expect(blockDohSwitch).toHaveAttribute('aria-checked', 'false');
        await expect(page.getByTestId('editor-module-conflict-alert')).toBeVisible();

        // ============================================================
        // 5. HIT PROBE (domain -> matched rule, stage, policy chain, DNS hint)
        // ============================================================
        await switchMobileStep(page, viewport.width, 'inspect');
        await page.getByTestId('editor-panel-tab-probe').click();
        await expect(page.getByTestId('editor-probe-panel')).toBeVisible();
        await page.getByTestId('probe-target-input').fill('api.openai.com');
        await page.getByTestId('probe-submit-btn').click();

        await expect(page.getByTestId('probe-result-card')).toBeVisible();
        await expect(page.getByTestId('probe-matched-rule')).not.toBeEmpty();
        await expect(page.getByTestId('probe-matched-stage')).toBeVisible();
        await expect(page.getByTestId('probe-policy-chain')).toBeVisible();
        await expectNoHorizontalOverflow(page);

        // ============================================================
        // 6. MIHOMO PREVIEW (CodeMirror 6 read-only YAML highlight)
        // ============================================================
        await page.getByTestId('editor-panel-tab-preview').click();
        await expect(page.getByTestId('editor-preview-panel')).toBeVisible();
        const previewCm = page.getByTestId('editor-preview-codemirror');
        await expect(previewCm.locator('.cm-editor')).toBeVisible();
        const cmContent = previewCm.locator('.cm-content');
        await expect(cmContent).toHaveAttribute('data-language', 'yaml');
        await expect(cmContent).toHaveAttribute('aria-readonly', 'true');
        await expect(cmContent).toContainText('# Generated by Private Rules');
        await expect(cmContent).toContainText('dns:');
        // Switch preview output to minimal so proxy-groups appears in CodeMirror's initial virtual viewport
        await page.getByTestId('preview-output-minimal').click();
        await expect(cmContent).toContainText('proxy-groups:');
        await page.getByTestId('preview-output-full').click();

        // ============================================================
        // 7. WRITABLE CODEMIRROR PATCH + INDEXEDDB DRAFT AUTO-SAVE & RECOVERY (desktop)
        // ============================================================
        if (viewport.name === 'desktop') {
          await page.getByTestId('editor-center-tab-patches').click();
          const patchCm = page.getByTestId('editor-patch-codemirror');
          await expect(patchCm.locator('.cm-content')).toBeVisible();
          await patchCm.locator('.cm-content').click();
          await page.keyboard.type('ipv6: true');
          await expect(patchCm.locator('.cm-content')).toContainText('ipv6: true');

          await expect(page.getByTestId('editor-draft-saved-indicator')).toBeVisible();
          await page.reload();
          await expect(page.getByTestId('template-editor-page')).toBeVisible();
          await expect(page.getByTestId('editor-draft-recovery-banner')).toBeVisible();
          await page.getByTestId('editor-restore-draft-btn').click();
          await page.getByTestId('editor-center-tab-rules').click();
          await expect(page.getByTestId('editor-cross-stage-warning')).toBeVisible();
        }

        // ============================================================
        // 8. SAVE NEW VERSION (v2) -> COMPARE -> ROLLBACK TO v1 (v3)
        // ============================================================
        await page.getByTestId('editor-version-note-input').fill(`v2 reorder ${viewport.name}`);
        await page.getByTestId('editor-save-version-btn').click();
        await expect(page.getByTestId('editor-version-badge')).toHaveText('v2');

        await switchMobileStep(page, viewport.width, 'inspect');
        await page.getByTestId('editor-panel-tab-versions').click();
        await expect(page.getByTestId('editor-versions-panel')).toBeVisible();
        await expect(page.getByTestId('version-item-v2')).toBeVisible();
        await expect(page.getByTestId('version-item-v1')).toBeVisible();
        await expect(page.getByTestId('version-compare-section')).toBeVisible();
        await expect(page.getByTestId('version-diff-output')).toBeVisible();

        // Rollback to v1 -> creates v3 and clears cross-layer warning
        await page.getByTestId('version-restore-v1').click();
        await expect(page.getByTestId('editor-version-badge')).toHaveText('v3');
        await switchMobileStep(page, viewport.width, 'editor');
        await page.getByTestId('editor-center-tab-rules').click();
        await expect(page.getByTestId('editor-cross-stage-warning')).toBeHidden();

        // ============================================================
        // 9. IMPORT WIZARD (.ini -> Compatibility Report -> Confirm & Save)
        // ============================================================
        await page.goto('/admin/templates');
        await expect(page.getByTestId('templates-page')).toBeVisible();
        await page.getByTestId('templates-import-btn').click();
        await expect(page.getByTestId('import-template-dialog')).toBeVisible();

        await page.getByTestId('import-format-ini').click();
        await page.getByTestId('import-template-name').fill(`Imported ${suffix}`);
        await page.getByTestId('import-template-slug').fill(`imp-${suffix}`);
        await page.getByTestId('import-content-textarea').fill(SAMPLE_ACL4SSR_INI);
        await page.getByTestId('import-preview-btn').click();

        // Step 2: Compatibility Report must be visible before saving
        await expect(page.getByTestId('import-compatibility-report')).toBeVisible();
        await page.getByTestId('import-confirm-save-btn').click();

        await expect(page).toHaveURL(/\/admin\/templates\/[^/]+/);
        await expect(page.getByTestId('template-editor-page')).toBeVisible();
        await expect(page.getByTestId('editor-template-title')).toContainText(`Imported ${suffix}`);

        const importedId = new URL(page.url()).pathname.split('/').pop()!;
        createdTemplateIds.push(importedId);

        // ============================================================
        // 10. UPSTREAM REBASE PREVIEW + DUPLICATE ON LIST PAGE (desktop)
        // ============================================================
        if (viewport.name === 'desktop') {
          await page.getByTestId('editor-panel-tab-versions').click();
          await page.getByTestId('versions-subtab-rebase').click();
          await page.getByTestId('rebase-content-textarea').fill(SAMPLE_ACL4SSR_INI);
          await page.getByTestId('rebase-preview-btn').click();
          await expect(page.getByTestId('rebase-preview-result')).toBeVisible();
          await page.getByTestId('rebase-apply-btn').click();
          await expect(page.getByTestId('editor-version-badge')).toHaveText('v2');

          await page.goto('/admin/templates');
          await expect(page.getByTestId(`template-card-${importedId}`)).toBeVisible();
          const duplicatePromise = page.waitForResponse(
            (res) => res.url().includes('/api/templates') && res.request().method() === 'POST' && res.status() === 201,
          );
          await page.getByTestId(`template-duplicate-${importedId}`).click();
          const duplicateRes = await duplicatePromise;
          const duplicatedPayload = (await duplicateRes.json()) as { template: { id: string } };
          const duplicatedId = duplicatedPayload.template.id;
          expect(duplicatedId).not.toBe(importedId);
          createdTemplateIds.push(duplicatedId);

          const duplicatedCard = page.getByTestId(`template-card-${duplicatedId}`);
          await expect(duplicatedCard).toBeVisible();
          await expect(duplicatedCard).toContainText(`Imported ${suffix}`);

          // Delete duplicated template via confirm dialog
          await page.getByTestId(`template-delete-${duplicatedId}`).click();
          await page.getByTestId('delete-confirm-submit').click();
          await expect(duplicatedCard).toHaveCount(0);
        }
      } finally {
        for (const tid of createdTemplateIds) {
          await page.request.delete(`/api/templates/${tid}`, { headers: JSON_HEADERS }).catch(() => {});
        }
      }
    });
  }

  test('Telegram Mini App session is strictly read-only on /admin/templates and /admin/templates/$id', async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext({ baseURL: ORIGIN });
    const adminPage = await adminCtx.newPage();
    await signInAdmin(adminPage);

    const suffix = `tg-${Date.now().toString(36)}`;
    const createRes = await adminPage.request.post('/api/templates', {
      data: { name: `TG Readonly ${suffix}`, slug: `tg-${suffix}`, starterTier: 'minimal' },
      headers: JSON_HEADERS,
    });
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()) as { template: { id: string } };
    const templateId = created.template.id;

    const tgCtx = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 390, height: 844 } });
    const tgPage = await tgCtx.newPage();
    try {
      const initData = buildSignedInitData(2001, suffix);
      await tgPage.addInitScript((value) => {
        (window as Window & { Telegram?: unknown }).Telegram = {
          WebApp: {
            initData: value,
            colorScheme: 'dark',
            themeParams: {},
            ready() {},
            expand() {},
          },
        };
      }, initData);

      // List page is read-only
      await tgPage.goto('/admin/templates');
      await expect(tgPage.getByTestId('templates-page')).toBeVisible();
      await expect(tgPage.getByTestId('templates-telegram-readonly')).toBeVisible();
      await expect(tgPage.getByTestId('templates-new-btn')).toHaveCount(0);
      await expect(tgPage.getByTestId('templates-import-btn')).toHaveCount(0);
      await expectNoHorizontalOverflow(tgPage);

      // Editor page is read-only
      await tgPage.goto(`/admin/templates/${templateId}`);
      await expect(tgPage.getByTestId('template-editor-page')).toBeVisible();
      await expect(tgPage.getByTestId('templates-telegram-readonly')).toBeVisible();
      await expect(tgPage.getByTestId('editor-save-version-btn')).toHaveCount(0);
      await expect(tgPage.getByTestId('drag-handle-lan-direct')).toBeDisabled();
      await expectNoHorizontalOverflow(tgPage);
    } finally {
      await tgCtx.close();
      await adminPage.request.delete(`/api/templates/${templateId}`, { headers: JSON_HEADERS }).catch(() => {});
      await adminCtx.close();
    }
  });
});
