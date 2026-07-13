import type { ReactNode } from 'react';

export type IconName = 'home' | 'rules' | 'domain' | 'links' | 'settings' | 'info' | 'download' | 'upload' | 'database' | 'pulse' | 'clock' | 'chevron' | 'chevronRight' | 'arrowLeft' | 'more' | 'activity' | 'plus' | 'close' | 'check' | 'logout' | 'file' | 'copy' | 'search' | 'refresh' | 'sync' | 'trash' | 'edit';

const paths: Record<IconName, ReactNode> = {
  home: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
  rules: <><path d="M4 7h10M18 7h2M10 17h10M4 17h2"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></>,
  domain: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z"/></>,
  links: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3A1.7 1.7 0 0 0 14 21v.2h-4V21a1.7 1.7 0 0 0-2.9-1.3l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.3-2.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 2.9 1.3l.1-.1L19.8 7l-.1.1A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 18v2h14v-2"/></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 18v2h14v-2"/></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>,
  pulse: <path d="M3 12h4l2-7 4 14 2-7h6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  chevron: <path d="m8 10 4 4 4-4"/>,
  chevronRight: <path d="m9 18 6-6-6-6"/>,
  arrowLeft: <><path d="m15 18-6-6 6-6"/><path d="M9 12h11"/></>,
  more: <><circle cx="12" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/></>,
  activity: <path d="M3 12h4l2-6 4 12 2-6h6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  close: <><path d="M6 6l12 12M18 6 6 18"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  logout: <><path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4M8 12h10"/></>,
  file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 8A7 7 0 0 1 18.5 6L20 8M4 16l1.5 2A7 7 0 0 0 18 16"/></>,
  sync: <><path d="M6.2 8.1A7 7 0 0 1 18.7 7"/><path d="M18.7 7V3.8M18.7 7h-3.2"/><path d="M17.8 15.9A7 7 0 0 1 5.3 17"/><path d="M5.3 17v3.2M5.3 17h3.2"/><circle cx="12" cy="12" r="2.2"/></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,
  edit: <><path d="M4 20h4l11-11-4-4L4 16zM13.5 6.5l4 4"/></>,
};

export function UiIcon({ name, size = 24 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
