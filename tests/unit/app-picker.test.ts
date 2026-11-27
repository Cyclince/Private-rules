import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { APPS, getApp, type AppDefinition } from '../../src/shared/apps';
import {
  APP_PICKER_PLATFORMS,
  APP_PICKER_RECOMMENDATIONS,
  APP_PICKER_STORAGE_KEY,
  AppPicker,
  appMatchesPickerPlatform,
  appPickerKeyAction,
  guessAppPickerPlatform,
  isAppSelectable,
  readStoredAppPickerPlatform,
  searchApps,
  toggleAppSelection,
  visibleApps,
  writeStoredAppPickerPlatform,
  type AppPickerMode,
} from '../../src/web/components/apps/AppPicker';
import { AppIcon, appInitial, appToneIndex, APP_ICON_TONES } from '../../src/web/components/apps/AppIcon';
import { I18nProvider, loadPageTranslations } from '../../src/web/i18n';

function app(id: string): AppDefinition {
  const found = getApp(id);
  if (!found) throw new Error(`missing app ${id}`);
  return found;
}

/** Minimal localStorage stand-in; the picker only uses get/setItem behind try/catch. */
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

type RenderProps = {
  mode: AppPickerMode;
  value: string[];
  initialPlatform: Parameters<typeof AppPicker>[0]['initialPlatform'];
};

/** Returns the whole opening tag of the element carrying a test id, so attribute checks stay order-independent. */
function tagWith(html: string, testId: string): string {
  const index = html.indexOf(`data-testid="${testId}"`);
  if (index === -1) throw new Error(`missing ${testId}`);
  return html.slice(html.lastIndexOf('<', index), html.indexOf('>', index) + 1);
}

async function renderPicker(props: RenderProps) {
  await loadPageTranslations();
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      { initialLocale: 'zh-CN' },
      createElement(AppPicker, { ...props, onChange: () => undefined }),
    ),
  );
}

describe('R1 AppPicker platform guessing and memory', () => {
  it('guesses the platform from the user agent, with iOS/iPadOS falling into the iPhone tab', () => {
    expect(guessAppPickerPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iphone');
    expect(guessAppPickerPlatform('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBe('iphone');
    // iPadOS 13+ reports a Macintosh user agent and is told apart by multi-touch.
    expect(guessAppPickerPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('iphone');
    expect(guessAppPickerPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('mac');
    expect(guessAppPickerPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('android');
    expect(guessAppPickerPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(guessAppPickerPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux-router');
    expect(guessAppPickerPlatform('')).toBe('iphone');
  });

  it('remembers the last platform and tolerates a missing or hostile storage', () => {
    withFakeStorage((store) => {
      expect(readStoredAppPickerPlatform()).toBeNull();
      writeStoredAppPickerPlatform('android');
      expect(store.get(APP_PICKER_STORAGE_KEY)).toBe('android');
      expect(readStoredAppPickerPlatform()).toBe('android');
      store.set(APP_PICKER_STORAGE_KEY, 'smart-fridge');
      expect(readStoredAppPickerPlatform()).toBeNull();
    });

    withFakeStorage(
      () => {
        expect(readStoredAppPickerPlatform()).toBeNull();
        expect(() => writeStoredAppPickerPlatform('mac')).not.toThrow();
      },
      { throwOnGet: true },
    );
  });
});

describe('R1 AppPicker filtering and selection', () => {
  it('matches the display name and aliases, ignoring case and surrounding spaces', () => {
    const iphone = visibleApps('iphone', '');
    expect(searchApps(iphone, 'shadow').map((item) => item.id)).toEqual(['shadowrocket']);
    expect(searchApps(iphone, '小火箭').map((item) => item.id)).toEqual(['shadowrocket']);
    expect(searchApps(iphone, ' 圈x ').map((item) => item.id)).toEqual(['quantumult-x']);
    expect(searchApps(iphone, 'SFA').map((item) => item.id)).toContain('sing-box');
    expect(searchApps(iphone, 'nothing-here')).toEqual([]);
    expect(searchApps(iphone, '')).toHaveLength(iphone.length);
  });

  it('shows only the apps of the chosen platform and hides unimplemented ones', () => {
    const ids = (platform: Parameters<typeof visibleApps>[0]) => visibleApps(platform, '').map((item) => item.id);

    expect(ids('iphone')).toEqual(expect.arrayContaining(['shadowrocket', 'loon', 'surge', 'stash', 'egern']));
    expect(ids('iphone')).not.toContain('clash-verge-rev');
    expect(ids('mac')).toContain('clash-verge-rev');
    expect(ids('windows')).not.toContain('openclash');
    expect(ids('linux-router')).toContain('openclash');
    expect(ids('android')).toEqual(expect.arrayContaining(['flclash', 'surfboard', 'clash-meta-android']));
    expect(ids('iphone')).not.toContain('hiddify');
    // Rules-only software still works for routing rules, so it stays visible.
    expect(ids('iphone')).toContain('egern');
    expect(appMatchesPickerPlatform(app('surfboard'), 'android')).toBe(true);
    expect(appMatchesPickerPlatform(app('surfboard'), 'iphone')).toBe(false);
  });

  it('replaces the value in single mode and toggles in multiple mode', () => {
    const loon = app('loon');
    const surge = app('surge');
    expect(toggleAppSelection('single', ['loon'], surge)).toEqual(['surge']);
    expect(toggleAppSelection('single', ['loon'], loon)).toEqual(['loon']);
    expect(toggleAppSelection('multiple', ['loon'], surge)).toEqual(['loon', 'surge']);
    expect(toggleAppSelection('multiple', ['loon', 'surge'], loon)).toEqual(['surge']);
    expect(toggleAppSelection('multiple', [], app('hiddify'))).toEqual([]);
  });

  it('blocks rules-only software only when a full configuration is required', () => {
    const egern = app('egern');
    expect(isAppSelectable(egern, 'single')).toBe(true);
    expect(isAppSelectable(egern, 'multiple')).toBe(false);
    expect(isAppSelectable(app('loon'), 'multiple')).toBe(true);
    expect(isAppSelectable(app('hiddify'), 'single')).toBe(false);
    expect(toggleAppSelection('multiple', ['loon'], egern)).toEqual(['loon']);
  });
});

describe('R1 AppPicker keyboard model', () => {
  const navigable = [0, 2, 3];

  it('moves through selectable options and wraps around', () => {
    expect(appPickerKeyAction('ArrowRight', 0, navigable)).toEqual({ type: 'move', index: 2 });
    expect(appPickerKeyAction('ArrowDown', 3, navigable)).toEqual({ type: 'move', index: 0 });
    expect(appPickerKeyAction('ArrowLeft', 0, navigable)).toEqual({ type: 'move', index: 3 });
    expect(appPickerKeyAction('Home', 3, navigable)).toEqual({ type: 'move', index: 0 });
    expect(appPickerKeyAction('End', 0, navigable)).toEqual({ type: 'move', index: 3 });
  });

  it('starts from the nearest selectable option when focus sits on a disabled one', () => {
    expect(appPickerKeyAction('ArrowRight', 1, navigable)).toEqual({ type: 'move', index: 0 });
    expect(appPickerKeyAction('ArrowLeft', 1, navigable)).toEqual({ type: 'move', index: 3 });
  });

  it('selects with Enter or Space and ignores other keys and empty lists', () => {
    expect(appPickerKeyAction('Enter', 2, navigable)).toEqual({ type: 'select', index: 2 });
    expect(appPickerKeyAction(' ', 2, navigable)).toEqual({ type: 'select', index: 2 });
    expect(appPickerKeyAction('Enter', 1, navigable)).toBeNull();
    expect(appPickerKeyAction('Escape', 2, navigable)).toBeNull();
    expect(appPickerKeyAction('ArrowRight', 0, [])).toBeNull();
  });
});

describe('R1 AppPicker rendering', () => {
  it('renders the platform tabs, the grid and the search box for the guessed platform', async () => {
    const html = await renderPicker({ mode: 'single', value: [], initialPlatform: 'iphone' });

    expect(html).toContain('你用的是哪个软件？');
    for (const platform of APP_PICKER_PLATFORMS) {
      expect(html).toContain(`data-testid="app-picker-platform-${platform}"`);
    }
    expect(tagWith(html, 'app-picker-platform-iphone')).toContain('aria-pressed="true"');
    expect(tagWith(html, 'app-picker-platform-mac')).toContain('aria-pressed="false"');
    expect(html).toContain('data-testid="app-picker-search"');
    expect(html).toContain('搜索软件名');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('data-testid="app-option-shadowrocket"');
    expect(html).not.toContain('data-testid="app-option-clash-verge-rev"');
    expect(html).not.toContain('data-testid="app-option-hiddify"');
    // Icon fallback badge: Shadowrocket starts with S.
    expect(html).toContain('>S</span>');
  });

  it('marks the current single selection and keeps every option selectable', async () => {
    const html = await renderPicker({ mode: 'single', value: ['egern'], initialPlatform: 'iphone' });

    expect(tagWith(html, 'app-option-egern')).toContain('aria-selected="true"');
    expect(tagWith(html, 'app-option-loon')).toContain('aria-selected="false"');
    expect(tagWith(html, 'app-option-loon')).not.toContain('aria-disabled');
    expect(html).not.toContain('aria-multiselectable');
    expect(html).not.toContain('暂时只能用分流规则');
    expect(html).toContain('先选一个现在要用的软件。');
  });

  it('disables rules-only software in template mode and explains why', async () => {
    const html = await renderPicker({ mode: 'multiple', value: [], initialPlatform: 'android' });

    expect(html).toContain('aria-multiselectable="true"');
    expect(html).toContain('手机和电脑都要用？这里可以多选。');
    expect(tagWith(html, 'app-option-surfboard')).toContain('aria-disabled="true"');
    expect(tagWith(html, 'app-option-surfboard')).toContain('aria-selected="false"');
    expect(html).toContain('data-testid="app-option-rules-only-surfboard"');
    expect(html).toContain('暂时只能用分流规则');
    expect(html).toContain('已选 0 个');
    expect(tagWith(html, 'app-option-flclash')).not.toContain('aria-disabled');
  });

  it('offers a name-only recommendation list per platform and never a download link', async () => {
    const html = await renderPicker({ mode: 'single', value: [], initialPlatform: 'windows' });

    expect(html).toContain('不知道自己用的是哪个？');
    expect(html).toContain('data-testid="app-picker-recommendations"');
    for (const id of APP_PICKER_RECOMMENDATIONS.windows) {
      expect(html).toContain(app(id).name);
    }
    expect(APP_PICKER_RECOMMENDATIONS.windows.length).toBeLessThanOrEqual(2);
    expect(html).not.toMatch(/<a\s/);
    expect(html).not.toContain('http');
  });
});

describe('R1 AppIcon', () => {
  it('derives a stable tone and the first letter or Han character for the badge', () => {
    expect(appInitial('Shadowrocket')).toBe('S');
    expect(appInitial('小火箭')).toBe('小');
    expect(appInitial('  loon ')).toBe('L');
    expect(appInitial('')).toBe('?');
    expect(appToneIndex('loon')).toBe(appToneIndex('loon'));
    expect(appToneIndex('loon')).toBeLessThan(APP_ICON_TONES.length);
    // Different apps spread across the accent palette rather than collapsing onto one tone.
    expect(new Set(APPS.map((item) => appToneIndex(item.id))).size).toBeGreaterThan(1);
  });

  it('shows the licensed image when present and the badge otherwise', async () => {
    const withImage = renderToStaticMarkup(
      createElement(AppIcon, { app: { id: 'loon', name: 'Loon', icon: '/apps/loon.webp' }, size: 'lg' }),
    );
    expect(withImage).toContain('src="/apps/loon.webp"');
    expect(withImage).toContain('alt="Loon"');
    expect(withImage).toContain('loading="lazy"');

    const badge = renderToStaticMarkup(createElement(AppIcon, { app: app('stash'), size: 'sm' }));
    expect(badge).toContain('data-testid="app-icon-stash"');
    expect(badge).not.toContain('<img');
    expect(badge).toContain('>S</span>');
  });
});
