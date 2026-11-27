import { z } from 'zod';
import { TEMPLATE_CLIENT_IDS } from '../../../shared/clients';
import type { AppCard, Condition } from '../../../shared/schemas/card';
import { isRuleTypeSupported } from '../capabilities';
import type { ResolvedTemplate } from '../model';
import { buildDirectCandidates, insertModuleCard } from './helpers';
import type { EnhancementModule } from './types';

export const BT_DIRECT_CARD_ID = 'module-bt-direct';

/**
 * BitTorrent client process names (public client names, matched by the client with
 * `find-process-mode: strict`). Private trackers use arbitrary ports, so the process
 * name is the reliable signal; ports only cover the well-known defaults.
 */
const BT_PROCESS_NAMES = [
  'qbittorrent',
  'qbittorrent.exe',
  'transmission',
  'transmission-daemon',
  'deluge',
  'deluged',
  'utorrent',
  'utorrent.exe',
  'bittorrent',
  'bittorrent.exe',
  'bitcomet',
  'bitcomet.exe',
  'tixati',
  'vuze',
  'aria2c',
  'libtorrent',
];

/** Default listening / DHT ports of common clients (qBittorrent 6881-6889, Transmission 51413, BitComet 16881). */
const BT_DEFAULT_PORTS = ['6881', '6882', '6883', '6884', '6885', '6886', '6887', '6888', '6889', '51413', '16881'];

const btDirectParamsSchema = z.object({
  includeProcessNames: z.boolean().optional(),
  includeDefaultPorts: z.boolean().optional(),
  extraDomains: z.array(z.string().trim().min(1)).optional(),
});

/**
 * Enhancement module: BT / PT 直连 (design §5.2, 直连优化).
 * Sends download-tool traffic straight out so airports do not flag BitTorrent usage
 * (most providers forbid it) and so PT traffic is never relayed through a shared node.
 */
export const btDirectModule: EnhancementModule = {
  id: 'bt-direct',
  name: 'BT / PT 直连',
  icon: '🧲',
  group: 'direct',
  description: '识别常见 BT 客户端进程与默认端口并直连，避免机场风控判定为 BT 流量，也避免 PT 上传走共享节点。',
  defaultEnabled: false,
  tierDefaults: { simple: false, advanced: false, pro: true },
  order: 34,
  affects: ['rules', 'groups'],
  conflictsWith: [],
  supportedClients: [...TEMPLATE_CLIENT_IDS],
  paramsSchema: btDirectParamsSchema,
  apply(template: ResolvedTemplate, ctx): ResolvedTemplate {
    const parsed = btDirectParamsSchema.parse(ctx.params ?? {});
    const clientSupportsProcess = ctx.client ? isRuleTypeSupported(ctx.client, 'PROCESS-NAME') : true;
    const includeProcessNames = (parsed.includeProcessNames ?? true) && clientSupportsProcess;
    const includeDefaultPorts = parsed.includeDefaultPorts ?? true;

    const conditions: Condition[] = [
      ...(includeProcessNames
        ? BT_PROCESS_NAMES.map((name): Condition => ({
            op: 'rule',
            rule: { type: 'PROCESS-NAME', value: name },
          }))
        : []),
      ...(includeDefaultPorts
        ? BT_DEFAULT_PORTS.map((port): Condition => ({
            op: 'rule',
            rule: { type: 'DST-PORT', value: port },
          }))
        : []),
      ...(parsed.extraDomains ?? []).map((suffix): Condition => ({
        op: 'rule',
        rule: { type: 'DOMAIN-SUFFIX', value: suffix },
      })),
    ];

    if (conditions.length === 0) return template;

    const card: AppCard = {
      id: BT_DIRECT_CARD_ID,
      slug: BT_DIRECT_CARD_ID,
      name: '🧲 BT / PT 直连',
      icon: 'download',
      category: 'other',
      stage: 'pre-direct',
      origin: 'builtin',
      group: {
        type: 'select',
        candidates: buildDirectCandidates(template),
      },
      matchers: [{ kind: 'inline', conditions }],
    };

    return insertModuleCard(template, card, 'stage-end');
  },
};
