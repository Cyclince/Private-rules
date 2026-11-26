/**
 * Clients that 1.1.0 compiles templates for, with how nodes reach each one
 * (design §11.1):
 *   A: the config references the subscription and the core fetches it itself
 *   B: nodes must be embedded; the server fetches and parses the subscription
 *   C: the client manages nodes; templates select them by name pattern only
 */
export type NodeAccessClass = 'A' | 'B' | 'C';

export const OUTPUT_PROFILES = ['full', 'minimal'] as const;
export type OutputProfile = (typeof OUTPUT_PROFILES)[number];

export const TEMPLATE_CLIENTS = {
  mihomo: { label: 'mihomo', nodeAccess: 'A', fileName: 'mihomo.yaml', contentType: 'text/yaml; charset=utf-8' },
  stash: { label: 'Stash', nodeAccess: 'A', fileName: 'stash.yaml', contentType: 'text/yaml; charset=utf-8' },
  surge: { label: 'Surge', nodeAccess: 'A', fileName: 'surge.conf', contentType: 'text/plain; charset=utf-8' },
  'sing-box': {
    label: 'sing-box',
    nodeAccess: 'B',
    fileName: 'singbox.json',
    contentType: 'application/json; charset=utf-8',
  },
  loon: { label: 'Loon', nodeAccess: 'C', fileName: 'loon.conf', contentType: 'text/plain; charset=utf-8' },
  'quantumult-x': {
    label: 'Quantumult X',
    nodeAccess: 'C',
    fileName: 'qx.conf',
    contentType: 'text/plain; charset=utf-8',
  },
  shadowrocket: {
    label: 'Shadowrocket',
    nodeAccess: 'C',
    fileName: 'shadowrocket.conf',
    contentType: 'text/plain; charset=utf-8',
  },
} as const satisfies Record<
  string,
  { label: string; nodeAccess: NodeAccessClass; fileName: string; contentType: string }
>;

export type TemplateClientId = keyof typeof TEMPLATE_CLIENTS;

export const TEMPLATE_CLIENT_IDS = Object.keys(TEMPLATE_CLIENTS) as TemplateClientId[];

const CLIENT_BY_FILE_NAME = new Map<string, TemplateClientId>(
  TEMPLATE_CLIENT_IDS.map((client) => [TEMPLATE_CLIENTS[client].fileName, client]),
);

/**
 * Resolves the `:file` segment of `/p/:slug/:file` or `/t/:token/:slug/:file`
 * (e.g. `mihomo.yaml`, `surge.conf`) to its target client (design §12.3).
 */
export function parsePublicationFile(file: string): TemplateClientId | null {
  return CLIENT_BY_FILE_NAME.get(file.toLowerCase()) ?? null;
}
