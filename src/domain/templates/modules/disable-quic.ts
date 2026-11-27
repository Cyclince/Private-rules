import { z } from 'zod';
import type { AppCard, Condition } from '../../../shared/schemas/card';
import type { ResolvedTemplate } from '../model';
import { insertModuleCard } from './helpers';
import { requireModuleMetadata } from './metadata';
import type { EnhancementModule } from './types';

export const DISABLE_QUIC_MODULE_ID = 'disable-quic';
export const DISABLE_QUIC_CARD_ID = 'module-disable-quic';

/**
 * Clients that natively support matching transport network/protocol (`NETWORK,UDP` / `PROTOCOL,UDP` /
 * `network: ["udp"]`) combined with `DST-PORT,443` inside a logical `AND` rule.
 * Quantumult X supports neither transport protocol rules nor logical `AND` rules and is omitted.
 */
export const DISABLE_QUIC_SUPPORTED_CLIENTS = requireModuleMetadata(DISABLE_QUIC_MODULE_ID).supportedClients;

const disableQuicParamsSchema = z.object({
  action: z.enum(['REJECT', 'REJECT-DROP']).optional(),
});

/**
 * Enhancement module: 禁用 QUIC (design §5.2, 识别准确度).
 * Rejects UDP/443 traffic with `AND,((NETWORK,UDP),(DST-PORT,443)),REJECT` (or client equivalent)
 * so apps fall back to TCP/TLS where domains and SNI are easier to inspect and route.
 */
export const disableQuicModule: EnhancementModule = {
  ...requireModuleMetadata(DISABLE_QUIC_MODULE_ID),
  paramsSchema: disableQuicParamsSchema,
  apply(template: ResolvedTemplate, ctx): ResolvedTemplate {
    const parsed = disableQuicParamsSchema.parse(ctx.params ?? {});
    const action = parsed.action ?? 'REJECT';

    const conditions: Condition[] = [
      {
        op: 'and',
        items: [
          { op: 'rule', rule: { type: 'NETWORK', value: 'UDP' } },
          { op: 'rule', rule: { type: 'DST-PORT', value: '443' } },
        ],
      },
    ];

    const card: AppCard = {
      id: DISABLE_QUIC_CARD_ID,
      slug: DISABLE_QUIC_CARD_ID,
      name: '🛑 禁用 QUIC',
      icon: 'reject',
      category: 'infrastructure',
      stage: 'pre-direct',
      origin: 'builtin',
      group: {
        type: 'select',
        candidates:
          action === 'REJECT-DROP'
            ? [
                { kind: 'builtin', id: 'REJECT-DROP' },
                { kind: 'builtin', id: 'REJECT' },
              ]
            : [
                { kind: 'builtin', id: 'REJECT' },
                { kind: 'builtin', id: 'REJECT-DROP' },
              ],
      },
      matchers: [{ kind: 'inline', conditions }],
    };

    return insertModuleCard(template, card, 'top');
  },
};
