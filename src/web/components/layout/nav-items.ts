import { Layers, LayoutDashboard, Send, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '../../i18n';

export type NavRoutePath = '/' | '/rulesets' | '/templates' | '/publications' | '/settings';

export type NavItem = {
  to: NavRoutePath;
  labelKey: MessageKey;
  icon: LucideIcon;
  mobile?: boolean;
};

export const SIDEBAR_NAV_ITEMS: readonly NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, mobile: true },
  { to: '/rulesets', labelKey: 'nav.rulesets', icon: ShieldCheck, mobile: true },
  { to: '/templates', labelKey: 'nav.templates', icon: Layers, mobile: true },
  { to: '/publications', labelKey: 'nav.publications', icon: Send, mobile: false },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings, mobile: true },
];

export const MOBILE_NAV_ITEMS: readonly NavItem[] = SIDEBAR_NAV_ITEMS.filter((item) => item.mobile);
