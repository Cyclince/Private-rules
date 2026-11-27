import { z } from 'zod';
import type { AppCard, Condition } from '../../../shared/schemas/card';
import type { ResolvedTemplate } from '../model';
import { insertModuleCard } from './helpers';
import { requireModuleMetadata } from './metadata';
import type { EnhancementModule } from './types';

export const PRIVACY_TRACKER_BLOCK_CARD_ID = 'module-privacy-tracker-block';

/**
 * Self-curated tracking / telemetry domains (design §5.2 「隐私跟踪拦截」).
 * Written from public vendor documentation — no third-party rule list is copied.
 * Only domains whose sole purpose is analytics, attribution or crash telemetry are
 * included; push transports (APNs / FCM / 厂商推送) are deliberately left out so
 * notifications keep working.
 */
const TRACKER_DOMAIN_SUFFIXES = [
  // Google / Firebase 统计与归因
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'doubleclick.net',
  'app-measurement.com',
  'firebase-settings.crashlytics.com',
  'crashlytics.com',
  // 移动广告归因 SDK
  'adjust.com',
  'appsflyer.com',
  'branch.io',
  'kochava.com',
  'mixpanel.com',
  'amplitude.com',
  'segment.io',
  'hotjar.com',
  'fullstory.com',
  'analytics.tiktok.com',
  // 国内统计与崩溃上报（不含推送通道）
  'cnzz.com',
  'hm.baidu.com',
  'bugly.qq.com',
  'sensorsdata.cn',
  'growingio.com',
  'talkingdata.com',
];

const privacyTrackerParamsSchema = z.object({
  action: z.enum(['REJECT', 'REJECT-DROP']).optional(),
  extraDomains: z.array(z.string().trim().min(1)).optional(),
  extraIps: z.array(z.string().trim().min(1)).optional(),
});

/**
 * Enhancement module: 隐私跟踪拦截 (design §5.2, DNS 与隐私).
 * Inserts a top-priority REJECT card for common tracking / attribution / telemetry
 * domains so analytics SDKs cannot follow the user through direct or proxied traffic.
 */
export const privacyTrackerBlockModule: EnhancementModule = {
  ...requireModuleMetadata('privacy-tracker-block'),
  paramsSchema: privacyTrackerParamsSchema,
  apply(template: ResolvedTemplate, ctx): ResolvedTemplate {
    const parsed = privacyTrackerParamsSchema.parse(ctx.params ?? {});
    const action = parsed.action ?? 'REJECT';

    const domains = [...TRACKER_DOMAIN_SUFFIXES, ...(parsed.extraDomains ?? [])];
    const conditions: Condition[] = [
      ...domains.map((domain): Condition => ({
        op: 'rule',
        rule: { type: 'DOMAIN-SUFFIX', value: domain },
      })),
      ...(parsed.extraIps ?? []).map((cidr): Condition => ({
        op: 'rule',
        rule: { type: 'IP-CIDR', value: cidr, options: { noResolve: true } },
      })),
    ];

    const card: AppCard = {
      id: PRIVACY_TRACKER_BLOCK_CARD_ID,
      slug: PRIVACY_TRACKER_BLOCK_CARD_ID,
      name: '🕵️ 隐私跟踪拦截',
      icon: 'advertising',
      category: 'privacy',
      stage: 'pre-direct',
      origin: 'builtin',
      group: {
        type: 'select',
        candidates: [
          { kind: 'builtin', id: action },
          ...(action === 'REJECT' ? ([{ kind: 'builtin', id: 'REJECT-DROP' }] as const) : []),
          { kind: 'builtin', id: 'DIRECT' },
        ],
      },
      matchers: [{ kind: 'inline', conditions }],
    };

    return insertModuleCard(template, card, 'top');
  },
};
