import type { ClientId } from '../types/domain-rules';

export type SubscriptionExample = { language: 'yaml' | 'ini' | 'json'; code: string };
export type SubscriptionExampleInput = {
  client: ClientId;
  url: string;
  name: string;
  policyName?: string;
};

/** Configuration fragments only: no requests, storage, or changes to subscription output. */
export function buildSubscriptionExample({
  client,
  url,
  name,
  policyName,
}: SubscriptionExampleInput): SubscriptionExample | null {
  if (!url) return null;
  const policy = policyName?.trim() || 'PROXY';
  // Resource identifiers and comma-delimited values must not introduce new config lines/fields.
  const tag = `rules-${name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'custom'}`;
  const clean = (value: string) => value.replace(/[\r\n,\u2028\u2029]/g, ' ');
  const quote = JSON.stringify;
  const note = '# Replace the outbound/policy name with your own client group name.\n';

  if (
    ['yaml-classical', 'yaml-domain', 'yaml-ipcidr', 'mihomo', 'clash', 'openclash', 'clash-verge', 'stash'].includes(
      client,
    )
  ) {
    // Legacy _IPCIDR.yaml contains typed IP/port rules, so it is classical, NOT behavior: ipcidr.
    const behavior = client === 'yaml-domain' ? 'domain' : 'classical';
    return {
      language: 'yaml',
      code: `${note}rule-providers:\n  ${quote(tag)}:\n    type: http\n    behavior: ${behavior}\n    format: yaml\n    url: ${quote(url)}\n    path: ${quote(`./rules/${tag}.yaml`)}\n    interval: 86400\nrules:\n  - ${quote(`RULE-SET,${tag},${clean(policy)}`)}\n`,
    };
  }

  if (client === 'json' || client === 'sing-box') {
    return {
      language: 'json',
      code:
        JSON.stringify(
          {
            route: {
              rule_set: [
                { type: 'remote', tag, format: 'source', url, download_detour: policy, update_interval: '1d' },
              ],
              rules: [{ rule_set: [tag], action: 'route', outbound: policy }],
            },
          },
          null,
          2,
        ) + '\n',
    };
  }

  if (client === 'loon') {
    return {
      language: 'ini',
      code: `${note}[Remote Rule]\n${clean(url)}, policy=${clean(policy)}, tag=${tag}, enabled=true\n`,
    };
  }
  if (client === 'quantumult-x') {
    // Quantumult X does not accept RULE-SET; filter_remote is its equivalent for remote rules.
    return {
      language: 'ini',
      code: `${note}[filter_remote]\n${clean(url)}, tag=${tag}, force-policy=${clean(policy)}, enabled=true\n`,
    };
  }
  if (['general', 'surge', 'surge-mac', 'shadowrocket', 'surfboard'].includes(client)) {
    return { language: 'ini', code: `${note}[Rule]\nRULE-SET,${clean(url)},${clean(policy)}\n` };
  }
  return null;
}
