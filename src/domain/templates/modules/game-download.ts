import { z } from 'zod';
import type { AppCard, Condition, PolicyRef } from '../../../shared/schemas/card';
import type { ResolvedTemplate } from '../model';
import { getStageOrder } from '../stages';
import { requireModuleMetadata } from './metadata';
import type { EnhancementModule } from './types';

export const GAME_DOWNLOAD_DIRECT_CARD_ID = 'module-game-download-direct';

const STEAM_CDN_SUFFIXES = [
  'steamcontent.com',
  'dl.steam.clngaa.com',
  'xz.pphimalayanrt.com',
  'st.dl.bscstorage.net',
  'st.dl.eccdnx.com',
  'st.dl.pinyuncloud.com',
];

const EPIC_CDN_SUFFIXES = ['epicgames-download1.akamaized.net', 'fastly-download.epicgames.com'];
const BLIZZARD_CDN_SUFFIXES = ['blzddist1-a.akamaihd.net', 'level3.blizzard.com'];

const gameDownloadParamsSchema = z.object({
  includeSteam: z.boolean().optional(),
  includeEpic: z.boolean().optional(),
  includeBlizzard: z.boolean().optional(),
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
 * Enhancement module 4: 游戏下载直连 (design §10.12).
 * Inserts Steam CDN and game platform download domains into the `pre-direct` stage.
 */
export const gameDownloadDirectModule: EnhancementModule = {
  ...requireModuleMetadata('game-download-direct'),
  paramsSchema: gameDownloadParamsSchema,
  apply(template: ResolvedTemplate, ctx): ResolvedTemplate {
    const next = structuredClone(template);
    const parsed = gameDownloadParamsSchema.parse(ctx.params ?? {});
    const includeSteam = parsed.includeSteam ?? true;
    const includeEpic = parsed.includeEpic ?? true;
    const includeBlizzard = parsed.includeBlizzard ?? true;

    const suffixes: string[] = [];
    if (includeSteam) suffixes.push(...STEAM_CDN_SUFFIXES);
    if (includeEpic) suffixes.push(...EPIC_CDN_SUFFIXES);
    if (includeBlizzard) suffixes.push(...BLIZZARD_CDN_SUFFIXES);

    const conditions: Condition[] = suffixes.map((suffix) => ({
      op: 'rule',
      rule: { type: 'DOMAIN-SUFFIX', value: suffix },
    }));

    const candidates: PolicyRef[] = [{ kind: 'builtin', id: 'DIRECT' }];
    if (next.cards.some((c) => c.enabled && c.cardId === 'proxy-select')) {
      candidates.push({ kind: 'card', cardId: 'proxy-select' });
    }

    const card: AppCard = {
      id: GAME_DOWNLOAD_DIRECT_CARD_ID,
      slug: GAME_DOWNLOAD_DIRECT_CARD_ID,
      name: '🎮 游戏下载直连',
      icon: 'steam',
      category: 'gaming',
      stage: 'pre-direct',
      origin: 'builtin',
      group: {
        type: 'select',
        candidates,
      },
      matchers: [
        ...(includeSteam ? [{ kind: 'catalog' as const, entryId: 'gaming-steam-cn' }] : []),
        ...(conditions.length > 0 ? [{ kind: 'inline' as const, conditions }] : []),
      ],
    };

    next.body.cards = next.body.cards.filter((ref) => ref.cardId !== GAME_DOWNLOAD_DIRECT_CARD_ID);
    next.cards = next.cards.filter((c) => c.cardId !== GAME_DOWNLOAD_DIRECT_CARD_ID);

    const insertIdx = findPreDirectInsertIndex(next);
    next.cards.splice(insertIdx, 0, {
      cardId: GAME_DOWNLOAD_DIRECT_CARD_ID,
      enabled: true,
      effective: card,
      effectiveGroupType: 'select',
      hasOverrides: false,
    });
    const bodyInsertIdx = Math.min(insertIdx, next.body.cards.length);
    next.body.cards.splice(bodyInsertIdx, 0, {
      cardId: GAME_DOWNLOAD_DIRECT_CARD_ID,
      enabled: true,
    });

    return next;
  },
};
