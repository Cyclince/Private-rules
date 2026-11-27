import { expect, test, type Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { E2E_ORIGIN } from '../helpers/e2e-env';

const ORIGIN = E2E_ORIGIN;
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' };

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

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
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

test.describe('M2b Template Detail 3-Tab Simple Flows, Redirects & Mobile Layout (A6)', () => {
  test('A6: add Shadowrocket without re-entering subscription -> edit AI route keeping URL unchanged with updated compiled output -> replace subscription across all clients', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInAdmin(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    const suffix = Date.now().toString(36);
    const initialSubUrl = `https://airport-alpha.example.test/sub?token=ALPHA_${suffix}`;
    const replacedSubUrl = `https://airport-beta.example.test/sub?token=BETA_${suffix}`;

    // Seed an existing wizard-created template with Mihomo + bound subscription
    const qcRes = await page.request.post('/api/templates/quick-create', {
      data: {
        name: `A6 测试模板 ${suffix}`,
        complexity: 'advanced',
        clients: ['mihomo'],
        clientDisplayNames: ['Clash Verge Rev'],
        clientLabels: { mihomo: 'Clash Verge Rev' },
        scenarios: [
          { id: 'domestic-direct', enabled: true },
          { id: 'ad-block', enabled: true },
          { id: 'ai', enabled: true, route: 'proxy' },
          { id: 'telegram', enabled: true, route: 'proxy' },
          { id: 'streaming', enabled: true, route: 'proxy' },
        ],
        rulesets: [],
        groupMode: 'region',
        subscriptionUrl: initialSubUrl,
        detectedRegions: ['HK', 'JP', 'US'],
        previewSummary: {
          nodeCount: 42,
          regions: { HK: 16, JP: 14, US: 12 },
          checkedAt: new Date().toISOString(),
        },
      },
      headers: JSON_HEADERS,
    });
    expect(qcRes.status()).toBe(201);
    const qcJson = (await qcRes.json()) as {
      template: { id: string };
      publications: Array<{ id: string }>;
    };
    const templateId = qcJson.template.id;
    const initialPubId = qcJson.publications[0].id;
    const pubIdsToClean = new Set<string>([initialPubId]);

    try {
      // Ensure advanced mode starts OFF
      await page.goto(`/admin/templates/${templateId}`);
      await expect(page.getByTestId('template-detail-page')).toBeVisible();
      const advToggle = page.getByTestId('template-advanced-toggle');
      await expect(advToggle).toHaveAttribute('aria-checked', 'false');

      // Check plain-language rule on Routing tab
      await expect(page.getByTestId('simple-routing-tab')).toBeVisible();
      await expectNoForbiddenWords(page, 'detail-routing-normal');

      // Check plain-language rule on Nodes tab & verify write-only wording
      await page.getByTestId('template-tab-nodes').click();
      await expect(page.getByTestId('simple-nodes-tab')).toBeVisible();
      await expect(page.getByTestId('simple-nodes-status-bound')).toContainText('已填写（无法查看原文）');
      await expectNoForbiddenWords(page, 'detail-nodes-normal');

      // ------------------------------------------------------------
      // A6.1: Output tab -> Add Shadowrocket -> new link appears without re-entering subscription
      // ------------------------------------------------------------
      await page.getByTestId('template-tab-output').click();
      await expect(page.getByTestId('simple-output-tab')).toBeVisible();
      await expectNoForbiddenWords(page, 'detail-output-normal');

      const originalMihomoUrl = (await page.getByTestId('simple-output-url-mihomo').innerText()).trim();
      expect(originalMihomoUrl).toContain('/mihomo.yaml');

      await page.getByTestId('output-add-client-btn').click();
      await expect(page.getByTestId('add-client-dialog')).toBeVisible();
      await page.getByTestId('add-client-option-shadowrocket').click();
      const addPubResPromise = page.waitForResponse(
        (res) => res.url().endsWith('/api/publications') && res.request().method() === 'POST',
      );
      await page.getByTestId('add-client-confirm-btn').click();
      const addPubRes = await addPubResPromise;
      expect(addPubRes.status()).toBe(201);
      const addedPub = (await addPubRes.json()) as { publication: { id: string } };
      pubIdsToClean.add(addedPub.publication.id);

      await expect(page.getByTestId('add-client-dialog')).toBeHidden();
      await expect(page.getByTestId('simple-output-row-shadowrocket')).toBeVisible();
      const shadowrocketUrl = (await page.getByTestId('simple-output-url-shadowrocket').innerText()).trim();
      expect(shadowrocketUrl).toContain('/shadowrocket.conf');

      // Verify Shadowrocket link works immediately without re-entering subscription URL
      const srInitialRes = await page.request.get(shadowrocketUrl);
      expect(srInitialRes.status()).toBe(200);
      const srInitialText = await srInitialRes.text();
      expect(srInitialText).toContain('[Proxy Group]');
      expect(srInitialText).toContain('[Rule]');

      // Verify initial Mihomo config contains initial subscription URL in proxy-providers
      const mihomoBeforeRes = await page.request.get(originalMihomoUrl);
      expect(mihomoBeforeRes.status()).toBe(200);
      const mihomoBeforeText = await mihomoBeforeRes.text();
      expect(mihomoBeforeText).toContain('airport-alpha.example.test');
      const mihomoBeforeDoc = parseYaml(mihomoBeforeText) as {
        'proxy-groups': Array<{ name: string; proxies?: string[] }>;
      };
      const aiGroupBefore = mihomoBeforeDoc['proxy-groups'].find((g) => g.name.includes('OpenAI'));
      expect(aiGroupBefore?.proxies?.[0]).not.toBe('DIRECT');

      // ------------------------------------------------------------
      // A6.2: Routing tab -> change AI service route -> save -> toast + URL unchanged + compiled output changes
      // ------------------------------------------------------------
      await page.getByTestId('template-tab-routing').click();
      await expect(page.getByTestId('simple-scenario-route-ai')).toBeVisible();
      await page.getByTestId('simple-scenario-route-ai').selectOption('direct');
      await page.getByTestId('simple-routing-save-btn').click();
      await expect(page.getByTestId('toast-viewport')).toContainText('已保存，客户端下次更新订阅时生效');

      // Verify subscription URL did not change
      await page.getByTestId('template-tab-output').click();
      await expect(page.getByTestId('simple-output-url-mihomo')).toHaveText(originalMihomoUrl);

      // Verify compiled Mihomo output reflects the new AI -> DIRECT route
      const mihomoAfterRouteRes = await page.request.get(originalMihomoUrl);
      expect(mihomoAfterRouteRes.status()).toBe(200);
      const mihomoAfterRouteDoc = parseYaml(await mihomoAfterRouteRes.text()) as {
        'proxy-groups': Array<{ name: string; proxies?: string[] }>;
      };
      const aiGroupAfter = mihomoAfterRouteDoc['proxy-groups'].find((g) => g.name.includes('OpenAI'));
      expect(aiGroupAfter?.proxies?.[0]).toBe('DIRECT');

      // ------------------------------------------------------------
      // A6.3: Nodes tab -> replace subscription -> raw URL scrubbed + ALL clients fetch valid updated config
      // ------------------------------------------------------------
      await page.getByTestId('template-tab-nodes').click();
      await page.getByTestId('simple-nodes-replace-btn').click();
      await expect(page.getByTestId('simple-nodes-sub-form')).toBeVisible();
      await page.getByTestId('simple-nodes-sub-input').fill(replacedSubUrl);
      await page.getByTestId('simple-nodes-sub-save-btn').click();
      await expect(page.getByTestId('simple-nodes-sub-form')).toBeHidden();

      // Raw subscription URL must be scrubbed from DOM
      const bodyAfterReplace = await page.evaluate(() => document.body.innerText);
      expect(bodyAfterReplace).not.toContain(`BETA_${suffix}`);
      expect(bodyAfterReplace).not.toContain(replacedSubUrl);

      // Both Mihomo AND Shadowrocket endpoints remain valid and Mihomo now points to the replaced provider URL
      const mihomoAfterSubRes = await page.request.get(originalMihomoUrl);
      expect(mihomoAfterSubRes.status()).toBe(200);
      const mihomoAfterSubText = await mihomoAfterSubRes.text();
      expect(mihomoAfterSubText).toContain('airport-beta.example.test');
      expect(mihomoAfterSubText).not.toContain('airport-alpha.example.test');

      const srAfterSubRes = await page.request.get(shadowrocketUrl);
      expect(srAfterSubRes.status()).toBe(200);
      expect(await srAfterSubRes.text()).toContain('[Proxy Group]');

      // ------------------------------------------------------------
      // 390px mobile layout: zero horizontal overflow across all 3 tabs (normal & advanced) + policy group library
      // ------------------------------------------------------------
      await page.setViewportSize({ width: 390, height: 844 });
      for (const tab of ['routing', 'nodes', 'output'] as const) {
        await page.getByTestId(`template-tab-${tab}`).click();
        await expectNoHorizontalOverflow(page);
      }

      // Turn on advanced mode and check 390px overflow across all 3 tabs
      await advToggle.click();
      for (const tab of ['routing', 'nodes', 'output'] as const) {
        await page.getByTestId(`template-tab-${tab}`).click();
        await expectNoHorizontalOverflow(page);
      }
      await advToggle.click();

      // Old route redirects
      await page.goto(`/admin/publications?selected=${initialPubId}`);
      await expect(page).toHaveURL(new RegExp(`/admin/templates/${templateId}\\?tab=output`));

      await page.goto('/admin/publications');
      await expect(page).toHaveURL(/\/admin\/templates$/);

      await page.goto('/admin/cards');
      await expect(page).toHaveURL(/\/admin\/templates\/groups/);
      await expectNoHorizontalOverflow(page);

      await page.goto('/admin/catalog');
      await expect(page).toHaveURL(/\/admin\/templates\/groups/);
      await expectNoHorizontalOverflow(page);
    } finally {
      for (const pubId of pubIdsToClean) {
        await page.request.delete(`/api/publications/${pubId}`, { headers: JSON_HEADERS }).catch(() => {});
      }
      await page.request.delete(`/api/templates/${templateId}`, { headers: JSON_HEADERS }).catch(() => {});
    }
  });
});
