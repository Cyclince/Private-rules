import { z } from 'zod';
import { TEMPLATE_CLIENT_IDS } from '../../../shared/clients';
import type { AppCard, Condition } from '../../../shared/schemas/card';
import type { ResolvedTemplate } from '../model';
import type { EnhancementModule } from './types';

export const BLOCK_ENCRYPTED_DNS_CARD_ID = 'module-block-encrypted-dns';

const COMMON_ENCRYPTED_DNS_DOMAINS = [
  'dns.google',
  'dns.cloudflare.com',
  'cloudflare-dns.com',
  'mozilla.cloudflare-dns.com',
  'dns.quad9.net',
  'dns.adguard-dns.com',
  'doh.opendns.com',
  'dns.nextdns.io',
  'dns.alidns.com',
  'doh.pub',
  'dot.pub',
];

const COMMON_ENCRYPTED_DNS_IPS = [
  '1.1.1.1/32',
  '1.0.0.1/32',
  '8.8.8.8/32',
  '8.8.4.4/32',
  '9.9.9.9/32',
  '149.112.112.112/32',
];

const blockEncryptedDnsParamsSchema = z.object({
  action: z.enum(['REJECT', 'REJECT-DROP']).optional(),
  extraDomains: z.array(z.string().trim().min(1)).optional(),
  extraIps: z.array(z.string().trim().min(1)).optional(),
});

/**
 * Enhancement module 3: 阻断加密 DNS (design §10.12).
 * Inserts a top-priority rule card blocking port 853 (DoT/DoQ) and common DoH/DoT/DoQ
 * endpoints so client applications cannot bypass the configured DNS.
 */
export const blockEncryptedDnsModule: EnhancementModule = {
  id: 'block-encrypted-dns',
  name: '阻断加密 DNS',
  description: '在规则最前面拦截 853 端口与常见 DoH / DoT / DoQ 域名和 IP，迫使终端使用配置中的 DNS。',
  defaultEnabled: false,
  order: 10,
  affects: ['rules', 'groups'],
  conflictsWith: ['dns-leak-guard'],
  conflictReasons: {
    'dns-leak-guard':
      '「阻断加密 DNS」在规则最顶部拦截 DoH/DoT 域名与 IP，与开启 respect-rules 的「防 DNS 泄漏」同时启用会阻断内核自身的上游加密 DNS 查询。',
  },
  supportedClients: [...TEMPLATE_CLIENT_IDS],
  paramsSchema: blockEncryptedDnsParamsSchema,
  apply(template: ResolvedTemplate, ctx): ResolvedTemplate {
    const next = structuredClone(template);
    const parsed = blockEncryptedDnsParamsSchema.parse(ctx.params ?? {});
    const action = parsed.action ?? 'REJECT-DROP';

    const domains = [...COMMON_ENCRYPTED_DNS_DOMAINS, ...(parsed.extraDomains ?? [])];
    const ips = [...COMMON_ENCRYPTED_DNS_IPS, ...(parsed.extraIps ?? [])];

    const conditions: Condition[] = [
      { op: 'rule', rule: { type: 'DST-PORT', value: '853' } },
      ...domains.map((domain): Condition => ({
        op: 'rule',
        rule: { type: 'DOMAIN-SUFFIX', value: domain },
      })),
      ...ips.map((cidr): Condition => ({
        op: 'rule',
        rule: { type: 'IP-CIDR', value: cidr, options: { noResolve: true } },
      })),
    ];

    const card: AppCard = {
      id: BLOCK_ENCRYPTED_DNS_CARD_ID,
      slug: BLOCK_ENCRYPTED_DNS_CARD_ID,
      name: '🚫 阻断加密 DNS',
      icon: 'advertising',
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
            : [{ kind: 'builtin', id: 'REJECT' }],
      },
      matchers: [
        { kind: 'inline', conditions },
        { kind: 'catalog', entryId: 'infra-encrypted-dns' },
      ],
    };

    // Remove any previous instance first for idempotency
    next.body.cards = next.body.cards.filter((ref) => ref.cardId !== BLOCK_ENCRYPTED_DNS_CARD_ID);
    next.cards = next.cards.filter((c) => c.cardId !== BLOCK_ENCRYPTED_DNS_CARD_ID);

    // Place right after leading hidden hub cards so it is the very first evaluated rule card
    let insertIdx = 0;
    while (insertIdx < next.cards.length && next.cards[insertIdx].effective.hidden) {
      insertIdx += 1;
    }

    next.cards.splice(insertIdx, 0, {
      cardId: BLOCK_ENCRYPTED_DNS_CARD_ID,
      enabled: true,
      effective: card,
      effectiveGroupType: 'select',
      hasOverrides: false,
    });

    const bodyInsertIdx = insertIdx < next.body.cards.length ? insertIdx : next.body.cards.length;
    next.body.cards.splice(bodyInsertIdx, 0, {
      cardId: BLOCK_ENCRYPTED_DNS_CARD_ID,
      enabled: true,
    });

    return next;
  },
};
