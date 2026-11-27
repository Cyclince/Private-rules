import { z } from 'zod';
import type { AppCard, Condition } from '../../../shared/schemas/card';
import type { ResolvedTemplate } from '../model';
import { buildDirectCandidates, insertModuleCard } from './helpers';
import { requireModuleMetadata } from './metadata';
import type { EnhancementModule } from './types';

export const DOMESTIC_APPS_DIRECT_CARD_ID = 'module-domestic-apps-direct';

/**
 * 国内常用应用的主域（自写清单，依据各公司公开的开放平台 / 支付回调文档整理）。
 *
 * `compilers/mihomo.ts` 里已核实的 MetaCubeX geosite 名称不包含 wechat / alipay / 银行类，
 * 所以这里不依赖 `GEOSITE`，改用少量可核对的域名后缀，保证各档位与各客户端输出一致。
 */
const WECHAT_SUFFIXES = [
  'weixin.qq.com',
  'wx.qq.com',
  'weixinbridge.com',
  'servicewechat.com',
  'wechat.com',
  'qpic.cn',
  'qlogo.cn',
  'tenpay.com',
];

const ALIPAY_SUFFIXES = ['alipay.com', 'alipayobjects.com', 'alipay.cn'];

const BANK_SUFFIXES = [
  // 工商 / 建设 / 农业 / 中国银行 / 交通
  'icbc.com.cn',
  'ccb.com',
  'abchina.com',
  'boc.cn',
  'bankofchina.com',
  'bankcomm.com',
  // 招商 / 浦发 / 兴业 / 民生 / 光大 / 邮储 / 中信
  'cmbchina.com',
  'spdb.com.cn',
  'cib.com.cn',
  'cmbc.com.cn',
  'cebbank.com',
  'psbc.com.cn',
  'citicbank.com',
  // 银联
  '95516.com',
  'unionpay.com',
];

const domesticAppsParamsSchema = z.object({
  includeWechat: z.boolean().optional(),
  includeAlipay: z.boolean().optional(),
  includeBanks: z.boolean().optional(),
  extraDomains: z.array(z.string().trim().min(1)).optional(),
});

/**
 * Enhancement module: 国内常用应用防误代理 (design §5.2, 直连优化).
 * Forces WeChat / Alipay / major domestic banks to DIRECT in the pre-direct stage so a
 * mis-grouped node can never break payments, logins or message delivery.
 */
export const domesticAppsDirectModule: EnhancementModule = {
  ...requireModuleMetadata('domestic-apps-direct'),
  paramsSchema: domesticAppsParamsSchema,
  apply(template: ResolvedTemplate, ctx): ResolvedTemplate {
    const parsed = domesticAppsParamsSchema.parse(ctx.params ?? {});
    const includeWechat = parsed.includeWechat ?? true;
    const includeAlipay = parsed.includeAlipay ?? true;
    const includeBanks = parsed.includeBanks ?? true;

    const suffixes: string[] = [];
    if (includeWechat) suffixes.push(...WECHAT_SUFFIXES);
    if (includeAlipay) suffixes.push(...ALIPAY_SUFFIXES);
    if (includeBanks) suffixes.push(...BANK_SUFFIXES);
    suffixes.push(...(parsed.extraDomains ?? []));

    if (suffixes.length === 0) return template;

    const conditions: Condition[] = suffixes.map((suffix) => ({
      op: 'rule',
      rule: { type: 'DOMAIN-SUFFIX', value: suffix },
    }));

    const card: AppCard = {
      id: DOMESTIC_APPS_DIRECT_CARD_ID,
      slug: DOMESTIC_APPS_DIRECT_CARD_ID,
      name: '📱 国内应用直连',
      icon: 'domestic',
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
