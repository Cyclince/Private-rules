import { describe, expect, it } from 'vitest';
import {
  detailParentPath,
  isDetailPath,
  isSectionPath,
  normalizePathname,
  pathDepth,
  readHistoryIndex,
  resolveNavigationMotion,
  type NavigationLocation,
} from '../../src/web/lib/navigation-motion';

const at = (pathname: string, historyIndex: number | null = null): NavigationLocation => ({ pathname, historyIndex });

describe('M4a direction-aware navigation motion', () => {
  it('normalizes the admin basepath, trailing slashes and empty paths', () => {
    expect(normalizePathname('/admin')).toBe('/');
    expect(normalizePathname('/admin/')).toBe('/');
    expect(normalizePathname('/admin/rules/')).toBe('/rules');
    expect(normalizePathname('/rules/abc')).toBe('/rules/abc');
    expect(pathDepth('/')).toBe(0);
    expect(pathDepth('/rules')).toBe(1);
    expect(pathDepth('/rules/abc')).toBe(2);
  });

  it('classifies section and detail paths', () => {
    for (const path of ['/', '/admin/', '/rules', '/subscriptions', '/templates', '/settings']) {
      expect(isSectionPath(path)).toBe(true);
    }
    expect(isSectionPath('/rules/abc')).toBe(false);

    expect(isDetailPath('/rules/abc')).toBe(true);
    expect(isDetailPath('/admin/subscriptions/xyz')).toBe(true);
    expect(isDetailPath('/templates/tpl-1')).toBe(true);
    expect(isDetailPath('/templates/new')).toBe(false);
    expect(isDetailPath('/templates/groups')).toBe(false);
    expect(isDetailPath('/templates/scenes')).toBe(false);
    expect(isDetailPath('/templates')).toBe(false);

    expect(detailParentPath('/rules/rule-1')).toBe('/rules');
    expect(detailParentPath('/admin/subscriptions/rule-1')).toBe('/subscriptions');
    expect(detailParentPath('/templates/tpl-1')).toBe('/templates');
    expect(detailParentPath('/templates/new')).toBeNull();
    expect(detailParentPath('/settings')).toBeNull();
  });

  it('fades when there is no previous page, the path is unchanged, or sections switch', () => {
    expect(resolveNavigationMotion(null, at('/rules'))).toBe('fade');
    expect(resolveNavigationMotion(at('/rules'), at('/rules'))).toBe('fade');
    // Overview and sidebar/bottom-nav switches are same-level pages.
    expect(resolveNavigationMotion(at('/', 1), at('/rules', 2))).toBe('fade');
    expect(resolveNavigationMotion(at('/rules', 2), at('/subscriptions', 3))).toBe('fade');
    expect(resolveNavigationMotion(at('/templates', 3), at('/settings', 4))).toBe('fade');
    expect(resolveNavigationMotion(at('/settings', 4), at('/', 5))).toBe('fade');
  });

  it('slides forward into rule, subscription and template detail pages', () => {
    expect(resolveNavigationMotion(at('/rules', 2), at('/rules/rule-1', 3))).toBe('forward');
    expect(resolveNavigationMotion(at('/subscriptions', 2), at('/subscriptions/rule-1', 3))).toBe('forward');
    expect(resolveNavigationMotion(at('/templates', 2), at('/templates/tpl-1', 3))).toBe('forward');
    expect(resolveNavigationMotion(at('/', 1), at('/rules/rule-1', 2))).toBe('forward');
  });

  it('reverses when returning from a detail page, including pushed back links', () => {
    expect(resolveNavigationMotion(at('/rules/rule-1', 3), at('/rules', 4))).toBe('back');
    expect(resolveNavigationMotion(at('/subscriptions/rule-1', 3), at('/subscriptions', 2))).toBe('back');
    expect(resolveNavigationMotion(at('/templates/tpl-1', 3), at('/templates', 4))).toBe('back');
    // Switching from a detail to an unrelated section is a lateral fade, not a return.
    expect(resolveNavigationMotion(at('/rules/rule-1', 3), at('/settings', 4))).toBe('fade');
    expect(resolveNavigationMotion(at('/rules/rule-1', 3), at('/', 4))).toBe('fade');
    expect(resolveNavigationMotion(at('/subscriptions/rule-1', 3), at('/settings', 4))).toBe('fade');
  });

  it('uses the history index to reverse browser back even between sub pages', () => {
    expect(resolveNavigationMotion(at('/rules/rule-1', 5), at('/rules/rule-2', 4))).toBe('back');
    expect(resolveNavigationMotion(at('/settings', 5), at('/rules', 4))).toBe('back');
    expect(resolveNavigationMotion(at('/rules/rule-2', 4), at('/rules/rule-1', 5))).toBe('fade');
  });

  it('falls back to depth for sub pages such as the template wizard and groups', () => {
    expect(resolveNavigationMotion(at('/templates', 2), at('/templates/new', 3))).toBe('forward');
    expect(resolveNavigationMotion(at('/templates/new', 3), at('/templates', 4))).toBe('back');
    expect(resolveNavigationMotion(at('/templates/groups', 3), at('/templates', 4))).toBe('back');
    expect(resolveNavigationMotion(at('/rules/rule-1', 3), at('/subscriptions/rule-1', 4))).toBe('fade');
  });

  it('reads the TanStack history index defensively', () => {
    expect(readHistoryIndex({ __TSR_index: 7 })).toBe(7);
    expect(readHistoryIndex({ __TSR_index: '7' })).toBeNull();
    expect(readHistoryIndex({})).toBeNull();
    expect(readHistoryIndex(null)).toBeNull();
    expect(readHistoryIndex(undefined)).toBeNull();
  });
});
