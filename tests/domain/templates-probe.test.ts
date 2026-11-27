import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS, buildStarterTemplate } from '../../src/builtin';
import { parseProbeTarget, probeTemplate, type AppCard, type TemplateBody } from '../../src/domain/templates';

function makeCard(partial: Partial<AppCard> & Pick<AppCard, 'id' | 'name'>): AppCard {
  return {
    slug: partial.id,
    category: 'other',
    stage: 'app',
    group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
    matchers: [],
    ...partial,
  };
}

function makeBody(cards: AppCard[], final: TemplateBody['final'] = { kind: 'builtin', id: 'DIRECT' }): TemplateBody {
  return {
    slots: [{ id: 'slot-main', name: 'Main', excludeInfo: true }],
    regionGroups: [{ id: 'region-us', name: '🇺🇸 美国节点', region: 'US', type: 'url-test', slotId: 'slot-main' }],
    cards: cards.map((c) => ({ cardId: c.id, enabled: true })),
    groupMode: 'select',
    final,
    output: 'full',
    dns: { mode: 'fake-ip', enable: true },
    modules: [],
  };
}

describe('template hit-test probe engine (design §10.8)', () => {
  it('parses domains, URLs with ports, IPv4, and IPv6 targets accurately', () => {
    expect(parseProbeTarget('API.OpenAI.COM.')).toMatchObject({ kind: 'domain', host: 'api.openai.com' });
    expect(parseProbeTarget('https://api.openai.com:8443/v1/chat')).toMatchObject({
      kind: 'url',
      host: 'api.openai.com',
      dstPort: 8443,
    });
    expect(parseProbeTarget('192.168.1.10')).toMatchObject({ kind: 'ipv4', ip: '192.168.1.10', isIpv6: false });
    expect(parseProbeTarget('[2400:3200::1]:443')).toMatchObject({
      kind: 'ipv6',
      ip: '2400:3200::1',
      isIpv6: true,
      dstPort: 443,
    });
  });

  it('matches domains, URLs, IPv4/IPv6, logical rules, and resolves the full policy chain', () => {
    const hub = makeCard({
      id: 'proxy-hub',
      name: '🚀 代理总组',
      stage: 'proxy-fallback',
      hidden: true,
      group: { type: 'select', candidates: [{ kind: 'region', regionGroupId: 'region-us' }] },
    });
    const lan = makeCard({
      id: 'lan',
      name: '🏠 局域网',
      stage: 'pre-direct',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
      matchers: [{ kind: 'geoip', name: 'private', noResolve: true }],
    });
    const ai = makeCard({
      id: 'ai',
      name: '🤖 AI',
      stage: 'app',
      group: { type: 'select', candidates: [{ kind: 'card', cardId: 'proxy-hub' }] },
      matchers: [
        {
          kind: 'inline',
          conditions: [{ op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'openai.com' } }],
        },
      ],
    });
    const apiPort = makeCard({
      id: 'api-port',
      name: '🔌 特殊端口',
      stage: 'port',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'REJECT' }] },
      matchers: [
        {
          kind: 'inline',
          conditions: [
            {
              op: 'and',
              items: [
                { op: 'rule', rule: { type: 'DOMAIN-KEYWORD', value: 'metrics' } },
                { op: 'rule', rule: { type: 'DST-PORT', value: '8443' } },
              ],
            },
          ],
        },
      ],
    });

    const cards = [hub, lan, ai, apiPort];
    const body = makeBody(cards, { kind: 'card', cardId: 'proxy-hub' });

    // Domain match + policy chain resolution: ai -> proxy-hub -> region-us
    const domainRes = probeTemplate({ target: 'api.openai.com', body, cards });
    expect(domainRes.matchedByFinal).toBe(false);
    expect(domainRes.cardId).toBe('ai');
    expect(domainRes.stage).toBe('app');
    expect(domainRes.matchedRule.summary).toBe('DOMAIN-SUFFIX,openai.com');
    expect(domainRes.finalPolicy).toEqual({ kind: 'region', regionGroupId: 'region-us' });
    expect(domainRes.policyChain.map((h) => h.label)).toEqual(['🤖 AI', '🚀 代理总组', '🇺🇸 美国节点']);

    // URL + logical AND match
    const urlRes = probeTemplate({ target: 'https://metrics.internal.org:8443/push', body, cards });
    expect(urlRes.cardId).toBe('api-port');
    expect(urlRes.stage).toBe('port');
    expect(urlRes.finalPolicy).toEqual({ kind: 'builtin', id: 'REJECT' });

    // Private IPv4 & IPv6 hit GEOIP,private natively without needing external cache
    const ipv4Res = probeTemplate({ target: '192.168.10.5', body, cards });
    expect(ipv4Res.cardId).toBe('lan');
    expect(ipv4Res.stage).toBe('pre-direct');
    expect(ipv4Res.finalPolicy).toEqual({ kind: 'builtin', id: 'DIRECT' });
    expect(ipv4Res.indeterminate).toBe(false);

    const ipv6Res = probeTemplate({ target: 'fe80::1', body, cards });
    expect(ipv6Res.cardId).toBe('lan');

    // Unmatched domain falls through to FINAL
    const finalRes = probeTemplate({ target: 'unmatched.example.org', body, cards });
    expect(finalRes.matchedByFinal).toBe(true);
    expect(finalRes.stage).toBe('final');
    expect(finalRes.finalPolicy).toEqual({ kind: 'region', regionGroupId: 'region-us' });
  });

  it('annotates DNS-dependent rules encountered on domain targets without guessing', () => {
    const ipBeforeDomain = makeCard({
      id: 'ip-rule',
      name: 'IP 分流',
      stage: 'ip',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'REJECT' }] },
      matchers: [
        { kind: 'geoip', name: 'telegram', noResolve: false },
        {
          kind: 'inline',
          conditions: [{ op: 'rule', rule: { type: 'IP-CIDR', value: '1.1.1.0/24', options: { noResolve: true } } }],
        },
      ],
    });
    const domainAfter = makeCard({
      id: 'domain-rule',
      name: '域名分流',
      stage: 'domestic',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
      matchers: [
        { kind: 'inline', conditions: [{ op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'example.cn' } }] },
      ],
    });

    const cards = [ipBeforeDomain, domainAfter];
    const body = makeBody(cards);
    const res = probeTemplate({ target: 'www.example.cn', body, cards });

    // Does NOT guess that IP rule matched; hits the domain rule below it, while annotating DNS points
    expect(res.cardId).toBe('domain-rule');
    expect(res.indeterminate).toBe(true);
    expect(res.dnsResolutionPoints).toHaveLength(2);
    expect(res.dnsResolutionPoints[0]).toMatchObject({
      cardId: 'ip-rule',
      noResolve: false,
      triggersDnsLookup: true,
    });
    expect(res.dnsResolutionPoints[1]).toMatchObject({
      cardId: 'ip-rule',
      noResolve: true,
      triggersDnsLookup: false,
    });
  });

  it('marks uncached remote rulesets and geosite sets as unresolved and indeterminate, and resolves when cached', () => {
    const remoteCard = makeCard({
      id: 'remote-ai',
      name: '远程 AI',
      stage: 'app',
      group: { type: 'select', candidates: [{ kind: 'region', regionGroupId: 'region-us' }] },
      matchers: [{ kind: 'remote', url: 'https://rules.example/ai.list', behavior: 'classical' }],
    });
    const body = makeBody([remoteCard]);

    // Without cache: falls to final and records unresolved remote source
    const uncached = probeTemplate({ target: 'chat.openai.com', body, cards: [remoteCard] });
    expect(uncached.matchedByFinal).toBe(true);
    expect(uncached.indeterminate).toBe(true);
    expect(uncached.unresolvedSources).toHaveLength(1);
    expect(uncached.unresolvedSources[0]).toMatchObject({
      cardId: 'remote-ai',
      matcherKind: 'remote',
      reason: 'uncached-remote',
      sourceLabel: 'https://rules.example/ai.list',
    });

    // With cache: deterministically matches the remote ruleset
    const cached = probeTemplate({
      target: 'chat.openai.com',
      body,
      cards: [remoteCard],
      caches: {
        remoteRules: new Map([['https://rules.example/ai.list', [{ type: 'DOMAIN-SUFFIX', value: 'openai.com' }]]]),
      },
    });
    expect(cached.matchedByFinal).toBe(false);
    expect(cached.cardId).toBe('remote-ai');
    expect(cached.indeterminate).toBe(false);
    expect(cached.unresolvedSources).toEqual([]);
  });

  it('probes built-in starter templates with geosite cache cleanly', () => {
    const caches = {
      geositeRules: new Map([
        ['private', [{ type: 'DOMAIN-SUFFIX', value: 'local' }]],
        ['category-ads-all', [{ type: 'DOMAIN-SUFFIX', value: 'doubleclick.net' }]],
        ['openai', [{ type: 'DOMAIN-SUFFIX', value: 'openai.com' }]],
      ]),
      catalogRules: new Map([['domestic-direct-custom', []]]),
    };

    const recommended = buildStarterTemplate('recommended');
    const resRecommended = probeTemplate({
      target: 'api.openai.com',
      body: recommended.baseBody,
      cards: BUILTIN_CARDS,
      caches,
    });
    expect(resRecommended.cardId).toBe('openai');
    expect(resRecommended.stage).toBe('app');
    expect(resRecommended.finalPolicy).toEqual({ kind: 'slot', slotId: 'slot-main' });
    expect(resRecommended.unresolvedSources).toEqual([]);

    const allTier = buildStarterTemplate('all');
    const resAll = probeTemplate({
      target: 'api.openai.com',
      body: allTier.baseBody,
      cards: BUILTIN_CARDS,
      caches,
    });
    expect(resAll.cardId).toBe('openai');
    expect(resAll.stage).toBe('app');
    expect(resAll.finalPolicy).toEqual({ kind: 'region', regionGroupId: 'region-us' });
    expect(resAll.unresolvedSources).toEqual([]);
  });
});
