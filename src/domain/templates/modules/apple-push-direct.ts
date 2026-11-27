import { z } from 'zod';
import { TEMPLATE_CLIENT_IDS } from '../../../shared/clients';
import type { AppCard, Condition } from '../../../shared/schemas/card';
import type { ResolvedTemplate } from '../model';
import { buildDirectCandidates, insertModuleCard } from './helpers';
import type { EnhancementModule } from './types';

export const APPLE_PUSH_DIRECT_CARD_ID = 'module-apple-push-direct';

/**
 * Apple Push Notification service endpoints (public Apple documentation):
 * APNs keeps a long-lived connection to `<n>-courier.push.apple.com`, with
 * `gateway.push.apple.com` and `push.apple.com` as the documented entry points.
 * `push.apple.com` also covers the numbered courier hosts, so a single suffix is enough —
 * the extra entries stay for readability and for templates that match exactly.
 */
const APPLE_PUSH_SUFFIXES = ['push.apple.com', 'courier.push.apple.com', 'gateway.push.apple.com'];

/** TCP 5223 is the APNs fallback port; it is not used by general web traffic. */
const APPLE_PUSH_PORTS = ['5223'];

const applePushParamsSchema = z.object({
  includePortRule: z.boolean().optional(),
  extraDomains: z.array(z.string().trim().min(1)).optional(),
});

/**
 * Enhancement module: Apple 推送直连 (design §5.2, 直连优化).
 * Keeps APNs on DIRECT so iPhones receive push notifications on time instead of
 * waiting for a proxy round-trip (and so the sniffer's `+.push.apple.com` skip-domain
 * actually resolves directly).
 */
export const applePushDirectModule: EnhancementModule = {
  id: 'apple-push-direct',
  name: 'Apple 推送直连',
  icon: '🍎',
  group: 'direct',
  description: '把 APNs 推送域名（push.apple.com 等）放到前置直连层，iPhone 推送不再绕代理，到达更及时。',
  defaultEnabled: false,
  tierDefaults: { simple: false, advanced: true, pro: true },
  order: 22,
  affects: ['rules', 'groups'],
  conflictsWith: [],
  supportedClients: [...TEMPLATE_CLIENT_IDS],
  paramsSchema: applePushParamsSchema,
  apply(template: ResolvedTemplate, ctx): ResolvedTemplate {
    const parsed = applePushParamsSchema.parse(ctx.params ?? {});
    const includePortRule = parsed.includePortRule ?? false;

    const conditions: Condition[] = [
      ...[...APPLE_PUSH_SUFFIXES, ...(parsed.extraDomains ?? [])].map((suffix): Condition => ({
        op: 'rule',
        rule: { type: 'DOMAIN-SUFFIX', value: suffix },
      })),
      ...(includePortRule
        ? APPLE_PUSH_PORTS.map((port): Condition => ({
            op: 'rule',
            rule: { type: 'DST-PORT', value: port },
          }))
        : []),
    ];

    const card: AppCard = {
      id: APPLE_PUSH_DIRECT_CARD_ID,
      slug: APPLE_PUSH_DIRECT_CARD_ID,
      name: '🍎 Apple 推送直连',
      icon: 'apple',
      category: 'domestic',
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
