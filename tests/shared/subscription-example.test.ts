import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildSubscriptionExample } from '../../src/shared/subscription-example';
import type { ClientId } from '../../src/types/domain-rules';

const name = 'My Streaming Rules';
const url = 'https://rules.example/sub/token%2Bsecret/My-Streaming-Rules.yaml?token=a%26b&mode=one';

function example(client: ClientId, policyName?: string) {
  return buildSubscriptionExample({ client, url, name, policyName })!;
}

describe('client subscription reference fragments', () => {
  it.each(['mihomo', 'clash', 'openclash', 'clash-verge', 'stash', 'yaml-classical', 'yaml-ipcidr'] as const)(
    '%s uses classical YAML matching the existing output',
    (client) => {
      const output = example(client, 'My Proxy');
      const config = parse(output.code);
      expect(config['rule-providers']['rules-My-Streaming-Rules']).toMatchObject({
        type: 'http',
        behavior: 'classical',
        format: 'yaml',
        url,
      });
      expect(config.rules).toEqual(['RULE-SET,rules-My-Streaming-Rules,My Proxy']);
      expect(output.code).toContain('Replace the outbound/policy name');
    },
  );

  it('uses domain behavior only for the domain-only YAML link', () => {
    const config = parse(example('yaml-domain').code);
    expect(config['rule-providers']['rules-My-Streaming-Rules'].behavior).toBe('domain');
    expect(config.rules).toEqual(['RULE-SET,rules-My-Streaming-Rules,PROXY']);
    expect(example('yaml-domain', '  ').code).toContain('PROXY');
  });

  it.each(['general', 'surge', 'surge-mac', 'shadowrocket', 'surfboard'] as const)(
    '%s uses RULE-SET without losing private token query parameters',
    (client) => {
      expect(example(client, 'PROXY').code).toContain('[Rule]\nRULE-SET,' + url + ',PROXY\n');
    },
  );

  it('uses the Loon and Quantumult X native equivalents, not invalid RULE-SET syntax', () => {
    expect(example('loon').code).toContain(
      '[Remote Rule]\n' + url + ', policy=PROXY, tag=rules-My-Streaming-Rules, enabled=true',
    );
    expect(example('quantumult-x').code).toContain(
      '[filter_remote]\n' + url + ', tag=rules-My-Streaming-Rules, force-policy=PROXY, enabled=true',
    );
    expect(example('quantumult-x').code).not.toContain('RULE-SET');
  });

  it.each(['json', 'sing-box'] as const)(
    '%s uses sing-box 1.12 remote source rule sets and explicit route actions',
    (client) => {
      const config = JSON.parse(example(client, 'Outbound Name').code);
      expect(config.route.rule_set).toEqual([
        {
          type: 'remote',
          tag: 'rules-My-Streaming-Rules',
          format: 'source',
          url,
          download_detour: 'Outbound Name',
          update_interval: '1d',
        },
      ]);
      expect(config.route.rules).toEqual([
        { rule_set: ['rules-My-Streaming-Rules'], action: 'route', outbound: 'Outbound Name' },
      ]);
    },
  );

  it('returns no snippet for plain text, unsupported clients or disabled links', () => {
    expect(buildSubscriptionExample({ client: 'url', url, name })).toBeNull();
    expect(buildSubscriptionExample({ client: 'v2ray', url, name })).toBeNull();
    expect(buildSubscriptionExample({ client: 'mihomo', url: '', name })).toBeNull();
  });

  it('quotes YAML special characters and keeps names from injecting lines or comma-separated fields', () => {
    const output = buildSubscriptionExample({
      client: 'mihomo',
      url,
      name: 'My Rules\n,more',
      policyName: 'Proxy: Main',
    })!;
    const config = parse(output.code);
    expect(Object.keys(config)).toEqual(['rule-providers', 'rules']);
    expect(Object.keys(config['rule-providers'])).toEqual(['rules-My-Rules-more']);
    expect(config.rules).toEqual(['RULE-SET,rules-My-Rules-more,Proxy: Main']);
  });
});
