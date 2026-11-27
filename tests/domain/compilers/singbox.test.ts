import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS } from '../../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../../src/builtin/catalog';
import { buildStarterTemplate, STARTER_TEMPLATE_TIERS } from '../../../src/builtin/templates';
import type { ParsedNode } from '../../../src/domain/nodes/parse';
import {
  CLIENT_CAPABILITIES,
  compileSingbox,
  compileTemplate,
  formatSingboxDuration,
  isGroupTypeSupported,
  isRuleTypeSupported,
  mapParsedNodeToSingboxOutbound,
  sanitizeSingboxRuleSetTag,
  sanitizeSingboxScalar,
  sanitizeSingboxTag,
  SINGBOX_MIN_VERSION,
  type AppCard,
  type TemplateBody,
} from '../../../src/domain/templates';
import { SUPPORTED_TEMPLATE_CLIENTS, type OutputProfile } from '../../../src/shared/clients';
import type { TemplateGroupMode } from '../../../src/shared/schemas/template';

const FIXED_GENERATED_AT = '2026-01-01T00:00:00.000Z';
const FIXED_BASE_URL = 'https://rules.example.com';
const SAMPLE_REALITY_PUBLIC_KEY = 'cmVhbGl0eS1wdWJsaWMta2V5LWRlbW8tMzItYnl0ZXM';

const SIX_PROTOCOL_NODES: ParsedNode[] = [
  {
    name: '🇭🇰 香港 SS 01',
    type: 'ss',
    server: 'hk-ss.example.com',
    port: 8388,
    cipher: 'aes-256-gcm',
    password: 'ss-password-1',
    plugin: 'obfs',
    pluginOpts: { mode: 'http', host: 'bing.com' },
    udp: true,
    tfo: true,
  },
  {
    name: '🇹🇼 台湾 VMess WS 01',
    type: 'vmess',
    server: 'tw-vmess.example.com',
    port: 443,
    uuid: '11111111-2222-3333-4444-555555555555',
    alterId: 0,
    security: 'auto',
    packetEncoding: 'xudp',
    tls: {
      enabled: true,
      serverName: 'tw-vmess.example.com',
      alpn: ['http/1.1'],
      fingerprint: 'chrome',
    },
    transport: {
      type: 'ws',
      path: '/ws?ed=2048',
      headers: { Host: 'cdn.tw-vmess.example.com' },
      maxEarlyData: 2048,
      earlyDataHeaderName: 'Sec-WebSocket-Protocol',
    },
  },
  {
    name: '🇺🇸 美国 VLESS Reality 01',
    type: 'vless',
    server: 'us-vless.example.com',
    port: 443,
    uuid: '22222222-3333-4444-5555-666666666666',
    flow: 'xtls-rprx-vision',
    tls: {
      enabled: true,
      serverName: 'www.microsoft.com',
      fingerprint: 'safari',
      reality: {
        publicKey: SAMPLE_REALITY_PUBLIC_KEY,
        shortId: '0123abcd',
      },
    },
  },
  {
    name: '🇯🇵 日本 Trojan gRPC 01',
    type: 'trojan',
    server: 'jp-trojan.example.com',
    port: 443,
    password: 'trojan-password-1',
    tls: {
      enabled: true,
      serverName: 'jp-trojan.example.com',
      alpn: ['h2'],
    },
    transport: {
      type: 'grpc',
      serviceName: 'tun-grpc',
    },
  },
  {
    name: '🇸🇬 新加坡 Hy2 01',
    type: 'hysteria2',
    server: 'sg-hy2.example.com',
    port: 443,
    ports: '20000-20010,443',
    password: 'hy2-password-1',
    upMbps: 50,
    downMbps: 200,
    obfs: { type: 'salamander', password: 'obfs-password-1' },
    tls: {
      enabled: true,
      serverName: 'sg-hy2.example.com',
      insecure: true,
    },
  },
  {
    name: '🇰🇷 韩国 TUIC 01',
    type: 'tuic',
    server: 'kr-tuic.example.com',
    port: 8443,
    uuid: '33333333-4444-5555-6666-777777777777',
    password: 'tuic-password-1',
    congestionControl: 'bbr',
    udpRelayMode: 'native',
    zeroRttHandshake: true,
    disableSni: true,
    tls: {
      enabled: true,
      alpn: ['h3'],
    },
  },
  {
    name: '剩余流量：120GB',
    type: 'ss',
    server: 'info.example.com',
    port: 8388,
    cipher: 'aes-128-gcm',
    password: 'info',
  },
];

const STANDARD_SNAPSHOT_BINDINGS = {
  'slot-main': {
    kind: 'snapshot' as const,
    nodes: SIX_PROTOCOL_NODES,
    fetchedAt: FIXED_GENERATED_AT,
    expiresAt: '2026-01-01T00:30:00.000Z',
    stale: false,
  },
};

type ParsedSingboxDoc = {
  log?: Record<string, unknown>;
  dns?: {
    servers: Array<Record<string, unknown>>;
    rules: Array<Record<string, unknown>>;
    final: string;
    strategy?: string;
  };
  inbounds?: Array<Record<string, unknown>>;
  outbounds: Array<Record<string, unknown> & { type: string; tag: string; outbounds?: string[] }>;
  route: {
    rules: Array<Record<string, unknown>>;
    rule_set?: Array<Record<string, unknown> & { tag: string; type: string }>;
    final: string;
    auto_detect_interface?: boolean;
    default_domain_resolver?: string;
  };
  experimental?: Record<string, unknown>;
};

describe('client capability matrix (sing-box 1.12 official docs audit)', () => {
  it('matches official sing-box 1.12 capabilities and helper predicates', () => {
    expect(SINGBOX_MIN_VERSION).toBe('1.12');
    const sb = CLIENT_CAPABILITIES['sing-box'];
    expect(sb.geosite).toBe('ruleset');
    expect(sb.geoip).toBe('ruleset');
    expect(sb.logicalRules).toBe(true);
    expect(sb.remoteRuleset).toBe(true);
    expect(sb.inlineRuleset).toBe(true);
    expect(sb.remoteNodes).toBe('none');
    expect(sb.nodeRegexFilter).toBe(true);
    expect(sb.groupIcons).toBe(false);
    expect(sb.noResolve).toBe(false);
    expect(sb.rejectDrop).toBe(true);
    expect(sb.remoteRulesetField).toBe('route.rule_set');
    expect(sb.finalRuleKeyword).toBe('route.final');
    expect(sb.ipV6RuleType).toBe('ip_cidr');
    expect(sb.supportsRespectRules).toBe(true);
    expect(sb.supportsDnsRedirHost).toBe(true);

    // 11 of 14 canonical rule types supported (USER-AGENT, URL-REGEX, IP-ASN unsupported)
    expect(sb.supportedRuleTypes.size).toBe(11);
    expect(isRuleTypeSupported('sing-box', 'USER-AGENT')).toBe(false);
    expect(isRuleTypeSupported('sing-box', 'URL-REGEX')).toBe(false);
    expect(isRuleTypeSupported('sing-box', 'IP-ASN')).toBe(false);
    expect(isRuleTypeSupported('sing-box', 'DOMAIN-REGEX')).toBe(true);
    expect(isRuleTypeSupported('sing-box', 'SRC-IP-CIDR')).toBe(true);
    expect(isRuleTypeSupported('sing-box', 'DST-PORT')).toBe(true);
    expect(isRuleTypeSupported('sing-box', 'SRC-PORT')).toBe(true);
    expect(isRuleTypeSupported('sing-box', 'PROCESS-NAME')).toBe(true);

    expect(isGroupTypeSupported('sing-box', 'select')).toBe(true);
    expect(isGroupTypeSupported('sing-box', 'url-test')).toBe(true);
    expect(isGroupTypeSupported('sing-box', 'fallback')).toBe(false);
    expect(isGroupTypeSupported('sing-box', 'load-balance')).toBe(false);
  });
});

describe('compileSingbox — 4 starter tiers × (full/minimal) × (select/fallback) snapshots', () => {
  const outputs: readonly OutputProfile[] = ['full', 'minimal'];
  const groupModes: readonly TemplateGroupMode[] = ['select', 'fallback'];

  for (const tier of STARTER_TEMPLATE_TIERS) {
    for (const output of outputs) {
      for (const groupMode of groupModes) {
        it(`matches snapshot for ${tier} / ${output} / ${groupMode}`, () => {
          const tpl = buildStarterTemplate(tier, { groupMode, output });
          const result = compileTemplate('sing-box', {
            body: tpl.baseBody,
            cards: BUILTIN_CARDS,
            templateName: tpl.name,
            generatedAt: FIXED_GENERATED_AT,
            catalogIndex: BUILTIN_CATALOG,
            baseUrl: FIXED_BASE_URL,
            slotBindings: STANDARD_SNAPSHOT_BINDINGS,
          });

          expect(result.client).toBe('sing-box');
          expect(result.output).toBe(output);
          expect(result.contentType).toBe('application/json; charset=utf-8');
          expect(result.extension).toBe('.json');

          // Must be strictly valid, deterministic JSON
          const parsed = JSON.parse(result.content) as ParsedSingboxDoc;
          expect(parsed.outbounds.length).toBeGreaterThan(0);
          expect(parsed.route.rules.length).toBeGreaterThan(0);
          expect(parsed.route.final).toBeTruthy();

          // Info banner node must be excluded by slot.excludeInfo
          expect(parsed.outbounds.some((o) => o.tag.includes('剩余流量'))).toBe(false);
          // All 6 real nodes must be inlined
          expect(result.report.stats.inlineProxies).toBe(6);

          // Every referenced outbound tag and rule_set tag must exist
          const outboundTags = new Set(parsed.outbounds.map((o) => o.tag));
          expect(outboundTags.has(parsed.route.final)).toBe(true);
          for (const ob of parsed.outbounds) {
            if (ob.outbounds) {
              expect(ob.outbounds.length).toBeGreaterThan(0);
              for (const child of ob.outbounds) {
                expect(outboundTags.has(child), `Missing outbound child ${child} in ${ob.tag}`).toBe(true);
              }
            }
          }
          const ruleSetTags = new Set((parsed.route.rule_set ?? []).map((rs) => rs.tag));
          for (const rule of parsed.route.rules) {
            if (Array.isArray(rule.rule_set)) {
              for (const rsTag of rule.rule_set as string[]) {
                expect(ruleSetTags.has(rsTag), `Missing rule_set tag ${rsTag}`).toBe(true);
              }
            }
            if (typeof rule.outbound === 'string') {
              expect(outboundTags.has(rule.outbound), `Missing route outbound ${rule.outbound}`).toBe(true);
            }
          }

          if (output === 'minimal') {
            expect(parsed.log).toBeUndefined();
            expect(parsed.dns).toBeUndefined();
            expect(parsed.inbounds).toBeUndefined();
            expect(parsed.experimental).toBeUndefined();
            expect(parsed.route.default_domain_resolver).toBeUndefined();
            expect(result.report.items.some((i) => i.code === 'MINIMAL_OMITTED_SECTIONS')).toBe(true);
          } else {
            expect(parsed.log).toBeDefined();
            expect(parsed.dns).toBeDefined();
            expect(parsed.inbounds).toBeDefined();
            expect(parsed.experimental).toBeDefined();
            expect(parsed.route.default_domain_resolver).toBe('dns-bootstrap');
          }

          if (groupMode === 'fallback') {
            expect(result.report.items.some((i) => i.code === 'UNSUPPORTED_GROUP_TYPE')).toBe(true);
          }

          // Deterministic output check
          const second = compileSingbox({
            body: tpl.baseBody,
            cards: BUILTIN_CARDS,
            templateName: tpl.name,
            generatedAt: FIXED_GENERATED_AT,
            catalogIndex: BUILTIN_CATALOG,
            baseUrl: FIXED_BASE_URL,
            slotBindings: STANDARD_SNAPSHOT_BINDINGS,
          });
          expect(second.content).toBe(result.content);

          expect(result.content).toMatchSnapshot();
        });
      }
    }
  }
});

describe('mapParsedNodeToSingboxOutbound — all 6 proxy protocols', () => {
  it('maps Shadowsocks with obfs-local / v2ray-plugin and warns on unsupported plugin', () => {
    const obfs = mapParsedNodeToSingboxOutbound(SIX_PROTOCOL_NODES[0]!, 'hk-ss');
    expect(obfs.warnings).toEqual([]);
    expect(obfs.outbound).toEqual({
      type: 'shadowsocks',
      tag: 'hk-ss',
      server: 'hk-ss.example.com',
      server_port: 8388,
      method: 'aes-256-gcm',
      password: 'ss-password-1',
      plugin: 'obfs-local',
      plugin_opts: 'obfs-host=bing.com;obfs=http',
      tcp_fast_open: true,
    });

    const v2 = mapParsedNodeToSingboxOutbound(
      {
        name: 'ss-v2',
        type: 'ss',
        server: '1.2.3.4',
        port: 443,
        cipher: 'chacha20-ietf-poly1305',
        password: 'pw',
        plugin: 'v2ray-plugin',
        pluginOpts: { mode: 'websocket', tls: true, host: 'cdn.example.com', path: '/v2' },
        udp: false,
      },
      'ss-v2',
    );
    expect(v2.warnings).toEqual([]);
    expect(v2.outbound).toMatchObject({
      type: 'shadowsocks',
      plugin: 'v2ray-plugin',
      plugin_opts: 'host=cdn.example.com;mode=websocket;path=/v2;tls',
      network: 'tcp',
    });

    const unsupported = mapParsedNodeToSingboxOutbound(
      {
        name: 'ss-stls',
        type: 'ss',
        server: '1.2.3.4',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'pw',
        plugin: 'shadow-tls',
      },
      'ss-stls',
    );
    expect(unsupported.outbound?.plugin).toBeUndefined();
    expect(unsupported.warnings.some((w) => w.code === 'UNSUPPORTED_CLIENT_FEATURE')).toBe(true);
  });

  it('maps VMess with WS transport, early data, TLS, uTLS, and xudp', () => {
    const res = mapParsedNodeToSingboxOutbound(SIX_PROTOCOL_NODES[1]!, 'tw-vmess');
    expect(res.warnings).toEqual([]);
    expect(res.outbound).toEqual({
      type: 'vmess',
      tag: 'tw-vmess',
      server: 'tw-vmess.example.com',
      server_port: 443,
      uuid: '11111111-2222-3333-4444-555555555555',
      security: 'auto',
      alter_id: 0,
      packet_encoding: 'xudp',
      tls: {
        enabled: true,
        server_name: 'tw-vmess.example.com',
        alpn: ['http/1.1'],
        utls: { enabled: true, fingerprint: 'chrome' },
      },
      transport: {
        type: 'ws',
        path: '/ws?ed=2048',
        headers: { Host: 'cdn.tw-vmess.example.com' },
        max_early_data: 2048,
        early_data_header_name: 'Sec-WebSocket-Protocol',
      },
    });
  });

  it('maps VLESS with Reality, auto-enables uTLS if fingerprint omitted, and maps http/httpupgrade transports', () => {
    const res = mapParsedNodeToSingboxOutbound(SIX_PROTOCOL_NODES[2]!, 'us-vless');
    expect(res.warnings).toEqual([]);
    expect(res.outbound).toEqual({
      type: 'vless',
      tag: 'us-vless',
      server: 'us-vless.example.com',
      server_port: 443,
      uuid: '22222222-3333-4444-5555-666666666666',
      flow: 'xtls-rprx-vision',
      tls: {
        enabled: true,
        server_name: 'www.microsoft.com',
        utls: { enabled: true, fingerprint: 'safari' },
        reality: {
          enabled: true,
          public_key: SAMPLE_REALITY_PUBLIC_KEY,
          short_id: '0123abcd',
        },
      },
    });

    // Reality without explicit fingerprint MUST auto-add utls.enabled=true (required by sing-box)
    const noFp = mapParsedNodeToSingboxOutbound(
      {
        name: 'vless-auto-utls',
        type: 'vless',
        server: 'reality.example.com',
        port: 443,
        uuid: '22222222-3333-4444-5555-666666666666',
        encryption: 'custom-enc',
        tls: {
          enabled: true,
          serverName: 'www.apple.com',
          reality: { publicKey: SAMPLE_REALITY_PUBLIC_KEY },
        },
        transport: {
          type: 'httpupgrade',
          host: 'up.example.com',
          path: '/upgrade',
        },
      },
      'vless-auto-utls',
    );
    expect(noFp.outbound?.tls).toMatchObject({
      enabled: true,
      utls: { enabled: true, fingerprint: 'chrome' },
      reality: { enabled: true, public_key: SAMPLE_REALITY_PUBLIC_KEY },
    });
    expect(noFp.outbound?.transport).toEqual({
      type: 'httpupgrade',
      host: 'up.example.com',
      path: '/upgrade',
    });
    expect(noFp.warnings.some((w) => w.code === 'UNSUPPORTED_CLIENT_FEATURE')).toBe(true);
  });

  it('maps Trojan with TLS and gRPC transport', () => {
    const res = mapParsedNodeToSingboxOutbound(SIX_PROTOCOL_NODES[3]!, 'jp-trojan');
    expect(res.warnings).toEqual([]);
    expect(res.outbound).toEqual({
      type: 'trojan',
      tag: 'jp-trojan',
      server: 'jp-trojan.example.com',
      server_port: 443,
      password: 'trojan-password-1',
      tls: {
        enabled: true,
        server_name: 'jp-trojan.example.com',
        alpn: ['h2'],
      },
      transport: {
        type: 'grpc',
        service_name: 'tun-grpc',
      },
    });
  });

  it('maps Hysteria2 with salamander obfs and mutually-exclusive server_ports vs server_port', () => {
    const withPorts = mapParsedNodeToSingboxOutbound(SIX_PROTOCOL_NODES[4]!, 'sg-hy2');
    expect(withPorts.warnings).toEqual([]);
    expect(withPorts.outbound).toEqual({
      type: 'hysteria2',
      tag: 'sg-hy2',
      server: 'sg-hy2.example.com',
      server_ports: ['20000:20010', '443:443'],
      up_mbps: 50,
      down_mbps: 200,
      obfs: { type: 'salamander', password: 'obfs-password-1' },
      password: 'hy2-password-1',
      tls: {
        enabled: true,
        server_name: 'sg-hy2.example.com',
        insecure: true,
      },
    });
    expect(withPorts.outbound?.server_port).toBeUndefined();

    const singlePort = mapParsedNodeToSingboxOutbound(
      {
        name: 'hy2-single',
        type: 'hysteria2',
        server: 'hy2.example.com',
        port: 8443,
        password: 'pw',
        obfs: { type: 'unknown-obfs', password: 'x' },
      },
      'hy2-single',
    );
    expect(singlePort.outbound?.server_port).toBe(8443);
    expect(singlePort.outbound?.server_ports).toBeUndefined();
    expect(singlePort.outbound?.obfs).toBeUndefined();
    expect(singlePort.warnings.some((w) => w.code === 'UNSUPPORTED_CLIENT_FEATURE')).toBe(true);
  });

  it('maps TUIC with congestion_control, udp_relay_mode, zero_rtt_handshake, and disable_sni', () => {
    const res = mapParsedNodeToSingboxOutbound(SIX_PROTOCOL_NODES[5]!, 'kr-tuic');
    expect(res.warnings).toEqual([]);
    expect(res.outbound).toEqual({
      type: 'tuic',
      tag: 'kr-tuic',
      server: 'kr-tuic.example.com',
      server_port: 8443,
      uuid: '33333333-4444-5555-6666-777777777777',
      password: 'tuic-password-1',
      congestion_control: 'bbr',
      udp_relay_mode: 'native',
      zero_rtt_handshake: true,
      tls: {
        enabled: true,
        disable_sni: true,
        alpn: ['h3'],
      },
    });
  });
});

describe('compileSingbox — special characters, DNS leak guard, rulesets, compatibility report', () => {
  it('safely serializes special characters in node names without breaking JSON', () => {
    const trickyNodes: ParsedNode[] = [
      {
        name: '🇭🇰 "Quoted" \\ Backslash {brace} [bracket],DIRECT',
        type: 'ss',
        server: '1.1.1.1',
        port: 8388,
        cipher: 'aes-128-gcm',
        password: 'p"w\\1\n2',
      },
      {
        name: '🇯🇵 Line\nBreak\r\nTab\tControl\x00Node',
        type: 'trojan',
        server: '2.2.2.2',
        port: 443,
        password: 'trojan"\\pw',
      },
      {
        name: '🇭🇰 "Quoted" \\ Backslash {brace} [bracket],DIRECT',
        type: 'ss',
        server: '3.3.3.3',
        port: 8389,
        cipher: 'aes-128-gcm',
        password: 'pw2',
      },
    ];

    const tpl = buildStarterTemplate('all', { output: 'minimal' });
    const res = compileSingbox({
      body: tpl.baseBody,
      cards: BUILTIN_CARDS,
      slotBindings: {
        'slot-main': {
          kind: 'snapshot',
          nodes: trickyNodes,
        },
      },
    });

    const parsed = JSON.parse(res.content) as ParsedSingboxDoc;
    const nodeOutbounds = parsed.outbounds.filter((o) => o.type === 'shadowsocks' || o.type === 'trojan');
    expect(nodeOutbounds).toHaveLength(3);
    expect(nodeOutbounds[0]!.tag).toBe('🇭🇰 "Quoted" \\ Backslash {brace} [bracket],DIRECT');
    expect(nodeOutbounds[1]!.tag).toBe('🇯🇵 Line Break Tab Control Node');
    expect(nodeOutbounds[2]!.tag).toBe('🇭🇰 "Quoted" \\ Backslash {brace} [bracket],DIRECT (2)');

    // Region filtering must still match the HK and JP nodes by original name
    const hkGroup = parsed.outbounds.find((o) => o.tag.includes('香港'));
    expect(hkGroup?.outbounds).toEqual([
      '🇭🇰 "Quoted" \\ Backslash {brace} [bracket],DIRECT',
      '🇭🇰 "Quoted" \\ Backslash {brace} [bracket],DIRECT (2)',
    ]);
  });

  it('emits sing-box 1.12 DNS syntax for dns-leak-guard (with nodes and with empty nodes)', () => {
    const tpl = buildStarterTemplate('standard', { output: 'full' });
    tpl.baseBody.modules = tpl.baseBody.modules.map((m) => (m.id === 'dns-leak-guard' ? { ...m, enabled: true } : m));

    const withNodes = compileSingbox({
      body: tpl.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      slotBindings: STANDARD_SNAPSHOT_BINDINGS,
    });
    const parsedWithNodes = JSON.parse(withNodes.content) as ParsedSingboxDoc;
    expect(withNodes.report.stats.appliedModules).toContain('dns-leak-guard');
    expect(parsedWithNodes.dns).toBeDefined();
    expect(parsedWithNodes.dns!.servers.some((s) => s.type === 'local' || s.type === 'dhcp')).toBe(false);
    expect(parsedWithNodes.dns!.final).toBe('dns-remote');
    expect(parsedWithNodes.route.default_domain_resolver).toBe('dns-bootstrap');
    const remoteServer = parsedWithNodes.dns!.servers.find((s) => s.tag === 'dns-remote');
    expect(remoteServer?.detour).toBe('🔒 防泄漏兜底');
    expect(parsedWithNodes.route.final).toBe('🔒 防泄漏兜底');
    expect(parsedWithNodes.dns!.servers.some((s) => s.type === 'fakeip')).toBe(true);

    // Without any nodes, dns-leak-guard must NOT fall back to `direct`; it appends a catch-all reject rule
    const withoutNodes = compileSingbox({
      body: tpl.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
    });
    const parsedEmpty = JSON.parse(withoutNodes.content) as ParsedSingboxDoc;
    const lastRule = parsedEmpty.route.rules[parsedEmpty.route.rules.length - 1];
    expect(lastRule).toEqual({
      network: ['tcp', 'udp'],
      action: 'reject',
      method: 'drop',
    });
  });

  it('reports stale snapshots, skipped nodes, unsupported rule types, inline rule_sets, and applies JSON clientPatch', () => {
    const customCard: AppCard = {
      id: 'custom-test',
      slug: 'custom-test',
      name: '🧪 自定义测试',
      category: 'other',
      stage: 'app',
      origin: 'user',
      group: {
        type: 'load-balance',
        candidates: [{ kind: 'slot', slotId: 'slot-main' }],
      },
      matchers: [
        { kind: 'ruleset', ruleSetId: 'my-private-rules' },
        { kind: 'remote', url: 'https://example.com/custom.list', behavior: 'classical', format: 'text' },
        { kind: 'remote', url: 'https://example.com/inline-override.list', behavior: 'domain', format: 'text' },
        {
          kind: 'inline',
          conditions: [
            { op: 'rule', rule: { type: 'DOMAIN', value: 'api.example.com' } },
            { op: 'rule', rule: { type: 'USER-AGENT', value: 'BadBot*' } },
            { op: 'rule', rule: { type: 'URL-REGEX', value: '^https://bad' } },
            { op: 'rule', rule: { type: 'IP-ASN', value: '13335' } },
            { op: 'rule', rule: { type: 'DST-PORT', value: '8000-8080/443' } },
          ],
        },
      ],
    };

    const body: TemplateBody = {
      slots: [{ id: 'slot-main', name: '主力', excludeInfo: true, udp: true }],
      regionGroups: [],
      cards: [{ cardId: 'custom-test', enabled: true }],
      groupMode: 'select',
      final: { kind: 'builtin', id: 'DIRECT' },
      output: 'full',
      dns: { mode: 'redir-host' },
      modules: [],
      clientPatches: {
        'sing-box': JSON.stringify({ log: { level: 'debug' } }),
      },
    };

    const res = compileSingbox({
      body,
      cards: [customCard],
      baseUrl: FIXED_BASE_URL,
      inlineRulePayloads: {
        'remote-custom-test-domain': ['+.inline.example.com', 'exact.example.com'],
      },
      slotBindings: {
        'slot-main': {
          kind: 'snapshot',
          nodes: [SIX_PROTOCOL_NODES[0]!],
          stale: true,
          staleReason: 'Upstream HTTP 503',
          fetchedAt: '2026-01-01T00:00:00.000Z',
          report: {
            format: 'clash-yaml',
            totalEntries: 3,
            parsedCount: 1,
            skippedCount: 2,
            truncated: false,
            truncatedCount: 0,
            protocolCounts: { ss: 1 },
            unsupportedProtocols: { ssr: 1, wireguard: 1 },
            malformedCount: 0,
            skipped: [],
          },
        },
      },
    });

    const parsed = JSON.parse(res.content) as ParsedSingboxDoc;
    // Patch merged
    expect(parsed.log?.level).toBe('debug');
    // redir-host mode emits no fakeip server
    expect(parsed.dns?.servers.some((s) => s.type === 'fakeip')).toBe(false);
    // Self-hosted ruleset uses -sing-box.json source format
    expect(parsed.route.rule_set).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'ruleset-my-private-rules',
          type: 'remote',
          format: 'source',
          url: 'https://rules.example.com/rules/my-private-rules-sing-box.json',
        }),
        expect.objectContaining({
          type: 'inline',
          rules: [{ domain: ['exact.example.com'], domain_suffix: ['inline.example.com'] }],
        }),
      ]),
    );
    // Port range + single port compiled cleanly
    expect(parsed.route.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ port: [443], port_range: ['8000:8080'], outbound: '🧪 自定义测试' }),
      ]),
    );
    // Compatibility report covers all warnings/info
    const codes = res.report.items.map((i) => i.code);
    expect(codes).toContain('STALE_NODE_SNAPSHOT');
    expect(codes).toContain('SKIPPED_UNSUPPORTED_NODES');
    expect(codes).toContain('UNSUPPORTED_GROUP_TYPE');
    expect(codes).toContain('UNSUPPORTED_REMOTE_FORMAT');
    expect(codes).toContain('UNSUPPORTED_RULE_TYPE');
    expect(res.report.stats.skippedRules).toBe(4); // 3 unsupported inline types + 1 skipped .list remote
  });

  it('helper sanitizers and duration formatter behave deterministically', () => {
    expect(sanitizeSingboxScalar(' a\nb\tc ')).toBe('a b c');
    expect(sanitizeSingboxTag('  ', 'Fallback')).toBe('Fallback');
    expect(sanitizeSingboxRuleSetTag('GeoSite / AI!CN')).toBe('geosite-ai-cn');
    expect(formatSingboxDuration(28800)).toBe('8h');
    expect(formatSingboxDuration(300)).toBe('5m');
    expect(formatSingboxDuration(90)).toBe('1m30s');
  });

  it('deduplicates multi-airport colliding node names with "机场名 · 节点名", supports perProvider groups, and compiles cleanly with zero slots across all compilers', () => {
    const sharedNodes: ParsedNode[] = [
      {
        name: '🇭🇰 香港 01',
        type: 'ss',
        server: 'hk-a.example.com',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'pw-a',
      },
      {
        name: '🇯🇵 日本 01',
        type: 'trojan',
        server: 'jp-a.example.com',
        port: 443,
        password: 'pw-a',
      },
    ];
    const backupNodes: ParsedNode[] = [
      {
        name: '🇭🇰 香港 01',
        type: 'ss',
        server: 'hk-b.example.com',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'pw-b',
      },
      {
        name: '🇺🇸 美国 01',
        type: 'trojan',
        server: 'us-b.example.com',
        port: 443,
        password: 'pw-b',
      },
    ];

    const tpl = buildStarterTemplate('all', { output: 'minimal' });
    tpl.baseBody.combineMode = 'perProvider';
    tpl.baseBody.slots = [
      { id: 'slot-main', name: '主力机场', excludeInfo: true, udp: true },
      { id: 'slot-2', name: '备用机场', excludeInfo: true, udp: true },
    ];

    const compiled = compileSingbox({
      body: tpl.baseBody,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      baseUrl: FIXED_BASE_URL,
      slotBindings: {
        'slot-main': { kind: 'snapshot', nodes: sharedNodes },
        'slot-2': { kind: 'snapshot', nodes: backupNodes },
      },
    });
    const doc = JSON.parse(compiled.content) as ParsedSingboxDoc;
    const nodeTags = doc.outbounds.filter((o) => o.type === 'shadowsocks' || o.type === 'trojan').map((o) => o.tag);

    expect(nodeTags).toEqual([
      '主力机场 · 🇭🇰 香港 01',
      '主力机场 · 🇯🇵 日本 01',
      '备用机场 · 🇭🇰 香港 01',
      '备用机场 · 🇺🇸 美国 01',
    ]);
    // All outbound tags are strictly unique
    expect(new Set(doc.outbounds.map((o) => o.tag)).size).toBe(doc.outbounds.length);

    // Region groups still match original node names across both airports
    const hkGroup = doc.outbounds.find((o) => o.tag.includes('香港'));
    expect(hkGroup?.outbounds).toEqual(['主力机场 · 🇭🇰 香港 01', '备用机场 · 🇭🇰 香港 01']);

    // perProvider emits one url-test group per airport + 🌐 全部节点 and wires them into proxy-select
    const mainProvider = doc.outbounds.find((o) => o.tag === '主力机场');
    const backupProvider = doc.outbounds.find((o) => o.tag === '备用机场');
    const allNodesGroup = doc.outbounds.find((o) => o.tag === '🌐 全部节点');
    expect(mainProvider).toMatchObject({
      type: 'urltest',
      outbounds: ['主力机场 · 🇭🇰 香港 01', '主力机场 · 🇯🇵 日本 01'],
    });
    expect(backupProvider).toMatchObject({
      type: 'urltest',
      outbounds: ['备用机场 · 🇭🇰 香港 01', '备用机场 · 🇺🇸 美国 01'],
    });
    expect(allNodesGroup).toMatchObject({
      type: 'selector',
      outbounds: nodeTags,
    });
    const proxySelect = doc.outbounds.find((o) => o.tag === '🚀 节点选择');
    expect(proxySelect?.outbounds).toContain('主力机场');
    expect(proxySelect?.outbounds).toContain('备用机场');
    expect(proxySelect?.outbounds).toContain('🌐 全部节点');

    // Deleting the last slot compiles cleanly across ALL supported compilers
    const emptyBody: TemplateBody = {
      ...buildStarterTemplate('standard', { output: 'full' }).baseBody,
      slots: [],
    };
    for (const client of SUPPORTED_TEMPLATE_CLIENTS) {
      const result = compileTemplate(client, {
        body: emptyBody,
        cards: BUILTIN_CARDS,
        catalogIndex: BUILTIN_CATALOG,
        baseUrl: FIXED_BASE_URL,
      });
      expect(result.content.length).toBeGreaterThan(0);
    }
  });
});
