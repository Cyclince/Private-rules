import { describe, expect, it } from 'vitest';
import {
  CLIENT_IMPORTS,
  generateLoonImportLink,
  generateMihomoImportLink,
  generateQuantumultXImportLink,
  generateShadowrocketImportLink,
  generateSingBoxImportLink,
  generateStashImportLink,
  generateSurgeImportLink,
  getImportLink,
} from '../../src/shared/client-import';
import { TEMPLATE_CLIENT_IDS } from '../../src/shared/clients';

const URL_WITH_TOKEN = 'https://rules.example/t/a%2Fb+token/profile/mihomo.yaml?token=a%2Bb%26c&label=中文#section';
const NAME = '流媒体测试 & 日常配置 #1';

function expectUrlParameter(link: string) {
  const parsed = new URL(link);
  expect(parsed.searchParams.get('url')).toBe(URL_WITH_TOKEN);
  expect(link).toContain('token%3Da%252Bb%2526c%26label%3D');
  expect(link).not.toContain('中文');
  return parsed;
}

describe('unverified client import scheme candidates', () => {
  it('encodes mihomo URL and Chinese name independently, including & and #', () => {
    const link = generateMihomoImportLink(URL_WITH_TOKEN, NAME);
    expect(link.startsWith('clash://install-config?url=')).toBe(true);
    const parsed = expectUrlParameter(link);
    expect(parsed.searchParams.get('name')).toBe(NAME);
    expect(parsed.hash).toBe('');
    expect([...parsed.searchParams.keys()]).toEqual(['url', 'name']);
  });

  it.each([
    ['stash', generateStashImportLink, 'stash://install-config?url='],
    ['surge', generateSurgeImportLink, 'surge:///install-config?url='],
  ] as const)('encodes %s URLs without adding an unsupported name parameter', (_client, generate, prefix) => {
    const link = generate(URL_WITH_TOKEN);
    expect(link.startsWith(prefix)).toBe(true);
    const parsed = expectUrlParameter(link);
    expect([...parsed.searchParams.keys()]).toEqual(['url']);
    expect(parsed.hash).toBe('');
  });

  it('puts the sing-box name in the encoded fragment, not in the URL query', () => {
    const link = generateSingBoxImportLink(URL_WITH_TOKEN, NAME);
    expect(link.startsWith('sing-box://import-remote-profile?url=')).toBe(true);
    const parsed = expectUrlParameter(link);
    expect(decodeURIComponent(parsed.hash.slice(1))).toBe(NAME);
    expect([...parsed.searchParams.keys()]).toEqual(['url']);
  });

  it('preserves the original Shadowrocket URL including token escaping', () => {
    expect(generateShadowrocketImportLink(URL_WITH_TOKEN)).toBe('shadowrocket://config/add/' + URL_WITH_TOKEN);
  });

  it('encodes Quantumult X JSON once, preserving the rule resource URL and Chinese tag', () => {
    const link = generateQuantumultXImportLink(URL_WITH_TOKEN, NAME);
    expect(link.startsWith('quantumult-x:///add-resource?remote-resource=')).toBe(true);
    expect(link).not.toContain('流媒体');
    const parsed = new URL(link);
    expect([...parsed.searchParams.keys()]).toEqual(['remote-resource']);
    expect(parsed.hash).toBe('');
    expect(JSON.parse(parsed.searchParams.get('remote-resource')!)).toEqual({
      filter_remote: [URL_WITH_TOKEN + ', tag=' + NAME + ', enabled=true'],
    });
  });

  it('does not invent a Loon scheme', () => {
    expect(generateLoonImportLink()).toBeNull();
    expect(CLIENT_IMPORTS.loon.linkFormat).toBeNull();
  });

  it('covers all compiler client IDs with metadata and hides all unverified links', () => {
    expect(Object.keys(CLIENT_IMPORTS).sort()).toEqual([...TEMPLATE_CLIENT_IDS].sort());
    for (const clientId of TEMPLATE_CLIENT_IDS) {
      expect(CLIENT_IMPORTS[clientId].label).toBeTruthy();
      expect(CLIENT_IMPORTS[clientId].platforms.length).toBeGreaterThan(0);
      expect(CLIENT_IMPORTS[clientId].verified).toBe(false);
      expect(getImportLink(clientId, URL_WITH_TOKEN, NAME)).toBeNull();
    }
  });

  it.each(TEMPLATE_CLIENT_IDS)('only exposes %s after verification (Loon stays unavailable)', (clientId) => {
    const metadata = CLIENT_IMPORTS[clientId];
    const previous = metadata.verified;
    try {
      metadata.verified = true;
      expect(getImportLink(clientId, URL_WITH_TOKEN, NAME)).toBe(metadata.generateLink(URL_WITH_TOKEN, NAME));
    } finally {
      metadata.verified = previous;
    }
  });
});
