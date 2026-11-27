import { describe, expect, it } from 'vitest';
import {
  APPS,
  APP_IDS,
  APP_PLATFORMS,
  appsByPlatform,
  getApp,
  importLinkForApp,
  ruleLinkForApp,
  templateClientForApp,
  type AppDefinition,
  type AppPlatform,
} from '../../src/shared/apps';
import { CLIENT_IMPORTS, getImportLink } from '../../src/shared/client-import';
import { TEMPLATE_CLIENTS, type TemplateClientId } from '../../src/shared/clients';
import type { ClientId, ClientLink } from '../../src/types/domain-rules';

/** First batch from design §1.2, with the D1 family decision applied. */
const FIRST_BATCH = [
  'shadowrocket',
  'quantumult-x',
  'loon',
  'surge',
  'stash',
  'egern',
  'sing-box',
  'clash-verge-rev',
  'clash-party',
  'flclash',
  'clash-meta-android',
  'karing',
  'surfboard',
  'openclash',
  'clashmi',
  'hiddify',
] as const;

function makeLink(id: ClientId, options: { recommendedUrl?: string; supported?: boolean } = {}): ClientLink {
  return {
    id,
    name: id,
    icon: id,
    description: id,
    fileName: `${id}.txt`,
    publicUrl: `https://rules.example.com/p/demo/${id}`,
    tokenUrl: `https://rules.example.com/t/demo/${id}`,
    recommendedUrl: options.recommendedUrl ?? `https://rules.example.com/p/demo/${id}`,
    supported: options.supported ?? true,
  };
}

function links(entries: Array<[ClientId, Parameters<typeof makeLink>[1]] | ClientId>): ClientLink[] {
  return entries.map((entry) => (Array.isArray(entry) ? makeLink(entry[0], entry[1]) : makeLink(entry)));
}

function appOrThrow(id: string): AppDefinition {
  const app = getApp(id);
  if (!app) throw new Error(`missing app ${id}`);
  return app;
}

describe('R1 software catalog (src/shared/apps.ts)', () => {
  it('contains exactly the first batch with complete, unique records', () => {
    expect([...APP_IDS].sort()).toEqual([...FIRST_BATCH].sort());
    expect(new Set(APP_IDS).size).toBe(APP_IDS.length);

    for (const app of APPS) {
      expect(app.id).toMatch(/^[a-z0-9-]+$/);
      expect(app.name.length).toBeGreaterThan(0);
      expect(Array.isArray(app.aliases)).toBe(true);
      expect(app.platforms.length).toBeGreaterThan(0);
      for (const platform of app.platforms) expect(APP_PLATFORMS).toContain(platform);
      expect(['mihomo', 'singbox', 'apple']).toContain(app.family);
      expect(['ready', 'rules-only', 'planned']).toContain(app.status);
      expect(app.ruleClientId.length).toBeGreaterThan(0);
      expect(app.howToKey).toBe(`apps.howTo.${app.id}`);
      // Artwork is deferred until licences are confirmed (D3); every row falls back to the badge.
      expect(app.icon).toBe('');
    }
  });

  it('keeps the D1 family decision: Stash with mihomo, Egern with the Apple family', () => {
    expect(appOrThrow('stash').family).toBe('mihomo');
    expect(appOrThrow('egern').family).toBe('apple');
  });

  it('maps each app to an existing rule client and a full-config compiler only when supported', () => {
    const ruleClientIds = new Set<ClientId>([
      'general',
      'clash',
      'mihomo',
      'openclash',
      'clash-verge',
      'stash',
      'loon',
      'shadowrocket',
      'quantumult-x',
      'surge',
      'surge-mac',
      'egern',
      'surfboard',
      'sing-box',
      'v2ray',
      'url',
      'json',
      'yaml-classical',
      'yaml-domain',
      'yaml-ipcidr',
    ]);

    for (const app of APPS) {
      expect(ruleClientIds.has(app.ruleClientId)).toBe(true);
      if (app.templateClientId !== null) {
        expect(Object.keys(TEMPLATE_CLIENTS)).toContain(app.templateClientId);
      }
      if (app.importClientId !== null) {
        expect(Object.keys(CLIENT_IMPORTS)).toContain(app.importClientId);
      }
    }

    expect(appOrThrow('clash-verge-rev').ruleClientId).toBe('clash-verge');
    expect(appOrThrow('surge').ruleClientId).toBe('surge');
    expect(appOrThrow('sing-box').ruleClientId).toBe('sing-box');
    expect(appOrThrow('sing-box').templateClientId).toBe('sing-box');
    expect(appOrThrow('clash-verge-rev').templateClientId).toBe('mihomo');
    expect(appOrThrow('stash').templateClientId).toBe('stash');
    expect(appOrThrow('egern').templateClientId).toBeNull();
    expect(appOrThrow('surfboard').templateClientId).toBeNull();
  });

  it('derives node access from the compiler instead of duplicating it', () => {
    for (const app of APPS) {
      const expected = app.templateClientId
        ? TEMPLATE_CLIENTS[app.templateClientId as TemplateClientId].nodeAccess
        : null;
      expect(app.nodeAccess).toBe(expected);
    }
    expect(appOrThrow('sing-box').nodeAccess).toBe('B');
    expect(appOrThrow('clash-verge-rev').nodeAccess).toBe('A');
    expect(appOrThrow('loon').nodeAccess).toBe('C');
    expect(appOrThrow('egern').nodeAccess).toBeNull();
  });

  it('marks rule-only and planned software honestly', () => {
    const rulesOnly = APPS.filter((app) => app.status === 'rules-only').map((app) => app.id);
    expect(rulesOnly).toEqual(['egern', 'karing', 'surfboard', 'clashmi']);
    expect(APPS.filter((app) => app.status === 'planned').map((app) => app.id)).toEqual(['hiddify']);

    for (const app of APPS) {
      if (app.status === 'ready') expect(app.templateClientId).not.toBeNull();
      else expect(app.templateClientId).toBeNull();
    }
  });

  it('looks apps up by id and ignores unknown ids', () => {
    expect(getApp('shadowrocket')?.name).toBe('Shadowrocket');
    expect(getApp('nope')).toBeUndefined();
    expect(templateClientForApp('nope' as never)).toBeNull();
    expect(ruleLinkForApp('nope' as never, links(['yaml-classical']))).toBeNull();
  });

  it('filters by platform and hides planned software unless asked', () => {
    const ids = (platform: AppPlatform) => appsByPlatform(platform).map((app) => app.id);

    expect(ids('ios')).toEqual(expect.arrayContaining(['shadowrocket', 'quantumult-x', 'loon', 'surge', 'stash']));
    expect(ids('macos')).toContain('clash-verge-rev');
    expect(ids('windows')).toEqual(expect.arrayContaining(['clash-verge-rev', 'flclash', 'clash-party', 'karing']));
    expect(ids('android')).toEqual(expect.arrayContaining(['flclash', 'clash-meta-android', 'surfboard']));
    expect(ids('router')).toEqual(['openclash']);
    expect(ids('linux')).toContain('clash-verge-rev');

    // Platform isolation: a Mac-only app never leaks into the iPhone list.
    expect(ids('ios')).not.toContain('clash-verge-rev');
    expect(ids('android')).not.toContain('openclash');

    expect(ids('ios')).not.toContain('hiddify');
    expect(appsByPlatform('ios', { includePlanned: true }).map((app) => app.id)).toContain('hiddify');
  });
});

describe('R1 rule link selection for an app', () => {
  it('prefers the software-specific file, then the family fallback', () => {
    const clashVerge = appOrThrow('clash-verge-rev');
    expect(ruleLinkForApp(clashVerge, links(['yaml-classical']))?.id).toBe('yaml-classical');
    expect(ruleLinkForApp(clashVerge, links(['yaml-classical', 'clash-verge']))?.id).toBe('clash-verge');
    expect(ruleLinkForApp(clashVerge, links(['clash', 'mihomo']))?.id).toBe('mihomo');
    // A shared LIST must never be picked while a YAML rule provider is available.
    expect(ruleLinkForApp(clashVerge, links(['general', 'yaml-classical']))?.id).toBe('yaml-classical');
  });

  it('gives mihomo-family apps a classical YAML rule provider', () => {
    for (const id of ['clash-party', 'flclash', 'clash-meta-android', 'stash', 'openclash']) {
      const picked = ruleLinkForApp(appOrThrow(id), links(['general', 'mihomo', 'yaml-classical']));
      expect(['yaml-classical', 'mihomo']).toContain(picked?.id);
      expect(picked?.id).not.toBe('general');
    }
    // Stash has its own YAML link and keeps it.
    expect(ruleLinkForApp(appOrThrow('stash'), links(['yaml-classical', 'stash']))?.id).toBe('stash');
  });

  it('gives sing-box apps the JSON rule set and never a YAML provider', () => {
    const singBox = appOrThrow('sing-box');
    expect(ruleLinkForApp(singBox, links(['sing-box', 'json']))?.id).toBe('sing-box');
    expect(ruleLinkForApp(singBox, links(['yaml-classical', 'json', 'general']))?.id).toBe('json');
    expect(ruleLinkForApp(singBox, links(['yaml-classical']))).toBeNull();
    expect(ruleLinkForApp(singBox, links(['yaml-classical', 'general']))?.id).toBe('general');
    expect(ruleLinkForApp(appOrThrow('karing'), links(['yaml-classical', 'json']))?.id).toBe('json');
  });

  it('gives Apple-family apps their own LIST, falling back within the family', () => {
    expect(ruleLinkForApp(appOrThrow('loon'), links(['general', 'loon']))?.id).toBe('loon');
    expect(ruleLinkForApp(appOrThrow('quantumult-x'), links(['general', 'quantumult-x']))?.id).toBe('quantumult-x');
    expect(ruleLinkForApp(appOrThrow('shadowrocket'), links(['surge', 'shadowrocket']))?.id).toBe('shadowrocket');
    expect(ruleLinkForApp(appOrThrow('egern'), links(['general', 'egern']))?.id).toBe('egern');
    expect(ruleLinkForApp(appOrThrow('surfboard'), links(['general', 'surfboard']))?.id).toBe('surfboard');
    // Only a generic list exists: still better than nothing, and never a YAML file.
    expect(ruleLinkForApp(appOrThrow('loon'), links(['yaml-classical', 'general']))?.id).toBe('general');
  });

  it('prefers a link with a usable address and skips unsupported ones', () => {
    const clashVerge = appOrThrow('clash-verge-rev');
    expect(ruleLinkForApp(clashVerge, links([['clash-verge', { recommendedUrl: '' }], 'yaml-classical']))?.id).toBe(
      'yaml-classical',
    );
    expect(ruleLinkForApp(clashVerge, links([['clash-verge', { supported: false }], 'yaml-classical']))?.id).toBe(
      'yaml-classical',
    );
    expect(ruleLinkForApp(clashVerge, [])).toBeNull();
    expect(ruleLinkForApp(clashVerge, links([['clash-verge', { supported: false }]]))).toBeNull();
  });

  it('resolves the compiler for an app id or a definition object', () => {
    expect(templateClientForApp('sing-box')).toBe('sing-box');
    expect(templateClientForApp(appOrThrow('flclash'))).toBe('mihomo');
    expect(templateClientForApp('egern')).toBeNull();
    expect(templateClientForApp('surfboard')).toBeNull();
  });

  it('reuses the verified-only import gate from client-import.ts', () => {
    for (const app of APPS) {
      if (app.importClientId === null) {
        expect(importLinkForApp(app, 'https://rules.example.com/p/demo/mihomo.yaml', 'demo')).toBeNull();
        continue;
      }
      expect(importLinkForApp(app, 'https://rules.example.com/p/demo/mihomo.yaml', 'demo')).toBe(
        getImportLink(app.importClientId, 'https://rules.example.com/p/demo/mihomo.yaml', 'demo'),
      );
    }
    // Every scheme is unverified today, so no app may expose an import button yet.
    expect(importLinkForApp('clash-verge-rev', 'https://rules.example.com/p/demo/mihomo.yaml', 'demo')).toBeNull();

    const metadata = CLIENT_IMPORTS.mihomo;
    const original = metadata.verified;
    try {
      metadata.verified = true;
      expect(importLinkForApp('clash-verge-rev', 'https://rules.example.com/p/demo/mihomo.yaml', 'demo')).toBe(
        'clash://install-config?url=https%3A%2F%2Frules.example.com%2Fp%2Fdemo%2Fmihomo.yaml&name=demo',
      );
    } finally {
      metadata.verified = original;
    }
  });
});
