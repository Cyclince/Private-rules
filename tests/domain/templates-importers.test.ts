import { describe, expect, it } from 'vitest';
import { importMihomoYaml, importSubconverterIni } from '../../src/domain/templates';
import { appCardSchema, templateBodySchema } from '../../src/shared/schemas';

const SAMPLE_SUBCONVERTER_INI = `; Small inline subconverter .ini fixture (ACL4SSR + Custom_OpenClash_Rules syntax)
[custom]
enable_rule_generator=true
overwrite_original_rules=true
unknown_custom_option=keep-in-report

; Rulesets covering prefixes, intervals, geosite, geoip, inline rules, and final
ruleset=🎯 全球直连,clash-classic:https://rules.example/LocalAreaNetwork.list,1800
ruleset=🛑 广告拦截,clash-domain:https://rules.example/BanAD.yaml,28800
ruleset=🤖 OpenAI,[]GEOSITE,openai
ruleset=🤖 OpenAI,[]DOMAIN-SUFFIX,chatgpt.com
ruleset=✈️ Telegram,clash-ipcidr:https://rules.example/TelegramIP.yaml,43200
ruleset=✈️ Telegram,[]IP-CIDR6,2001:b28:f23d::/48,no-resolve
ruleset=🎯 全球直连,[]GEOIP,CN,no-resolve
ruleset=🐟 漏网之鱼,[]FINAL
ruleset=🚀 节点选择,[]UNSUPPORTED-FOO,bar

; Proxy groups covering select, url-test, fallback, load-balance, region regex, and unsupported relay
custom_proxy_group=🚀 节点选择\`select\`[]⚡ 自动选择\`[]🇭🇰 香港节点\`[]🇺🇸 美国节点\`[]DIRECT\`.*
custom_proxy_group=⚡ 自动选择\`url-test\`.*\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=🇭🇰 香港节点\`url-test\`(港|HK|Hong Kong)\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=🇺🇸 美国节点\`fallback\`(美|US|United States)\`http://www.gstatic.com/generate_204\`300,,100
custom_proxy_group=🤖 OpenAI\`select\`[]🇺🇸 美国节点\`[]🚀 节点选择
custom_proxy_group=✈️ Telegram\`load-balance\`[]🇭🇰 香港节点\`[]🇺🇸 美国节点\`http://www.gstatic.com/generate_204\`300,,50
custom_proxy_group=🎯 全球直连\`select\`[]DIRECT\`[]🚀 节点选择
custom_proxy_group=🛑 广告拦截\`select\`[]REJECT\`[]DIRECT
custom_proxy_group=🐟 漏网之鱼\`select\`[]🚀 节点选择\`[]DIRECT
custom_proxy_group=⛓️ 链式代理\`relay\`[]🇭🇰 香港节点\`[]🇺🇸 美国节点

[extra_unrecognized_section]
foo=bar
`;

const SAMPLE_MIHOMO_YAML = `# Small inline mihomo YAML fixture
mixed-port: 7890
allow-lan: true
log-level: info
ipv6: false

dns:
  enable: true
  ipv6: false
  enhanced-mode: fake-ip
  default-nameserver:
    - 223.5.5.5
  nameserver:
    - https://dns.alidns.com/dns-query
  fallback:
    - https://1.1.1.1/dns-query
  fake-ip-filter:
    - "*.lan"
  respect-rules: true
  nameserver-policy:
    "geosite:cn": "223.5.5.5"

tun:
  enable: true
  stack: mixed

proxies:
  - name: "Static-HK-01"
    type: ss
    server: 1.2.3.4
    port: 443

proxy-providers:
  AirportA:
    type: http
    url: "https://secret.airport.example/sub?token=do-not-leak"
    interval: 3600
    filter: "^(?!.*(流量|到期)).*$"
    header:
      User-Agent:
        - "clash.meta"
    health-check:
      enable: true
      url: "https://cp.cloudflare.com/generate_204"
      interval: 300
    override:
      udp: true

proxy-groups:
  - name: "🚀 节点选择"
    type: select
    proxies:
      - "🇭🇰 香港节点"
      - "🇯🇵 日本节点"
      - "Static-HK-01"
      - DIRECT
  - name: "🇭🇰 香港节点"
    type: url-test
    use:
      - AirportA
    filter: "(?i)港|HK|Hong Kong"
    exclude-filter: "倍|实验"
    url: "https://cp.cloudflare.com/generate_204"
    interval: 300
    tolerance: 50
  - name: "🇯🇵 日本节点"
    type: fallback
    include-all: true
    filter: "(?i)日本|JP|Tokyo"
    url: "https://cp.cloudflare.com/generate_204"
    interval: 300
  - name: "🤖 AI 服务"
    type: select
    proxies:
      - "🇯🇵 日本节点"
      - "🚀 节点选择"
  - name: "⛓️ 不支持的组"
    type: relay
    proxies:
      - "🇭🇰 香港节点"
      - "🇯🇵 日本节点"

rule-providers:
  openai_domain:
    type: http
    behavior: domain
    format: text
    url: "https://rules.example/openai.list"
    interval: 28800
  lan_inline:
    type: inline
    behavior: domain
    payload:
      - "+.local"
      - "router.home"

rules:
  - RULE-SET,lan_inline,DIRECT
  - RULE-SET,openai_domain,🤖 AI 服务
  - GEOSITE,openai,🤖 AI 服务
  - AND,((DOMAIN-SUFFIX,anthropic.com),(DST-PORT,443)),🤖 AI 服务
  - IP-CIDR6,2001:db8::/32,DIRECT,no-resolve
  - GEOIP,CN,DIRECT,no-resolve
  - SUB-RULE,(NETWORK,udp),udp-chain
  - MATCH,🚀 节点选择
`;

const SAMPLE_MINIMAL_MIHOMO_YAML = `proxy-groups:
  - name: "🚀 Proxy"
    type: select
    include-all: true
    proxies:
      - DIRECT

rules:
  - GEOSITE,gfw,🚀 Proxy
  - GEOIP,CN,DIRECT,no-resolve
  - MATCH,🚀 Proxy
`;

describe('template importers (subconverter .ini and mihomo YAML)', () => {
  it('imports subconverter .ini into schema-valid template IR and preserves unrecognized items in compatibility report', () => {
    const result = importSubconverterIni(SAMPLE_SUBCONVERTER_INI, { name: 'ACL4SSR Inline Sample' });

    // Every generated body and card must strictly satisfy M4.1 Zod schemas
    expect(() => templateBodySchema.parse(result.body)).not.toThrow();
    for (const card of result.cards) {
      expect(() => appCardSchema.parse(card)).not.toThrow();
    }

    // Region groups recognized from regex-only proxy groups
    expect((result.body.regionGroups ?? []).map((rg) => rg.region)).toEqual(['HK', 'US']);
    expect(result.body.regionGroups?.[0].type).toBe('url-test');
    expect(result.body.regionGroups?.[1].type).toBe('fallback');

    // Compatibility report captures unrecognized keys, sections, unsupported group types, and rules (never dropped)
    expect(result.report.items.some((i) => i.code === 'INI_UNRECOGNIZED_KEY')).toBe(true);
    expect(result.report.items.some((i) => i.code === 'INI_UNRECOGNIZED_SECTION')).toBe(true);
    expect(result.report.items.some((i) => i.code === 'INI_UNSUPPORTED_GROUP_TYPE')).toBe(true);
    expect(result.report.items.some((i) => i.code === 'INI_UNSUPPORTED_INLINE_RULE')).toBe(true);
    expect(result.body.clientPatches?.mihomo).toContain('unknown_custom_option=keep-in-report');

    expect(result).toMatchSnapshot();
  });

  it('imports mihomo YAML into schema-valid template IR, strips secrets & static proxies, and preserves unrecognized content', () => {
    const result = importMihomoYaml(SAMPLE_MIHOMO_YAML, { name: 'mihomo Inline Sample' });

    expect(() => templateBodySchema.parse(result.body)).not.toThrow();
    for (const card of result.cards) {
      expect(() => appCardSchema.parse(card)).not.toThrow();
    }

    // Secrets from proxy-providers MUST NOT leak into template body
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain('do-not-leak');
    expect(serialized).not.toContain('Static-HK-01');

    // Output profile detected as full (has dns & general)
    expect(result.body.output).toBe('full');
    expect(result.body.dns.respectRules).toBe(true);
    expect(result.body.dns.custom).toEqual({ 'nameserver-policy': { 'geosite:cn': '223.5.5.5' } });
    expect((result.body.regionGroups ?? []).map((rg) => rg.region)).toEqual(['HK', 'JP']);

    // Unrecognized sections (tun) and rules (SUB-RULE) go into compatibility report + clientPatches.mihomo
    expect(result.report.items.some((i) => i.code === 'YAML_UNRECOGNIZED_SECTION' && i.source === 'tun')).toBe(true);
    expect(result.report.items.some((i) => i.code === 'YAML_PROXIES_IGNORED')).toBe(true);
    expect(result.report.items.some((i) => i.code === 'YAML_PROVIDER_SECRET_STRIPPED')).toBe(true);
    expect(result.report.items.some((i) => i.code === 'YAML_UNSUPPORTED_GROUP_TYPE')).toBe(true);
    expect(result.report.items.some((i) => i.code === 'YAML_UNRECOGNIZED_RULE')).toBe(true);
    expect(result.body.clientPatches?.mihomo).toContain('tun:');
    expect(result.body.clientPatches?.mihomo).toContain('SUB-RULE,(NETWORK,udp),udp-chain');

    expect(result).toMatchSnapshot();
  });

  it('infers minimal output profile for mihomo YAML without dns or general runtime fields', () => {
    const result = importMihomoYaml(SAMPLE_MINIMAL_MIHOMO_YAML, { name: 'Minimal OpenClash YAML' });
    expect(() => templateBodySchema.parse(result.body)).not.toThrow();
    expect(result.body.output).toBe('minimal');
    expect(result.report.items).toEqual([]);
    expect(result).toMatchSnapshot();
  });
});
