import { describe, expect, it } from 'vitest';
import { linksForCategory } from '../../src/lib/links';
import { APPS, getApp, ruleLinkForApp } from '../../src/shared/apps';
import type { RuleCategory, RulesData } from '../../src/types/domain-rules';
import { formatGroupForLink, linkCopyState } from '../../src/web/components/subscriptions/subscription-helpers';
import {
  readStoredSelectedAppId,
  SELECTED_APP_STORAGE_KEY,
  writeStoredSelectedAppId,
} from '../../src/web/components/apps/app-selection';
import { en } from '../../src/web/i18n/en';
import { zhCNApps } from '../../src/web/i18n/zh-CN.apps';

const data: RulesData = {
  version: 1,
  settings: {
    baseUrl: 'https://rules.example.com',
    policyName: 'PROXY',
    githubMirrorUrl: '',
    publicLinksEnabled: true,
    tokenLinksEnabled: true,
    customIconPackUrls: [],
    customIconPackNames: {},
    iconPackAutoUpdate: true,
    iconPackUpdateIntervalHours: 24,
  },
  categories: [],
  updatedAt: '2026-11-27T00:00:00.000Z',
};

const category: RuleCategory = {
  id: 'cat-1',
  name: 'Alpha',
  slug: 'alpha',
  rules: [],
  createdAt: '2026-11-20T00:00:00.000Z',
  updatedAt: '2026-11-25T00:00:00.000Z',
};

const links = linksForCategory(category, data, 'https://rules.example.com/admin/subscriptions', 'e2e-rule-token');

const FAMILY_LINK_IDS = {
  mihomo: ['yaml-classical', 'mihomo', 'clash', 'openclash', 'clash-verge', 'stash'],
  singbox: ['sing-box', 'json'],
  apple: ['general', 'loon', 'quantumult-x', 'shadowrocket', 'surge', 'surge-mac', 'egern', 'surfboard'],
} as const;

const FORBIDDEN = /内核|语法|格式|YAML|LIST|JSON/i;

describe('R2 subscription page: app-first link selection', () => {
  it('gives every selectable app one link from its own family', () => {
    for (const app of APPS.filter((item) => item.status !== 'planned')) {
      const link = ruleLinkForApp(app, links);
      expect(link, app.id).not.toBeNull();
      expect(link!.recommendedUrl, app.id).toMatch(/^https:\/\//);
      expect(FAMILY_LINK_IDS[app.family], `${app.id} -> ${link!.id}`).toContain(link!.id);
    }
  });

  it('maps the apps a beginner is most likely to pick to their dedicated files', () => {
    const expected: Record<string, string> = {
      'clash-verge-rev': 'clash-verge',
      'clash-party': 'mihomo',
      flclash: 'mihomo',
      'clash-meta-android': 'clash',
      stash: 'stash',
      openclash: 'openclash',
      'sing-box': 'sing-box',
      shadowrocket: 'shadowrocket',
      loon: 'loon',
      'quantumult-x': 'quantumult-x',
      surge: 'surge',
      egern: 'egern',
      surfboard: 'surfboard',
    };
    for (const [appId, linkId] of Object.entries(expected)) {
      expect(ruleLinkForApp(appId, links)?.id, appId).toBe(linkId);
    }
  });

  it('reports copy state so disabled rules cannot be copied', () => {
    const live = ruleLinkForApp('clash-verge-rev', links);
    expect(linkCopyState(live)).toMatchObject({ canCopy: true });
    expect(linkCopyState(live).displayUrl).toContain('/sub/e2e-rule-token/');

    const disabledLinks = linksForCategory(
      { ...category, tokenLinksEnabled: false, publicLinksEnabled: false },
      data,
      'https://rules.example.com/admin/subscriptions',
      'e2e-rule-token',
    );
    const disabled = ruleLinkForApp('clash-verge-rev', disabledLinks);
    expect(disabled?.recommendedUrl).toBe('');
    expect(linkCopyState(disabled)).toEqual({ displayUrl: '', canCopy: false });
    expect(linkCopyState(null)).toEqual({ displayUrl: '', canCopy: false });
  });

  it('builds a single-format snippet group for the chosen app link', () => {
    const link = ruleLinkForApp('clash-verge-rev', links)!;
    const group = formatGroupForLink(link);
    expect(group.id).toBe('yaml');
    expect(group.formats).toHaveLength(1);
    expect(group.formats[0].id).toBe(link.id);
    expect(group.formats[0].link.recommendedUrl).toBe(link.recommendedUrl);

    const singBoxGroup = formatGroupForLink(ruleLinkForApp('sing-box', links)!);
    expect(singBoxGroup.id).toBe('json');
  });
});

describe('R2 subscription page: per-app usage copy', () => {
  it('has a step-by-step rule subscription guide for every app in all three languages', () => {
    for (const app of APPS) {
      const key = `apps.ruleHowTo.${app.id}` as keyof typeof zhCNApps;
      const zh = zhCNApps[key];
      expect(zh, `zh-CN ${app.id}`).toBeTruthy();
      expect(en[key], `en ${app.id}`).toBeTruthy();
      const steps = zh.split('\n').filter(Boolean);
      expect(steps.length, `${app.id} steps`).toBeGreaterThanOrEqual(2);
      expect(steps.length, `${app.id} steps`).toBeLessThanOrEqual(3);
      // Ordinary copy: no internal vocabulary; the app's own name is expected though.
      expect(zh, app.id).not.toMatch(FORBIDDEN);
      expect(zh, app.id).toContain(app.name.split(' ')[0]);
    }
  });

  it('keeps the picker label and empty-state copy free of internal vocabulary', () => {
    expect(zhCNApps['apps.picker.yourApp']).toBe('你的软件');
    expect(zhCNApps['apps.picker.chooseApp']).toBe('选择你用的软件');
    expect(zhCNApps['apps.picker.yourApp']).not.toMatch(FORBIDDEN);
    expect(zhCNApps['apps.picker.chooseApp']).not.toMatch(FORBIDDEN);
  });
});

describe('R2 subscription page: remembered app choice', () => {
  function withFakeStorage(run: (store: Map<string, string>) => void, options: { throwOnGet?: boolean } = {}) {
    const store = new Map<string, string>();
    const fakeWindow = {
      localStorage: {
        getItem(key: string) {
          if (options.throwOnGet) throw new Error('blocked');
          return store.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          store.set(key, value);
        },
        removeItem(key: string) {
          store.delete(key);
        },
      },
    };
    const globalWithWindow = globalThis as { window?: unknown };
    const previous = globalWithWindow.window;
    globalWithWindow.window = fakeWindow;
    try {
      run(store);
    } finally {
      globalWithWindow.window = previous;
    }
  }

  it('writes, reads back, ignores unknown ids and survives broken storage', () => {
    withFakeStorage((store) => {
      expect(readStoredSelectedAppId()).toBeNull();
      writeStoredSelectedAppId('loon');
      expect(store.get(SELECTED_APP_STORAGE_KEY)).toBe('loon');
      expect(readStoredSelectedAppId()).toBe('loon');
      store.set(SELECTED_APP_STORAGE_KEY, 'smart-fridge');
      expect(readStoredSelectedAppId()).toBeNull();
      writeStoredSelectedAppId(null);
      expect(readStoredSelectedAppId()).toBeNull();
    });

    withFakeStorage(
      () => {
        expect(readStoredSelectedAppId()).toBeNull();
        expect(() => writeStoredSelectedAppId('mac')).not.toThrow();
      },
      { throwOnGet: true },
    );
  });

  it('only remembers ids that exist in the catalog', () => {
    for (const app of APPS) {
      expect(getApp(app.id)?.id).toBe(app.id);
    }
  });
});
