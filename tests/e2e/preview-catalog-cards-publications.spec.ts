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

test.describe('M4.4a Rule Catalog, App Cards Library, and Publications', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} (${viewport.width}x${viewport.height}): catalog hierarchy/filter/detail, card fork/edit/delete, publication create/bind/masked/public-disabled/preview/copy-link`, async ({
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
        // 1. RULE CATALOG PAGE: browse, search, category filter, hierarchy, detail drawer
        // ============================================================
        await page.goto('/admin/catalog');
        await expect(page.getByTestId('catalog-page')).toBeVisible();
        await expect(page.getByTestId('catalog-list')).toBeVisible();
        await expectNoHorizontalOverflow(page);

        // Filter by category: AI
        await page.getByTestId('catalog-category-ai').click();
        await expect(page).toHaveURL(/category=ai/);
        await expect(page.getByTestId('catalog-group-ai-all')).toBeVisible();
        await expect(page.getByTestId('catalog-children-ai-all')).toBeVisible();
        await expect(page.getByTestId('catalog-children-ai-all').getByTestId('catalog-item-ai-openai')).toBeVisible();

        // Collapse and re-expand parent-child hierarchy
        await page.getByTestId('catalog-toggle-ai-all').click();
        await expect(page.getByTestId('catalog-children-ai-all')).toBeHidden();
        await page.getByTestId('catalog-toggle-ai-all').click();
        await expect(page.getByTestId('catalog-children-ai-all')).toBeVisible();

        // Search inside catalog
        await page.getByTestId('catalog-search-input').fill('OpenAI');
        await expect(page.getByTestId('catalog-item-ai-openai')).toBeVisible();

        // Open detail drawer and verify repository, license, and rule count
        await page.getByTestId('catalog-view-ai-openai').click();
        await expect(page.getByTestId('catalog-detail-sheet')).toBeVisible();
        await expect(page.getByTestId('catalog-detail-repository')).toContainText(
          'github.com/blackmatrix7/ios_rule_script',
        );
        await expect(page.getByTestId('catalog-detail-license')).not.toBeEmpty();
        await expect(page.getByTestId('catalog-detail-rule-count')).not.toBeEmpty();

        // Navigate to parent entry from detail drawer
        await page.getByTestId('catalog-detail-parent-btn').click();
        await expect(page.getByTestId('catalog-detail-repository')).toContainText(
          'github.com/MetaCubeX/meta-rules-dat',
        );
        await expect(page.getByTestId('catalog-detail-license')).toContainText('GPL-3.0');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('catalog-detail-sheet')).toBeHidden();

        // ============================================================
        // 2. APP CARDS LIBRARY: builtin/user/fork, view, fork, edit, create, delete
        // ============================================================
        await page.goto('/admin/cards');
        await expect(page.getByTestId('cards-page')).toBeVisible();
        await expect(page.getByTestId('cards-list')).toBeVisible();
        await expectNoHorizontalOverflow(page);

        // Filter to AI builtin cards and view details
        await page.getByTestId('cards-origin-builtin').click();
        await page.getByTestId('cards-category-ai').click();
        await expect(page.getByTestId('card-item-openai')).toBeVisible();
        await page.getByTestId('card-view-openai').click();
        await expect(page.getByTestId('card-detail-sheet')).toBeVisible();
        await expect(page.getByTestId('card-detail-edit-btn')).toHaveCount(0);
        await page.keyboard.press('Escape');

        // Fork the builtin OpenAI card -> switches/creates a 'fork' card
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

        // Forking opens the newly forked card's detail sheet and switches origin filter to fork
        await expect(page.getByTestId('card-detail-sheet')).toBeVisible();
        await expect(page.getByTestId('card-detail-edit-btn')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('card-detail-sheet')).toBeHidden();

        // Filter to fork origin and edit the forked card (name, icon, category, defaultRoute, inline matcher)
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

        // Create a custom (user) card and then delete it
        const customCardName = `Custom Card ${suffix}`;
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

        // Delete the custom card via UI confirmation dialog
        await page.getByTestId(`card-delete-${createdCard.id}`).click();
        await expect(page.getByTestId('delete-confirm-dialog')).toBeVisible();
        await page.getByTestId('delete-confirm-submit').click();
        await expect(page.getByTestId('delete-confirm-dialog')).toBeHidden();
        await expect(page.getByTestId(`card-item-${createdCard.id}`)).toHaveCount(0);

        // ============================================================
        // 3. PUBLICATIONS PAGE: create, node slot binding (masked + public disabled), preview, copy link
        // ============================================================
        await page.goto('/admin/publications');
        await expect(page.getByTestId('publications-page')).toBeVisible();
        await expectNoHorizontalOverflow(page);

        // Unsupported clients are clearly labeled "即将支持" while Stash, Surge & sing-box are now supported
        await expect(page.getByTestId('publications-client-loon')).toContainText('即将支持');
        await expect(page.getByTestId('publications-client-stash')).not.toContainText('即将支持');
        await expect(page.getByTestId('publications-client-surge')).not.toContainText('即将支持');
        await expect(page.getByTestId('publications-client-sing-box')).not.toContainText('即将支持');

        // Create a new publication with mihomo + stash + surge + sing-box (supported) + loon (unsupported)
        await page.getByTestId('publications-create-btn').click();
        await expect(page.getByTestId('publication-form-dialog')).toBeVisible();
        await expect(page.getByTestId('pub-form-client-coming-soon-loon')).toContainText('即将支持');
        await expect(page.getByTestId('pub-form-client-coming-soon-stash')).toHaveCount(0);
        await expect(page.getByTestId('pub-form-client-coming-soon-surge')).toHaveCount(0);
        await expect(page.getByTestId('pub-form-client-coming-soon-sing-box')).toHaveCount(0);

        await page.getByTestId('pub-form-slug').fill(pubSlug);
        await page.getByTestId('pub-form-template').selectOption(templateId);
        await page.getByTestId('pub-form-version').selectOption('1');
        await page.getByTestId('pub-form-client-stash').click();
        await page.getByTestId('pub-form-client-surge').click();
        await page.getByTestId('pub-form-client-sing-box').click();
        await page.getByTestId('pub-form-client-loon').click();
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
        await expect(page.getByTestId(`publication-item-${publicationId}`)).toBeVisible();

        // Bind a node slot (write-only: plaintext disappears, only masked value is displayed)
        await page.getByTestId('publication-tab-nodes').click();
        await expect(page.getByTestId('node-slots-panel')).toBeVisible();
        await expect(page.getByTestId(`node-slot-${slotId}`)).toBeVisible();
        await expectNoHorizontalOverflow(page);

        await page.getByTestId(`node-slot-url-${slotId}`).fill(secretUrlA);
        await page.getByTestId(`node-slot-ua-${slotId}`).fill('clash-verge/v2.0');
        await page.getByTestId(`node-slot-save-${slotId}`).click();

        await expect(page.getByTestId(`node-slot-masked-${slotId}`)).toBeVisible();
        await expect(page.getByTestId(`node-slot-masked-${slotId}`)).toContainText('secret-airport.example.test');
        await expect(page.getByTestId(`node-slot-masked-${slotId}`)).not.toContainText(secretTokenA);

        // Verify plaintext URL / token never leaks anywhere in rendered DOM
        const bodyTextAfterBind = await page.evaluate(() => document.body.innerText);
        expect(bodyTextAfterBind).not.toContain(secretTokenA);
        expect(bodyTextAfterBind).not.toContain(secretUrlA);

        // Replace flow opens an empty password input (cannot view old URL) and updates masked value
        await page.getByTestId(`node-slot-replace-${slotId}`).click();
        await expect(page.getByTestId(`node-slot-url-${slotId}`)).toHaveValue('');
        await page.getByTestId(`node-slot-url-${slotId}`).fill(secretUrlB);
        await page.getByTestId(`node-slot-save-${slotId}`).click();
        await expect(page.getByTestId(`node-slot-masked-${slotId}`)).toContainText('backup-airport.example.test');
        await expect(page.getByTestId(`node-slot-masked-${slotId}`)).not.toContainText(secretTokenB);

        // Open Edit Publication modal: "public" option MUST be disabled with explanation because node is bound
        await page.getByTestId('publication-edit-btn').click();
        await expect(page.getByTestId('publication-form-dialog')).toBeVisible();
        await expect(page.getByTestId('pub-form-access-public')).toBeDisabled();
        await expect(page.getByTestId('pub-public-disabled-reason')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('publication-form-dialog')).toBeHidden();

        // Real-time compile preview (<pre> Mihomo YAML + unsupported client coming-soon state)
        await page.getByTestId('publication-tab-preview').click();
        await expect(page.getByTestId('publication-preview-panel')).toBeVisible();
        await expect(page.getByTestId('publication-preview-code')).toBeVisible();
        await expect(page.getByTestId('publication-preview-code')).toContainText('rules:');
        await expectNoHorizontalOverflow(page);

        await expect(page.getByTestId('preview-client-coming-soon-loon')).toContainText('即将支持');
        await expect(page.getByTestId('preview-client-coming-soon-stash')).toHaveCount(0);
        await expect(page.getByTestId('preview-client-coming-soon-surge')).toHaveCount(0);
        await expect(page.getByTestId('preview-client-coming-soon-sing-box')).toHaveCount(0);
        await page.getByTestId('preview-client-stash').click();
        await expect(page.getByTestId('publication-preview-code')).toContainText('proxy-groups:');
        await page.getByTestId('preview-client-surge').click();
        await expect(page.getByTestId('publication-preview-code')).toContainText('[Proxy Group]');
        await page.getByTestId('preview-client-sing-box').click();
        await expect(page.getByTestId('publication-preview-code')).toContainText('"outbounds"');
        await page.getByTestId('preview-client-loon').click();
        await expect(page.getByTestId('preview-unsupported-notice')).toBeVisible();
        await page.getByTestId('preview-client-mihomo').click();
        await expect(page.getByTestId('publication-preview-code')).toBeVisible();

        // Subscription Links tab: only valid policy links shown; unsupported labeled "即将支持"; copy works
        await page.getByTestId('publication-tab-links').click();
        await expect(page.getByTestId('publication-links-panel')).toBeVisible();
        await expect(page.getByTestId('pub-link-coming-soon-loon')).toContainText('即将支持');
        await expect(page.getByTestId('pub-link-item-mihomo')).toBeVisible();
        await expect(page.getByTestId('pub-link-item-stash')).toBeVisible();
        await expect(page.getByTestId('pub-link-item-surge')).toBeVisible();
        await expect(page.getByTestId('pub-link-item-sing-box')).toBeVisible();
        await expect(page.getByTestId('pub-link-url-stash')).toHaveText(
          `${ORIGIN}/t/e2e-rule-token/${pubSlug}/stash.yaml`,
        );
        await expect(page.getByTestId('pub-link-url-surge')).toHaveText(
          `${ORIGIN}/t/e2e-rule-token/${pubSlug}/surge.conf`,
        );
        await expect(page.getByTestId('pub-link-url-sing-box')).toHaveText(
          `${ORIGIN}/t/e2e-rule-token/${pubSlug}/singbox.json`,
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

  test('displays disabled prompt and disables node slot binding when SESSION_SECRET is not configured', async ({
    page,
  }) => {
    await signInAdmin(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    const suffix = Date.now().toString(36);
    let templateId: string | null = null;
    let publicationId: string | null = null;

    try {
      const tplRes = await page.request.post('/api/templates', {
        data: { name: `NoSecret Tpl ${suffix}`, slug: `nosecret-${suffix}`, starterTier: 'standard' },
        headers: JSON_HEADERS,
      });
      const tplPayload = (await tplRes.json()) as {
        template: { id: string };
        resolvedBody: { slots: Array<{ id: string }> };
      };
      templateId = tplPayload.template.id;
      const slotId = tplPayload.resolvedBody.slots[0]?.id ?? 'slot-main';

      const pubRes = await page.request.post('/api/publications', {
        data: { slug: `nosecret-pub-${suffix}`, templateId, clients: ['mihomo'], access: 'token' },
        headers: JSON_HEADERS,
      });
      publicationId = ((await pubRes.json()) as { publication: { id: string } }).publication.id;

      // Simulate server without explicit SESSION_SECRET
      await page.route('**/api/auth/me', async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as Record<string, unknown>;
        await route.fulfill({
          status: res.status(),
          contentType: 'application/json',
          body: JSON.stringify({ ...body, sessionSecretConfigured: false }),
        });
      });
      await page.route('**/api/publications*', async (route) => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        const res = await route.fetch();
        const body = (await res.json()) as {
          publications?: Array<Record<string, unknown>>;
          publication?: Record<string, unknown>;
        };
        if (Array.isArray(body.publications)) {
          body.publications = body.publications.map((item) => ({ ...item, sessionSecretConfigured: false }));
        }
        if (body.publication) {
          body.publication = { ...body.publication, sessionSecretConfigured: false };
        }
        await route.fulfill({
          status: res.status(),
          contentType: 'application/json',
          body: JSON.stringify(body),
        });
      });

      await page.goto(`/admin/publications?selected=${publicationId}&tab=nodes`);
      await expect(page.getByTestId('publications-session-secret-banner')).toBeVisible();
      await expect(page.getByTestId('session-secret-missing-alert')).toBeVisible();
      await expect(page.getByTestId(`node-slot-url-${slotId}`)).toBeDisabled();
      await expect(page.getByTestId(`node-slot-save-${slotId}`)).toBeDisabled();
    } finally {
      if (publicationId) {
        await page.request.delete(`/api/publications/${publicationId}`, { headers: JSON_HEADERS });
      }
      if (templateId) {
        await page.request.delete(`/api/templates/${templateId}`, { headers: JSON_HEADERS });
      }
    }
  });

  test('Telegram Mini App session renders catalog, cards, and publications read-only with write buttons disabled', async ({
    page,
  }) => {
    await signInAdmin(page);
    const suffix = Date.now().toString(36);
    let templateId: string | null = null;
    let publicationId: string | null = null;
    let customCardId: string | null = null;

    try {
      // Seed a custom card, template, and publication as admin
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

      // Catalog remains readable
      await page.goto('/admin/catalog');
      await expect(page.getByTestId('catalog-list')).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Cards page shows Telegram read-only notice and disables all write buttons
      await page.goto('/admin/cards');
      await expect(page.getByTestId('cards-telegram-readonly')).toBeVisible();
      await expect(page.getByTestId('cards-create-btn')).toBeDisabled();
      await expect(page.getByTestId('card-fork-openai')).toBeDisabled();
      await expect(page.getByTestId(`card-edit-${customCardId}`)).toBeDisabled();
      await expect(page.getByTestId(`card-delete-${customCardId}`)).toBeDisabled();
      await expectNoHorizontalOverflow(page);

      // Publications page shows Telegram read-only notice, disables write controls, while keeping preview & links readable
      await page.goto(`/admin/publications?selected=${publicationId}&tab=nodes`);
      await expect(page.getByTestId('publications-telegram-readonly')).toBeVisible();
      await expect(page.getByTestId('publications-create-btn')).toBeDisabled();
      await expect(page.getByTestId('publication-edit-btn')).toBeDisabled();
      await expect(page.getByTestId('publication-delete-btn')).toBeDisabled();
      await expect(page.getByTestId(`node-slot-url-${slotId}`)).toBeDisabled();
      await expect(page.getByTestId(`node-slot-save-${slotId}`)).toBeDisabled();

      await page.getByTestId('publication-tab-preview').click();
      await expect(page.getByTestId('publication-preview-code')).toContainText('rules:');
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
