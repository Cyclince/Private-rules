import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { BUILTIN_CARDS } from '../../src/builtin/cards';
import { BUILTIN_CATALOG } from '../../src/builtin/catalog';
import { buildComplexityStarterTemplate, buildStarterTemplate } from '../../src/builtin/templates';
import {
  ModuleConflictError,
  applyEnhancementModules,
  buildDefaultModulesForComplexity,
  compileLoon,
  compileMihomo,
  compileQuanx,
  compileShadowrocket,
  compileSingbox,
  compileStash,
  compileSurge,
  probeTemplate,
  resolveTemplateCards,
  validateModuleCombination,
} from '../../src/domain/templates';
import {
  APPLE_PUSH_DIRECT_CARD_ID,
  BT_DIRECT_CARD_ID,
  DISABLE_QUIC_CARD_ID,
  DISABLE_QUIC_MODULE_ID,
  DOMESTIC_APPS_DIRECT_CARD_ID,
  ENHANCEMENT_MODULES,
  MIHOMO_DEFAULT_SNIFFER_PATCH,
  MODULE_AUXILIARY_CARD_IDS,
  PRIVACY_TRACKER_BLOCK_CARD_ID,
  SNIFFER_MODULE_ID,
  TUN_MODE_MODULE_ID,
  shouldEmitSniffer,
  type EnhancementModule,
  type ModuleTierDefaults,
} from '../../src/domain/templates/modules';

const FIXED_GENERATED_AT = '2026-01-01T00:00:00.000Z';
const FIXED_BASE_URL = 'https://rules.example.com';

const STANDARD_SLOT_BINDINGS = {
  'slot-main': {
    kind: 'http' as const,
    url: 'https://sub.example.com/airport?token=demo',
    userAgent: 'clash-verge/v2.5.1',
    intervalSec: 3600,
  },
};

const NEW_MODULE_IDS = [
  'privacy-tracker-block',
  'sniffer',
  'disable-quic',
  'apple-push-direct',
  'domestic-apps-direct',
  'bt-direct',
  'tun-mode',
] as const;

type ModuleId = (typeof NEW_MODULE_IDS)[number];

const EXPECTED_TIERS: Record<ModuleId, ModuleTierDefaults> = {
  'privacy-tracker-block': { simple: false, advanced: false, pro: true },
  sniffer: { simple: false, advanced: true, pro: true },
  'disable-quic': { simple: false, advanced: false, pro: true },
  'apple-push-direct': { simple: false, advanced: true, pro: true },
  'domestic-apps-direct': { simple: true, advanced: true, pro: true },
  'bt-direct': { simple: false, advanced: false, pro: true },
  'tun-mode': { simple: false, advanced: false, pro: false },
};

function buildBody(modules: readonly { id: string; enabled: boolean }[] = []) {
  const tpl = buildStarterTemplate('standard', { output: 'full' });
  return {
    body: { ...structuredClone(tpl.baseBody), modules: [...tpl.baseBody.modules, ...modules] },
  };
}

function compileMihomoBody(body: ReturnType<typeof buildBody>['body']) {
  return compileMihomo({
    body,
    cards: BUILTIN_CARDS,
    catalogIndex: BUILTIN_CATALOG,
    generatedAt: FIXED_GENERATED_AT,
    slotBindings: STANDARD_SLOT_BINDINGS,
  });
}

function docOf(body: ReturnType<typeof buildBody>['body']): Record<string, unknown> {
  return parseYaml(compileMihomoBody(body).content) as Record<string, unknown>;
}

function rulesOf(doc: Record<string, unknown>): string[] {
  return doc.rules as string[];
}

function appliedTemplate(body: ReturnType<typeof buildBody>['body']) {
  return applyEnhancementModules(resolveTemplateCards(body, BUILTIN_CARDS), { client: 'mihomo' }).template;
}

function probeIn(
  body: ReturnType<typeof buildBody>['body'],
  target: string,
  meta?: { processName?: string; dstPort?: number; network?: string },
) {
  const applied = appliedTemplate(body);
  return probeTemplate({
    target,
    body: applied.body,
    cards: applied.cards.map((entry) => entry.effective),
    ...(meta ? { meta } : {}),
  });
}

describe('N4 §5.2 enhancement modules — metadata, tiers and conflicts', () => {
  it('registers each new module with §5.2 group, tier defaults and client support', () => {
    const byId = new Map(ENHANCEMENT_MODULES.map((mod) => [mod.id, mod]));
    for (const id of NEW_MODULE_IDS) {
      const mod = byId.get(id);
      expect(mod, `missing module ${id}`).toBeTruthy();
      expect(mod!.tierDefaults).toEqual(EXPECTED_TIERS[id]);
      expect(mod!.icon.trim().length).toBeGreaterThan(0);
      expect(mod!.description.trim().length).toBeGreaterThan(0);
    }

    // Only mihomo can express a sniffer section / TUN runtime block today.
    expect(byId.get('sniffer')!.supportedClients).toEqual(['mihomo']);
    expect(byId.get('tun-mode')!.supportedClients).toEqual(['mihomo']);
    // disable-quic works on every client that supports UDP/network + port + AND logic (all except quantumult-x).
    expect(byId.get(DISABLE_QUIC_MODULE_ID)!.group).toBe('accuracy');
    expect(byId.get(DISABLE_QUIC_MODULE_ID)!.conflictsWith).toEqual([]);
    expect(byId.get(DISABLE_QUIC_MODULE_ID)!.supportedClients).toEqual([
      'mihomo',
      'stash',
      'surge',
      'sing-box',
      'loon',
      'shadowrocket',
    ]);
    // The remaining additions are pure rule cards and work on every compiled client.
    for (const id of ['privacy-tracker-block', 'apple-push-direct', 'domestic-apps-direct', 'bt-direct'] as const) {
      expect(byId.get(id)!.supportedClients).toEqual([
        'mihomo',
        'stash',
        'surge',
        'sing-box',
        'loon',
        'quantumult-x',
        'shadowrocket',
      ]);
    }
  });

  it('never conflicts with each other or with the existing modules, while the known conflict still trips', () => {
    const allNew = NEW_MODULE_IDS.map((id) => ({ id, enabled: true }));
    const withExisting = [
      ...allNew,
      { id: 'ip-no-resolve', enabled: true },
      { id: 'game-download-direct', enabled: true },
      { id: 'tunnel-direct', enabled: true },
      { id: 'dns-leak-guard', enabled: true },
    ];
    const validation = validateModuleCombination(withExisting);
    expect(validation.ok).toBe(true);
    expect(validation.conflicts).toEqual([]);

    // 禁用 QUIC 与 游戏下载直连 的取舍（§5.2 说明）在当前实现里体现为「直连模块相互独立」：
    // 下载直连、国内应用直连、BT 直连可以同时启用，规则按模块 order 顺序求值。
    expect(
      validateModuleCombination([
        { id: 'game-download-direct', enabled: true },
        { id: 'bt-direct', enabled: true },
        { id: 'domestic-apps-direct', enabled: true },
      ]).ok,
    ).toBe(true);

    // Existing hard conflict is untouched by the new modules.
    expect(
      validateModuleCombination([
        { id: 'dns-leak-guard', enabled: true },
        { id: 'block-encrypted-dns', enabled: true },
      ]).conflicts,
    ).toHaveLength(1);

    // Conflict machinery still reports a declared conflict of a custom module.
    const conflictingModule: EnhancementModule = {
      id: 'synthetic-tracker-proxy',
      name: '合成模块',
      icon: '🧪',
      group: 'dns-privacy',
      description: 'test only',
      defaultEnabled: false,
      tierDefaults: { simple: false, advanced: false, pro: true },
      order: 99,
      affects: ['rules'],
      conflictsWith: ['privacy-tracker-block'],
      conflictReasons: { 'privacy-tracker-block': '合成模块与隐私跟踪拦截互斥。' },
      supportedClients: ['mihomo'],
      apply: (tpl) => tpl,
    };
    const registry = [...ENHANCEMENT_MODULES, conflictingModule];
    const body = buildBody([
      { id: 'privacy-tracker-block', enabled: true },
      { id: 'synthetic-tracker-proxy', enabled: true },
    ]);
    const resolved = resolveTemplateCards(body.body, BUILTIN_CARDS);
    expect(() => applyEnhancementModules(resolved, { client: 'mihomo', registry })).toThrow(ModuleConflictError);
  });

  it('keeps every existing output byte-identical when the new modules are not bound', () => {
    const { body } = buildBody();
    const plain = compileMihomoBody(body);

    // Binding the new card modules with enabled:false is a no-op as well.
    const disabledCardModules = NEW_MODULE_IDS.filter((id) => id !== SNIFFER_MODULE_ID).map((id) => ({
      id,
      enabled: false,
    }));
    const withDisabled = compileMihomoBody({ ...body, modules: [...body.modules, ...disabledCardModules] });
    expect(withDisabled.content).toBe(plain.content);
    expect(plain.content).not.toContain(PRIVACY_TRACKER_BLOCK_CARD_ID);
    expect(plain.content).not.toContain(APPLE_PUSH_DIRECT_CARD_ID);
    expect(plain.content).not.toContain(DOMESTIC_APPS_DIRECT_CARD_ID);
    expect(plain.content).not.toContain(BT_DIRECT_CARD_ID);
  });
});

describe('N4 §5.2 enhancement modules — mihomo output per module', () => {
  it('privacy-tracker-block rejects tracking domains at the top of the rule list', () => {
    const { body } = buildBody([{ id: 'privacy-tracker-block', enabled: true }]);
    const doc = docOf(body);
    const rules = rulesOf(doc);

    expect(rules[0]).toBe('DOMAIN-SUFFIX,google-analytics.com,🕵️ 隐私跟踪拦截');
    expect(rules).toContain('DOMAIN-SUFFIX,app-measurement.com,🕵️ 隐私跟踪拦截');
    expect(rules).toContain('DOMAIN-SUFFIX,bugly.qq.com,🕵️ 隐私跟踪拦截');
    expect(rules.some((rule) => rule.includes('push.apple.com'))).toBe(false);

    const groupNames = (doc['proxy-groups'] as { name: string }[]).map((group) => group.name);
    expect(groupNames).toContain('🕵️ 隐私跟踪拦截');

    expect(probeIn(body, 'https://www.google-analytics.com/collect').cardId).toBe(PRIVACY_TRACKER_BLOCK_CARD_ID);
  });

  it('apple-push-direct routes APNs hosts to DIRECT before application groups', () => {
    const { body } = buildBody([{ id: 'apple-push-direct', enabled: true }]);
    const doc = docOf(body);
    const rules = rulesOf(doc);

    for (const suffix of ['push.apple.com', 'courier.push.apple.com', 'gateway.push.apple.com']) {
      const index = rules.indexOf(`DOMAIN-SUFFIX,${suffix},🍎 Apple 推送直连`);
      expect(index).toBeGreaterThanOrEqual(0);
      const firstAppRule = rules.findIndex((rule) => rule.endsWith(',🍎 苹果服务'));
      if (firstAppRule >= 0) expect(index).toBeLessThan(firstAppRule);
    }
    // Port 5223 is opt-in.
    expect(rules.some((rule) => rule.startsWith('DST-PORT,5223'))).toBe(false);

    expect(probeIn(body, '17-courier.push.apple.com').cardId).toBe(APPLE_PUSH_DIRECT_CARD_ID);
  });

  it('domestic-apps-direct forces WeChat, Alipay and bank domains to DIRECT', () => {
    const { body } = buildBody([{ id: 'domestic-apps-direct', enabled: true }]);
    const doc = docOf(body);
    const rules = rulesOf(doc);

    expect(rules).toContain('DOMAIN-SUFFIX,weixin.qq.com,📱 国内应用直连');
    expect(rules).toContain('DOMAIN-SUFFIX,alipay.com,📱 国内应用直连');
    expect(rules).toContain('DOMAIN-SUFFIX,icbc.com.cn,📱 国内应用直连');
    expect(rules).toContain('DOMAIN-SUFFIX,95516.com,📱 国内应用直连');

    expect(probeIn(body, 'wx.qq.com').cardId).toBe(DOMESTIC_APPS_DIRECT_CARD_ID);
    expect(probeIn(body, 'www.icbc.com.cn').cardId).toBe(DOMESTIC_APPS_DIRECT_CARD_ID);
  });

  it('bt-direct matches download clients by process name and default ports', () => {
    const { body } = buildBody([{ id: 'bt-direct', enabled: true }]);
    const doc = docOf(body);
    const rules = rulesOf(doc);

    expect(rules).toContain('PROCESS-NAME,qbittorrent,🧲 BT / PT 直连');
    expect(rules).toContain('DST-PORT,6881,🧲 BT / PT 直连');
    expect(rules).toContain('DST-PORT,51413,🧲 BT / PT 直连');

    expect(probeIn(body, '1.2.3.4', { processName: 'transmission' }).cardId).toBe(BT_DIRECT_CARD_ID);
    expect(probeIn(body, '1.2.3.4', { dstPort: 51413 }).cardId).toBe(BT_DIRECT_CARD_ID);
  });

  it('bt-direct drops PROCESS-NAME rules on clients that cannot express them', () => {
    const resolved = resolveTemplateCards(buildBody().body, BUILTIN_CARDS);
    const onQuantumult = applyEnhancementModules(resolved, {
      client: 'quantumult-x',
      bindings: [{ id: 'bt-direct', enabled: true }],
    });
    const card = onQuantumult.template.cards.find((entry) => entry.cardId === BT_DIRECT_CARD_ID);
    expect(card).toBeTruthy();
    const conditions = card!.effective.matchers.flatMap((matcher) =>
      matcher.kind === 'inline' ? matcher.conditions : [],
    );
    expect(conditions.some((cond) => cond.op === 'rule' && cond.rule.type === 'PROCESS-NAME')).toBe(false);
    expect(conditions.some((cond) => cond.op === 'rule' && cond.rule.type === 'DST-PORT')).toBe(true);
  });

  it('sniffer keeps exactly one compiler-written block and omits sniffer completely when explicitly disabled', () => {
    const { body: baselineBody } = buildBody();
    const { body } = buildBody([{ id: 'sniffer', enabled: true }]);
    const baselineYaml = compileMihomoBody(baselineBody).content;
    const enabledYaml = compileMihomoBody(body).content;
    expect(enabledYaml).toBe(baselineYaml);

    const enabledDoc = parseYaml(enabledYaml) as Record<string, unknown>;
    const sniffer = enabledDoc.sniffer as Record<string, unknown>;
    expect(sniffer.enable).toBe(true);
    expect((sniffer.sniff as Record<string, unknown>).QUIC).toBeTruthy();
    expect(body.clientPatches?.mihomo).toBeUndefined();

    const disabled = {
      ...body,
      modules: [...body.modules.filter((mod) => mod.id !== 'sniffer'), { id: 'sniffer', enabled: false }],
    };
    const disabledCompiled = compileMihomoBody(disabled);
    const disabledDoc = parseYaml(disabledCompiled.content) as Record<string, unknown>;
    expect(disabledDoc.sniffer).toBeUndefined();
    expect(disabledCompiled.content).not.toMatch(/^sniffer:/m);
    expect(appliedTemplate(disabled).body.clientPatches?.mihomo).toBeUndefined();

    expect(shouldEmitSniffer([])).toBe(true);
    expect(shouldEmitSniffer([{ id: 'sniffer', enabled: false }])).toBe(false);
    expect(shouldEmitSniffer([{ id: 'sniffer', enabled: true }])).toBe(true);
  });

  it('tun-mode writes a mihomo tun block through client patches and is off by default', () => {
    const { body } = buildBody();
    expect(docOf(body).tun).toBeUndefined();

    const { body: withTun } = buildBody([{ id: 'tun-mode', enabled: true }]);
    const doc = docOf(withTun);
    const tun = doc.tun as Record<string, unknown>;
    expect(tun.enable).toBe(true);
    expect(tun.stack).toBe('mixed');
    expect(tun['auto-route']).toBe(true);
    expect(tun['dns-hijack']).toEqual(['any:53']);
    expect(appliedTemplate(withTun).body.clientPatches?.mihomo).toContain('tun:');

    // Existing (user / imported) patch text is preserved.
    const withExistingPatch = {
      ...withTun,
      clientPatches: { ...(withTun.clientPatches ?? {}), mihomo: 'keep-alive-interval: 30\n' },
    };
    const merged = compileMihomoBody(withExistingPatch);
    const mergedDoc = parseYaml(merged.content) as Record<string, unknown>;
    expect(mergedDoc['keep-alive-interval']).toBe(30);
    expect((mergedDoc.tun as Record<string, unknown>).enable).toBe(true);

    // A user patch that already defines tun is never overwritten.
    const userTun = applyEnhancementModules(resolveTemplateCards(withTun, BUILTIN_CARDS), {
      client: 'mihomo',
      bindings: [{ id: 'tun-mode', enabled: true }],
    });
    expect(userTun.applied).toEqual(['tun-mode']);
  });

  it('composes the direct modules in deterministic pre-direct order', () => {
    const { body } = buildBody([
      ...NEW_MODULE_IDS.map((id) => ({ id, enabled: true })),
      { id: 'game-download-direct', enabled: true },
      { id: 'tunnel-direct', enabled: true },
    ]);
    const resolved = applyEnhancementModules(resolveTemplateCards(body, BUILTIN_CARDS), { client: 'mihomo' });
    const order = resolved.template.cards
      .map((entry) => entry.cardId)
      .filter((cardId) => MODULE_AUXILIARY_CARD_IDS.includes(cardId));
    expect(order).toEqual([
      DISABLE_QUIC_CARD_ID,
      PRIVACY_TRACKER_BLOCK_CARD_ID,
      'module-game-download-direct',
      APPLE_PUSH_DIRECT_CARD_ID,
      DOMESTIC_APPS_DIRECT_CARD_ID,
      'module-tunnel-direct',
      BT_DIRECT_CARD_ID,
    ]);

    // Idempotent: a second pass does not duplicate module cards.
    const twice = applyEnhancementModules(resolved.template, {
      client: 'mihomo',
      bindings: [
        ...NEW_MODULE_IDS.map((id) => ({ id, enabled: true })),
        { id: 'game-download-direct', enabled: true },
        { id: 'tunnel-direct', enabled: true },
      ],
    });
    const count = twice.template.cards.filter((entry) => entry.cardId === BT_DIRECT_CARD_ID).length;
    expect(count).toBe(1);
  });

  it('skips unsupported clients and reports the skip in the compatibility report', () => {
    const resolved = resolveTemplateCards(buildBody().body, BUILTIN_CARDS);

    const surgeModules = applyEnhancementModules(resolved, {
      client: 'surge',
      bindings: [
        { id: 'tun-mode', enabled: true },
        { id: SNIFFER_MODULE_ID, enabled: true },
      ],
    });
    expect(surgeModules.applied).toEqual([]);
    expect(surgeModules.skipped.map((entry) => entry.moduleId)).toEqual([SNIFFER_MODULE_ID, TUN_MODE_MODULE_ID]);
    for (const skipped of surgeModules.skipped) {
      expect(skipped.reason).toBe('unsupported-client');
      expect(skipped.client).toBe('surge');
    }

    const { body } = buildBody([
      { id: SNIFFER_MODULE_ID, enabled: true },
      { id: TUN_MODE_MODULE_ID, enabled: true },
    ]);
    const compiled = compileSurge({
      body,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      generatedAt: FIXED_GENERATED_AT,
      baseUrl: FIXED_BASE_URL,
      rulesetBehaviors: new Map(),
      slotBindings: STANDARD_SLOT_BINDINGS,
    });
    const skips = compiled.report.items.filter((item) => item.code === 'MODULE_SKIPPED');
    expect(skips.map((item) => item.location?.moduleId).sort()).toEqual([SNIFFER_MODULE_ID, TUN_MODE_MODULE_ID]);
    expect(compiled.content).not.toContain('sniffer');
    expect(compiled.content).not.toContain('tun:');
  });

  it('leaves minimal output cleanly without sniffer and notes runtime modules', () => {
    const tpl = buildStarterTemplate('standard', { output: 'minimal' });
    const snifferOff = {
      ...structuredClone(tpl.baseBody),
      output: 'minimal' as const,
      modules: [...tpl.baseBody.modules, { id: SNIFFER_MODULE_ID, enabled: false }],
    };
    const res = applyEnhancementModules(resolveTemplateCards(snifferOff, BUILTIN_CARDS), { client: 'mihomo' });
    expect(res.disabled).toEqual([]);
    expect(res.template.body.clientPatches?.mihomo).toBeUndefined();
    expect(compileMihomoBody(snifferOff).content).not.toMatch(/^sniffer:/m);

    const withTun = {
      ...structuredClone(tpl.baseBody),
      output: 'minimal' as const,
      modules: [...tpl.baseBody.modules, { id: TUN_MODE_MODULE_ID, enabled: true }],
    };
    const tunRes = applyEnhancementModules(resolveTemplateCards(withTun, BUILTIN_CARDS), { client: 'mihomo' });
    expect(tunRes.applied).toEqual(['ip-no-resolve', TUN_MODE_MODULE_ID]);
    expect(tunRes.notes.some((note) => note.includes('运行参数'))).toBe(true);
  });

  it('documents the T1 sniffer block accurately', () => {
    // Mirrors `compileSnifferSection()` — used for documentation and drift detection only.
    expect(MIHOMO_DEFAULT_SNIFFER_PATCH).toContain('sniffer:');
    expect(MIHOMO_DEFAULT_SNIFFER_PATCH).toContain('QUIC:');
    expect(MIHOMO_DEFAULT_SNIFFER_PATCH).toContain('enable: true');
  });

  it('hides module auxiliary groups across all complexity tiers and preserves visible group counts', () => {
    const simpleTpl = buildComplexityStarterTemplate('simple');
    const simpleDoc = parseYaml(compileMihomoBody(simpleTpl.baseBody).content) as Record<string, unknown>;
    const simpleVisible = (simpleDoc['proxy-groups'] as Array<Record<string, unknown>>)
      .filter((g) => g.hidden !== true)
      .map((g) => g.name);
    expect(simpleVisible).toEqual(['🚀 代理', '🎯 直连', '🚫 拦截']);

    const advBase = buildComplexityStarterTemplate('advanced').baseBody;
    const advWithModules = {
      ...structuredClone(advBase),
      modules: buildDefaultModulesForComplexity('advanced'),
    };
    const advDoc = parseYaml(compileMihomoBody(advWithModules).content) as Record<string, unknown>;
    const advGroups = advDoc['proxy-groups'] as Array<Record<string, unknown>>;
    const advVisibleNames = advGroups.filter((g) => g.hidden !== true).map((g) => String(g.name));
    // 12 core/business visible groups from recommended + 🔒 防泄漏兜底 (`module-dns-leak-final`), while
    // module auxiliary groups (`苹果推送直连` / `国内应用直连` / `隧道直连` 等) remain hidden.
    expect(advVisibleNames.length).toBeLessThanOrEqual(13);
    expect(advVisibleNames.length).toBeGreaterThanOrEqual(8);
    expect(advVisibleNames).not.toContain('🍎 Apple 推送直连');
    expect(advVisibleNames).not.toContain('📱 国内应用直连');
    expect(advGroups.find((g) => g.name === '🍎 Apple 推送直连')?.hidden).toBe(true);
    expect(advGroups.find((g) => g.name === '📱 国内应用直连')?.hidden).toBe(true);
  });

  it('compiles disable-quic across supported clients, hits UDP/443 in probe, and skips Quantumult X', () => {
    const { body } = buildBody([{ id: DISABLE_QUIC_MODULE_ID, enabled: true }]);
    const mihomoDoc = docOf(body);
    const mihomoRules = rulesOf(mihomoDoc);
    expect(mihomoRules).toContain('AND,((NETWORK,UDP),(DST-PORT,443)),🛑 禁用 QUIC');
    const quicGroup = (mihomoDoc['proxy-groups'] as Array<Record<string, unknown>>).find(
      (g) => g.name === '🛑 禁用 QUIC',
    );
    expect(quicGroup).toMatchObject({ type: 'select', proxies: ['REJECT', 'REJECT-DROP'], hidden: true });

    // Probe matches UDP/443, ignores TCP/443, and coexists cleanly with game-download-direct
    expect(probeIn(body, 'https://www.youtube.com', { dstPort: 443, network: 'udp' }).cardId).toBe(
      DISABLE_QUIC_CARD_ID,
    );
    expect(probeIn(body, 'https://www.youtube.com', { dstPort: 443, network: 'tcp' }).cardId).not.toBe(
      DISABLE_QUIC_CARD_ID,
    );

    const commonInput = {
      body,
      cards: BUILTIN_CARDS,
      catalogIndex: BUILTIN_CATALOG,
      generatedAt: FIXED_GENERATED_AT,
      baseUrl: FIXED_BASE_URL,
      rulesetBehaviors: new Map(),
      slotBindings: STANDARD_SLOT_BINDINGS,
      experimentalFullConfig: true,
    };

    const stashRes = compileStash(commonInput);
    expect(stashRes.content).toContain('AND,((NETWORK,udp),(DST-PORT,443)),🛑 禁用 QUIC');

    const surgeRes = compileSurge(commonInput);
    expect(surgeRes.content).toContain('AND,((PROTOCOL,UDP),(DEST-PORT,443)),🛑 禁用 QUIC');

    const loonRes = compileLoon(commonInput);
    expect(loonRes.content).toContain('AND,((PROTOCOL,UDP),(DEST-PORT,443)),🛑 禁用 QUIC');

    const srRes = compileShadowrocket(commonInput);
    expect(srRes.content).toContain('AND,((PROTOCOL,UDP),(DST-PORT,443)),🛑 禁用 QUIC');
    expect(srRes.report.items.some((i) => i.code === 'UNSUPPORTED_RULE_TYPE')).toBe(false);

    const sbRes = compileSingbox(commonInput);
    const sbJson = JSON.parse(sbRes.content) as { route: { rules: Array<Record<string, unknown>> } };
    expect(
      sbJson.route.rules.some(
        (rule) =>
          rule.type === 'logical' &&
          rule.mode === 'and' &&
          Array.isArray(rule.rules) &&
          JSON.stringify(rule.rules).includes('"network":["udp"]') &&
          JSON.stringify(rule.rules).includes('"port":[443]'),
      ),
    ).toBe(true);

    const qxRes = compileQuanx(commonInput);
    expect(qxRes.report.stats?.skippedModules).toContain(DISABLE_QUIC_MODULE_ID);
    expect(
      qxRes.report.items.some(
        (item) => item.code === 'MODULE_SKIPPED' && item.location?.moduleId === DISABLE_QUIC_MODULE_ID,
      ),
    ).toBe(true);
    expect(qxRes.content).not.toContain('禁用 QUIC');
  });
});
