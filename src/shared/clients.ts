/**
 * Clients that 1.1.0 compiles templates for, with how nodes reach each one
 * (design §11.1):
 *   A: the config references the subscription and the core fetches it itself
 *   B: nodes must be embedded; the server fetches and parses the subscription
 *   C: the client manages nodes; templates select them by name pattern only
 */
export type NodeAccessClass = 'A' | 'B' | 'C';

export const TEMPLATE_CLIENTS = {
  mihomo: { label: 'mihomo', nodeAccess: 'A', fileSuffix: '.yaml', contentType: 'text/yaml; charset=utf-8' },
  stash: { label: 'Stash', nodeAccess: 'A', fileSuffix: '-stash.yaml', contentType: 'text/yaml; charset=utf-8' },
  surge: { label: 'Surge', nodeAccess: 'A', fileSuffix: '-surge.conf', contentType: 'text/plain; charset=utf-8' },
  'sing-box': {
    label: 'sing-box',
    nodeAccess: 'B',
    fileSuffix: '-singbox.json',
    contentType: 'application/json; charset=utf-8',
  },
  loon: { label: 'Loon', nodeAccess: 'C', fileSuffix: '-loon.conf', contentType: 'text/plain; charset=utf-8' },
  'quantumult-x': {
    label: 'Quantumult X',
    nodeAccess: 'C',
    fileSuffix: '-qx.conf',
    contentType: 'text/plain; charset=utf-8',
  },
  shadowrocket: {
    label: 'Shadowrocket',
    nodeAccess: 'C',
    fileSuffix: '-shadowrocket.conf',
    contentType: 'text/plain; charset=utf-8',
  },
} as const satisfies Record<
  string,
  { label: string; nodeAccess: NodeAccessClass; fileSuffix: string; contentType: string }
>;

export type TemplateClientId = keyof typeof TEMPLATE_CLIENTS;

export const TEMPLATE_CLIENT_IDS = Object.keys(TEMPLATE_CLIENTS) as TemplateClientId[];

/**
 * Resolves a publication file name such as `home-surge.conf` to its slug and
 * client. Longer suffixes are tried first so `-stash.yaml` wins over `.yaml`.
 */
export function parsePublicationFile(file: string): { slug: string; client: TemplateClientId } | null {
  const candidates = [...TEMPLATE_CLIENT_IDS].sort(
    (a, b) => TEMPLATE_CLIENTS[b].fileSuffix.length - TEMPLATE_CLIENTS[a].fileSuffix.length,
  );
  for (const client of candidates) {
    const suffix = TEMPLATE_CLIENTS[client].fileSuffix;
    if (file.endsWith(suffix) && file.length > suffix.length) return { slug: file.slice(0, -suffix.length), client };
  }
  return null;
}
