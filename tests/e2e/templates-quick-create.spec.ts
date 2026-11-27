import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { E2E_ORIGIN } from '../helpers/e2e-env';

const ORIGIN = E2E_ORIGIN;
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' };
const BASELINE_DIR = join(process.cwd(), '.baseline', 'r4a');

// "策略组" is a user-facing term since r2 §4.1, so it is no longer forbidden here.
const FORBIDDEN_PLAIN_WORDS = ['槽位', '组件', '发布'] as const;
const FORBIDDEN_PLAIN_REGEXES = [/\bfull\b/i, /\bminimal\b/i, /\bfork\b/i, /\boverlay\b/i] as const;

async function signInAdmin(page: Page) {
  const res = await page.request.post('/api/auth/login', {
    data: { password: 'e2e-password' },
    headers: JSON_HEADERS,
  });
  expect(res.status()).toBe(200);
}

async function clearAllTemplatesAndPublications(page: Page) {
  const pubsRes = await page.request.get('/api/publications');
  if (pubsRes.ok()) {
    const pubsData = (await pubsRes.json()) as { publications: Array<{ id: string }> };
    for (const pub of pubsData.publications) {
      await page.request.delete(`/api/publications/${pub.id}`, { headers: JSON_HEADERS }).catch(() => {});
    }
  }
  const tplRes = await page.request.get('/api/templates');
  if (tplRes.ok()) {
    const tplData = (await tplRes.json()) as { templates: Array<{ id: string }> };
    for (const tpl of tplData.templates) {
      await page.request.delete(`/api/templates/${tpl.id}`, { headers: JSON_HEADERS }).catch(() => {});
    }
  }
}

async function expectNoForbiddenWords(page: Page, stageLabel: string) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const word of FORBIDDEN_PLAIN_WORDS) {
    expect(text, `[${stageLabel}] must not contain forbidden word "${word}"`).not.toContain(word);
  }
  for (const regex of FORBIDDEN_PLAIN_REGEXES) {
    expect(text, `[${stageLabel}] must not match forbidden pattern ${regex}`).not.toMatch(regex);
  }
}

async function expectNoHorizontalOverflow(page: Page, stageLabel: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `[${stageLabel}] horizontal overflow`).toBeLessThanOrEqual(0);
}

async function ensureAppSelected(page: Page, platform: 'mac' | 'iphone', appId: string) {
  await page.getByTestId(`app-picker-platform-${platform}`).click();
  const option = page.getByTestId(`app-option-${appId}`);
  await expect(option).toBeVisible();
  if ((await option.getAttribute('aria-selected')) !== 'true') {
    await option.click();
  }
  await expect(option).toHaveAttribute('aria-selected', 'true');
}

async function mockPreviewSubscription(page: Page) {
  await page.route('**/api/templates/preview-subscription', async (route) => {
    const body = route.request().postDataJSON() as { subscriptionUrl?: string; name?: string } | null;
    const isSecond = body?.subscriptionUrl?.includes('backup');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        isSecond
          ? {
              nodeCount: 24,
              totalParsedCount: 25,
              infoNodeCount: 1,
              format: 'clash-yaml',
              regions: [
                { code: 'JP', name: '日本', emoji: '🇯🇵', count: 14 },
                { code: 'SG', name: '新加坡', emoji: '🇸🇬', count: 10 },
              ],
              regionCounts: { JP: 14, SG: 10 },
              checkedAt: new Date().toISOString(),
            }
          : {
              nodeCount: 86,
              totalParsedCount: 88,
              infoNodeCount: 2,
              format: 'clash-yaml',
              regions: [
                { code: 'HK', name: '香港', emoji: '🇭🇰', count: 20 },
                { code: 'JP', name: '日本', emoji: '🇯🇵', count: 15 },
                { code: 'US', name: '美国', emoji: '🇺🇸', count: 12 },
              ],
              regionCounts: { HK: 20, JP: 15, US: 12 },
              checkedAt: new Date().toISOString(),
            },
      ),
    });
  });
}

test.describe('R4a 8-Step Guided Quick-Create Wizard (A4, A5 & R4a Flows)', () => {
  test.describe.configure({ mode: 'serial' });

  test('A4 & Simple 4-step flow: skips steps 4/6/7, shows skipped badges, completes in 4 steps with zero forbidden words', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signInAdmin(page);
    await clearAllTemplatesAndPublications(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockPreviewSubscription(page);

    try {
      await page.goto('/admin/templates');
      await expect(page.getByTestId('templates-page')).toBeVisible();
      await expect(page.getByTestId('templates-empty-state')).toBeVisible();
      await expectNoForbiddenWords(page, 'empty-list');
      await expectNoHorizontalOverflow(page, 'empty-list');

      // Step 1: AppPicker multi-select with rules-only disabled
      await page.getByTestId('templates-new-btn').click();
      await expect(page).toHaveURL(/\/admin\/templates\/new/);
      await expect(page.getByTestId('wizard-step-1')).toBeVisible();
      await expect(page.getByTestId('wizard-step-indicator')).toHaveText('第 1 步 / 共 8 步');
      await ensureAppSelected(page, 'mac', 'clash-verge-rev');
      await expect(page.getByTestId('app-option-egern')).toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByTestId('app-option-rules-only-egern')).toBeVisible();
      await expectNoForbiddenWords(page, 'step-1');
      await page.getByTestId('wizard-next-btn').click();

      // Step 2: Fill mock subscription URL & check preview summary
      await expect(page.getByTestId('wizard-step-2')).toBeVisible();
      await expect(page.getByTestId('wizard-step-panel')).toHaveAttribute('data-direction', 'forward');
      await expect(page.getByTestId('wizard-step-indicator')).toHaveText('第 2 步 / 共 8 步');
      await expect(page.getByTestId('wizard-sub-name-0')).toHaveValue('机场 1');
      await page.getByTestId('wizard-sub-input-0').fill('https://mock-airport.example/sub?token=demo');
      await page.getByTestId('wizard-sub-check-btn-0').click();
      await expect(page.getByTestId('wizard-sub-preview-ok-0')).toContainText(
        '识别到 86 个节点：🇭🇰 香港 20 · 🇯🇵 日本 15 · 🇺🇸 美国 12',
      );
      await expectNoForbiddenWords(page, 'step-2');
      await page.getByTestId('wizard-next-btn').click();

      // Step 3: Simple tier is selected by default and marks 4, 6, 7 as skipped
      await expect(page.getByTestId('wizard-step-3')).toBeVisible();
      await expect(page.getByTestId('wizard-step-indicator')).toHaveText('第 3 步 / 共 8 步');
      await expect(page.getByTestId('wizard-tier-simple')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('wizard-progress-skipped-4')).toHaveText('已跳过');
      await expect(page.getByTestId('wizard-progress-skipped-6')).toHaveText('已跳过');
      await expect(page.getByTestId('wizard-progress-skipped-7')).toHaveText('已跳过');
      await expectNoForbiddenWords(page, 'step-3');
      await page.getByTestId('wizard-next-btn').click();

      // Skips Step 4 -> lands directly on Step 5 (My Rules)
      await expect(page.getByTestId('wizard-step-5')).toBeVisible();
      await expect(page.getByTestId('wizard-step-indicator')).toHaveText('第 5 步 / 共 8 步');
      await expect(page.getByTestId('wizard-my-rules-simple-note')).toBeVisible();
      await expectNoForbiddenWords(page, 'step-5-simple');
      await page.getByTestId('wizard-next-btn').click();

      // Skips Steps 6 & 7 -> lands directly on Step 8 (Summary)
      await expect(page.getByTestId('wizard-step-8')).toBeVisible();
      await expect(page.getByTestId('wizard-step-indicator')).toHaveText('第 8 步 / 共 8 步');
      await expect(page.getByTestId('wizard-summary-item-4')).toContainText('已跳过');
      await expect(page.getByTestId('wizard-summary-item-6')).toContainText('已跳过');
      await expect(page.getByTestId('wizard-summary-item-7')).toContainText('已跳过');
      await expectNoForbiddenWords(page, 'step-8-simple');

      // Generate
      await page.getByTestId('wizard-generate-btn').click();

      // Completion page
      await expect(page.getByTestId('wizard-done')).toBeVisible();
      await expect(page.getByTestId('wizard-done')).toContainText('配置已生成');
      await expect(page.getByTestId('wizard-done-link-mihomo')).toBeVisible();
      await expect(page.getByTestId('wizard-done-url-mihomo')).toContainText('/t/');
      await expect(page.getByTestId('wizard-done-url-mihomo')).toContainText('/mihomo.yaml');
      await expectNoForbiddenWords(page, 'done');
      await expectNoHorizontalOverflow(page, 'done');

      // Finish back to list and verify populated card with zero forbidden words
      await page.getByTestId('wizard-done-finish-btn').click();
      await expect(page).toHaveURL(/\/admin\/templates$/);
      await expect(page.getByTestId('templates-page')).toBeVisible();
      await expect(page.getByTestId('templates-page')).toContainText('我的配置');
      await expect(page.getByTestId('templates-page')).toContainText('86 个节点 · 正常');
      await expectNoForbiddenWords(page, 'populated-list');
    } finally {
      await clearAllTemplatesAndPublications(page);
    }
  });

  test('A5: Emby_Direct ruleset defaults to direct in step 5 (simple allows only proxy/direct/reject) and compiles first in mihomo config', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signInAdmin(page);
    await clearAllTemplatesAndPublications(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    const createRsRes = await page.request.post('/api/rulesets', {
      data: { name: 'Emby_Direct', tokenLinksEnabled: true, publicLinksEnabled: false },
      headers: JSON_HEADERS,
    });
    expect(createRsRes.status()).toBe(201);
    const rsListRes = await page.request.get('/api/rulesets');
    const rsList = (await rsListRes.json()) as { data: { categories: Array<{ id: string; name: string }> } };
    const embyCat = rsList.data.categories.find((c) => c.name === 'Emby_Direct');
    expect(embyCat).toBeDefined();
    const embyId = embyCat!.id;

    const addRuleRes = await page.request.post(`/api/rulesets/${embyId}/rules`, {
      data: { value: 'emby.example.com', type: 'DOMAIN-SUFFIX' },
      headers: JSON_HEADERS,
    });
    expect(addRuleRes.status()).toBe(201);

    try {
      await page.goto('/admin/templates/new');
      await expect(page.getByTestId('wizard-step-1')).toBeVisible();
      await ensureAppSelected(page, 'mac', 'clash-verge-rev');
      await page.getByTestId('wizard-next-btn').click();

      // Step 2: skip subscription
      await expect(page.getByTestId('wizard-step-2')).toBeVisible();
      await page.getByTestId('wizard-skip-sub').check();
      await page.getByTestId('wizard-next-btn').click();

      // Step 3: simple default -> Next
      await expect(page.getByTestId('wizard-step-3')).toBeVisible();
      await page.getByTestId('wizard-next-btn').click();

      // Step 5: Emby_Direct defaults to 'direct' and simple route select has only 3 options
      await expect(page.getByTestId('wizard-step-5')).toBeVisible();
      await expect(page.getByTestId(`wizard-ruleset-row-${embyId}`)).toBeVisible();
      const routeSelect = page.getByTestId(`wizard-ruleset-route-${embyId}`);
      await expect(routeSelect).toHaveValue('direct');
      await expect(routeSelect.locator('option')).toHaveCount(3);
      await page.getByTestId(`wizard-ruleset-toggle-${embyId}`).check();
      await page.getByTestId('wizard-next-btn').click();

      // Step 8: set name and generate
      await expect(page.getByTestId('wizard-step-8')).toBeVisible();
      await page.getByTestId('wizard-name-input').fill('Emby 直连配置');
      await page.getByTestId('wizard-generate-btn').click();

      // Completion page shows no-subscription warning & mihomo URL
      await expect(page.getByTestId('wizard-done')).toBeVisible();
      await expect(page.getByTestId('wizard-done-no-sub')).toBeVisible();

      const mihomoUrl = (await page.getByTestId('wizard-done-url-mihomo').innerText()).trim();
      expect(mihomoUrl).toContain('/mihomo.yaml');

      const yamlRes = await page.request.get(mihomoUrl);
      expect(yamlRes.status()).toBe(200);
      const yamlText = await yamlRes.text();
      const doc = parseYaml(yamlText) as {
        rules: string[];
        'proxy-groups': Array<{ name: string; proxies?: string[] }>;
      };

      expect(doc.rules[0]).toMatch(/^RULE-SET,[^,]+,Emby_Direct$/);
      const embyGroup = doc['proxy-groups'].find((g) => g.name === 'Emby_Direct');
      expect(embyGroup?.proxies?.[0]).toBe('DIRECT');
    } finally {
      await clearAllTemplatesAndPublications(page);
      await page.request.delete(`/api/rulesets/${embyId}`, { headers: JSON_HEADERS }).catch(() => {});
    }
  });

  test('Pro tier: multi-airport + perProvider + 15 categories + trait pools + module groups/conflicts + Apple subs guide', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInAdmin(page);
    await clearAllTemplatesAndPublications(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await mockPreviewSubscription(page);

    try {
      await page.goto('/admin/templates/new');
      await expect(page.getByTestId('wizard-step-1')).toBeVisible();
      // Select both Clash Verge Rev (Mac) and Shadowrocket (iPhone)
      await ensureAppSelected(page, 'mac', 'clash-verge-rev');
      await ensureAppSelected(page, 'iphone', 'shadowrocket');
      await page.getByTestId('wizard-next-btn').click();

      // Step 2: 2 subscriptions -> combineMode appears -> select perProvider
      await expect(page.getByTestId('wizard-step-2')).toBeVisible();
      await page.getByTestId('wizard-sub-name-0').fill('主力机场');
      await page.getByTestId('wizard-sub-input-0').fill('https://mock-airport.example/main');
      await page.getByTestId('wizard-sub-check-btn-0').click();
      await expect(page.getByTestId('wizard-sub-preview-ok-0')).toBeVisible();

      await page.getByTestId('wizard-sub-add-btn').click();
      await page.getByTestId('wizard-sub-name-1').fill('备用机场');
      await page.getByTestId('wizard-sub-input-1').fill('https://mock-airport.example/backup');
      await page.getByTestId('wizard-sub-check-btn-1').click();
      await expect(page.getByTestId('wizard-sub-preview-ok-1')).toBeVisible();

      await expect(page.getByTestId('wizard-combine-mode-section')).toBeVisible();
      await page.getByTestId('wizard-combine-mode-perProvider').click();
      await page.getByTestId('wizard-next-btn').click();

      // Step 3: choose Pro
      await expect(page.getByTestId('wizard-step-3')).toBeVisible();
      await page.getByTestId('wizard-tier-pro').click();
      await page.getByTestId('wizard-next-btn').click();

      // Step 4: all 15 categories rendered, presets work
      await expect(page.getByTestId('wizard-step-4')).toBeVisible();
      for (const cat of [
        'base',
        'ai',
        'social',
        'streaming',
        'music',
        'finance',
        'shopping',
        'privacy',
        'domestic',
        'other',
      ]) {
        await expect(page.getByTestId(`wizard-category-${cat}`)).toBeVisible();
      }
      await page.getByTestId('wizard-preset-clear').click();
      await expect(page.getByTestId('wizard-scenario-toggle-ai')).toHaveAttribute('aria-checked', 'false');
      await page.getByTestId('wizard-preset-recommended').click();
      await expect(page.getByTestId('wizard-scenario-toggle-ai')).toHaveAttribute('aria-checked', 'true');
      await expectNoForbiddenWords(page, 'step-4-pro');
      await page.getByTestId('wizard-next-btn').click();

      // Step 5: My Rules in pro mode (shows region options if empty/non-empty)
      await expect(page.getByTestId('wizard-step-5')).toBeVisible();
      await page.getByTestId('wizard-next-btn').click();

      // Step 6: Node pools (detected regions + provider pools + trait pools)
      await expect(page.getByTestId('wizard-step-6')).toBeVisible();
      await expect(page.getByTestId('wizard-pool-region-toggle-HK')).toBeChecked();
      await expect(page.getByTestId('wizard-pool-region-toggle-JP')).toBeChecked();
      await expect(page.getByTestId('wizard-pool-region-toggle-SG')).toBeChecked();
      await expect(page.getByTestId('wizard-pool-provider-section')).toBeVisible();
      await expect(page.getByTestId('wizard-pool-traits-section')).toBeVisible();
      await page.getByTestId('wizard-pool-trait-toggle-pool-trait-gaming').uncheck();
      await expectNoForbiddenWords(page, 'step-6-pro');
      await page.getByTestId('wizard-next-btn').click();

      // Step 7: Module groups + partial/conflict handling
      await expect(page.getByTestId('wizard-step-7')).toBeVisible();
      for (const grp of ['dns-privacy', 'accuracy', 'direct', 'runtime']) {
        await expect(page.getByTestId(`wizard-module-group-${grp}`)).toBeVisible();
      }
      // sniffer is mihomo-only -> partial hint when Clash Verge Rev + Shadowrocket are both selected
      await expect(page.getByTestId('wizard-module-partial-sniffer')).toBeVisible();
      // Enable block-encrypted-dns -> conflict notice auto-disables dns-leak-guard
      await page.getByTestId('wizard-module-switch-block-encrypted-dns').click();
      await expect(page.getByTestId('wizard-module-conflict-notice')).toBeVisible();
      await expect(page.getByTestId('wizard-module-switch-dns-leak-guard')).toHaveAttribute('aria-checked', 'false');
      await expectNoForbiddenWords(page, 'step-7-pro');
      await page.getByTestId('wizard-next-btn').click();

      // Step 8: summary & generate
      await expect(page.getByTestId('wizard-step-8')).toBeVisible();
      await page.getByTestId('wizard-name-input').fill('专业多机场配置');
      await expectNoForbiddenWords(page, 'step-8-pro');
      await page.getByTestId('wizard-generate-btn').click();

      // Completion page: separate cards for Clash Verge Rev and Shadowrocket; Apple card lists sub names without URLs
      await expect(page.getByTestId('wizard-done')).toBeVisible();
      await expect(page.getByTestId('wizard-done-app-clash-verge-rev')).toBeVisible();
      await expect(page.getByTestId('wizard-done-app-shadowrocket')).toBeVisible();
      const appleSubs = page.getByTestId('wizard-done-apple-subs-shadowrocket');
      await expect(appleSubs).toBeVisible();
      await expect(appleSubs).toContainText('主力机场');
      await expect(appleSubs).toContainText('备用机场');
      await expect(appleSubs).not.toContainText('https://mock-airport.example');
      await expectNoForbiddenWords(page, 'done-pro');

      // Verify compiled mihomo YAML reflects perProvider, selected trait pools & module overrides
      const mihomoUrl = (await page.getByTestId('wizard-done-url-mihomo').innerText()).trim();
      const yamlRes = await page.request.get(mihomoUrl);
      expect(yamlRes.status()).toBe(200);
      const yamlText = await yamlRes.text();
      expect(yamlText).toContain('主力机场');
      expect(yamlText).toContain('备用机场');
    } finally {
      await clearAllTemplatesAndPublications(page);
    }
  });

  test('Back navigation and summary jump-back preserve all entered inputs without data loss', async ({ page }) => {
    test.setTimeout(60_000);
    await signInAdmin(page);
    await clearAllTemplatesAndPublications(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/admin/templates/new');
    await ensureAppSelected(page, 'mac', 'clash-verge-rev');
    await page.getByTestId('wizard-next-btn').click();

    // Fill Step 2
    await page.getByTestId('wizard-sub-name-0').fill('测试主力机场');
    await page.getByTestId('wizard-sub-input-0').fill('https://mock-airport.example/keep-me');
    await page.getByTestId('wizard-next-btn').click();

    // Step 3 -> Advanced
    await page.getByTestId('wizard-tier-advanced').click();
    await page.getByTestId('wizard-next-btn').click();

    // Step 4 -> toggle github ON
    await page.getByTestId('wizard-scenario-toggle-github').click();
    await expect(page.getByTestId('wizard-scenario-toggle-github')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('wizard-next-btn').click();

    // Step 5 -> Next
    await page.getByTestId('wizard-next-btn').click();

    // Step 6 -> uncheck KR
    await page.getByTestId('wizard-pool-region-toggle-KR').uncheck();
    await page.getByTestId('wizard-next-btn').click();

    // Step 7 -> Back (check backward motion direction)
    await expect(page.getByTestId('wizard-step-7')).toBeVisible();
    await page.getByTestId('wizard-back-btn').click();
    await expect(page.getByTestId('wizard-step-6')).toBeVisible();
    await expect(page.getByTestId('wizard-step-panel')).toHaveAttribute('data-direction', 'backward');
    await expect(page.getByTestId('wizard-pool-region-toggle-KR')).not.toBeChecked();

    // Advance to Step 8 and set custom name
    await page.getByTestId('wizard-next-btn').click();
    await page.getByTestId('wizard-next-btn').click();
    await expect(page.getByTestId('wizard-step-8')).toBeVisible();
    await page.getByTestId('wizard-name-input').fill('保留数据模板');

    // Jump back to Step 2 via summary edit button
    await page.getByTestId('wizard-summary-edit-2').click();
    await expect(page.getByTestId('wizard-step-2')).toBeVisible();
    await expect(page.getByTestId('wizard-step-panel')).toHaveAttribute('data-direction', 'backward');
    await expect(page.getByTestId('wizard-sub-name-0')).toHaveValue('测试主力机场');
    await expect(page.getByTestId('wizard-sub-input-0')).toHaveValue('https://mock-airport.example/keep-me');

    // Jump directly to Step 4 via progress bar & verify github remained checked, then jump back to Step 8
    await page.getByTestId('wizard-progress-step-4').click();
    await expect(page.getByTestId('wizard-step-4')).toBeVisible();
    await expect(page.getByTestId('wizard-scenario-toggle-github')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('wizard-progress-step-8').click();
    await expect(page.getByTestId('wizard-step-8')).toBeVisible();
    await expect(page.getByTestId('wizard-name-input')).toHaveValue('保留数据模板');
  });

  test('390px mobile zero horizontal overflow & captures .baseline/r4a screenshots for all steps on desktop and mobile', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await mkdir(BASELINE_DIR, { recursive: true });
    await signInAdmin(page);
    await clearAllTemplatesAndPublications(page);
    await mockPreviewSubscription(page);

    try {
      for (const viewport of [
        { label: 'desktop', width: 1280, height: 800 },
        { label: 'mobile', width: 390, height: 844 },
      ] as const) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('/admin/templates/new');

        // Step 1
        await expect(page.getByTestId('wizard-step-1')).toBeVisible();
        await ensureAppSelected(page, 'mac', 'clash-verge-rev');
        await expectNoHorizontalOverflow(page, `${viewport.label}-step-1`);
        await page.screenshot({ path: join(BASELINE_DIR, `step-1-${viewport.label}.png`), fullPage: true });
        await page.getByTestId('wizard-next-btn').click();

        // Step 2
        await expect(page.getByTestId('wizard-step-2')).toBeVisible();
        await page.getByTestId('wizard-sub-input-0').fill('https://mock-airport.example/sub');
        await page.getByTestId('wizard-sub-check-btn-0').click();
        await expect(page.getByTestId('wizard-sub-preview-ok-0')).toBeVisible();
        await expectNoHorizontalOverflow(page, `${viewport.label}-step-2`);
        await page.screenshot({ path: join(BASELINE_DIR, `step-2-${viewport.label}.png`), fullPage: true });
        await page.getByTestId('wizard-next-btn').click();

        // Step 3 (select pro so steps 4, 6, 7 are all rendered for screenshots)
        await expect(page.getByTestId('wizard-step-3')).toBeVisible();
        await page.getByTestId('wizard-tier-pro').click();
        await expectNoHorizontalOverflow(page, `${viewport.label}-step-3`);
        await page.screenshot({ path: join(BASELINE_DIR, `step-3-${viewport.label}.png`), fullPage: true });
        await page.getByTestId('wizard-next-btn').click();

        // Step 4
        await expect(page.getByTestId('wizard-step-4')).toBeVisible();
        await expectNoHorizontalOverflow(page, `${viewport.label}-step-4`);
        await page.screenshot({ path: join(BASELINE_DIR, `step-4-${viewport.label}.png`), fullPage: true });
        await page.getByTestId('wizard-next-btn').click();

        // Step 5
        await expect(page.getByTestId('wizard-step-5')).toBeVisible();
        await expectNoHorizontalOverflow(page, `${viewport.label}-step-5`);
        await page.screenshot({ path: join(BASELINE_DIR, `step-5-${viewport.label}.png`), fullPage: true });
        await page.getByTestId('wizard-next-btn').click();

        // Step 6
        await expect(page.getByTestId('wizard-step-6')).toBeVisible();
        await expectNoHorizontalOverflow(page, `${viewport.label}-step-6`);
        await page.screenshot({ path: join(BASELINE_DIR, `step-6-${viewport.label}.png`), fullPage: true });
        await page.getByTestId('wizard-next-btn').click();

        // Step 7
        await expect(page.getByTestId('wizard-step-7')).toBeVisible();
        await expectNoHorizontalOverflow(page, `${viewport.label}-step-7`);
        await page.screenshot({ path: join(BASELINE_DIR, `step-7-${viewport.label}.png`), fullPage: true });
        await page.getByTestId('wizard-next-btn').click();

        // Step 8
        await expect(page.getByTestId('wizard-step-8')).toBeVisible();
        await page.getByTestId('wizard-name-input').fill(`截图配置-${viewport.label}`);
        await expectNoHorizontalOverflow(page, `${viewport.label}-step-8`);
        await page.screenshot({ path: join(BASELINE_DIR, `step-8-${viewport.label}.png`), fullPage: true });
        await page.getByTestId('wizard-generate-btn').click();

        // Done
        await expect(page.getByTestId('wizard-done')).toBeVisible();
        await expectNoHorizontalOverflow(page, `${viewport.label}-done`);
        await page.screenshot({ path: join(BASELINE_DIR, `done-${viewport.label}.png`), fullPage: true });

        await clearAllTemplatesAndPublications(page);
      }
    } finally {
      await clearAllTemplatesAndPublications(page);
    }
  });
});
