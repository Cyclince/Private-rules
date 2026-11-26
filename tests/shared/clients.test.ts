import { describe, expect, it } from 'vitest';
import { OUTPUT_PROFILES, parsePublicationFile, TEMPLATE_CLIENTS, TEMPLATE_CLIENT_IDS } from '../../src/shared/clients';

describe('template client registry', () => {
  it('maps every client to a unique publication file name', () => {
    const fileNames = TEMPLATE_CLIENT_IDS.map((id) => TEMPLATE_CLIENTS[id].fileName);
    expect(new Set(fileNames).size).toBe(fileNames.length);
  });

  it('defines full and minimal output profiles', () => {
    expect(OUTPUT_PROFILES).toEqual(['full', 'minimal']);
  });

  it('classifies node access per design §11.1', () => {
    expect(TEMPLATE_CLIENTS.mihomo.nodeAccess).toBe('A');
    expect(TEMPLATE_CLIENTS.surge.nodeAccess).toBe('A');
    expect(TEMPLATE_CLIENTS['sing-box'].nodeAccess).toBe('B');
    expect(TEMPLATE_CLIENTS['quantumult-x'].nodeAccess).toBe('C');
  });

  it.each([
    ['mihomo.yaml', 'mihomo'],
    ['Mihomo.YAML', 'mihomo'],
    ['stash.yaml', 'stash'],
    ['surge.conf', 'surge'],
    ['singbox.json', 'sing-box'],
    ['loon.conf', 'loon'],
    ['qx.conf', 'quantumult-x'],
    ['shadowrocket.conf', 'shadowrocket'],
  ])('parses %s as %s', (file, client) => {
    expect(parsePublicationFile(file)).toBe(client);
  });

  it.each(['home.yaml', 'home-surge.conf', 'mihomo.list', '.yaml', '-surge.conf', 'mihomo'])('rejects %s', (file) => {
    expect(parsePublicationFile(file)).toBeNull();
  });
});
