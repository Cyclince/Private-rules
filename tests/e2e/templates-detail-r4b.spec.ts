import { expect, test, type Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { E2E_ORIGIN } from '../helpers/e2e-env';

const ORIGIN = E2E_ORIGIN;
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' };

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

type SimpleViewPayload = {
  outputs: Array<{ id: string; links: Array<{ client: string; url: string | null }> }>;
  nodes: { subscriptions: Array<{ slotId: string; bound: boolean }>; nodeNames: string[] };
  template: { complexity: string };
};

async function readSimpleView(page: Page, templateId: string): Promise<SimpleViewPayload> {
  const res = await page.request.get(`/api/templates/${templateId}/simple`);
  expect(res.status()).toBe(200);
  return (await res.json()) as SimpleViewPayload;
}

function mihomoUrl(view: SimpleViewPayload): string {
  const url = view.outputs.flatMap((output) => output.links).find((link) => link.client === 'mihomo')?.url;
  expect(url, 'mihomo subscription url').toBeTruthy();
  return url!;
}

async function fetchMihomo(page: Page, url: string): Promise<string> {
  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  return res.text();
}

const SAMPLE_NODES = ['🇯🇵 日本 01', '🇯🇵 东京 IEPL', '🇯🇵 大阪 家宽', '🇭🇰 香港 01', '🇭🇰 香港 02', '🇺🇸 美国 01'];

test.describe('R4b template detail: tiers, node pools, preview, modules', () => {
  test('simple 3 destinations, advanced region pool, pro custom pool with live preview, module switch in output', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await signInAdmin(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    const suffix = Date.now().toString(36);
    const subUrl = `https://airport-r4b.example.test/sub?token=R4B_${suffix}`;

    const qcRes = await page.request.post('/api/templates/quick-create', {
      data: {
        name: `R4b 三档模板 ${suffix}`,
        complexity: 'advanced',
        clients: ['mihomo'],
        clientDisplayNames: ['Clash Verge Rev'],
        clientLabels: { mihomo: 'Clash Verge Rev' },
        scenarios: [
          { id: 'domestic-direct', enabled: true },
          { id: 'ad-block', enabled: true },
          { id: 'ai', enabled: true, route: 'region:US' },
          { id: 'telegram', enabled: true, route: 'proxy' },
          { id: 'streaming', enabled: true, route: 'proxy' },
        ],
        rulesets: [],
        groupMode: 'region',
        subscriptionUrl: subUrl,
        detectedRegions: ['HK', 'JP', 'US'],
        previewSummary: {
          nodeCount: SAMPLE_NODES.length,
          regions: { JP: 3, HK: 2, US: 1 },
          status: 'ok',
          checkedAt: new Date().toISOString(),
          sampleNames: SAMPLE_NODES,
        },
      },
      headers: JSON_HEADERS,
    });
    expect(qcRes.status()).toBe(201);
    const templateId = ((await qcRes.json()) as { template: { id: string } }).template.id;

    try {
      await page.goto(`/admin/templates/${templateId}`);
      await expect(page.getByTestId('template-detail-page')).toBeVisible();
      await expect(page.getByTestId('template-tier-switch')).toHaveAttribute('data-tier', 'advanced');

      // Advanced tier: policy-group cards are grouped by category
      await expect(page.getByTestId('simple-routing-groups')).toBeVisible();
      await expect(page.getByTestId('routing-group-ai')).toBeVisible();
      await expect(page.getByTestId('routing-group-privacy')).toBeVisible();
      await expect(page.getByTestId('simple-hub-cards')).toHaveCount(0);

      // Advanced tier: no regular-expression editor yet
      await page.getByTestId('template-tab-nodes').click();
      await expect(page.getByTestId('simple-nodes-pools-card')).toBeVisible();
      await expect(page.getByTestId('node-pool-new-btn')).toHaveCount(0);
      await expect(page.getByTestId('node-pool-editor')).toHaveCount(0);

      // Regions detected inside the airport are pre-checked and preview from cached names
      await expect(page.getByTestId('node-pool-toggle-region-jp')).toBeChecked();
      await expect(page.getByTestId('node-pool-row-region-jp')).toHaveAttribute('data-checked', 'true');
      await expect(page.getByTestId('node-pool-empty-region-jp')).toHaveCount(0);

      // Tick a region that has no cached nodes -> pool appears in the output with an empty hint
      const sgToggle = page.getByTestId('node-pool-toggle-region-sg');
      await expect(sgToggle).not.toBeChecked();
      await sgToggle.click();
      await expect(page.getByTestId('node-pool-row-region-sg')).toHaveAttribute('data-checked', 'true');
      await expect(page.getByTestId('node-pool-empty-region-sg')).toBeVisible();

      let view = await readSimpleView(page, templateId);
      expect(view.nodes.nodeNames.length).toBeGreaterThan(0);
      let mihomo = await fetchMihomo(page, mihomoUrl(view));
      expect(mihomo).toContain('日本节点');
      expect(mihomo).toContain('新加坡节点');
      const yamlWithRegion = parseYaml(mihomo) as { 'proxy-groups': Array<{ name: string }> };
      expect(yamlWithRegion['proxy-groups'].some((group) => group.name.includes('日本节点'))).toBe(true);

      // Upgrade to Pro: pools and the regex editor become available
      await page.getByTestId('template-tier-pro').click();
      await expect(page.getByTestId('template-tier-switch')).toHaveAttribute('data-tier', 'pro');
      await expect(page.getByTestId('template-tier-downgrade-dialog')).toHaveCount(0);

      await page.getByTestId('template-tab-nodes').click();
      await page.getByTestId('node-pool-new-btn').click();
      await expect(page.getByTestId('node-pool-editor')).toBeVisible();
      const poolName = `🏷 日本优选 ${suffix}`;
      await page.getByTestId('node-pool-name-input').fill(poolName);
      await page.getByTestId('node-pool-include-input').fill('日本|东京|大阪');
      await expect(page.getByTestId('node-pool-preview').getByText('🇯🇵 日本 01')).toBeVisible();
      await expect(page.getByTestId('node-pool-preview-count')).toContainText('3');
      // "Test regex" input reports matches for an arbitrary pattern
      await page.getByTestId('node-pool-regex-test-input').fill('香港');
      await expect(page.getByTestId('node-pool-regex-test-result')).toContainText('2');
      await page.getByTestId('node-pool-save-btn').click();
      await expect(page.getByTestId('node-pool-custom-list')).toContainText('日本优选');

      view = await readSimpleView(page, templateId);
      mihomo = await fetchMihomo(page, mihomoUrl(view));
      expect(mihomo).toContain('日本优选');

      // Empty pool protection: a pattern that matches nothing shows the hint
      await page.getByTestId('node-pool-new-btn').click();
      await page.getByTestId('node-pool-name-input').fill(`🈳 空池 ${suffix}`);
      await page.getByTestId('node-pool-include-input').fill('新加坡专线');
      await expect(page.getByTestId('node-pool-preview-empty')).toBeVisible();
      await page.getByTestId('node-pool-cancel-btn').click();

      // Modules tab: switching off traffic sniffing removes the section from the output
      expect(mihomo).toContain('sniffer:');
      await page.getByTestId('template-tab-modules').click();
      await expect(page.getByTestId('simple-modules-tab')).toBeVisible();
      const snifferSwitch = page.getByTestId('simple-module-switch-sniffer');
      await expect(snifferSwitch).toHaveAttribute('aria-checked', 'true');
      await snifferSwitch.click();
      await expect(snifferSwitch).toHaveAttribute('aria-checked', 'false');
      view = await readSimpleView(page, templateId);
      mihomo = await fetchMihomo(page, mihomoUrl(view));
      expect(mihomo).not.toContain('sniffer:');

      // Downgrade to Simple: confirmation first, then only the three destinations
      await page.getByTestId('template-tab-routing').click();
      await page.getByTestId('template-tier-simple').click();
      await expect(page.getByTestId('template-tier-downgrade-dialog')).toBeVisible();
      await expect(page.getByTestId('template-tier-downgrade-dialog')).toContainText('不会删除你的自定义');
      await page.getByTestId('template-tier-downgrade-confirm').click();
      await expect(page.getByTestId('template-tier-switch')).toHaveAttribute('data-tier', 'simple');

      await expect(page.getByTestId('simple-hub-cards')).toBeVisible();
      await expect(page.getByTestId('simple-hub-card-proxy')).toBeVisible();
      await expect(page.getByTestId('simple-hub-card-direct')).toBeVisible();
      await expect(page.getByTestId('simple-hub-card-reject')).toBeVisible();
      await expect(page.getByTestId('simple-routing-groups')).toHaveCount(0);
      await expect(page.getByTestId('simple-my-rules-list')).toHaveCount(0);

      // Simple tier hides the pools entirely
      await page.getByTestId('template-tab-nodes').click();
      await expect(page.getByTestId('simple-nodes-pools-card')).toHaveCount(0);

      // 390px: every tab stays inside the viewport in the simple tier
      await page.setViewportSize({ width: 390, height: 844 });
      for (const tab of ['routing', 'nodes', 'modules', 'output'] as const) {
        await page.getByTestId(`template-tab-${tab}`).click();
        await expectNoHorizontalOverflow(page);
      }
    } finally {
      await page.request.delete(`/api/templates/${templateId}`, { headers: JSON_HEADERS }).catch(() => {});
    }
  });

  test('adding a second airport keeps every software link unchanged', async ({ page }) => {
    test.setTimeout(120_000);
    await signInAdmin(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    const suffix = Date.now().toString(36);
    const qcRes = await page.request.post('/api/templates/quick-create', {
      data: {
        name: `R4b 多机场 ${suffix}`,
        complexity: 'advanced',
        clients: ['mihomo', 'shadowrocket'],
        clientDisplayNames: ['Clash Verge Rev', 'Shadowrocket'],
        clientLabels: { mihomo: 'Clash Verge Rev', shadowrocket: 'Shadowrocket' },
        scenarios: [
          { id: 'domestic-direct', enabled: true },
          { id: 'ad-block', enabled: true },
        ],
        rulesets: [],
        groupMode: 'region',
        subscriptionUrl: `https://airport-one.example.test/sub?token=ONE_${suffix}`,
        detectedRegions: ['HK'],
        previewSummary: {
          nodeCount: 2,
          regions: { HK: 2 },
          status: 'ok',
          checkedAt: new Date().toISOString(),
          sampleNames: ['🇭🇰 香港 01', '🇭🇰 香港 02'],
        },
      },
      headers: JSON_HEADERS,
    });
    expect(qcRes.status()).toBe(201);
    const templateId = ((await qcRes.json()) as { template: { id: string } }).template.id;

    try {
      const before = await readSimpleView(page, templateId);
      const linksBefore = before.outputs.flatMap((output) =>
        output.links.map((link) => `${link.client}:${link.url ?? ''}`),
      );
      expect(linksBefore).toHaveLength(2);
      expect(linksBefore.every((item) => !item.endsWith(':'))).toBe(true);

      await page.goto(`/admin/templates/${templateId}?tab=nodes`);
      await expect(page.getByTestId('simple-nodes-tab')).toBeVisible();
      await page.getByTestId('simple-nodes-add-btn').click();
      await expect(page.getByTestId('simple-nodes-sub-form')).toBeVisible();
      await page.getByTestId('simple-nodes-sub-name-input').fill(`机场二 ${suffix}`);
      await page.getByTestId('simple-nodes-sub-input').fill(`https://airport-two.example.test/sub?token=TWO_${suffix}`);
      await page.getByTestId('simple-nodes-sub-save-btn').click();
      await expect(page.getByTestId('simple-nodes-sub-form')).toBeHidden();

      const after = await readSimpleView(page, templateId);
      expect(after.nodes.subscriptions).toHaveLength(2);
      const linksAfter = after.outputs.flatMap((output) =>
        output.links.map((link) => `${link.client}:${link.url ?? ''}`),
      );
      expect(linksAfter).toEqual(linksBefore);

      // Combined mode is offered once there is more than one airport
      await expect(page.getByTestId('simple-combine-mode-merge')).toBeVisible();
      await expect(page.getByTestId('simple-combine-mode-perProvider')).toBeVisible();

      // Every software still serves a valid configuration
      for (const link of after.outputs.flatMap((output) => output.links)) {
        const res = await page.request.get(link.url!);
        expect(res.status()).toBe(200);
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalOverflow(page);
    } finally {
      await page.request.delete(`/api/templates/${templateId}`, { headers: JSON_HEADERS }).catch(() => {});
    }
  });
});
