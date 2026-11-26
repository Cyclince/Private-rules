import { BUILTIN_CARDS, getBuiltinCard } from '../../builtin';
import { createRepositories, serializeCardBody } from '../../data/repositories';
import { id, slugify } from '../../domain/rules/slug';
import { AppError } from '../../shared/errors';
import type { AppCard, AppCardGroup, CardOrigin, CatalogCategory, Matcher, Stage } from '../../shared/schemas/card';
import type { Env } from '../../types';
import { now } from '../rulesets';

export type ListCardsOptions = {
  query?: string;
  category?: CatalogCategory;
  origin?: CardOrigin;
  stage?: Stage;
  cursor?: string;
  limit?: number;
};

export type ListCardsResult = {
  cards: AppCard[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
};

export type CreateCardInput = {
  name: string;
  slug?: string;
  icon?: string;
  category: CatalogCategory;
  stage: Stage;
  group: AppCardGroup;
  matchers: Matcher[];
  hidden?: boolean;
};

export type UpdateCardInput = {
  name?: string;
  slug?: string;
  icon?: string | null;
  category?: CatalogCategory;
  stage?: Stage;
  group?: AppCardGroup;
  matchers?: Matcher[];
  hidden?: boolean;
};

export type ForkCardInput = {
  name?: string;
  slug?: string;
  icon?: string;
  category?: CatalogCategory;
  stage?: Stage;
  group?: AppCardGroup;
  matchers?: Matcher[];
  hidden?: boolean;
};

function decodeOffsetCursor(raw?: string): number {
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError('VALIDATION_FAILED', '分页游标无效。');
  }
  return parsed;
}

/**
 * Loads the complete app card map (`BUILTIN_CARDS` overlaid with DB `app_cards`)
 * used by template linting, probing, and compilation.
 */
export async function loadCardLookup(env: Env): Promise<Map<string, AppCard>> {
  const customCards = await createRepositories(env.DB).cards.listAll();
  const map = new Map<string, AppCard>();
  for (const card of BUILTIN_CARDS) {
    map.set(card.id, structuredClone(card));
  }
  for (const card of customCards) {
    map.set(card.id, card);
  }
  return map;
}

async function resolveUniqueCardSlug(
  env: Env,
  preferred: string,
  explicit: boolean,
  excludeCardId?: string,
): Promise<string> {
  const base = slugify(preferred).toLowerCase();
  const lookup = await loadCardLookup(env);
  const taken = new Set<string>();
  for (const card of lookup.values()) {
    if (card.id !== excludeCardId) taken.add(card.slug.toLowerCase());
  }

  if (!taken.has(base)) return base;
  if (explicit) {
    throw new AppError('CONFLICT', `组件标识 ${base} 已存在。`);
  }
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export async function listCards(env: Env, options: ListCardsOptions = {}): Promise<ListCardsResult> {
  const lookup = await loadCardLookup(env);
  let cards = [...lookup.values()];

  if (options.category) {
    cards = cards.filter((card) => card.category === options.category);
  }
  if (options.origin) {
    cards = cards.filter((card) => (card.origin ?? 'builtin') === options.origin);
  }
  if (options.stage) {
    cards = cards.filter((card) => card.stage === options.stage);
  }
  const query = options.query?.trim().toLowerCase();
  if (query) {
    cards = cards.filter(
      (card) =>
        card.id.toLowerCase().includes(query) ||
        card.slug.toLowerCase().includes(query) ||
        card.name.toLowerCase().includes(query) ||
        card.category.toLowerCase().includes(query),
    );
  }

  const total = cards.length;
  const offset = decodeOffsetCursor(options.cursor);
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 200));
  const slice = cards.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  const hasMore = nextOffset < total;

  return {
    cards: slice,
    total,
    nextCursor: hasMore ? String(nextOffset) : null,
    hasMore,
  };
}

export async function getCardById(env: Env, cardId: string): Promise<AppCard> {
  const dbCard = await createRepositories(env.DB).cards.findById(cardId);
  if (dbCard) return dbCard;
  const builtin = getBuiltinCard(cardId);
  if (builtin) return structuredClone(builtin);
  throw new AppError('CARD_NOT_FOUND', '应用组件不存在。');
}

export async function createCard(env: Env, input: CreateCardInput): Promise<AppCard> {
  const timestamp = now();
  const cardId = id('card');
  const slug = await resolveUniqueCardSlug(env, input.slug || input.name, Boolean(input.slug));

  await createRepositories(env.DB).cards.create({
    id: cardId,
    slug,
    name: input.name.trim(),
    icon: input.icon?.trim() || null,
    category: input.category,
    body: serializeCardBody({
      stage: input.stage,
      group: input.group,
      matchers: input.matchers,
      hidden: input.hidden,
    }),
    origin: 'user',
    forkedFrom: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const created = await createRepositories(env.DB).cards.findById(cardId);
  if (!created) throw new AppError('INTERNAL', '创建应用组件失败。');
  return created;
}

export async function updateCard(env: Env, cardId: string, patch: UpdateCardInput): Promise<AppCard> {
  const repos = createRepositories(env.DB);
  const existing = await repos.cards.findById(cardId);
  if (!existing) {
    if (getBuiltinCard(cardId)) {
      throw new AppError('FORBIDDEN', '内置组件不可直接修改，请先复制（fork）后再编辑。');
    }
    throw new AppError('CARD_NOT_FOUND', '应用组件不存在。');
  }

  const nextSlug =
    patch.slug !== undefined && patch.slug.trim() !== existing.slug
      ? await resolveUniqueCardSlug(env, patch.slug, true, existing.id)
      : existing.slug;
  const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
  const nextIcon = patch.icon === undefined ? (existing.icon ?? null) : patch.icon?.trim() || null;
  const nextCategory = patch.category ?? existing.category;
  const nextBody = serializeCardBody({
    stage: patch.stage ?? existing.stage,
    group: patch.group ?? existing.group,
    matchers: patch.matchers ?? existing.matchers,
    hidden: patch.hidden ?? existing.hidden,
  });
  const timestamp = now();

  await repos.cards.update(existing.id, {
    slug: nextSlug,
    name: nextName,
    icon: nextIcon,
    category: nextCategory,
    body: nextBody,
    updatedAt: timestamp,
  });

  const updated = await repos.cards.findById(existing.id);
  if (!updated) throw new AppError('CARD_NOT_FOUND', '应用组件不存在。');
  return updated;
}

export async function forkCard(env: Env, sourceCardId: string, input: ForkCardInput = {}): Promise<AppCard> {
  const source = await getCardById(env, sourceCardId);
  const timestamp = now();
  const cardId = id('card');
  const slug = await resolveUniqueCardSlug(env, input.slug || `${source.slug}-fork`, Boolean(input.slug));

  await createRepositories(env.DB).cards.create({
    id: cardId,
    slug,
    name: input.name?.trim() || `${source.name} (副本)`,
    icon: (input.icon !== undefined ? input.icon : source.icon)?.trim() || null,
    category: input.category ?? source.category,
    body: serializeCardBody({
      stage: input.stage ?? source.stage,
      group: structuredClone(input.group ?? source.group),
      matchers: structuredClone(input.matchers ?? source.matchers),
      hidden: input.hidden ?? source.hidden,
    }),
    origin: 'fork',
    forkedFrom: source.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const forked = await createRepositories(env.DB).cards.findById(cardId);
  if (!forked) throw new AppError('INTERNAL', '复制应用组件失败。');
  return forked;
}

export async function deleteCard(env: Env, cardId: string): Promise<{ deletedId: string }> {
  const repos = createRepositories(env.DB);
  const existing = await repos.cards.findById(cardId);
  if (!existing) {
    if (getBuiltinCard(cardId)) {
      throw new AppError('FORBIDDEN', '内置组件不可删除。');
    }
    throw new AppError('CARD_NOT_FOUND', '应用组件不存在。');
  }
  await repos.cards.deleteById(existing.id);
  return { deletedId: existing.id };
}
