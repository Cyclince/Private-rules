import { Blocks, Copy, Pencil, Trash2 } from 'lucide-react';
import type { AppCard } from '../../../shared/schemas/card';
import { useI18n, type MessageKey } from '../../i18n';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../ui/sheet';
import { formatMatcherSummary, formatPolicyRefLabel, serializePolicyRef } from './card-helpers';

type CardDetailSheetProps = {
  open: boolean;
  card: AppCard | null;
  cardNames: ReadonlyMap<string, string>;
  readOnly: boolean;
  forking: boolean;
  onFork: (card: AppCard) => void;
  onEdit: (card: AppCard) => void;
  onDelete: (card: AppCard) => void;
  onOpenChange: (open: boolean) => void;
};

function originBadgeVariant(origin: AppCard['origin']): 'outline' | 'primary' | 'accent' {
  if (origin === 'user') return 'primary';
  if (origin === 'fork') return 'accent';
  return 'outline';
}

export function CardDetailSheet({
  open,
  card,
  cardNames,
  readOnly,
  forking,
  onFork,
  onEdit,
  onDelete,
  onOpenChange,
}: CardDetailSheetProps) {
  const { t } = useI18n();
  const origin = card?.origin ?? 'builtin';
  const isEditable = origin !== 'builtin';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto" data-testid="card-detail-sheet">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 pr-8">
            <Blocks className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">{card?.name ?? t('cards.detailTitle')}</span>
          </SheetTitle>
          <SheetDescription className="font-mono text-xs">{card?.slug ?? ''}</SheetDescription>
        </SheetHeader>

        {card ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={originBadgeVariant(origin)}>{t(`cards.origin.${origin}` as MessageKey)}</Badge>
              <Badge variant="outline">{t(`taxonomy.category.${card.category}` as MessageKey)}</Badge>
              <Badge variant="outline">{t(`taxonomy.stage.${card.stage}` as MessageKey)}</Badge>
              {card.icon ? (
                <Badge variant="outline" className="font-mono text-[11px]">
                  icon: {card.icon}
                </Badge>
              ) : null}
            </div>

            {card.forkedFrom ? (
              <div className="rounded-[var(--radius-sm)] border border-border bg-surface-muted/60 px-3 py-2 text-xs text-text-muted">
                {t('cards.forkedFromLabel')}:{' '}
                <span className="font-mono text-text">{cardNames.get(card.forkedFrom) ?? card.forkedFrom}</span>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/50 p-3.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-text-muted">{t('cards.detailGroupType')}</span>
                <Badge variant="outline" className="font-mono">
                  {card.group.type}
                </Badge>
              </div>
              <div className="mt-1 font-medium text-text-muted">{t('cards.detailCandidates')}</div>
              <ol className="flex flex-col gap-1.5">
                {card.group.candidates.map((candidate, index) => (
                  <li
                    key={`${serializePolicyRef(candidate)}-${index}`}
                    className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-surface px-2.5 py-1.5"
                  >
                    <span className="truncate text-text">{formatPolicyRefLabel(candidate, t, cardNames)}</span>
                    {index === 0 ? (
                      <Badge variant="primary" className="text-[10px]">
                        {t('cards.defaultRouteLabel')}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-text-muted">
                {t('cards.detailMatchers')} ({card.matchers.length})
              </div>
              {card.matchers.length === 0 ? (
                <p className="rounded-[var(--radius-md)] border border-border bg-surface-muted/40 p-3 text-xs text-text-muted">
                  {t('cards.detailNoMatchers')}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {card.matchers.map((matcher, index) => (
                    <li
                      key={`${matcher.kind}-${index}`}
                      className="break-all rounded-[var(--radius-sm)] border border-border bg-surface-muted/50 px-3 py-2 font-mono text-[11px] text-text"
                    >
                      {formatMatcherSummary(matcher, t)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!isEditable ? <p className="text-xs text-text-muted">{t('cards.builtinHint')}</p> : null}

            <SheetFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={readOnly || forking}
                data-testid="card-detail-fork-btn"
                onClick={() => onFork(card)}
              >
                <Copy className="h-3.5 w-3.5" />
                <span>{forking ? t('cards.forking') : t('cards.fork')}</span>
              </Button>
              {isEditable ? (
                <>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={readOnly}
                    data-testid="card-detail-edit-btn"
                    onClick={() => onEdit(card)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>{t('common.edit')}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={readOnly}
                    data-testid="card-detail-delete-btn"
                    onClick={() => onDelete(card)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{t('common.delete')}</span>
                  </Button>
                </>
              ) : null}
            </SheetFooter>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
