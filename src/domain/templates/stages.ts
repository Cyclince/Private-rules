import type { AppCard } from '../../shared/schemas/card';
import { STAGE_VALUES, type Stage } from '../../shared/stages';
import type { TemplateCardRef } from '../../shared/schemas/template';
import { toCardMap, type CardLookup } from './model';

export type StageMetadata = {
  id: Stage;
  order: number;
  labelZh: string;
  labelEn: string;
  description: string;
};

/**
 * Fixed 7-layer rule stratification order (design §10.10).
 * New cards automatically insert into their layer; cross-layer drag is allowed
 * and surfaced as a warning rather than hard-blocked.
 */
export const STAGES: readonly Stage[] = STAGE_VALUES;

export const STAGE_DEFINITIONS: readonly StageMetadata[] = [
  {
    id: 'pre-direct',
    order: 0,
    labelZh: '前置直连',
    labelEn: 'Pre-Direct',
    description: '局域网与私有地址、自定义直连、游戏下载 CDN、广告拦截',
  },
  {
    id: 'app',
    order: 1,
    labelZh: '应用',
    labelEn: 'Applications',
    description: '即时通讯、社交、AI、GitHub、流媒体、苹果、微软、谷歌、游戏平台（窄在前、宽在后）',
  },
  {
    id: 'proxy-fallback',
    order: 2,
    labelZh: '兜底代理',
    labelEn: 'Proxy Fallback',
    description: '自定义代理与 GFW 列表，承接应用层未命中的被墙域名',
  },
  {
    id: 'ip',
    order: 3,
    labelZh: 'IP 规则',
    labelEn: 'IP Rules',
    description: 'Telegram、Twitter、Google、Netflix 等 GEOIP / IP 段（带 no-resolve，置于域名规则之后）',
  },
  {
    id: 'domestic',
    order: 4,
    labelZh: '国内直连',
    labelEn: 'Domestic',
    description: 'GEOSITE cn、GEOIP cn 等国内域名与 IP',
  },
  {
    id: 'port',
    order: 5,
    labelZh: '非标端口',
    labelEn: 'Ports',
    description: '非标准端口分流规则',
  },
  {
    id: 'final',
    order: 6,
    labelZh: '兜底',
    labelEn: 'Final',
    description: 'MATCH / FINAL 最终兜底出口，每个模板有且只有一条',
  },
];

const STAGE_ORDER_MAP = new Map<Stage, number>(STAGE_DEFINITIONS.map((item) => [item.id, item.order]));

export function getStageOrder(stage: Stage): number {
  return STAGE_ORDER_MAP.get(stage) ?? 1;
}

export function compareStages(a: Stage, b: Stage): number {
  return getStageOrder(a) - getStageOrder(b);
}

export function getStageMetadata(stage: Stage): StageMetadata {
  return STAGE_DEFINITIONS[getStageOrder(stage)];
}

function effectiveStageOfRef(ref: TemplateCardRef, cardMap: Map<string, AppCard>): Stage | undefined {
  if (ref.overrides?.stage) return ref.overrides.stage;
  return cardMap.get(ref.cardId)?.stage;
}

/**
 * Finds the deterministic insertion index for a new card belonging to `targetStage`,
 * placing it at the end of its stage layer (before any card from a later stage).
 */
export function findInsertIndexForStage(
  cards: readonly TemplateCardRef[],
  cardLookup: CardLookup,
  targetStage: Stage,
): number {
  const cardMap = toCardMap(cardLookup);
  const targetOrder = getStageOrder(targetStage);

  for (let i = 0; i < cards.length; i += 1) {
    const stage = effectiveStageOfRef(cards[i], cardMap);
    if (stage && getStageOrder(stage) > targetOrder) {
      return i;
    }
  }
  return cards.length;
}

/** Stable-sorts template card references by the 7-layer stage order while keeping intra-layer order. */
export function sortCardsByStage(cards: readonly TemplateCardRef[], cardLookup: CardLookup): TemplateCardRef[] {
  const cardMap = toCardMap(cardLookup);
  return cards
    .map((ref, index) => ({
      ref,
      index,
      order: getStageOrder(effectiveStageOfRef(ref, cardMap) ?? 'app'),
    }))
    .sort((a, b) => (a.order !== b.order ? a.order - b.order : a.index - b.index))
    .map((entry) => entry.ref);
}

export type StageOrderingViolation = {
  cardId: string;
  stage: Stage;
  index: number;
  precedingCardId: string;
  precedingStage: Stage;
  message: string;
};

/**
 * Detects cross-layer ordering violations (e.g., an `ip` card placed before an `app`
 * card, or `domestic` placed before `proxy-fallback`) without blocking manual overrides.
 */
export function checkStageOrdering(
  cards: readonly TemplateCardRef[],
  cardLookup: CardLookup,
): StageOrderingViolation[] {
  const cardMap = toCardMap(cardLookup);
  const violations: StageOrderingViolation[] = [];

  let highestOrderSeen = -1;
  let highestCardId = '';
  let highestStage: Stage = 'pre-direct';

  cards.forEach((ref, index) => {
    if (!ref.enabled) return;
    const card = cardMap.get(ref.cardId);
    if (card?.hidden || ref.overrides?.hidden) return;
    const stage = effectiveStageOfRef(ref, cardMap);
    if (!stage) return;

    const order = getStageOrder(stage);
    if (order < highestOrderSeen) {
      violations.push({
        cardId: ref.cardId,
        stage,
        index,
        precedingCardId: highestCardId,
        precedingStage: highestStage,
        message: `组件 ${ref.cardId}（${getStageMetadata(stage).labelZh}层）排在 ${highestCardId}（${getStageMetadata(highestStage).labelZh}层）之后，违反规则分层顺序。`,
      });
    } else if (order > highestOrderSeen) {
      highestOrderSeen = order;
      highestCardId = ref.cardId;
      highestStage = stage;
    }
  });

  return violations;
}

export type InferredStageResult = {
  stage: Stage;
  confident: boolean;
  reason: string;
};

/** App-layer catalog categories defined by the 15-category taxonomy (N3). */
const APP_STAGE_CATEGORIES: ReadonlySet<string> = new Set([
  'ai',
  'streaming',
  'regional-streaming',
  'music',
  'social',
  'gaming',
  'developer',
  'cloud-office',
  'apple',
  'finance',
  'shopping',
]);

export type InferCardStageInput = Pick<AppCard, 'slug' | 'name' | 'matchers'> & {
  category: AppCard['category'] | (string & {});
};

/**
 * Infers the most appropriate 7-layer stage for an imported card whose stage
 * was not explicitly declared (design §10.10).
 */
export function inferCardStage(card: InferCardStageInput): InferredStageResult {
  const category: string = card.category;
  const text = `${card.slug} ${card.name}`.toLowerCase();

  if (/\b(final|match)\b|漏网之鱼|兜底/.test(text) && card.matchers.length === 0) {
    return { stage: 'final', confident: true, reason: '兜底策略组' };
  }

  if (
    // N3 uses 'privacy' (normalized from legacy 'advertising'); keep 'advertising' until N3 merges importers
    category === 'privacy' ||
    category === 'advertising' ||
    /private|lan|local|局域网|私有|直连|custom[-_]?direct|cdn|tracker/i.test(text)
  ) {
    if (!/domestic|国内|\bcn\b|china/i.test(text)) {
      return { stage: 'pre-direct', confident: true, reason: '前置直连或广告拦截' };
    }
  }

  if (card.matchers.length > 0) {
    const allGeoPrivate = card.matchers.every(
      (m) => (m.kind === 'geosite' || m.kind === 'geoip') && m.name.toLowerCase() === 'private',
    );
    if (allGeoPrivate) {
      return { stage: 'pre-direct', confident: true, reason: '私有地址匹配器' };
    }

    const allDomestic = card.matchers.every(
      (m) =>
        ((m.kind === 'geosite' || m.kind === 'geoip') && /^(cn|china|geolocation-cn)$/i.test(m.name)) ||
        (m.kind === 'catalog' && /domestic|china|cn/i.test(m.entryId)),
    );
    if (allDomestic || category === 'domestic') {
      return { stage: 'domestic', confident: true, reason: '国内域名/IP 规则' };
    }

    const allGfw = card.matchers.every(
      (m) =>
        (m.kind === 'geosite' && /^(gfw|geolocation-!cn)$/i.test(m.name)) ||
        (m.kind === 'catalog' && /gfw|proxy/i.test(m.entryId)),
    );
    if (allGfw || /\bgfw\b|代理兜底|proxy[-_]?fallback/i.test(text)) {
      return { stage: 'proxy-fallback', confident: true, reason: 'GFW / 代理兜底规则' };
    }

    const allIp = card.matchers.every(
      (m) =>
        m.kind === 'geoip' ||
        (m.kind === 'remote' && m.behavior === 'ipcidr') ||
        (m.kind === 'inline' &&
          m.conditions.every(
            (c) =>
              c.op === 'rule' && (c.rule.type === 'IP-CIDR' || c.rule.type === 'IP-ASN' || c.rule.type === 'GEOIP'),
          )),
    );
    if (allIp) {
      return { stage: 'ip', confident: true, reason: '纯 IP / GEOIP 匹配器' };
    }

    const allPort = card.matchers.every(
      (m) =>
        m.kind === 'inline' &&
        m.conditions.every((c) => c.op === 'rule' && (c.rule.type === 'DST-PORT' || c.rule.type === 'SRC-PORT')),
    );
    if (allPort) {
      return { stage: 'port', confident: true, reason: '纯端口规则' };
    }
  }

  if (APP_STAGE_CATEGORIES.has(category)) {
    return { stage: 'app', confident: true, reason: '具体应用分类' };
  }

  return { stage: 'app', confident: false, reason: '未能明确推断分层，默认归入应用层' };
}
