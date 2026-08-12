import type { ReactNode } from 'react';

export type IconName = 'home' | 'rules' | 'domain' | 'links' | 'settings' | 'configuration' | 'appearance' | 'telegram' | 'optimize' | 'optimizeAction' | 'iconPack' | 'updatePack' | 'healthCheck' | 'saveSettings' | 'backup' | 'apiKey' | 'service' | 'info' | 'download' | 'upload' | 'database' | 'pulse' | 'clock' | 'chevron' | 'chevronRight' | 'arrowLeft' | 'more' | 'manage' | 'activity' | 'plus' | 'expand' | 'close' | 'check' | 'logout' | 'file' | 'copy' | 'search' | 'refresh' | 'restore' | 'sync' | 'trash' | 'edit' | 'key';

const paths: Record<IconName, ReactNode> = {
  home: <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>,
  rules: <><path d="M4 7h10M18 7h2M10 17h10M4 17h2"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></>,
  domain: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z"/></>,
  links: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3A1.7 1.7 0 0 0 14 21v.2h-4V21a1.7 1.7 0 0 0-2.9-1.3l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.3-2.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 2.9 1.3l.1-.1L19.8 7l-.1.1A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></>,
  configuration: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></>,
  appearance: <><path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-2.1a2 2 0 0 1-1.8-2.9l.5-1A2.1 2.1 0 0 0 13.7 3H12Z"/><circle cx="7.5" cy="11" r=".8" fill="currentColor" stroke="none"/><circle cx="10" cy="7" r=".8" fill="currentColor" stroke="none"/><circle cx="7.8" cy="15" r=".8" fill="currentColor" stroke="none"/></>,
  telegram: <><path d="m3.2 11.2 16.4-7c.8-.3 1.5.4 1.2 1.2l-5.2 15c-.3.8-1.3.9-1.8.3l-3.4-4.4-3.1 2.4.5-4.8 9.1-6.4-10.7 5.1-3-.4c-.8-.1-1-1-.3-1.4Z"/><path d="m7.8 13.9 9.1-6.4M10.4 16.3l.1-3"/></>,
  optimize: <><path d="M4 7h9M17 7h3M4 17h5M13 17h7"/><circle cx="15" cy="7" r="2"/><circle cx="11" cy="17" r="2"/><path d="m18.5 11 .5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"/></>,
  optimizeAction: <><path d="M5 5h5l2 2h7v5H5z"/><path d="m7 12-2 7h14l-2-7M9 16h6"/><path d="m18.5 3 .4 1 .9.4-.9.4-.4 1-.4-1-.9-.4.9-.4z"/></>,
  iconPack: <><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="m6.5 17 4-4 2.8 2.8 1.7-1.7 2.5 2.9"/></>,
  updatePack: <><path d="m12 3 8 4.5-8 4.5-8-4.5z"/><path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5"/><path d="M12 6v5M9.8 8.8 12 11l2.2-2.2"/></>,
  healthCheck: <><path d="M4 12h3l2-5 3.2 10 2.2-6 1.5 3H20"/><path d="M19 5v3h-3"/><path d="M19 8a8 8 0 1 0 1 8"/></>,
  saveSettings: <><path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8V4M8 15h8"/><path d="m10 17 1.5 1.5L15 15"/></>,
  backup: <><path d="M5 8h14v12H5zM4 4h16v4H4zM9 12h6"/></>,
  apiKey: <><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6z"/><circle cx="10" cy="12" r="2"/><path d="M12 12h4M15 12v2"/></>,
  service: <><ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/><path d="m15.5 17 1.2 1.2 2.3-2.5"/></>,
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
  manage: <><rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="m7.5 8 1.4 1.4L11.5 7M13.5 8.5h3M7.5 14l1.4 1.4 2.6-2.4M13.5 14.5h3"/></>,
  activity: <path d="M3 12h4l2-6 4 12 2-6h6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  expand: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/><path d="m3 8 5-5M21 8l-5-5M3 16l5 5M21 16l-5 5"/></>,
  close: <><path d="M6 6l12 12M18 6 6 18"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  logout: <><path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4M8 12h10"/></>,
  file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 8A7 7 0 0 1 18.5 6L20 8M4 16l1.5 2A7 7 0 0 0 18 16"/></>,
  restore: <><path d="M4 9V4m0 0h5M4 4l3.2 3.2A8 8 0 1 1 5 15"/><path d="M12 8v5l3 2"/></>,
  sync: <><path d="M6.2 8.1A7 7 0 0 1 18.7 7"/><path d="M18.7 7V3.8M18.7 7h-3.2"/><path d="M17.8 15.9A7 7 0 0 1 5.3 17"/><path d="M5.3 17v3.2M5.3 17h3.2"/><circle cx="12" cy="12" r="2.2"/></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,
  edit: <><path d="M4 20h4l11-11-4-4L4 16zM13.5 6.5l4 4"/></>,
  key: <><circle cx="8" cy="12" r="4"/><path d="M12 12h9M17 12v3M20 12v2"/></>,
};

export function UiIcon({ name, size = 24 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
