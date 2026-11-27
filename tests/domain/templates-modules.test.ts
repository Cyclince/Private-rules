import { describe, expect, it } from 'vitest';
import { BUILTIN_CARDS, buildStarterTemplate } from '../../src/builtin';
import {
  BLOCK_ENCRYPTED_DNS_CARD_ID,
  DNS_LEAK_FINAL_CARD_ID,
  ENHANCEMENT_MODULES,
  GAME_DOWNLOAD_DIRECT_CARD_ID,
  MODULE_GROUPS,
  MODULE_GROUP_DEFINITIONS,
  ModuleConflictError,
  TUNNEL_DIRECT_CARD_ID,
  applyEnhancementModules,
  listEnhancementModulesByGroup,
  probeTemplate,
  resolveTemplateCards,
  validateModuleCombination,
  type AppCard,
  type EnhancementModule,
} from '../../src/domain/templates';

function buildResolvedStandard() {
  const std = buildStarterTemplate('standard');
  return resolveTemplateCards(std.baseBody, BUILTIN_CARDS);
}

function toCardLookup(resolved: ReturnType<typeof buildResolvedStandard>): AppCard[] {
  return resolved.cards.map((c) => c.effective);
}

describe('5 template enhancement modules (individual, combined, and conflicting)', () => {
  it('registers all 5 enhancement modules', () => {
    expect(ENHANCEMENT_MODULES.map((m) => m.id).sort()).toEqual([
      'block-encrypted-dns',
      'dns-leak-guard',
      'game-download-direct',
      'ip-no-resolve',
      'tunnel-direct',
    ]);
  });

  it('1) ip-no-resolve adds noResolve: true to all GEOIP and inline IP-CIDR/IP-ASN rules without mutating input', () => {
    const customIpCard: AppCard = {
      id: 'custom-ip',
      slug: 'custom-ip',
      name: 'Custom IP',
      category: 'infrastructure',
      stage: 'ip',
      group: { type: 'select', candidates: [{ kind: 'builtin', id: 'DIRECT' }] },
      matchers: [
        { kind: 'geoip', name: 'telegram' },
        {
          kind: 'inline',
          conditions: [
            { op: 'rule', rule: { type: 'IP-CIDR', value: '91.108.4.0/22' } },
            { op: 'rule', rule: { type: 'IP-ASN', value: '62041' } },
          ],
        },
      ],
    };
    const baseBody = structuredClone(buildStarterTemplate('minimal').baseBody);
    baseBody.cards.splice(1, 0, { cardId: 'custom-ip', enabled: true });
    const resolved = resolveTemplateCards(baseBody, [...BUILTIN_CARDS, customIpCard]);
    const snapshot = structuredClone(resolved);

    const res = applyEnhancementModules(resolved, {
      client: 'mihomo',
      bindings: [{ id: 'ip-no-resolve', enabled: true }],
    });

    // Immutability check
    expect(resolved).toEqual(snapshot);
    expect(res.applied).toEqual(['ip-no-resolve']);
    expect(res.skipped).toEqual([]);

    const transformed = res.template.cards.find((c) => c.cardId === 'custom-ip')!.effective;
    expect(transformed.matchers[0]).toMatchObject({ kind: 'geoip', name: 'telegram', noResolve: true });
    expect(transformed.matchers[1]).toMatchObject({
      kind: 'inline',
      conditions: [
        { op: 'rule', rule: { type: 'IP-CIDR', value: '91.108.4.0/22', options: { noResolve: true } } },
        { op: 'rule', rule: { type: 'IP-ASN', value: '62041', options: { noResolve: true } } },
      ],
    });

    // Skipped on sing-box where no-resolve is not applicable
    const singboxRes = applyEnhancementModules(resolved, {
      client: 'sing-box',
      bindings: [{ id: 'ip-no-resolve', enabled: true }],
    });
    expect(singboxRes.applied).toEqual([]);
    expect(singboxRes.skipped).toHaveLength(1);
    expect(singboxRes.skipped[0]).toMatchObject({ moduleId: 'ip-no-resolve', client: 'sing-box' });
  });

  it('2) dns-leak-guard hardens DNS, removes system DNS, replaces final with a no-DIRECT group, and skips unsupported clients', () => {
    const resolved = buildResolvedStandard();
    resolved.body.dns.nameserver = ['system', 'dhcp://system', 'https://dns.alidns.com/dns-query'];

    const res = applyEnhancementModules(resolved, {
      client: 'mihomo',
      bindings: [{ id: 'dns-leak-guard', enabled: true }],
    });

    expect(res.applied).toEqual(['dns-leak-guard']);
    expect(res.template.body.dns.respectRules).toBe(true);
    expect(res.template.body.dns.nameserver).toEqual(['https://dns.alidns.com/dns-query']);
    expect(res.template.body.final).toEqual({ kind: 'card', cardId: DNS_LEAK_FINAL_CARD_ID });

    const finalCard = res.template.cards.find((c) => c.cardId === DNS_LEAK_FINAL_CARD_ID)!.effective;
    expect(finalCard.group.candidates.some((c) => c.kind === 'builtin' && c.id === 'DIRECT')).toBe(false);
    expect(finalCard.group.candidates.at(-1)).toEqual({ kind: 'builtin', id: 'REJECT-DROP' });

    // Supported on sing-box, skipped on Surge
    expect(
      applyEnhancementModules(resolved, {
        client: 'sing-box',
        bindings: [{ id: 'dns-leak-guard', enabled: true }],
      }).applied,
    ).toEqual(['dns-leak-guard']);

    const surgeRes = applyEnhancementModules(resolved, {
      client: 'surge',
      bindings: [{ id: 'dns-leak-guard', enabled: true }],
    });
    expect(surgeRes.applied).toEqual([]);
    expect(surgeRes.skipped[0]).toMatchObject({ moduleId: 'dns-leak-guard', client: 'surge' });
  });

  it('3) block-encrypted-dns prepends top-priority rules blocking port 853 and DoH/DoT domains and IPs', () => {
    const resolved = buildResolvedStandard();
    const res = applyEnhancementModules(resolved, {
      client: 'mihomo',
      bindings: [{ id: 'block-encrypted-dns', enabled: true }],
    });

    expect(res.applied).toEqual(['block-encrypted-dns']);
    const firstNonHidden = res.template.cards.find((c) => !c.effective.hidden);
    expect(firstNonHidden?.cardId).toBe(BLOCK_ENCRYPTED_DNS_CARD_ID);

    const cards = toCardLookup(res.template);
    const dohProbe = probeTemplate({ target: 'dns.google', body: res.template.body, cards });
    expect(dohProbe.cardId).toBe(BLOCK_ENCRYPTED_DNS_CARD_ID);
    expect(dohProbe.finalPolicy).toEqual({ kind: 'builtin', id: 'REJECT-DROP' });

    const dotPortProbe = probeTemplate({ target: 'custom.resolver.net:853', body: res.template.body, cards });
    expect(dotPortProbe.cardId).toBe(BLOCK_ENCRYPTED_DNS_CARD_ID);

    const ipProbe = probeTemplate({ target: '1.1.1.1', body: res.template.body, cards });
    expect(ipProbe.cardId).toBe(BLOCK_ENCRYPTED_DNS_CARD_ID);
  });

  it('4) game-download-direct routes Steam & game CDN domains to DIRECT in pre-direct stage', () => {
    const resolved = buildResolvedStandard();
    const res = applyEnhancementModules(resolved, {
      bindings: [{ id: 'game-download-direct', enabled: true }],
    });

    expect(res.applied).toEqual(['game-download-direct']);
    const gameCard = res.template.cards.find((c) => c.cardId === GAME_DOWNLOAD_DIRECT_CARD_ID);
    expect(gameCard?.effective.stage).toBe('pre-direct');

    const probe = probeTemplate({
      target: 'cache1-sha1.steamcontent.com',
      body: res.template.body,
      cards: toCardLookup(res.template),
      caches: {
        geositeRules: new Map([
          ['private', []],
          ['category-ads-all', []],
        ]),
        catalogRules: new Map([
          ['domestic-direct-custom', []],
          ['gaming-steam-cn', []],
        ]),
      },
    });
    expect(probe.cardId).toBe(GAME_DOWNLOAD_DIRECT_CARD_ID);
    expect(probe.finalPolicy).toEqual({ kind: 'builtin', id: 'DIRECT' });
  });

  it('5) tunnel-direct routes Tailscale, Cloudflare Tunnel, and ZeroTier traffic to DIRECT in pre-direct stage', () => {
    const resolved = buildResolvedStandard();
    const res = applyEnhancementModules(resolved, {
      bindings: [{ id: 'tunnel-direct', enabled: true }],
    });

    expect(res.applied).toEqual(['tunnel-direct']);
    const cards = toCardLookup(res.template);
    const caches = {
      geositeRules: new Map([
        ['private', []],
        ['category-ads-all', []],
      ]),
      catalogRules: new Map([
        ['domestic-direct-custom', []],
        ['infra-tunnel-direct', []],
      ]),
    };

    const tsDomain = probeTemplate({ target: 'myhost.tailnet.ts.net', body: res.template.body, cards, caches });
    expect(tsDomain.cardId).toBe(TUNNEL_DIRECT_CARD_ID);
    expect(tsDomain.finalPolicy).toEqual({ kind: 'builtin', id: 'DIRECT' });

    const cfTunnel = probeTemplate({ target: 'region1.v2.argotunnel.com', body: res.template.body, cards, caches });
    expect(cfTunnel.cardId).toBe(TUNNEL_DIRECT_CARD_ID);
  });

  it('composes compatible module combinations in deterministic order with ip-no-resolve running last', () => {
    const resolved = buildResolvedStandard();

    const comboA = applyEnhancementModules(resolved, {
      client: 'mihomo',
      bindings: [
        { id: 'ip-no-resolve', enabled: true },
        { id: 'tunnel-direct', enabled: true },
        { id: 'game-download-direct', enabled: true },
        { id: 'dns-leak-guard', enabled: true },
      ],
    });
    expect(comboA.applied).toEqual(['game-download-direct', 'tunnel-direct', 'dns-leak-guard', 'ip-no-resolve']);
    expect(comboA.template.body.final).toEqual({ kind: 'card', cardId: DNS_LEAK_FINAL_CARD_ID });

    const comboB = applyEnhancementModules(resolved, {
      client: 'mihomo',
      bindings: [
        { id: 'ip-no-resolve', enabled: true },
        { id: 'block-encrypted-dns', enabled: true },
        { id: 'game-download-direct', enabled: true },
        { id: 'tunnel-direct', enabled: true },
      ],
    });
    expect(comboB.applied).toEqual(['block-encrypted-dns', 'game-download-direct', 'tunnel-direct', 'ip-no-resolve']);
    // block-encrypted-dns stays first non-hidden card even with other pre-direct modules
    expect(comboB.template.cards.find((c) => !c.effective.hidden)?.cardId).toBe(BLOCK_ENCRYPTED_DNS_CARD_ID);
  });

  it('rejects conflicting module combinations (dns-leak-guard + block-encrypted-dns), unknown modules, and invalid params', () => {
    const conflictingBindings = [
      { id: 'dns-leak-guard', enabled: true },
      { id: 'block-encrypted-dns', enabled: true },
    ];

    const validation = validateModuleCombination(conflictingBindings);
    expect(validation.ok).toBe(false);
    expect(validation.conflicts).toHaveLength(1);
    expect(validation.conflicts[0]).toMatchObject({
      moduleA: 'dns-leak-guard',
      moduleB: 'block-encrypted-dns',
    });

    const resolved = buildResolvedStandard();
    expect(() => applyEnhancementModules(resolved, { client: 'mihomo', bindings: conflictingBindings })).toThrow(
      ModuleConflictError,
    );

    // Disabled conflicting module is NOT a conflict
    expect(
      validateModuleCombination([
        { id: 'dns-leak-guard', enabled: true },
        { id: 'block-encrypted-dns', enabled: false },
      ]).ok,
    ).toBe(true);

    // Unknown module & invalid params fail validation
    const badBindings = [
      { id: 'non-existent-module', enabled: true },
      { id: 'block-encrypted-dns', enabled: true, params: { action: 'INVALID' } },
    ];
    const badValidation = validateModuleCombination(badBindings);
    expect(badValidation.ok).toBe(false);
    expect(badValidation.errors.map((e) => e.code)).toEqual(['UNKNOWN_MODULE', 'INVALID_MODULE_PARAMS']);
    expect(() => applyEnhancementModules(resolved, { bindings: badBindings })).toThrow(ModuleConflictError);
  });

  it('exposes complete §5 module metadata (group, icon, tierDefaults, supportedClients) and groups cleanly including runtime extensions', () => {
    expect(MODULE_GROUP_DEFINITIONS.map((g) => g.id)).toEqual([...MODULE_GROUPS]);
    expect(MODULE_GROUPS).toEqual(['dns-privacy', 'accuracy', 'direct', 'runtime']);

    for (const mod of ENHANCEMENT_MODULES) {
      expect(MODULE_GROUPS).toContain(mod.group);
      expect(mod.icon.trim().length).toBeGreaterThan(0);
      expect(typeof mod.tierDefaults.simple).toBe('boolean');
      expect(typeof mod.tierDefaults.advanced).toBe('boolean');
      expect(typeof mod.tierDefaults.pro).toBe('boolean');
      expect(mod.supportedClients.length).toBeGreaterThan(0);
    }

    const byId = new Map(ENHANCEMENT_MODULES.map((m) => [m.id, m]));
    expect(byId.get('dns-leak-guard')).toMatchObject({
      group: 'dns-privacy',
      icon: '🛡️',
      tierDefaults: { simple: true, advanced: true, pro: true },
    });
    expect(byId.get('block-encrypted-dns')).toMatchObject({
      group: 'dns-privacy',
      icon: '🚫',
      tierDefaults: { simple: false, advanced: false, pro: true },
    });
    expect(byId.get('ip-no-resolve')).toMatchObject({
      group: 'accuracy',
      icon: '📌',
      tierDefaults: { simple: true, advanced: true, pro: true },
    });
    expect(byId.get('tunnel-direct')).toMatchObject({
      group: 'direct',
      icon: '🔗',
      tierDefaults: { simple: false, advanced: true, pro: true },
    });
    expect(byId.get('game-download-direct')).toMatchObject({
      group: 'direct',
      icon: '🎮',
      tierDefaults: { simple: false, advanced: false, pro: true },
    });

    const grouped = listEnhancementModulesByGroup();
    expect(grouped.map((b) => b.id)).toEqual(['dns-privacy', 'accuracy', 'direct', 'runtime']);
    expect(grouped[0].modules.map((m) => m.id)).toEqual(['block-encrypted-dns', 'dns-leak-guard']);
    expect(grouped[1].modules.map((m) => m.id)).toEqual(['ip-no-resolve']);
    expect(grouped[2].modules.map((m) => m.id)).toEqual(['game-download-direct', 'tunnel-direct']);
    expect(grouped[3].modules).toEqual([]);

    // Custom future runtime module fits cleanly without structural changes
    const syntheticRuntimeModule: EnhancementModule = {
      id: 'tun-mode',
      name: 'TUN 模式',
      icon: '⚙️',
      group: 'runtime',
      description: 'Mock runtime module for extensibility check.',
      defaultEnabled: false,
      tierDefaults: { simple: false, advanced: false, pro: true },
      order: 60,
      affects: ['dns'],
      supportedClients: ['mihomo'],
      apply: (tpl) => tpl,
    };
    const extendedGroups = listEnhancementModulesByGroup([...ENHANCEMENT_MODULES, syntheticRuntimeModule]);
    expect(extendedGroups.find((b) => b.id === 'runtime')?.modules.map((m) => m.id)).toEqual(['tun-mode']);
  });
});
