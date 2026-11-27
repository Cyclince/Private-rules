import { Layers, LayoutDashboard, Link2, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '../../i18n';

export type MainNavRoutePath = '/' | '/rules' | '/subscriptions' | '/templates' | '/settings';
export type NavRoutePath = MainNavRoutePath | '/templates/scenes';

export type NavItem = {
  to: MainNavRoutePath;
  labelKey: MessageKey;
  icon: LucideIcon;
  mobile?: boolean;
};

export type SidebarNavSection = {
  id: 'overview' | 'rules' | 'templates' | 'settings';
  groupLabelKey?: MessageKey;
  items: readonly NavItem[];
};

export const SIDEBAR_NAV_SECTIONS: readonly SidebarNavSection[] = [
  {
    id: 'overview',
    items: [{ to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, mobile: true }],
  },
  {
    id: 'rules',
    groupLabelKey: 'nav.groupRules',
    items: [
      { to: '/rules', labelKey: 'nav.rules', icon: ShieldCheck, mobile: true },
      { to: '/subscriptions', labelKey: 'nav.subscriptions', icon: Link2, mobile: true },
    ],
  },
  {
    id: 'templates',
    groupLabelKey: 'nav.groupTemplates',
    items: [{ to: '/templates', labelKey: 'nav.templates', icon: Layers, mobile: true }],
  },
  {
    id: 'settings',
    items: [{ to: '/settings', labelKey: 'nav.settings', icon: Settings, mobile: true }],
  },
];

export const SIDEBAR_NAV_ITEMS: readonly NavItem[] = SIDEBAR_NAV_SECTIONS.flatMap((section) => section.items);

export const MOBILE_NAV_ITEMS: readonly NavItem[] = SIDEBAR_NAV_ITEMS.filter((item) => item.mobile);

export const ROUTE_TITLE_ENTRIES: ReadonlyArray<{ path: NavRoutePath; labelKey: MessageKey }> = [
  { path: '/', labelKey: 'nav.dashboard' },
  { path: '/rules', labelKey: 'nav.rules' },
  { path: '/subscriptions', labelKey: 'nav.subscriptions' },
  { path: '/templates/scenes', labelKey: 'nav.cards' },
  { path: '/templates', labelKey: 'nav.templates' },
  { path: '/settings', labelKey: 'nav.settings' },
];
