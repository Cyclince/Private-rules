import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_SUBSCRIPTION_ENTRIES,
  groupPreviewNodesByRegion,
  parseNodeSubscription,
  toNodePreview,
} from '../../src/domain/nodes';

function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function toBase64Url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

const VALID_UUID_A = '11111111-2222-3333-4444-555555555555';
const VALID_UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const REALITY_PBK = 'cmVhbGl0eS1wdWJsaWMta2V5LWRlbW8tMzItYnl0ZXM';

describe('parseNodeSubscription (M5.2a pure B-class node parser)', () => {
  describe('Base64 URI & plain URI parsing — all 6 protocols (normal cases)', () => {
    it('parses Shadowsocks (SIP002 base64, SIP002 plain SS2022, IPv6, plugin, and legacy base64)', () => {
      const sip002 = `ss://${toBase64Url('aes-256-gcm:pass:with:colon')}@ss1.example.test:8388?plugin=${encodeURIComponent('obfs-local;obfs=http;obfs-host=cdn.example.test')}&udp=1&tfo=1#${encodeURIComponent('🇭🇰 香港 SS 01')}`;
      const ss2022 = `ss://${encodeURIComponent('2022-blake3-aes-128-gcm:secret-key-2022')}@[2001:db8::1]:443#${encodeURIComponent('🇯🇵 日本 SS2022')}`;
      const legacy = `ss://${toBase64('chacha20-ietf-poly1305:legacy-pass@ss2.example.test:8443')}#${encodeURIComponent('🇺🇸 美国 Legacy')}`;

      const payload = toBase64([sip002, ss2022, legacy].join('\n'));
      const result = parseNodeSubscription(payload);

      expect(result.report.format).toBe('base64-uri');
      expect(result.report.parsedCount).toBe(3);
      expect(result.report.skippedCount).toBe(0);
      expect(result.report.protocolCounts).toEqual({ ss: 3 });

      expect(result.nodes[0]).toEqual({
        name: '🇭🇰 香港 SS 01',
        type: 'ss',
        server: 'ss1.example.test',
        port: 8388,
        cipher: 'aes-256-gcm',
        password: 'pass:with:colon',
        plugin: 'obfs-local',
        pluginOpts: { obfs: 'http', 'obfs-host': 'cdn.example.test' },
        udp: true,
        tfo: true,
      });

      expect(result.nodes[1]).toEqual({
        name: '🇯🇵 日本 SS2022',
        type: 'ss',
        server: '2001:db8::1',
        port: 443,
        cipher: '2022-blake3-aes-128-gcm',
        password: 'secret-key-2022',
      });

      expect(result.nodes[2]).toEqual({
        name: '🇺🇸 美国 Legacy',
        type: 'ss',
        server: 'ss2.example.test',
        port: 8443,
        cipher: 'chacha20-ietf-poly1305',
        password: 'legacy-pass',
      });
    });

    it('parses VMess (V2RayN JSON with TLS+WS, gRPC, and URL-style URI)', () => {
      const vmessWsJson = JSON.stringify({
        v: '2',
        ps: '🇸🇬 新加坡 VMess WS',
        add: 'vmess-sg.example.test',
        port: '443',
        id: VALID_UUID_A,
        aid: '0',
        scy: 'aes-128-gcm',
        net: 'ws',
        host: 'ws.example.test',
        path: '/ws-path',
        tls: 'tls',
        sni: 'sni.example.test',
        alpn: 'h2,http/1.1',
        fp: 'chrome',
      });
      const vmessGrpcJson = JSON.stringify({
        ps: '🇯🇵 东京 VMess gRPC',
        add: 'vmess-jp.example.test',
        port: 8443,
        id: VALID_UUID_B,
        aid: 0,
        net: 'grpc',
        path: 'grpc-svc',
        tls: 'tls',
      });
      const vmessUrlStyle = `vmess://auto:${VALID_UUID_A}@vmess-url.example.test:80?type=ws&path=%2Fchat&host=cdn.example.test#${encodeURIComponent('🇹🇼 台湾 VMess 80')}`;

      const result = parseNodeSubscription(
        toBase64([`vmess://${toBase64(vmessWsJson)}`, `vmess://${toBase64(vmessGrpcJson)}`, vmessUrlStyle].join('\n')),
      );

      expect(result.report.parsedCount).toBe(3);
      expect(result.report.skippedCount).toBe(0);
      expect(result.nodes[0]).toEqual({
        name: '🇸🇬 新加坡 VMess WS',
        type: 'vmess',
        server: 'vmess-sg.example.test',
        port: 443,
        uuid: VALID_UUID_A,
        alterId: 0,
        security: 'aes-128-gcm',
        tls: {
          enabled: true,
          serverName: 'sni.example.test',
          alpn: ['h2', 'http/1.1'],
          fingerprint: 'chrome',
        },
        transport: {
          type: 'ws',
          path: '/ws-path',
          headers: { Host: 'ws.example.test' },
        },
      });
      expect(result.nodes[1]).toMatchObject({
        name: '🇯🇵 东京 VMess gRPC',
        type: 'vmess',
        transport: { type: 'grpc', serviceName: 'grpc-svc' },
      });
      expect(result.nodes[2]).toMatchObject({
        name: '🇹🇼 台湾 VMess 80',
        type: 'vmess',
        port: 80,
        transport: { type: 'ws', path: '/chat', headers: { Host: 'cdn.example.test' } },
      });
    });

    it('parses VLESS including Reality, TLS+WS, and plain none', () => {
      const vlessReality = `vless://${VALID_UUID_A}@vless-reality.example.test:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=${REALITY_PBK}&sid=1a2b3c4d&type=tcp#${encodeURIComponent('🇺🇸 洛杉矶 VLESS Reality')}`;
      const vlessTlsWs = `vless://${VALID_UUID_B}@vless-ws.example.test:8443?security=tls&sni=edge.example.test&alpn=h2,http/1.1&type=ws&path=%2Fvless&host=edge.example.test&ed=2048#${encodeURIComponent('🇭🇰 香港 VLESS WS')}`;
      const vlessPlain = `vless://${VALID_UUID_A}@vless-plain.example.test:8080?security=none&type=tcp#PlainVLESS`;

      const result = parseNodeSubscription(toBase64([vlessReality, vlessTlsWs, vlessPlain].join('\n')));
      expect(result.report.parsedCount).toBe(3);
      expect(result.report.skippedCount).toBe(0);

      expect(result.nodes[0]).toEqual({
        name: '🇺🇸 洛杉矶 VLESS Reality',
        type: 'vless',
        server: 'vless-reality.example.test',
        port: 443,
        uuid: VALID_UUID_A,
        flow: 'xtls-rprx-vision',
        encryption: 'none',
        tls: {
          enabled: true,
          serverName: 'www.microsoft.com',
          fingerprint: 'chrome',
          reality: {
            publicKey: REALITY_PBK,
            shortId: '1a2b3c4d',
          },
        },
      });
      expect(result.nodes[1]).toMatchObject({
        type: 'vless',
        tls: { enabled: true, serverName: 'edge.example.test', alpn: ['h2', 'http/1.1'] },
        transport: { type: 'ws', path: '/vless', headers: { Host: 'edge.example.test' }, maxEarlyData: 2048 },
      });
      expect(result.nodes[2]).toMatchObject({
        name: 'PlainVLESS',
        type: 'vless',
        port: 8080,
      });
      expect((result.nodes[2] as { tls?: unknown }).tls).toBeUndefined();
    });

    it('parses Trojan, Hysteria2 (hysteria2:// & hy2://), and TUIC URIs', () => {
      const trojan = `trojan://${encodeURIComponent('tr0jan!pass')}@trojan.example.test:443?sni=trojan.example.test&alpn=h2&allowInsecure=1&type=grpc&serviceName=tr-grpc#${encodeURIComponent('🇯🇵 大阪 Trojan')}`;
      const hy2 = `hy2://${encodeURIComponent('hy2-secret:token')}@hy2.example.test:8443?sni=hy2.example.test&insecure=1&obfs=salamander&obfs-password=salam-pass&up=50&down=200&mport=20000-30000#${encodeURIComponent('🇸🇬 新加坡 Hy2')}`;
      const tuic = `tuic://${VALID_UUID_A}:${encodeURIComponent('tuic-pass')}@tuic.example.test:443?congestion_control=bbr&alpn=h3&sni=tuic.example.test&udp_relay_mode=native&reduce_rtt=1&disable_sni=0&allow_insecure=1#${encodeURIComponent('🇬🇧 伦敦 TUIC')}`;

      const result = parseNodeSubscription(toBase64([trojan, hy2, tuic].join('\n')));
      expect(result.report.parsedCount).toBe(3);
      expect(result.report.skippedCount).toBe(0);
      expect(result.report.protocolCounts).toEqual({ trojan: 1, hysteria2: 1, tuic: 1 });

      expect(result.nodes[0]).toEqual({
        name: '🇯🇵 大阪 Trojan',
        type: 'trojan',
        server: 'trojan.example.test',
        port: 443,
        password: 'tr0jan!pass',
        tls: {
          enabled: true,
          serverName: 'trojan.example.test',
          insecure: true,
          alpn: ['h2'],
        },
        transport: {
          type: 'grpc',
          serviceName: 'tr-grpc',
        },
      });

      expect(result.nodes[1]).toEqual({
        name: '🇸🇬 新加坡 Hy2',
        type: 'hysteria2',
        server: 'hy2.example.test',
        port: 8443,
        password: 'hy2-secret:token',
        obfs: { type: 'salamander', password: 'salam-pass' },
        upMbps: 50,
        downMbps: 200,
        ports: '20000-30000',
        tls: {
          enabled: true,
          serverName: 'hy2.example.test',
          insecure: true,
        },
      });

      expect(result.nodes[2]).toEqual({
        name: '🇬🇧 伦敦 TUIC',
        type: 'tuic',
        server: 'tuic.example.test',
        port: 443,
        uuid: VALID_UUID_A,
        password: 'tuic-pass',
        congestionControl: 'bbr',
        udpRelayMode: 'native',
        zeroRttHandshake: true,
        disableSni: false,
        tls: {
          enabled: true,
          serverName: 'tuic.example.test',
          insecure: true,
          alpn: ['h3'],
        },
      });
    });
  });

  describe('Clash / mihomo YAML parsing — all 6 protocols (normal & abnormal cases)', () => {
    it('parses all 6 supported protocols from Clash YAML (plain and Base64-encoded)', () => {
      const yaml = [
        'proxies:',
        '  - name: "🇭🇰 香港 SS"',
        '    type: ss',
        '    server: ss.example.test',
        '    port: 8388',
        '    cipher: aes-256-gcm',
        '    password: ss-password-secret',
        '    udp: true',
        '  - name: "🇯🇵 日本 VMess"',
        '    type: vmess',
        '    server: vmess.example.test',
        '    port: 443',
        `    uuid: ${VALID_UUID_A}`,
        '    alterId: 0',
        '    cipher: auto',
        '    tls: true',
        '    servername: vmess.example.test',
        '    network: ws',
        '    ws-opts:',
        '      path: /v2',
        '      headers:',
        '        Host: vmess.example.test',
        '  - name: "🇺🇸 美国 VLESS Reality"',
        '    type: vless',
        '    server: vless.example.test',
        '    port: 443',
        `    uuid: ${VALID_UUID_B}`,
        '    flow: xtls-rprx-vision',
        '    tls: true',
        '    servername: www.apple.com',
        '    client-fingerprint: chrome',
        '    reality-opts:',
        `      public-key: ${REALITY_PBK}`,
        '      short-id: abcd1234',
        '  - name: "🇸🇬 新加坡 Trojan"',
        '    type: trojan',
        '    server: trojan.example.test',
        '    port: 443',
        '    password: trojan-secret',
        '    sni: trojan.example.test',
        '    skip-cert-verify: false',
        '  - name: "🇩🇪 德国 Hy2"',
        '    type: hysteria2',
        '    server: hy2.example.test',
        '    port: 8443',
        '    password: hy2-password',
        '    up: "50 Mbps"',
        '    down: "200 Mbps"',
        '    obfs: salamander',
        '    obfs-password: obfs-secret',
        '    sni: hy2.example.test',
        '  - name: "🇬🇧 英国 TUIC"',
        '    type: tuic',
        '    server: tuic.example.test',
        '    port: 443',
        `    uuid: ${VALID_UUID_A}`,
        '    password: tuic-password',
        '    congestion-controller: bbr',
        '    udp-relay-mode: native',
        '    reduce-rtt: true',
        '    alpn: [h3]',
      ].join('\n');

      for (const input of [yaml, toBase64(yaml)]) {
        const result = parseNodeSubscription(input);
        expect(result.report.format).toBe('clash-yaml');
        expect(result.report.parsedCount).toBe(6);
        expect(result.report.skippedCount).toBe(0);
        expect(result.report.protocolCounts).toEqual({
          ss: 1,
          vmess: 1,
          vless: 1,
          trojan: 1,
          hysteria2: 1,
          tuic: 1,
        });
        expect(result.nodes[2]).toMatchObject({
          type: 'vless',
          flow: 'xtls-rprx-vision',
          tls: {
            enabled: true,
            serverName: 'www.apple.com',
            fingerprint: 'chrome',
            reality: { publicKey: REALITY_PBK, shortId: 'abcd1234' },
          },
        });
        expect(result.nodes[4]).toMatchObject({
          type: 'hysteria2',
          upMbps: 50,
          downMbps: 200,
          obfs: { type: 'salamander', password: 'obfs-secret' },
        });
        expect(result.nodes[5]).toMatchObject({
          type: 'tuic',
          congestionControl: 'bbr',
          udpRelayMode: 'native',
          zeroRttHandshake: true,
          tls: { enabled: true, alpn: ['h3'] },
        });
      }
    });

    it('skips malformed entries for each of the 6 protocols and unsupported protocols in Clash YAML without leaking secrets', () => {
      const yaml = [
        'proxies:',
        // 6 malformed entries — one per supported protocol
        '  - name: "Bad SS"',
        '    type: ss',
        '    server: bad-ss.example.test',
        '    port: 8388',
        '    cipher: aes-256-gcm',
        // missing password
        '  - name: "Bad VMess"',
        '    type: vmess',
        '    server: bad-vmess.example.test',
        '    port: 443',
        '    uuid: not-a-uuid',
        '  - name: "Bad VLESS Reality"',
        '    type: vless',
        '    server: bad-vless.example.test',
        '    port: 443',
        `    uuid: ${VALID_UUID_A}`,
        '    reality-opts:',
        '      short-id: abcd',
        // missing public-key
        '  - name: "Bad Trojan"',
        '    type: trojan',
        '    server: bad-trojan.example.test',
        '    port: 0',
        '    password: SHOULD_NOT_LEAK_TROJAN_PASS',
        '  - name: "Bad Hy2"',
        '    type: hysteria2',
        '    server: bad-hy2.example.test',
        '    port: 443',
        // missing password
        '  - name: "Bad TUIC"',
        '    type: tuic',
        '    server: bad-tuic.example.test',
        '    port: 443',
        `    uuid: ${VALID_UUID_A}`,
        // missing password
        // Unsupported protocols
        '  - name: "Legacy SSR"',
        '    type: ssr',
        '    server: ssr.example.test',
        '    port: 443',
        '    password: SHOULD_NOT_LEAK_SSR_PASS',
        '  - name: "WG Tunnel"',
        '    type: wireguard',
        '    server: wg.example.test',
        '    port: 51820',
        '  - name: "Snell Node"',
        '    type: snell',
        '    server: snell.example.test',
        '    port: 443',
        // 1 valid node to prove parsing continues
        '  - name: "🇭🇰 有效节点"',
        '    type: trojan',
        '    server: ok.example.test',
        '    port: 443',
        '    password: ok-secret-password',
      ].join('\n');

      const result = parseNodeSubscription(yaml);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].name).toBe('🇭🇰 有效节点');
      expect(result.report.totalEntries).toBe(10);
      expect(result.report.parsedCount).toBe(1);
      expect(result.report.skippedCount).toBe(9);
      expect(result.report.malformedCount).toBe(6);
      expect(result.report.unsupportedProtocols).toEqual({
        ssr: 1,
        wireguard: 1,
        snell: 1,
      });

      const reportJson = JSON.stringify(result.report);
      expect(reportJson).not.toContain('SHOULD_NOT_LEAK_TROJAN_PASS');
      expect(reportJson).not.toContain('SHOULD_NOT_LEAK_SSR_PASS');
      expect(reportJson).not.toContain('ok-secret-password');
      expect(reportJson).not.toContain('bad-ss.example.test');
    });
  });

  describe('URI abnormal cases across all 6 protocols, empty inputs, mixed formats, and entry limits', () => {
    it('skips abnormal URIs for each of the 6 protocols plus unsupported URI schemes', () => {
      const lines = [
        // 6 malformed URIs — one per protocol
        'ss://not-valid-base64!!!@ss.example.test:8388#BadSS',
        `vmess://${toBase64(JSON.stringify({ ps: 'BadVMess', add: 'vm.example.test', port: 99999, id: 'bad-id' }))}`,
        `vless://${VALID_UUID_A}@vless.example.test:443?security=reality&sni=example.com#BadVlessNoPbk`,
        'trojan://@trojan.example.test:443#BadTrojanEmptyPass',
        'hysteria2://hy2-secret-pass@hy2.example.test:notaport#BadHy2Port',
        `tuic://${VALID_UUID_A}@tuic.example.test:443#BadTuicNoPass`,
        // Unsupported URI schemes
        'ssr://c29tZS1zc3ItcGF5bG9hZA#UnsupportedSSR',
        'socks5://user:secret@socks.example.test:1080#UnsupportedSocks',
        'wireguard://privkey@wg.example.test:51820#UnsupportedWG',
        // Valid node
        `trojan://valid-pass@good.example.test:443#${encodeURIComponent('🇯🇵 东京 01')}`,
      ];

      const result = parseNodeSubscription(toBase64(lines.join('\n')));
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].name).toBe('🇯🇵 东京 01');
      expect(result.report.malformedCount).toBe(6);
      expect(result.report.unsupportedProtocols).toEqual({ ssr: 1, socks5: 1, wireguard: 1 });
      expect(result.report.skippedCount).toBe(9);

      const reportJson = JSON.stringify(result.report);
      expect(reportJson).not.toContain('hy2-secret-pass');
      expect(reportJson).not.toContain('valid-pass');
      expect(reportJson).not.toContain('good.example.test');
    });

    it('handles empty, whitespace, comments-only, and empty YAML proxies cleanly', () => {
      for (const emptyInput of ['', '   \n\t  ', '\uFEFF', '# comment only\n// another comment']) {
        const res = parseNodeSubscription(emptyInput);
        expect(res.nodes).toEqual([]);
        expect(res.report.format).toBe('empty');
        expect(res.report.totalEntries).toBe(0);
        expect(res.report.skippedCount).toBe(0);
      }

      const emptyYaml = parseNodeSubscription('proxies: []\n');
      expect(emptyYaml.nodes).toEqual([]);
      expect(emptyYaml.report.format).toBe('clash-yaml');
      expect(emptyYaml.report.totalEntries).toBe(0);

      const nullYaml = parseNodeSubscription('proxies:\n');
      expect(nullYaml.nodes).toEqual([]);
      expect(nullYaml.report.format).toBe('clash-yaml');
    });

    it('parses mixed format subscriptions (plain URIs + Base64 URI blocks + comments + garbage)', () => {
      const plainLine = `trojan://p1@hk.example.test:443#${encodeURIComponent('🇭🇰 香港 Plain')}`;
      const b64Block = toBase64(
        [
          `vless://${VALID_UUID_A}@jp.example.test:443?security=tls&sni=jp.example.test#${encodeURIComponent('🇯🇵 日本 B64')}`,
          `hy2://p2@sg.example.test:8443?sni=sg.example.test#${encodeURIComponent('🇸🇬 新加坡 B64')}`,
        ].join('\n'),
      );
      const mixedPayload = ['# header comment', plainLine, '', b64Block, 'not-a-valid-entry', 'ssr://abc#Old'].join(
        '\n',
      );

      const result = parseNodeSubscription(mixedPayload);
      expect(result.report.format).toBe('mixed');
      expect(result.nodes.map((n) => n.name)).toEqual(['🇭🇰 香港 Plain', '🇯🇵 日本 B64', '🇸🇬 新加坡 B64']);
      expect(result.report.parsedCount).toBe(3);
      expect(result.report.malformedCount).toBe(1);
      expect(result.report.unsupportedProtocols).toEqual({ ssr: 1 });
    });

    it('enforces entry limit on oversized subscriptions (both URI and YAML) and caps skipped detail list', () => {
      const uriLines = Array.from(
        { length: 25 },
        (_, i) => `trojan://secret-${i}@n${i}.example.test:443#${encodeURIComponent(`🇭🇰 香港 ${i}`)}`,
      ).join('\n');

      const limitedUri = parseNodeSubscription(toBase64(uriLines), { maxEntries: 10 });
      expect(limitedUri.nodes).toHaveLength(10);
      expect(limitedUri.report.totalEntries).toBe(25);
      expect(limitedUri.report.parsedCount).toBe(10);
      expect(limitedUri.report.truncated).toBe(true);
      expect(limitedUri.report.truncatedCount).toBe(15);
      expect(limitedUri.report.skippedCount).toBe(15);
      expect(limitedUri.report.skipped.some((item) => item.reason === 'limit_exceeded')).toBe(true);

      const yamlLines = [
        'proxies:',
        ...Array.from(
          { length: 15 },
          (_, i) =>
            `  - { name: "Node ${i}", type: ss, server: s${i}.example.test, port: 8388, cipher: aes-256-gcm, password: p${i} }`,
        ),
      ].join('\n');
      const limitedYaml = parseNodeSubscription(yamlLines, { maxEntries: 5 });
      expect(limitedYaml.nodes).toHaveLength(5);
      expect(limitedYaml.report.truncated).toBe(true);
      expect(limitedYaml.report.truncatedCount).toBe(10);

      // Default limit constant sanity check
      expect(DEFAULT_MAX_SUBSCRIPTION_ENTRIES).toBe(1000);
    });
  });

  describe('Reality publicKey (pbk) and shortId (sid) validation', () => {
    const PBK_URL_UNPADDED = '----____AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const PBK_URL_PADDED = '----____AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const PBK_STD_UNPADDED = '++++////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const PBK_STD_PADDED = '++++////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

    it('accepts valid 32-byte base64url and standard base64 pbk (with or without padding) and valid shortId for VLESS and Trojan', () => {
      const uris = [
        // Base64URL unpadded + omitted sid
        `vless://${VALID_UUID_A}@v1.example.test:443?security=reality&pbk=${PBK_URL_UNPADDED}&sni=www.microsoft.com#VLESS-URL-NoSid`,
        // Base64URL padded + empty sid (0 hex chars)
        `vless://${VALID_UUID_A}@v2.example.test:443?security=reality&pbk=${PBK_URL_PADDED}&sid=&sni=www.microsoft.com#VLESS-URL-EmptySid`,
        // Standard Base64 unpadded (raw '+' and '/' in query) + 2-char hex sid
        `vless://${VALID_UUID_A}@v3.example.test:443?security=reality&pbk=${PBK_STD_UNPADDED}&sid=ab&sni=www.microsoft.com#VLESS-Std-Unpadded`,
        // Standard Base64 padded (percent-encoded) + 16-char mixed-case hex sid
        `vless://${VALID_UUID_A}@v4.example.test:443?security=reality&pbk=${encodeURIComponent(PBK_STD_PADDED)}&sid=0123456789ABCDEF&sni=www.microsoft.com#VLESS-Std-Padded`,
        // Trojan Reality with standard Base64 padded + 8-char hex sid
        `trojan://tr-pass@t1.example.test:443?security=reality&pbk=${PBK_STD_PADDED}&sid=0123abcd&sni=www.apple.com#Trojan-Reality-Valid`,
      ];

      const uriResult = parseNodeSubscription(uris.join('\n'));
      expect(uriResult.report.parsedCount).toBe(5);
      expect(uriResult.report.skippedCount).toBe(0);
      expect(uriResult.nodes.map((n) => n.name)).toEqual([
        'VLESS-URL-NoSid',
        'VLESS-URL-EmptySid',
        'VLESS-Std-Unpadded',
        'VLESS-Std-Padded',
        'Trojan-Reality-Valid',
      ]);

      // All valid keys are normalized to canonical 43-char unpadded Base64URL for sing-box compatibility
      for (const node of uriResult.nodes) {
        expect((node as { tls?: { reality?: { publicKey: string } } }).tls?.reality?.publicKey).toBe(PBK_URL_UNPADDED);
      }
      expect(
        (uriResult.nodes[0] as { tls?: { reality?: { shortId?: string } } }).tls?.reality?.shortId,
      ).toBeUndefined();
      expect(
        (uriResult.nodes[1] as { tls?: { reality?: { shortId?: string } } }).tls?.reality?.shortId,
      ).toBeUndefined();
      expect((uriResult.nodes[2] as { tls?: { reality?: { shortId?: string } } }).tls?.reality?.shortId).toBe('ab');
      expect((uriResult.nodes[3] as { tls?: { reality?: { shortId?: string } } }).tls?.reality?.shortId).toBe(
        '0123456789ABCDEF',
      );
      expect((uriResult.nodes[4] as { tls?: { reality?: { shortId?: string } } }).tls?.reality?.shortId).toBe(
        '0123abcd',
      );

      // Clash YAML VLESS & Trojan Reality with standard base64 + empty/valid short-id
      const yaml = [
        'proxies:',
        '  - name: "YAML VLESS Std Padded"',
        '    type: vless',
        '    server: y1.example.test',
        '    port: 443',
        `    uuid: ${VALID_UUID_A}`,
        '    tls: true',
        '    reality-opts:',
        `      public-key: "${PBK_STD_PADDED}"`,
        '      short-id: ""',
        '  - name: "YAML Trojan Std Unpadded"',
        '    type: trojan',
        '    server: y2.example.test',
        '    port: 443',
        '    password: secret',
        '    reality-opts:',
        `      public-key: "${PBK_STD_UNPADDED}"`,
        '      short-id: "deadBEEF01234567"',
      ].join('\n');

      const yamlResult = parseNodeSubscription(yaml);
      expect(yamlResult.report.parsedCount).toBe(2);
      expect(yamlResult.report.skippedCount).toBe(0);
      expect(yamlResult.nodes[0]).toMatchObject({
        type: 'vless',
        tls: { enabled: true, reality: { publicKey: PBK_URL_UNPADDED } },
      });
      expect(
        (yamlResult.nodes[0] as { tls?: { reality?: { shortId?: string } } }).tls?.reality?.shortId,
      ).toBeUndefined();
      expect(yamlResult.nodes[1]).toMatchObject({
        type: 'trojan',
        tls: { enabled: true, reality: { publicKey: PBK_URL_UNPADDED, shortId: 'deadBEEF01234567' } },
      });
    });

    it('skips VLESS and Trojan Reality URIs with wrong pbk length, illegal chars, or invalid shortId while keeping valid nodes', () => {
      const badPbk30Bytes = 'cmVhbGl0eS1wdWJsaWMta2V5LWRlbW8tMTIzNDU2';
      const badPbk31Bytes = 'dGVzdC1yZWFsaXR5LXB1YmxpYy1rZXktMzJieXRlcw';
      const badPbk33Bytes = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const badPbkDoublePad = 'cmVhbGl0eS1wdWJsaWMta2V5LWRlbW8tMzItYnl0ZXM==';
      const badPbkIllegalChar = 'cmVhbGl0eS1wdWJsaWMta2V5LWRlbW8tMzItYnl0Z!M';
      const badPbkWithSpace = 'cmVhbGl0eS1wdWJsaWMta2V5LWRlbW8tMzItYnl0Z%20M';
      const badPbkMixedAlphabet = '----////AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

      const lines = [
        // Wrong lengths
        `vless://${VALID_UUID_A}@b1.example.test:443?security=reality&pbk=${badPbk30Bytes}#BadPbk30`,
        `vless://${VALID_UUID_A}@b2.example.test:443?security=reality&pbk=${badPbk31Bytes}#BadPbk31`,
        `vless://${VALID_UUID_A}@b3.example.test:443?security=reality&pbk=${badPbk33Bytes}#BadPbk33`,
        `vless://${VALID_UUID_A}@b4.example.test:443?security=reality&pbk=${badPbkDoublePad}#BadPbkPad`,
        // Illegal characters / mixed alphabet
        `vless://${VALID_UUID_A}@b5.example.test:443?security=reality&pbk=${badPbkIllegalChar}#BadPbkBang`,
        `vless://${VALID_UUID_A}@b6.example.test:443?security=reality&pbk=${badPbkWithSpace}#BadPbkSpace`,
        `trojan://secret-tr@b7.example.test:443?security=reality&pbk=${badPbkMixedAlphabet}#BadTrojanMixed`,
        // Invalid shortId (odd length, >16 chars, non-hex)
        `vless://${VALID_UUID_A}@b8.example.test:443?security=reality&pbk=${REALITY_PBK}&sid=abc#BadSidOdd`,
        `vless://${VALID_UUID_A}@b9.example.test:443?security=reality&pbk=${REALITY_PBK}&sid=0123456789abcdef01#BadSidLong`,
        `vless://${VALID_UUID_A}@b10.example.test:443?security=reality&pbk=${REALITY_PBK}&sid=0123ghij#BadSidNonHex`,
        `trojan://secret-tr@b11.example.test:443?security=reality&pbk=${REALITY_PBK}&sid=a#BadTrojanSidOdd`,
        // Valid sibling node must still parse cleanly
        `vless://${VALID_UUID_A}@ok.example.test:443?security=reality&pbk=${REALITY_PBK}&sid=0123abcd#${encodeURIComponent('🇺🇸 正常 Reality')}`,
      ];

      const result = parseNodeSubscription(lines.join('\n'));
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].name).toBe('🇺🇸 正常 Reality');
      expect(result.report.parsedCount).toBe(1);
      expect(result.report.skippedCount).toBe(11);
      expect(result.report.malformedCount).toBe(11);
      expect(result.report.skipped).toHaveLength(11);
      expect(result.report.skipped.every((entry) => entry.reason === 'malformed')).toBe(true);

      const reportJson = JSON.stringify(result.report);
      expect(reportJson).not.toContain(badPbk30Bytes);
      expect(reportJson).not.toContain(badPbkIllegalChar);
      expect(reportJson).not.toContain('secret-tr');
      expect(reportJson).not.toContain('0123ghij');
    });

    it('skips Clash YAML VLESS and Trojan Reality entries with invalid public-key or short-id', () => {
      const yaml = [
        'proxies:',
        '  - name: "YAML Bad VLESS KeyLen"',
        '    type: vless',
        '    server: bad1.example.test',
        '    port: 443',
        `    uuid: ${VALID_UUID_A}`,
        '    reality-opts:',
        '      public-key: "cmVhbGl0eS1wdWJsaWMta2V5LWRlbW8tMTIzNDU2"',
        '  - name: "YAML Bad VLESS KeyChar"',
        '    type: vless',
        '    server: bad2.example.test',
        '    port: 443',
        `    uuid: ${VALID_UUID_A}`,
        '    reality-opts:',
        '      public-key: "cmVhbGl0eS1wdWJsaWMta2V5LWRlbW8tMzItYnl0Z@M"',
        '  - name: "YAML Bad VLESS ShortId Odd"',
        '    type: vless',
        '    server: bad3.example.test',
        '    port: 443',
        `    uuid: ${VALID_UUID_A}`,
        '    reality-opts:',
        `      public-key: "${REALITY_PBK}"`,
        '      short-id: "123"',
        '  - name: "YAML Bad Trojan ShortId TooLong"',
        '    type: trojan',
        '    server: bad4.example.test',
        '    port: 443',
        '    password: secret',
        '    reality-opts:',
        `      public-key: "${REALITY_PBK}"`,
        '      short-id: "0123456789abcdef01"',
        '  - name: "YAML Bad Trojan ShortId NonString"',
        '    type: trojan',
        '    server: bad5.example.test',
        '    port: 443',
        '    password: secret',
        '    reality-opts:',
        `      public-key: "${REALITY_PBK}"`,
        '      short-id: 1234',
        '  - name: "🇯🇵 正常 Trojan Reality"',
        '    type: trojan',
        '    server: good.example.test',
        '    port: 443',
        '    password: good-password',
        '    reality-opts:',
        `      public-key: "${REALITY_PBK}"`,
        '      short-id: "0123abcd"',
      ].join('\n');

      const result = parseNodeSubscription(yaml);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].name).toBe('🇯🇵 正常 Trojan Reality');
      expect(result.report.parsedCount).toBe(1);
      expect(result.report.skippedCount).toBe(5);
      expect(result.report.malformedCount).toBe(5);
      expect(result.report.skipped.map((s) => s.name)).toEqual([
        'YAML Bad VLESS KeyLen',
        'YAML Bad VLESS KeyChar',
        'YAML Bad VLESS ShortId Odd',
        'YAML Bad Trojan ShortId TooLong',
        'YAML Bad Trojan ShortId NonString',
      ]);
    });
  });

  describe('safe preview projection (toNodePreview & groupPreviewNodesByRegion)', () => {
    it('returns only name, protocol, regions, and isInfo without any server/port/credentials', () => {
      const parsed = parseNodeSubscription(
        [
          `vless://${VALID_UUID_A}@secret-server.example.test:443?security=reality&pbk=${REALITY_PBK}&sni=cdn.example.com#${encodeURIComponent('🇭🇰 香港 01')}`,
          `trojan://super-secret-password@jp-node.example.test:8443#${encodeURIComponent('🇯🇵 东京 IEPL')}`,
          `ss://${toBase64Url('aes-256-gcm:pw123')}@info.example.test:8388#${encodeURIComponent('剩余流量：80GB')}`,
        ].join('\n'),
      );

      const previews = parsed.nodes.map(toNodePreview);
      expect(previews).toEqual([
        { name: '🇭🇰 香港 01', protocol: 'vless', regions: ['HK'], isInfo: false },
        { name: '🇯🇵 东京 IEPL', protocol: 'trojan', regions: ['JP'], isInfo: false },
        { name: '剩余流量：80GB', protocol: 'ss', regions: [], isInfo: true },
      ]);

      const serialized = JSON.stringify(previews);
      expect(serialized).not.toContain('secret-server.example.test');
      expect(serialized).not.toContain('super-secret-password');
      expect(serialized).not.toContain(VALID_UUID_A);
      expect(serialized).not.toContain(REALITY_PBK);
      expect(serialized).not.toContain('pw123');

      const grouped = groupPreviewNodesByRegion(previews);
      expect(grouped).toEqual({
        HK: ['🇭🇰 香港 01'],
        JP: ['🇯🇵 东京 IEPL'],
      });
    });
  });
});
