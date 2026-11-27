import { z } from 'zod';
import type { AppCard, Condition, PolicyRef } from '../../../shared/schemas/card';
import type { ResolvedTemplate } from '../model';
import { getStageOrder } from '../stages';
import { requireModuleMetadata } from './metadata';
import type { EnhancementModule } from './types';

export const TUNNEL_DIRECT_CARD_ID = 'module-tunnel-direct';

const tunnelDirectParamsSchema = z.object({
  includeTailscale: z.boolean().optional(),
  includeCloudflareTunnel: z.boolean().optional(),
  includeZeroTier: z.boolean().optional(),
});

function findPreDirectInsertIndex(template: ResolvedTemplate): number {
  const preDirectOrder = getStageOrder('pre-direct');
  for (let i = 0; i < template.cards.length; i += 1) {
    const entry = template.cards[i];
    if (entry.effective.hidden) continue;
    if (getStageOrder(entry.effective.stage) > preDirectOrder) {
      return i;
    }
  }
  return template.cards.length;
}

/**
 * Enhancement module 5: 局域网与内网穿透直连 (design §10.12).
 * Inserts Tailscale, Cloudflare Tunnel, and ZeroTier domains, CGNAT/ULA CIDRs,
 * and UDP/control ports into the `pre-direct` stage.
 */
export const tunnelDirectModule: EnhancementModule = {
  ...requireModuleMetadata('tunnel-direct'),
  paramsSchema: tunnelDirectParamsSchema,
  apply(template: ResolvedTemplate, ctx): ResolvedTemplate {
    const next = structuredClone(template);
    const parsed = tunnelDirectParamsSchema.parse(ctx.params ?? {});
    const includeTailscale = parsed.includeTailscale ?? true;
    const includeCloudflareTunnel = parsed.includeCloudflareTunnel ?? true;
    const includeZeroTier = parsed.includeZeroTier ?? true;

    const conditions: Condition[] = [];
    if (includeTailscale) {
      conditions.push(
        { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'tailscale.com' } },
        { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'tailscale.io' } },
        { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'ts.net' } },
        { op: 'rule', rule: { type: 'IP-CIDR', value: '100.64.0.0/10', options: { noResolve: true } } },
        { op: 'rule', rule: { type: 'IP-CIDR', value: 'fd7a:115c:a1e0::/48', options: { noResolve: true } } },
        { op: 'rule', rule: { type: 'DST-PORT', value: '41641' } },
      );
    }
    if (includeCloudflareTunnel) {
      conditions.push(
        { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'argotunnel.com' } },
        { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'cftunnel.com' } },
        { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'cfargotunnel.com' } },
        { op: 'rule', rule: { type: 'DST-PORT', value: '7844' } },
      );
    }
    if (includeZeroTier) {
      conditions.push(
        { op: 'rule', rule: { type: 'DOMAIN-SUFFIX', value: 'zerotier.com' } },
        { op: 'rule', rule: { type: 'DST-PORT', value: '9993' } },
      );
    }

    const candidates: PolicyRef[] = [{ kind: 'builtin', id: 'DIRECT' }];
    if (next.cards.some((c) => c.enabled && c.cardId === 'proxy-select')) {
      candidates.push({ kind: 'card', cardId: 'proxy-select' });
    }

    const card: AppCard = {
      id: TUNNEL_DIRECT_CARD_ID,
      slug: TUNNEL_DIRECT_CARD_ID,
      name: '🔗 局域网与内网穿透直连',
      icon: 'lan',
      category: 'infrastructure',
      stage: 'pre-direct',
      origin: 'builtin',
      group: {
        type: 'select',
        candidates,
      },
      matchers: [
        ...(includeTailscale ? [{ kind: 'catalog' as const, entryId: 'infra-tunnel-direct' }] : []),
        ...(conditions.length > 0 ? [{ kind: 'inline' as const, conditions }] : []),
      ],
    };

    next.body.cards = next.body.cards.filter((ref) => ref.cardId !== TUNNEL_DIRECT_CARD_ID);
    next.cards = next.cards.filter((c) => c.cardId !== TUNNEL_DIRECT_CARD_ID);

    const insertIdx = findPreDirectInsertIndex(next);
    next.cards.splice(insertIdx, 0, {
      cardId: TUNNEL_DIRECT_CARD_ID,
      enabled: true,
      effective: card,
      effectiveGroupType: 'select',
      hasOverrides: false,
    });
    const bodyInsertIdx = Math.min(insertIdx, next.body.cards.length);
    next.body.cards.splice(bodyInsertIdx, 0, {
      cardId: TUNNEL_DIRECT_CARD_ID,
      enabled: true,
    });

    return next;
  },
};
