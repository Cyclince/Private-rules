import { Blocks, BookOpen, Check, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CatalogItem } from '../../../application/catalog';
import { getStageMetadata } from '../../../domain/templates/stages';
import { CATALOG_CATEGORY_VALUES, type CatalogCategory } from '../../../shared/app-categories';
import type { AppCard } from '../../../shared/schemas/card';
import { useI18n, type MessageKey } from '../../i18n';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

type TemplateCatalogSidebarProps = {
  cards: readonly AppCard[];
  catalogItems: readonly CatalogItem[];
  addedCardIds: ReadonlySet<string>;
  readOnly?: boolean;
  onAddCard: (card: AppCard) => void;
};

const CATEGORIES: ReadonlyArray<CatalogCategory | 'all'> = ['all', ...CATALOG_CATEGORY_VALUES];

export function TemplateCatalogSidebar({
  cards,
  catalogItems,
  addedCardIds,
  readOnly = false,
  onAddCard,
}: TemplateCatalogSidebarProps) {
  const { t, locale } = useI18n();
  const [sourceTab, setSourceTab] = useState<'cards' | 'catalog'>('cards');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CatalogCategory | 'all'>('all');

  const normalizedQuery = query.trim().toLowerCase();

  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      if (category !== 'all' && card.category !== category) return false;
      if (!normalizedQuery) return true;
      return (
        card.name.toLowerCase().includes(normalizedQuery) ||
        card.slug.toLowerCase().includes(normalizedQuery) ||
        card.id.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [cards, category, normalizedQuery]);

  const filteredCatalog = useMemo(() => {
    return catalogItems.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!normalizedQuery) return true;
      return (
        item.name.toLowerCase().includes(normalizedQuery) ||
        item.id.toLowerCase().includes(normalizedQuery) ||
        item.provider.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [catalogItems, category, normalizedQuery]);

  return (
    <aside
      data-testid="editor-left-catalog"
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-3"
    >
      <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-border bg-bg p-1">
        <button
          type="button"
          data-testid="editor-catalog-tab-cards"
          onClick={() => setSourceTab('cards')}
          className={`flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs font-medium transition-colors ${
            sourceTab === 'cards' ? 'bg-primary text-primary-foreground' : 'text-text-muted hover:text-text'
          }`}
        >
          <Blocks className="h-3.5 w-3.5" />
          <span>{t('templates.editorCatalogCards')}</span>
        </button>
        <button
          type="button"
          data-testid="editor-catalog-tab-rulesets"
          onClick={() => setSourceTab('catalog')}
          className={`flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs font-medium transition-colors ${
            sourceTab === 'catalog' ? 'bg-primary text-primary-foreground' : 'text-text-muted hover:text-text'
          }`}
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>{t('templates.editorCatalogRulesets')}</span>
        </button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <Input
          data-testid="editor-catalog-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('templates.editorCatalogSearchPlaceholder')}
          className="h-8 pl-8 text-xs"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`cursor-pointer rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
              category === cat
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-bg text-text-muted hover:text-text'
            }`}
          >
            {cat === 'all' ? t('taxonomy.categoryAll') : t(`taxonomy.category.${cat}` as MessageKey)}
          </button>
        ))}
      </div>

      {sourceTab === 'cards' ? (
        <div
          data-testid="editor-catalog-cards-list"
          className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto pr-0.5 lg:max-h-[calc(100vh-290px)]"
        >
          {filteredCards.length === 0 ? (
            <p className="py-6 text-center text-xs text-text-muted">{t('cards.empty')}</p>
          ) : (
            filteredCards.map((card) => {
              const isAdded = addedCardIds.has(card.id);
              const stageMeta = getStageMetadata(card.stage);
              return (
                <div
                  key={card.id}
                  data-testid={`catalog-card-item-${card.id}`}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border/80 bg-bg px-2.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-text">{card.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                        {locale === 'en' ? stageMeta.labelEn : stageMeta.labelZh}
                      </Badge>
                      {card.hidden ? (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          {t('templates.editorBaseGroupBadge')}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {isAdded ? (
                    <Badge variant="success" className="shrink-0 px-1.5 py-0.5 text-[10px]">
                      <Check className="mr-0.5 h-3 w-3" />
                      {t('templates.editorAddedBadge')}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`editor-add-card-${card.id}`}
                      disabled={readOnly}
                      onClick={() => onAddCard(card)}
                      className="h-7 shrink-0 px-2 text-xs"
                    >
                      <Plus className="h-3 w-3" />
                      <span>{t('templates.editorAddBtn')}</span>
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div
          data-testid="editor-catalog-rulesets-list"
          className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto pr-0.5 lg:max-h-[calc(100vh-290px)]"
        >
          {filteredCatalog.length === 0 ? (
            <p className="py-6 text-center text-xs text-text-muted">{t('catalog.empty')}</p>
          ) : (
            filteredCatalog.slice(0, 80).map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-border/80 bg-bg px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="truncate text-xs font-medium text-text">{item.name}</span>
                  <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                    {item.kind}
                  </Badge>
                </div>
                <div className="truncate font-mono text-[10px] text-text-muted">{item.id}</div>
              </div>
            ))
          )}
        </div>
      )}
    </aside>
  );
}
