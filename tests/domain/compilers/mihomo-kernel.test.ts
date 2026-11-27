import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILTIN_CARDS } from '../../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../../src/builtin/catalog';
import { buildStarterTemplate, STARTER_TEMPLATE_TIERS } from '../../../src/builtin/templates';
import { splitRulesetByBehavior } from '../../../src/domain/formatters';
import { compileMihomo } from '../../../src/domain/templates';
import type { OutputProfile } from '../../../src/shared/clients';
import type { CatalogEntry } from '../../../src/shared/schemas/card';
import type { TemplateGroupMode } from '../../../src/shared/schemas/template';

function resolveMihomoBinary(): string | null {
  const candidates = [process.env.MIHOMO_BIN, 'mihomo'].filter((v): v is string => Boolean(v?.trim()));
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-v'], { stdio: 'pipe', timeout: 5_000 });
      return bin;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

const MIHOMO_BIN = resolveMihomoBinary();
const REQUIRE_KERNEL = process.env.REQUIRE_MIHOMO_KERNEL === '1';

if (!MIHOMO_BIN && !REQUIRE_KERNEL) {
  console.info(
    '[mihomo-kernel] mihomo binary not found on PATH (or MIHOMO_BIN); skipping `mihomo -t` kernel validation locally.',
  );
}

const MOCK_PROXY_PROVIDER_YAML = `proxies:
  - { name: "🇭🇰 HK-01", type: ss, server: 127.0.0.1, port: 8388, cipher: aes-128-gcm, password: "demo" }
  - { name: "🇹🇼 TW-01", type: ss, server: 127.0.0.1, port: 8389, cipher: aes-128-gcm, password: "demo" }
  - { name: "🇯🇵 JP-01", type: ss, server: 127.0.0.1, port: 8390, cipher: aes-128-gcm, password: "demo" }
  - { name: "🇸🇬 SG-01", type: ss, server: 127.0.0.1, port: 8391, cipher: aes-128-gcm, password: "demo" }
  - { name: "🇺🇸 US-01", type: ss, server: 127.0.0.1, port: 8392, cipher: aes-128-gcm, password: "demo" }
  - { name: "🇰🇷 KR-01", type: ss, server: 127.0.0.1, port: 8393, cipher: aes-128-gcm, password: "demo" }
  - { name: "🇬🇧 UK-01", type: ss, server: 127.0.0.1, port: 8394, cipher: aes-128-gcm, password: "demo" }
  - { name: "🇩🇪 DE-01", type: ss, server: 127.0.0.1, port: 8395, cipher: aes-128-gcm, password: "demo" }
  - { name: "🇫🇷 FR-01", type: ss, server: 127.0.0.1, port: 8396, cipher: aes-128-gcm, password: "demo" }
  - { name: "🇳🇱 NL-01", type: ss, server: 127.0.0.1, port: 8397, cipher: aes-128-gcm, password: "demo" }
  - { name: "🇨🇦 CA-01", type: ss, server: 127.0.0.1, port: 8398, cipher: aes-128-gcm, password: "demo" }
  - { name: "🇦🇺 AU-01", type: ss, server: 127.0.0.1, port: 8399, cipher: aes-128-gcm, password: "demo" }
  - { name: "剩余流量：100GB", type: ss, server: 127.0.0.1, port: 8400, cipher: aes-128-gcm, password: "demo" }
`;

const SPLIT_SAMPLE = splitRulesetByBehavior({
  name: 'Kernel Sample',
  slug: 'custom-direct',
  updatedAt: '2026-01-01T00:00:00.000Z',
  rules: [
    { type: 'DOMAIN', value: 'api.example.com', enabled: true },
    { type: 'DOMAIN-SUFFIX', value: 'example.org', enabled: true },
    { type: 'DOMAIN-KEYWORD', value: 'private-rules', enabled: true },
    { type: 'IP-CIDR', value: '10.0.0.0/8', enabled: true },
    { type: 'IP-CIDR', value: 'fd00::/8', enabled: true },
  ],
});

const MOCK_DOMAIN_YAML = SPLIT_SAMPLE.files.find((f) => f.behavior === 'domain')!.yaml;
const MOCK_CLASSICAL_YAML = SPLIT_SAMPLE.files.find((f) => f.behavior === 'classical')!.yaml;
const MOCK_IPCIDR_YAML = SPLIT_SAMPLE.files.find((f) => f.behavior === 'ipcidr')!.yaml;

describe('mihomo -t kernel config validation', () => {
  if (!MIHOMO_BIN && REQUIRE_KERNEL) {
    it('requires mihomo binary when REQUIRE_MIHOMO_KERNEL=1', () => {
      throw new Error('REQUIRE_MIHOMO_KERNEL=1 is set, but `mihomo` binary was not found on PATH or MIHOMO_BIN.');
    });
    return;
  }

  const runIfKernel = MIHOMO_BIN ? describe : describe.skip;

  runIfKernel('executes real `mihomo -t` against all compiled starter configs', () => {
    let server: Server;
    let baseUrl = '';
    let workDir = '';
    let localCatalog: CatalogEntry[] = [];

    beforeAll(async () => {
      workDir = await mkdtemp(join(tmpdir(), 'private-rules-mihomo-kernel-'));
      server = createServer((req, res) => {
        const url = req.url ?? '/';
        res.statusCode = 200;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        if (url.startsWith('/proxies/')) {
          res.end(MOCK_PROXY_PROVIDER_YAML);
          return;
        }
        if (url.includes('_domain.yaml') || url.includes('/domain')) {
          res.end(MOCK_DOMAIN_YAML);
          return;
        }
        if (url.includes('_ipcidr.yaml') || url.includes('/ipcidr')) {
          res.end(MOCK_IPCIDR_YAML);
          return;
        }
        res.end(MOCK_CLASSICAL_YAML);
      });

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
      });
      const address = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${address.port}`;

      // Point catalog entries to local mock HTTP server for deterministic offline CI validation
      localCatalog = BUILTIN_CATALOG.map((entry) => ({
        ...entry,
        sourceUrl: `${baseUrl}/catalog/${encodeURIComponent(entry.id)}_${entry.behavior ?? 'classical'}.yaml`,
        format: 'yaml',
      }));
    }, 30_000);

    afterAll(async () => {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      if (workDir) {
        await rm(workDir, { recursive: true, force: true });
      }
    });

    const outputs: readonly OutputProfile[] = ['full', 'minimal'];
    const groupModes: readonly TemplateGroupMode[] = ['select', 'fallback'];

    for (const tier of STARTER_TEMPLATE_TIERS) {
      for (const output of outputs) {
        for (const groupMode of groupModes) {
          it(`validates ${tier} / ${output} / ${groupMode} with mihomo -t`, async () => {
            const tpl = buildStarterTemplate(tier, { groupMode, output });
            const compiled = compileMihomo({
              body: tpl.baseBody,
              cards: BUILTIN_CARDS,
              templateName: tpl.name,
              generatedAt: '2026-01-01T00:00:00.000Z',
              catalogIndex: localCatalog,
              rulesetBehaviors: new Map([['custom-direct', SPLIT_SAMPLE.counts]]),
              baseUrl,
              slotBindings: {
                'slot-main': {
                  kind: 'http',
                  url: `${baseUrl}/proxies/main.yaml`,
                  userAgent: 'clash-verge/v2.5.1',
                },
              },
            });

            const configPath = join(workDir, `${tier}-${output}-${groupMode}.yaml`);
            await writeFile(configPath, compiled.content, 'utf8');

            const stdout = execFileSync(MIHOMO_BIN!, ['-t', '-d', workDir, '-f', configPath], {
              encoding: 'utf8',
              timeout: 120_000,
            });
            expect(stdout).toContain('is successful');
          }, 120_000);
        }
      }
    }

    it('validates dns-leak-guard enabled config with mihomo -t', async () => {
      const tpl = buildStarterTemplate('standard', { groupMode: 'fallback', output: 'full' });
      tpl.baseBody.modules = tpl.baseBody.modules.map((mod) =>
        mod.id === 'dns-leak-guard' ? { ...mod, enabled: true } : mod,
      );
      const compiled = compileMihomo({
        body: tpl.baseBody,
        cards: BUILTIN_CARDS,
        templateName: `${tpl.name} (DNS Leak Guard)`,
        generatedAt: '2026-01-01T00:00:00.000Z',
        catalogIndex: localCatalog,
        rulesetBehaviors: new Map([['custom-direct', SPLIT_SAMPLE.counts]]),
        baseUrl,
        slotBindings: {
          'slot-main': {
            kind: 'http',
            url: `${baseUrl}/proxies/main.yaml`,
          },
        },
      });

      const configPath = join(workDir, 'standard-dns-leak-guard.yaml');
      await writeFile(configPath, compiled.content, 'utf8');

      const stdout = execFileSync(MIHOMO_BIN!, ['-t', '-d', workDir, '-f', configPath], {
        encoding: 'utf8',
        timeout: 120_000,
      });
      expect(stdout).toContain('is successful');
    }, 120_000);

    it('validates multi-airport recommended config with mihomo -t', async () => {
      const tpl = buildStarterTemplate('recommended', { groupMode: 'select', output: 'full' });
      tpl.baseBody.slots = [
        { id: 'slot-main', name: '主力机场', excludeInfo: true },
        { id: 'slot-backup', name: '备用机场', excludeInfo: true },
      ];
      const compiled = compileMihomo({
        body: tpl.baseBody,
        cards: BUILTIN_CARDS,
        templateName: `${tpl.name} (Multi-Airport)`,
        generatedAt: '2026-01-01T00:00:00.000Z',
        catalogIndex: localCatalog,
        rulesetBehaviors: new Map([['custom-direct', SPLIT_SAMPLE.counts]]),
        baseUrl,
        slotBindings: {
          'slot-main': { kind: 'http', url: `${baseUrl}/proxies/main.yaml` },
          'slot-backup': { kind: 'http', url: `${baseUrl}/proxies/backup.yaml` },
        },
      });

      const configPath = join(workDir, 'recommended-multi-airport.yaml');
      await writeFile(configPath, compiled.content, 'utf8');

      const stdout = execFileSync(MIHOMO_BIN!, ['-t', '-d', workDir, '-f', configPath], {
        encoding: 'utf8',
        timeout: 120_000,
      });
      expect(stdout).toContain('is successful');
    }, 120_000);

    it('validates legacyGeodata compatibility mode config with mihomo -t', async () => {
      const tpl = buildStarterTemplate('recommended', { groupMode: 'select', output: 'full' });
      tpl.baseBody.legacyGeodata = true;
      const compiled = compileMihomo({
        body: tpl.baseBody,
        cards: BUILTIN_CARDS,
        templateName: `${tpl.name} (Legacy Geodata)`,
        generatedAt: '2026-01-01T00:00:00.000Z',
        catalogIndex: localCatalog,
        rulesetBehaviors: new Map([['custom-direct', SPLIT_SAMPLE.counts]]),
        baseUrl,
        slotBindings: {
          'slot-main': { kind: 'http', url: `${baseUrl}/proxies/main.yaml` },
        },
      });

      const configPath = join(workDir, 'recommended-legacy-geodata.yaml');
      await writeFile(configPath, compiled.content, 'utf8');

      const stdout = execFileSync(MIHOMO_BIN!, ['-t', '-d', workDir, '-f', configPath], {
        encoding: 'utf8',
        timeout: 120_000,
      });
      expect(stdout).toContain('is successful');
    }, 120_000);
  });
});
