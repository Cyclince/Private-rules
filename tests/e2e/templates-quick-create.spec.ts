import { expect, test, type Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';

const ORIGIN = 'http://127.0.0.1:5180';
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' };

const FORBIDDEN_PLAIN_WORDS = ['槽位', '组件', '发布', '策略组'] as const;
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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('M2a Templates List & 3-Step Quick-Create Wizard (A4 & A5)', () => {
  test.describe.configure({ mode: 'serial' });

  test('A4: fresh DB -> new template -> Clash Verge Rev -> default scenarios -> mock subscription -> generate -> completion links with zero forbidden words', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signInAdmin(page);
    await clearAllTemplatesAndPublications(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Intercept only subscription preview so no external network request is made
    await page.route('**/api/templates/preview-subscription', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      });
    });

    try {
      // 1. Empty templates list
      await page.goto('/admin/templates');
      await expect(page.getByTestId('templates-page')).toBeVisible();
      await expect(page.getByTestId('templates-empty-state')).toBeVisible();
      await expectNoForbiddenWords(page, 'empty-list');
      await expectNoHorizontalOverflow(page);

      // Click primary "新建模板" button
      await page.getByTestId('templates-new-btn').click();
      await expect(page).toHaveURL(/\/admin\/templates\/new/);
      await expect(page.getByTestId('wizard-step-1')).toBeVisible();
      await expect(page.getByTestId('wizard-step-indicator')).toHaveText('第 1 步 / 共 3 步');
      await expectNoForbiddenWords(page, 'step-1');

      // Step 1: pick Clash Verge Rev
      await page.getByTestId('wizard-client-clash-verge-rev').click();
      await page.getByTestId('wizard-next-btn').click();

      // Step 2: keep default scenarios (standard preset)
      await expect(page.getByTestId('wizard-step-2')).toBeVisible();
      await expect(page.getByTestId('wizard-step-indicator')).toHaveText('第 2 步 / 共 3 步');
      await expect(page.getByTestId('wizard-scenario-toggle-domestic-direct')).toBeChecked();
      await expect(page.getByTestId('wizard-scenario-toggle-ad-block')).toBeChecked();
      await expect(page.getByTestId('wizard-scenario-toggle-ai')).toBeChecked();
      await expectNoForbiddenWords(page, 'step-2');
      await page.getByTestId('wizard-next-btn').click();

      // Step 3: fill mock subscription URL and verify preview summary
      await expect(page.getByTestId('wizard-step-3')).toBeVisible();
      await expect(page.getByTestId('wizard-step-indicator')).toHaveText('第 3 步 / 共 3 步');
      await page.getByTestId('wizard-sub-input').fill('https://mock-airport.example/sub?token=demo');
      await page.getByTestId('wizard-sub-check-btn').click();
      await expect(page.getByTestId('wizard-sub-preview-ok')).toContainText(
        '识别到 86 个节点：香港 20 · 日本 15 · 美国 12',
      );
      await expectNoForbiddenWords(page, 'step-3');

      // Generate
      await page.getByTestId('wizard-generate-btn').click();

      // Completion page
      await expect(page.getByTestId('wizard-done')).toBeVisible();
      await expect(page.getByTestId('wizard-done')).toContainText('配置已生成');
      await expect(page.getByTestId('wizard-done-link-mihomo')).toBeVisible();
      await expect(page.getByTestId('wizard-done-url-mihomo')).toContainText('/t/');
      await expect(page.getByTestId('wizard-done-url-mihomo')).toContainText('/mihomo.yaml');
      await expectNoForbiddenWords(page, 'done');
      await expectNoHorizontalOverflow(page);

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

  test('A5: Emby_Direct ruleset defaults to direct in step 2 and compiles first in mihomo config pointing to DIRECT', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signInAdmin(page);
    await clearAllTemplatesAndPublications(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Create Emby_Direct ruleset with a domain rule
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
      await page.getByTestId('wizard-client-clash-verge-rev').click();
      await page.getByTestId('wizard-next-btn').click();

      // Step 2: Emby_Direct appears under My Rules and defaults to 'direct'
      await expect(page.getByTestId(`wizard-ruleset-row-${embyId}`)).toBeVisible();
      await expect(page.getByTestId(`wizard-ruleset-route-${embyId}`)).toHaveValue('direct');
      await page.getByTestId(`wizard-ruleset-toggle-${embyId}`).check();
      await page.getByTestId('wizard-next-btn').click();

      // Step 3: skip subscription and generate
      await expect(page.getByTestId('wizard-step-3')).toBeVisible();
      await page.getByTestId('wizard-skip-sub').check();
      await page.getByTestId('wizard-name-input').fill('Emby 直连配置');
      await page.getByTestId('wizard-generate-btn').click();

      // Completion page shows no-subscription warning & mihomo URL
      await expect(page.getByTestId('wizard-done')).toBeVisible();
      await expect(page.getByTestId('wizard-done-no-sub')).toBeVisible();

      const mihomoUrl = (await page.getByTestId('wizard-done-url-mihomo').innerText()).trim();
      expect(mihomoUrl).toContain('/mihomo.yaml');

      // Fetch real compiled mihomo YAML from the generated subscription URL
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
});
