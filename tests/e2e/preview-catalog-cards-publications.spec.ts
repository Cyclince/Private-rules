import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { E2E_ORIGIN } from '../helpers/e2e-env';

const ORIGIN = E2E_ORIGIN;
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' };
const BOT_TOKEN = '123456:e2e-test-token';

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 834, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

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
    query_id: `e2e-m44a-${userId}-${Date.now()}-${suffix}`,
    user: JSON.stringify({ id: userId, first_name: 'M44aMiniApp', username: `m44a_${userId}` }),
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

async function ensureAdvancedMode(page: Page, enabled: boolean) {
  const toggle = page.getByTestId('template-advanced-toggle');
  await expect(toggle).toBeVisible();
  const isChecked = (await toggle.getAttribute('aria-checked')) === 'true';
  if (isChecked !== enabled) {
    await toggle.click();
  }
}

test.describe('M2b Consolidated Scenes Library, Community Rules Picker, and Advanced Template Publications', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} (${viewport.width}x${viewport.height}): community rules browse/filter/detail in scenes, scene fork/edit/create/delete, advanced output create/bind/masked/public-disabled/preview/copy-link`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await installClipboardSpy(page);
      await signInAdmin(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      const suffix = `${viewport.name}-${Date.now().toString(36)}`;
      const pubSlug = `e2e-pub-${suffix}`;
      const secretTokenA = `RAW_SECRET_TOKEN_A_${suffix}`;
      const secretTokenB = `RAW_SECRET_TOKEN_B_${suffix}`;
      const secretUrlA = `https://secret-airport.example.test/sub?token=${secretTokenA}`;
      const secretUrlB = `https://backup-airport.example.test/link?key=${secretTokenB}`;

      let templateId: string | null = null;
      let publicationId: string | null = null;
      const createdCardIds: string[] = [];

      try {
        // Seed a template with 2 versions so pinnedVersion selector has choices
        const tplRes = await page.request.post('/api/templates', {
          data: { name: `M44a Tpl ${suffix}`, slug: `tpl-${suffix}`, starterTier: 'standard' },
          headers: JSON_HEADERS,
        });
        expect(tplRes.status()).toBe(201);
        const tplPayload = (await tplRes.json()) as {
          template: { id: string };
          resolvedBody: { slots: Array<{ id: string }> };
        };
        templateId = tplPayload.template.id;
        const slotId = tplPayload.resolvedBody.slots[0]?.id ?? 'slot-main';

        // ============================================================
        // 1. POLICY GROUPS (/admin/templates/groups): community rules browser + detail drawer inside the editor
        // ============================================================
        await page.goto('/admin/templates/groups');
        await expect(page.getByTestId('cards-page')).toBeVisible();
        await expect(page.getByTestId('cards-list')).toBeVisible();
        // Policy groups are listed by category section with an icon in the heading (r2 §4.2).
        await expect(page.getByTestId('policy-group-section-base')).toBeVisible();
        await expect(page.getByTestId('policy-group-section-ai')).toContainText('AI');
        await expect(page.getByTestId('policy-group-section-privacy')).toBeVisible();
        await expectNoHorizontalOverflow(page);

        // Open New Scene dialog -> browse community rules (replaces standalone /catalog page)
        await page.getByTestId('cards-create-btn').click();
        await expect(page.getByTestId('card-form-dialog')).toBeVisible();
        await page.getByTestId('card-form-matcher-kind-0').selectOption('catalog');
        await page.getByTestId('card-form-browse-catalog-0').click();
        await expect(page.getByTestId('card-form-catalog-browser-0')).toBeVisible();

        // Filter community rules by category AI and search OpenAI
        await page.getByTestId('card-form-catalog-category-0').selectOption('ai');
        await page.getByTestId('card-form-catalog-search-0').fill('OpenAI');
        await expect(page.getByTestId('card-form-catalog-item-ai-openai')).toBeVisible();

        // Open CatalogDetailSheet and verify repository, license, rule count & parent navigation
        await page.getByTestId('card-form-catalog-detail-ai-openai').click();
        await expect(page.getByTestId('catalog-detail-sheet')).toBeVisible();
        await expect(page.getByTestId('catalog-detail-repository')).toContainText(
          'github.com/blackmatrix7/ios_rule_script',
        );
        await expect(page.getByTestId('catalog-detail-license')).not.toBeEmpty();
        await expect(page.getByTestId('catalog-detail-rule-count')).not.toBeEmpty();

        await page.getByTestId('catalog-detail-parent-btn').click();
        await expect(page.getByTestId('catalog-detail-repository')).toContainText(
          'github.com/MetaCubeX/meta-rules-dat',
        );
        await expect(page.getByTestId('catalog-detail-license')).toContainText('GPL-3.0');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('catalog-detail-sheet')).toBeHidden();

        // Pick entry from community rules browser and close dialog
        await page.getByTestId('card-form-catalog-pick-ai-openai').click();
        await expect(page.getByTestId('card-form-matcher-value-0')).toHaveValue('ai-openai');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('card-form-dialog')).toBeHidden();

        // ============================================================
        // 2. POLICY GROUPS: builtin/user/fork, view, "复制并修改", edit, create, delete
        // ============================================================
        await page.getByTestId('cards-origin-builtin').click();
        await page.getByTestId('cards-category-ai').click();
        await expect(page.getByTestId('card-item-openai')).toBeVisible();
        await expect(page.getByTestId('card-fork-openai')).toContainText('复制并修改');
        await page.getByTestId('card-view-openai').click();
        await expect(page.getByTestId('card-detail-sheet')).toBeVisible();
        await expect(page.getByTestId('card-detail-edit-btn')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // Fork the builtin OpenAI scene -> creates a 'fork' scene
        const forkResponsePromise = page.waitForResponse(
          (res) => res.url().includes('/api/cards/openai/fork') && res.request().method() === 'POST',
        );
        await page.getByTestId('card-fork-openai').click();
        const forkResponse = await forkResponsePromise;
        expect(forkResponse.status()).toBe(201);
        const forkedBody = (await forkResponse.json()) as { card: { id: string; name: string; origin: string } };
        const forkedCardId = forkedBody.card.id;
        createdCardIds.push(forkedCardId);
        expect(forkedBody.card.origin).toBe('fork');

        await expect(page.getByTestId('card-detail-sheet')).toBeVisible();
        await expect(page.getByTestId('card-detail-edit-btn')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('card-detail-sheet')).toBeHidden();

        // Filter to fork origin and edit the forked scene
        await page.getByTestId('cards-origin-fork').click();
        await page.getByTestId('cards-category-all').click();
        await expect(page.getByTestId(`card-item-${forkedCardId}`)).toBeVisible();
        await expect(page.getByTestId(`card-origin-badge-${forkedCardId}`)).toBeVisible();

        const editedCardName = `Forked AI ${suffix}`;
        await page.getByTestId(`card-edit-${forkedCardId}`).click();
        await expect(page.getByTestId('card-form-dialog')).toBeVisible();
        await page.getByTestId('card-form-name').fill(editedCardName);
        await page.getByTestId('card-form-icon').fill('spark');
        await page.getByTestId('card-form-category').selectOption('other');
        await page.getByTestId('card-form-default-route').selectOption('builtin:DIRECT');

        // Add an inline rule matcher
        await page.getByTestId('card-form-add-matcher').click();
        const lastMatcherRow = page
          .getByTestId('card-form-dialog')
          .locator('[data-testid^="card-form-matcher-kind-"]')
          .last();
        const matcherIndex = (await lastMatcherRow.getAttribute('data-testid'))!.replace('card-form-matcher-kind-', '');
        await page.getByTestId(`card-form-matcher-kind-${matcherIndex}`).selectOption('inline');
        await page.getByTestId(`card-form-matcher-value-${matcherIndex}`).fill('DOMAIN-SUFFIX,fork-e2e.example.test');

        await page.getByTestId('card-form-submit').click();
        await expect(page.getByTestId('card-form-dialog')).toBeHidden();
        await expect(page.getByTestId(`card-item-${forkedCardId}`)).toContainText(editedCardName);
        await expect(page.getByTestId(`card-default-route-${forkedCardId}`)).toContainText('直连');

        // Create a custom (user) scene and then delete it
        const customCardName = `Custom Scene ${suffix}`;
        await page.getByTestId('cards-create-btn').click();
        await expect(page.getByTestId('card-form-dialog')).toBeVisible();
        await page.getByTestId('card-form-name').fill(customCardName);
        await page.getByTestId('card-form-icon').fill('bolt');
        await page.getByTestId('card-form-category').selectOption('social');
        const createCardResPromise = page.waitForResponse(
          (res) => res.url().endsWith('/api/cards') && res.request().method() === 'POST',
        );
        await page.getByTestId('card-form-submit').click();
        const createCardRes = await createCardResPromise;
        expect(createCardRes.status()).toBe(201);
        const createdCard = ((await createCardRes.json()) as { card: { id: string } }).card;
        createdCardIds.push(createdCard.id);
        await expect(page.getByTestId('card-form-dialog')).toBeHidden();

        await page.getByTestId('cards-origin-user').click();
        await expect(page.getByTestId(`card-item-${createdCard.id}`)).toContainText(customCardName);

        await page.getByTestId(`card-delete-${createdCard.id}`).click();
        await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
        await page.getByTestId('delete-confirm-submit').click();
        await expect(page.getByTestId('delete-confirm-dialog')).toBeHidden();
        await expect(page.getByTestId(`card-item-${createdCard.id}`)).toHaveCount(0);

        // ============================================================
        // 3. TEMPLATE DETAIL ADVANCED OUTPUT & NODES (replaces standalone /publications page)
        // ============================================================
        await page.goto(`/admin/templates/${templateId}?tab=output`);
        await expect(page.getByTestId('template-detail-page')).toBeVisible();
        await ensureAdvancedMode(page, true);
        await expect(page.getByTestId('advanced-output-panel')).toBeVisible();
        await expectNoHorizontalOverflow(page);

        // Create a new publication with all 7 supported clients
        await page.getByTestId('publications-create-btn').click();
        await expect(page.getByTestId('publication-form-dialog')).toBeVisible();
        for (const client of ['stash', 'surge', 'sing-box', 'loon', 'quantumult-x', 'shadowrocket']) {
          await expect(page.getByTestId(`pub-form-client-coming-soon-${client}`)).toHaveCount(0);
        }
        await expect(page.getByTestId('pub-form-experimental-full-config')).not.toBeChecked();
        await expect(page.getByTestId('pub-form-experimental-warning')).toHaveCount(0);

        await page.getByTestId('pub-form-slug').fill(pubSlug);
        await page.getByTestId('pub-form-version').selectOption('1');
        await page.getByTestId('pub-form-client-stash').click();
        await page.getByTestId('pub-form-client-surge').click();
        await page.getByTestId('pub-form-client-sing-box').click();
        await page.getByTestId('pub-form-client-loon').click();
        await page.getByTestId('pub-form-client-quantumult-x').click();
        await page.getByTestId('pub-form-client-shadowrocket').click();
        await page.getByTestId('pub-form-access-token').click();
        await page.getByTestId('pub-form-output').selectOption('minimal');

        const createPubResPromise = page.waitForResponse(
          (res) => res.url().endsWith('/api/publications') && res.request().method() === 'POST',
        );
        await page.getByTestId('pub-form-submit').click();
        const createPubRes = await createPubResPromise;
        expect(createPubRes.status()).toBe(201);
        publicationId = ((await createPubRes.json()) as { publication: { id: string } }).publication.id;
        await expect(page.getByTestId('publication-form-dialog')).toBeHidden();
        await expect(page.getByTestId(`publication-row-${publicationId}`)).toBeVisible();

        // Bind a node slot in Advanced Nodes tab (write-only: plaintext disappears, only masked value is displayed)
        await page.getByTestId('template-tab-nodes').click();
        await expect(page.getByTestId('advanced-nodes-panel')).toBeVisible();
        await expect(page.getByTestId('node-slots-panel')).toBeVisible();
        await expect(page.getByTestId(`node-slot-${slotId}`)).toBeVisible();
        await expectNoHorizontalOverflow(page);

        await page.getByTestId(`node-slot-url-${slotId}`).fill(secretUrlA);
        await page.getByTestId(`node-slot-ua-${slotId}`).fill('clash-verge/v2.0');
        await page.getByTestId(`node-slot-save-${slotId}`).click();

        await expect(page.getByTestId(`node-slot-masked-${slotId}`)).toBeVisible();
        await expect(page.getByTestId(`node-slot-masked-${slotId}`)).toContainText('secret-airport.example.test');
        await expect(page.getByTestId(`node-slot-masked-${slotId}`)).not.toContainText(secretTokenA);

        const bodyTextAfterBind = await page.evaluate(() => document.body.innerText);
        expect(bodyTextAfterBind).not.toContain(secretTokenA);
        expect(bodyTextAfterBind).not.toContain(secretUrlA);

        // Replace flow opens an empty password input and updates masked value
        await page.getByTestId(`node-slot-replace-${slotId}`).click();
        await expect(page.getByTestId(`node-slot-url-${slotId}`)).toHaveValue('');
        await page.getByTestId(`node-slot-url-${slotId}`).fill(secretUrlB);
        await page.getByTestId(`node-slot-save-${slotId}`).click();
        await expect(page.getByTestId(`node-slot-masked-${slotId}`)).toContainText('backup-airport.example.test');
        await expect(page.getByTestId(`node-slot-masked-${slotId}`)).not.toContainText(secretTokenB);

        // Switch back to Output tab: verify public disabled when bound, experimental warning, 7-client preview, and links
        await page.getByTestId('template-tab-output').click();
        await expect(page.getByTestId('advanced-output-panel')).toBeVisible();

        await page.getByTestId(`publication-edit-${publicationId}`).click();
        await expect(page.getByTestId('publication-form-dialog')).toBeVisible();
        await expect(page.getByTestId('pub-form-access-public')).toBeDisabled();
        await expect(page.getByTestId('pub-public-disabled-reason')).toBeVisible();
        await expect(page.getByTestId('pub-form-experimental-full-config')).not.toBeChecked();
        await page.getByTestId('pub-form-experimental-full-config').check();
        await expect(page.getByTestId('pub-form-experimental-warning')).toBeVisible();
        await expect(page.getByTestId('pub-form-experimental-warning')).toContainText('未经真机验证');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('publication-form-dialog')).toBeHidden();

        // Real-time compile preview across all 7 clients + compatibility report
        await expect(page.getByTestId('publication-preview-panel')).toBeVisible();
        await expect(page.getByTestId('publication-preview-code')).toBeVisible();
        await expect(page.getByTestId('publication-preview-code')).toContainText('rules:');
        await expect(page.getByTestId('publication-preview-compat-report')).toBeVisible();
        await expectNoHorizontalOverflow(page);

        for (const client of ['stash', 'surge', 'sing-box', 'loon', 'quantumult-x', 'shadowrocket']) {
          await expect(page.getByTestId(`preview-client-coming-soon-${client}`)).toHaveCount(0);
        }
        await page.getByTestId('preview-client-stash').click();
        await expect(page.getByTestId('publication-preview-code')).toContainText('proxy-groups:');
        await page.getByTestId('preview-client-surge').click();
        await expect(page.getByTestId('publication-preview-code')).toContainText('[Proxy Group]');
        await page.getByTestId('preview-client-sing-box').click();
        await expect(page.getByTestId('publication-preview-code')).toContainText('"outbounds"');
        await page.getByTestId('preview-client-loon').click();
        await expect(page.getByTestId('publication-preview-mode-banner')).toBeVisible();
        await expect(page.getByTestId('publication-preview-code')).toContainText('Rules-Only Remote Resource');
        await expect(page.getByTestId('compat-report-item-RULES_ONLY_SAFE_DEFAULT')).toBeVisible();
        await page.getByTestId('preview-client-quantumult-x').click();
        await expect(page.getByTestId('publication-preview-mode-banner')).toBeVisible();
        await expect(page.getByTestId('publication-preview-code')).toContainText('filter_remote Rules-Only Resource');
        await page.getByTestId('preview-client-shadowrocket').click();
        await expect(page.getByTestId('publication-preview-code')).toContainText('[Proxy Group]');
        await page.getByTestId('preview-client-mihomo').click();
        await expect(page.getByTestId('publication-preview-code')).toBeVisible();

        // All 7 supported clients have active token links & copy works
        await expect(page.getByTestId('pub-link-url-stash')).toHaveText(
          `${ORIGIN}/t/e2e-rule-token/${pubSlug}/stash.yaml`,
        );
        await expect(page.getByTestId('pub-link-url-surge')).toHaveText(
          `${ORIGIN}/t/e2e-rule-token/${pubSlug}/surge.conf`,
        );
        await expect(page.getByTestId('pub-link-url-sing-box')).toHaveText(
          `${ORIGIN}/t/e2e-rule-token/${pubSlug}/singbox.json`,
        );
        await expect(page.getByTestId('pub-link-url-loon')).toHaveText(
          `${ORIGIN}/t/e2e-rule-token/${pubSlug}/loon.conf`,
        );
        await expect(page.getByTestId('pub-link-url-quantumult-x')).toHaveText(
          `${ORIGIN}/t/e2e-rule-token/${pubSlug}/qx.conf`,
        );
        await expect(page.getByTestId('pub-link-url-shadowrocket')).toHaveText(
          `${ORIGIN}/t/e2e-rule-token/${pubSlug}/shadowrocket.conf`,
        );
        const expectedUrl = `${ORIGIN}/t/e2e-rule-token/${pubSlug}/mihomo.yaml`;
        await expect(page.getByTestId('pub-link-url-mihomo')).toHaveText(expectedUrl);

        await page.getByTestId('pub-link-copy-mihomo').click();
        const copiedTexts = await page.evaluate(
          () => (window as Window & { __copiedTexts?: string[] }).__copiedTexts ?? [],
        );
        expect(copiedTexts.at(-1)).toBe(expectedUrl);
        await expectNoHorizontalOverflow(page);
      } finally {
        if (publicationId) {
          await page.request.delete(`/api/publications/${publicationId}`, { headers: JSON_HEADERS });
        }
        if (templateId) {
          await page.request.delete(`/api/templates/${templateId}`, { headers: JSON_HEADERS });
        }
        for (const cardId of createdCardIds) {
          await page.request.delete(`/api/cards/${cardId}`, { headers: JSON_HEADERS });
        }
      }
    });
  }

  test('redirects /admin/publications?selected=<id> to template output and keeps node slot binding enabled without manual SESSION_SECRET banner', async ({
    page,
  }) => {
    await signInAdmin(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    const suffix = Date.now().toString(36);
    let templateId: string | null = null;
    let publicationId: string | null = null;

    try {
      const tplRes = await page.request.post('/api/templates', {
        data: { name: `AutoSecret Tpl ${suffix}`, slug: `autosecret-${suffix}`, starterTier: 'standard' },
        headers: JSON_HEADERS,
      });
      const tplPayload = (await tplRes.json()) as {
        template: { id: string };
        resolvedBody: { slots: Array<{ id: string }> };
      };
      templateId = tplPayload.template.id;
      const slotId = tplPayload.resolvedBody.slots[0]?.id ?? 'slot-main';

      const pubRes = await page.request.post('/api/publications', {
        data: { slug: `autosecret-pub-${suffix}`, templateId, clients: ['mihomo'], access: 'token' },
        headers: JSON_HEADERS,
      });
      publicationId = ((await pubRes.json()) as { publication: { id: string } }).publication.id;

      await page.goto(`/admin/publications?selected=${publicationId}`);
      await expect(page).toHaveURL(new RegExp(`/admin/templates/${templateId}\\?tab=output`));
      await ensureAdvancedMode(page, true);
      await page.getByTestId('template-tab-nodes').click();
      await expect(page.getByTestId('session-secret-missing-alert')).toHaveCount(0);
      await expect(page.getByTestId(`node-slot-url-${slotId}`)).toBeEnabled();
      await expect(page.getByTestId(`node-slot-save-${slotId}`)).toBeEnabled();
    } finally {
      if (publicationId) {
        await page.request.delete(`/api/publications/${publicationId}`, { headers: JSON_HEADERS });
      }
      if (templateId) {
        await page.request.delete(`/api/templates/${templateId}`, { headers: JSON_HEADERS });
      }
    }
  });

  test('Telegram Mini App session renders the policy group library and template detail (normal & advanced) read-only', async ({
    page,
  }) => {
    await signInAdmin(page);
    const suffix = Date.now().toString(36);
    let templateId: string | null = null;
    let publicationId: string | null = null;
    let customCardId: string | null = null;

    try {
      const cardRes = await page.request.post('/api/cards', {
        data: {
          name: `TG Card ${suffix}`,
          category: 'other',
          stage: 'app',
          group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
          matchers: [],
        },
        headers: JSON_HEADERS,
      });
      customCardId = ((await cardRes.json()) as { card: { id: string } }).card.id;

      const tplRes = await page.request.post('/api/templates', {
        data: { name: `TG Tpl ${suffix}`, slug: `tg-tpl-${suffix}`, starterTier: 'standard' },
        headers: JSON_HEADERS,
      });
      const tplPayload = (await tplRes.json()) as {
        template: { id: string };
        resolvedBody: { slots: Array<{ id: string }> };
      };
      templateId = tplPayload.template.id;
      const slotId = tplPayload.resolvedBody.slots[0]?.id ?? 'slot-main';

      const pubRes = await page.request.post('/api/publications', {
        data: { slug: `tg-pub-${suffix}`, templateId, clients: ['mihomo'], access: 'token' },
        headers: JSON_HEADERS,
      });
      publicationId = ((await pubRes.json()) as { publication: { id: string } }).publication.id;

      // Switch session to Telegram Mini App
      await page.request.post('/api/auth/logout', { headers: JSON_HEADERS });
      const initData = buildSignedInitData(2001, 'readonly');
      const tgRes = await page.request.post('/api/telegram/session', {
        data: { initData },
        headers: JSON_HEADERS,
      });
      expect(tgRes.status()).toBe(201);

      await page.setViewportSize({ width: 390, height: 844 });

      // Scenes library shows Telegram read-only notice and disables write buttons
      await page.goto('/admin/templates/groups');
      await expect(page.getByTestId('cards-telegram-readonly')).toBeVisible();
      await expect(page.getByTestId('cards-create-btn')).toBeDisabled();
      await expect(page.getByTestId('card-fork-openai')).toBeDisabled();
      await expect(page.getByTestId(`card-edit-${customCardId}`)).toBeDisabled();
      await expect(page.getByTestId(`card-delete-${customCardId}`)).toBeDisabled();
      await expectNoHorizontalOverflow(page);

      // Template detail Output & Nodes tabs stay read-only while keeping preview & links readable
      await page.goto(`/admin/templates/${templateId}?tab=output`);
      await expect(page.getByTestId('templates-telegram-readonly')).toBeVisible();
      await expect(page.getByTestId('output-add-client-btn')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);

      await ensureAdvancedMode(page, true);
      await expect(page.getByTestId('publications-create-btn')).toHaveCount(0);
      await expect(page.getByTestId(`publication-edit-${publicationId}`)).toHaveCount(0);
      await expect(page.getByTestId(`publication-delete-${publicationId}`)).toHaveCount(0);
      await expect(page.getByTestId('publication-preview-code')).toContainText('rules:');
      await expectNoHorizontalOverflow(page);

      await page.getByTestId('template-tab-nodes').click();
      await expect(page.getByTestId(`node-slot-url-${slotId}`)).toBeDisabled();
      await expect(page.getByTestId(`node-slot-save-${slotId}`)).toBeDisabled();
      await expectNoHorizontalOverflow(page);
    } finally {
      await signInAdmin(page);
      if (publicationId) {
        await page.request.delete(`/api/publications/${publicationId}`, { headers: JSON_HEADERS });
      }
      if (templateId) {
        await page.request.delete(`/api/templates/${templateId}`, { headers: JSON_HEADERS });
      }
      if (customCardId) {
        await page.request.delete(`/api/cards/${customCardId}`, { headers: JSON_HEADERS });
      }
    }
  });
});
