import { describe, expect, it } from 'vitest';
import { parsePublicationFile, TEMPLATE_CLIENTS, TEMPLATE_CLIENT_IDS } from '../../src/shared/clients';

describe('template client registry', () => {
  it('maps every client to a unique file suffix', () => {
    const suffixes = TEMPLATE_CLIENT_IDS.map((id) => TEMPLATE_CLIENTS[id].fileSuffix);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });

  it('classifies node access per design §11.1', () => {
    expect(TEMPLATE_CLIENTS.mihomo.nodeAccess).toBe('A');
    expect(TEMPLATE_CLIENTS.surge.nodeAccess).toBe('A');
    expect(TEMPLATE_CLIENTS['sing-box'].nodeAccess).toBe('B');
    expect(TEMPLATE_CLIENTS['quantumult-x'].nodeAccess).toBe('C');
  });

  it.each([
    ['home.yaml', 'home', 'mihomo'],
    ['home-stash.yaml', 'home', 'stash'],
    ['my-home-surge.conf', 'my-home', 'surge'],
    ['home-singbox.json', 'home', 'sing-box'],
    ['home-qx.conf', 'home', 'quantumult-x'],
  ])('parses %s', (file, slug, client) => {
    expect(parsePublicationFile(file)).toEqual({ slug, client });
  });

  it.each(['home.list', '.yaml', '-surge.conf', 'home'])('rejects %s', (file) => {
    expect(parsePublicationFile(file)).toBeNull();
  });
});
