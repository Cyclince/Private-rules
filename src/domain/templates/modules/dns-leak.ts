import { z } from 'zod';
import type { AppCard, PolicyRef } from '../../../shared/schemas/card';
import type { ResolvedTemplate } from '../model';
import { requireModuleMetadata } from './metadata';
import type { EnhancementModule } from './types';

export const DNS_LEAK_FINAL_CARD_ID = 'module-dns-leak-final';

const DEFAULT_PROXY_DOH = ['https://1.1.1.1/dns-query', 'https://dns.google/dns-query'];
const DEFAULT_BOOTSTRAP_DNS = ['223.5.5.5', '119.29.29.29'];

const dnsLeakParamsSchema = z.object({
  finalGroupName: z.string().trim().min(1).optional(),
  emptyFallback: z.enum(['REJECT', 'REJECT-DROP']).optional(),
  proxyNameservers: z.array(z.string().trim().min(1)).min(1).optional(),
});

function isSystemDnsEntry(entry: string): boolean {
  const lower = entry.trim().toLowerCase();
  return lower === 'system' || lower.startsWith('dhcp://') || lower === 'local';
}

function buildProxyOnlyCandidates(template: ResolvedTemplate, emptyFallback: 'REJECT' | 'REJECT-DROP'): PolicyRef[] {
  const candidates: PolicyRef[] = [];
  const enabledIds = new Set(template.cards.filter((c) => c.enabled).map((c) => c.cardId));

  if (enabledIds.has('proxy-select')) {
    candidates.push({ kind: 'card', cardId: 'proxy-select' });
  }
  if (enabledIds.has('auto-select')) {
    candidates.push({ kind: 'card', cardId: 'auto-select' });
  }
  for (const pool of template.body.pools ?? []) {
    if (pool.kind === 'all') continue;
    candidates.push({ kind: 'pool', poolId: pool.id });
  }
  if (!template.body.pools) {
    for (const rg of template.body.regionGroups ?? []) {
      candidates.push({ kind: 'region', regionGroupId: rg.id });
    }
  }
  if (candidates.length === 0) {
    for (const pool of template.body.pools ?? []) {
      if (pool.kind === 'all') {
        candidates.push({ kind: 'pool', poolId: pool.id });
      }
    }
  }
  if (candidates.length === 0) {
    for (const slot of template.body.slots) {
      candidates.push({ kind: 'slot', slotId: slot.id });
    }
  }
  // Never include DIRECT in leak-guard final; empty fallback terminates with REJECT / REJECT-DROP
  candidates.push({ kind: 'builtin', id: emptyFallback });
  return candidates;
}

/**
 * Enhancement module 2: 防 DNS 泄漏 (design §10.12).
 * Enables DNS rule-following (`respectRules: true`), strips system/DHCP DNS entries,
 * and replaces `final` with a dedicated proxy-only group that falls back to REJECT-DROP/REJECT.
 */
export const dnsLeakGuardModule: EnhancementModule = {
  ...requireModuleMetadata('dns-leak-guard'),
  paramsSchema: dnsLeakParamsSchema,
  apply(template: ResolvedTemplate, ctx): ResolvedTemplate {
    const next = structuredClone(template);
    const parsed = dnsLeakParamsSchema.parse(ctx.params ?? {});
    const emptyFallback = parsed.emptyFallback ?? 'REJECT-DROP';
    const proxyNameservers = parsed.proxyNameservers ?? DEFAULT_PROXY_DOH;
    const finalGroupName = parsed.finalGroupName ?? '🔒 防泄漏兜底';

    // 1. Harden DNS profile
    const cleanedNameservers = (next.body.dns.nameserver ?? []).filter((ns) => !isSystemDnsEntry(ns));
    const cleanedFallback = (next.body.dns.fallback ?? []).filter((ns) => !isSystemDnsEntry(ns));
    const cleanedDefault = (next.body.dns.defaultNameserver ?? []).filter((ns) => !isSystemDnsEntry(ns));

    next.body.dns = {
      ...next.body.dns,
      enable: true,
      respectRules: true,
      defaultNameserver: cleanedDefault.length > 0 ? cleanedDefault : [...DEFAULT_BOOTSTRAP_DNS],
      nameserver: cleanedNameservers.length > 0 ? cleanedNameservers : [...proxyNameservers],
      fallback: cleanedFallback.length > 0 ? cleanedFallback : [...proxyNameservers],
      custom: {
        ...next.body.dns.custom,
        proxyServerNameserver: next.body.dns.custom?.proxyServerNameserver ?? [...DEFAULT_BOOTSTRAP_DNS],
        dnsLeakGuard: {
          emptyFallback,
          client: ctx.client ?? 'mihomo',
        },
      },
    };

    // 2. Replace `final` with a dedicated proxy-only group (no DIRECT fallback)
    const finalCard: AppCard = {
      id: DNS_LEAK_FINAL_CARD_ID,
      slug: DNS_LEAK_FINAL_CARD_ID,
      name: finalGroupName,
      icon: 'final',
      category: 'infrastructure',
      stage: 'final',
      origin: 'builtin',
      group: {
        type: 'select',
        candidates: buildProxyOnlyCandidates(next, emptyFallback),
      },
      matchers: [],
    };

    const existingBodyIdx = next.body.cards.findIndex((ref) => ref.cardId === DNS_LEAK_FINAL_CARD_ID);
    if (existingBodyIdx >= 0) {
      next.body.cards[existingBodyIdx] = { cardId: DNS_LEAK_FINAL_CARD_ID, enabled: true };
    } else {
      next.body.cards.push({ cardId: DNS_LEAK_FINAL_CARD_ID, enabled: true });
    }

    const resolvedEntry = {
      cardId: DNS_LEAK_FINAL_CARD_ID,
      enabled: true,
      effective: finalCard,
      effectiveGroupType: 'select' as const,
      hasOverrides: false,
    };
    const existingResolvedIdx = next.cards.findIndex((c) => c.cardId === DNS_LEAK_FINAL_CARD_ID);
    if (existingResolvedIdx >= 0) {
      next.cards[existingResolvedIdx] = resolvedEntry;
    } else {
      next.cards.push(resolvedEntry);
    }

    next.body.final = { kind: 'card', cardId: DNS_LEAK_FINAL_CARD_ID };
    return next;
  },
};
