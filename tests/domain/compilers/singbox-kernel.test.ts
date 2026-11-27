import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILTIN_CARDS } from '../../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../../src/builtin/catalog';
import { buildStarterTemplate, STARTER_TEMPLATE_TIERS } from '../../../src/builtin/templates';
import type { ParsedNode } from '../../../src/domain/nodes/parse';
import { compileSingbox } from '../../../src/domain/templates';
import type { OutputProfile } from '../../../src/shared/clients';
import type { TemplateGroupMode } from '../../../src/shared/schemas/template';

function resolveSingboxBinary(): string | null {
  const candidates = [process.env.SINGBOX_BIN, 'sing-box'].filter((v): v is string => Boolean(v?.trim()));
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['version'], { stdio: 'pipe', timeout: 5_000 });
      return bin;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

const SINGBOX_BIN = resolveSingboxBinary();
const REQUIRE_KERNEL = process.env.REQUIRE_SINGBOX_KERNEL === '1';

if (!SINGBOX_BIN && !REQUIRE_KERNEL) {
  console.info(
    '[singbox-kernel] sing-box binary not found on PATH (or SINGBOX_BIN); skipping `sing-box check` kernel validation locally.',
  );
}

const SAMPLE_REALITY_PUBLIC_KEY = 'cmVhbGl0eS1wdWJsaWMta2V5LWRlbW8tMzItYnl0ZXM';

const SAMPLE_KERNEL_NODES: ParsedNode[] = [
  {
    name: '🇭🇰 HK SS 01',
    type: 'ss',
    server: '198.51.100.1',
    port: 8388,
    cipher: 'aes-256-gcm',
    password: 'demo-password',
    plugin: 'obfs',
    pluginOpts: { mode: 'http', host: 'example.com' },
    udp: true,
    tfo: true,
  },
  {
    name: '🇹🇼 TW VMess 01',
    type: 'vmess',
    server: '198.51.100.2',
    port: 443,
    uuid: '11111111-2222-3333-4444-555555555555',
    alterId: 0,
    security: 'auto',
    packetEncoding: 'xudp',
    tls: { enabled: true, serverName: 'tw.example.com', fingerprint: 'chrome' },
    transport: { type: 'ws', path: '/ws', headers: { Host: 'tw.example.com' } },
  },
  {
    name: '🇺🇸 US VLESS Reality 01',
    type: 'vless',
    server: '198.51.100.3',
    port: 443,
    uuid: '22222222-3333-4444-5555-666666666666',
    flow: 'xtls-rprx-vision',
    tls: {
      enabled: true,
      serverName: 'www.microsoft.com',
      fingerprint: 'chrome',
      reality: {
        publicKey: SAMPLE_REALITY_PUBLIC_KEY,
        shortId: '0123abcd',
      },
    },
  },
  {
    name: '🇯🇵 JP Trojan 01',
    type: 'trojan',
    server: '198.51.100.4',
    port: 443,
    password: 'demo-password',
    tls: { enabled: true, serverName: 'jp.example.com', alpn: ['h2'] },
    transport: { type: 'grpc', serviceName: 'tun-grpc' },
  },
  {
    name: '🇸🇬 SG Hy2 01',
    type: 'hysteria2',
    server: '198.51.100.5',
    port: 443,
    ports: '20000-20010',
    password: 'demo-password',
    upMbps: 50,
    downMbps: 200,
    obfs: { type: 'salamander', password: 'obfs-password' },
    tls: { enabled: true, serverName: 'sg.example.com' },
  },
  {
    name: '🇰🇷 KR TUIC 01',
    type: 'tuic',
    server: '198.51.100.6',
    port: 8443,
    uuid: '33333333-4444-5555-6666-777777777777',
    password: 'demo-password',
    congestionControl: 'bbr',
    udpRelayMode: 'native',
    zeroRttHandshake: true,
    disableSni: true,
    tls: { enabled: true, alpn: ['h3'] },
  },
];

describe('sing-box check kernel config validation', () => {
  if (!SINGBOX_BIN && REQUIRE_KERNEL) {
    it('requires sing-box binary when REQUIRE_SINGBOX_KERNEL=1', () => {
      throw new Error('REQUIRE_SINGBOX_KERNEL=1 is set, but `sing-box` binary was not found on PATH or SINGBOX_BIN.');
    });
    return;
  }

  const runIfKernel = SINGBOX_BIN ? describe : describe.skip;

  runIfKernel('executes real `sing-box check` against all compiled starter configs', () => {
    let workDir = '';

    beforeAll(async () => {
      workDir = await mkdtemp(join(tmpdir(), 'private-rules-singbox-kernel-'));
    });

    afterAll(async () => {
      if (workDir) {
        await rm(workDir, { recursive: true, force: true });
      }
    });

    const outputs: readonly OutputProfile[] = ['full', 'minimal'];
    const groupModes: readonly TemplateGroupMode[] = ['select', 'fallback'];

    for (const tier of STARTER_TEMPLATE_TIERS) {
      for (const output of outputs) {
        for (const groupMode of groupModes) {
          it(`validates ${tier} / ${output} / ${groupMode} with sing-box check`, async () => {
            const tpl = buildStarterTemplate(tier, { groupMode, output });
            const compiled = compileSingbox({
              body: tpl.baseBody,
              cards: BUILTIN_CARDS,
              templateName: tpl.name,
              generatedAt: '2026-01-01T00:00:00.000Z',
              catalogIndex: BUILTIN_CATALOG,
              baseUrl: 'https://rules.example.com',
              slotBindings: {
                'slot-main': {
                  kind: 'snapshot',
                  nodes: SAMPLE_KERNEL_NODES,
                },
              },
            });

            const configPath = join(workDir, `${tier}-${output}-${groupMode}.json`);
            await writeFile(configPath, compiled.content, 'utf8');

            expect(() =>
              execFileSync(SINGBOX_BIN!, ['check', '-c', configPath], {
                encoding: 'utf8',
                stdio: 'pipe',
                timeout: 30_000,
              }),
            ).not.toThrow();
          }, 30_000);
        }
      }
    }

    it('validates dns-leak-guard enabled config (with and without nodes) with sing-box check', async () => {
      const tpl = buildStarterTemplate('standard', { groupMode: 'fallback', output: 'full' });
      tpl.baseBody.modules = tpl.baseBody.modules.map((mod) =>
        mod.id === 'dns-leak-guard' ? { ...mod, enabled: true } : mod,
      );

      for (const [label, bindings] of [
        ['with-nodes', { 'slot-main': { kind: 'snapshot' as const, nodes: SAMPLE_KERNEL_NODES } }],
        ['empty-nodes', undefined],
      ] as const) {
        const compiled = compileSingbox({
          body: tpl.baseBody,
          cards: BUILTIN_CARDS,
          templateName: `${tpl.name} (${label})`,
          generatedAt: '2026-01-01T00:00:00.000Z',
          catalogIndex: BUILTIN_CATALOG,
          baseUrl: 'https://rules.example.com',
          slotBindings: bindings,
        });

        const configPath = join(workDir, `standard-dns-leak-guard-${label}.json`);
        await writeFile(configPath, compiled.content, 'utf8');

        expect(() =>
          execFileSync(SINGBOX_BIN!, ['check', '-c', configPath], {
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: 30_000,
          }),
        ).not.toThrow();
      }
    }, 30_000);
  });
});
