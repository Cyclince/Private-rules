import type { TemplateClientId } from './clients';

export type ImportLinkGenerator = (url: string, name: string) => string | null;

export type ClientImportMetadata = {
  label: string;
  platforms: readonly string[];
  /** Enable only after device verification in docs/device-test-checklist.md. */
  verified: boolean;
  linkFormat: string | null;
  generateLink: ImportLinkGenerator;
};

/** Candidate scheme builders for device testing, not UI use. Encode query values exactly once. */
export function generateMihomoImportLink(url: string, name: string): string {
  return `clash://install-config?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
}

export function generateStashImportLink(url: string): string {
  return `stash://install-config?url=${encodeURIComponent(url)}`;
}

export function generateSurgeImportLink(url: string): string {
  return `surge:///install-config?url=${encodeURIComponent(url)}`;
}

export function generateSingBoxImportLink(url: string, name: string): string {
  return `sing-box://import-remote-profile?url=${encodeURIComponent(url)}#${encodeURIComponent(name)}`;
}

export function generateShadowrocketImportLink(url: string): string {
  // This candidate embeds the original URL, rather than an encoded query value.
  return `shadowrocket://config/add/${url}`;
}

export function generateQuantumultXImportLink(url: string, name: string): string {
  // QX's safe default is a remote rule resource, not a replacement of the full configuration.
  // Verify both the resource kind and tag syntax on-device before enabling this candidate.
  const resource = { filter_remote: [`${url}, tag=${name}, enabled=true`] };
  return `quantumult-x:///add-resource?remote-resource=${encodeURIComponent(JSON.stringify(resource))}`;
}

export function generateLoonImportLink(): null {
  return null;
}

export const CLIENT_IMPORTS: Record<TemplateClientId, ClientImportMetadata> = {
  mihomo: {
    label: 'Clash Verge Rev / FlClash / Clash Party',
    platforms: ['Windows', 'macOS', 'Linux', 'Android'],
    verified: false,
    linkFormat: 'clash://install-config?url=<encoded>&name=<encoded name>',
    generateLink: generateMihomoImportLink,
  },
  stash: {
    label: 'Stash',
    platforms: ['iOS', 'macOS'],
    verified: false,
    linkFormat: 'stash://install-config?url=<encoded>',
    generateLink: generateStashImportLink,
  },
  surge: {
    label: 'Surge',
    platforms: ['iOS', 'macOS'],
    verified: false,
    linkFormat: 'surge:///install-config?url=<encoded>',
    generateLink: generateSurgeImportLink,
  },
  'sing-box': {
    label: 'sing-box',
    platforms: ['Android', 'iOS', 'macOS', 'Windows', 'Linux'],
    verified: false,
    linkFormat: 'sing-box://import-remote-profile?url=<encoded>#<encoded name>',
    generateLink: generateSingBoxImportLink,
  },
  shadowrocket: {
    label: 'Shadowrocket',
    platforms: ['iOS', 'macOS'],
    verified: false,
    linkFormat: 'shadowrocket://config/add/<url>',
    generateLink: generateShadowrocketImportLink,
  },
  'quantumult-x': {
    label: 'Quantumult X',
    platforms: ['iOS', 'macOS'],
    verified: false,
    linkFormat: 'quantumult-x:///add-resource?remote-resource=<encoded JSON>',
    generateLink: generateQuantumultXImportLink,
  },
  loon: {
    label: 'Loon',
    platforms: ['iOS', 'macOS'],
    verified: false,
    linkFormat: null,
    generateLink: generateLoonImportLink,
  },
};

/** UI entry point: unverified or unavailable schemes must never expose an import button. */
export function getImportLink(clientId: TemplateClientId, url: string, name: string): string | null {
  const client = CLIENT_IMPORTS[clientId];
  return client.verified ? client.generateLink(url, name) : null;
}
