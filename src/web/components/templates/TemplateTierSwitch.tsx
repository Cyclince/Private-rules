import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { SimpleTemplateView } from '../../../application/templates';
import type { ComplexityTier } from '../../../shared/schemas/template';
import { useI18n, type MessageKey } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { invalidateTemplates } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { SlidingIndicator, useSlidingIndicator } from '../ui/sliding-indicator';
import { isTierDowngrade, TIER_IDS, tierRank } from './detail/template-detail-data';

type TemplateTierSwitchProps = {
  view: SimpleTemplateView;
  readOnly: boolean;
};

function tierLabelKey(tier: ComplexityTier): MessageKey {
  return `templateDetail.tier.${tier}` as MessageKey;
}

/**
 * 简易 / 进阶 / 专业 switch (design §2.3). Upgrading applies immediately; a step
 * down asks first, because it hides the extra parts without deleting anything.
 */
export function TemplateTierSwitch({ view, readOnly }: TemplateTierSwitchProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const { containerRef, rect } = useSlidingIndicator<HTMLDivElement>({
    selector: '[data-state="active"]',
  });
  const [pendingTier, setPendingTier] = useState<ComplexityTier | null>(null);
  const confirmTitleId = useId();

  const current = view.template.complexity;

  const mutation = useMutation({
    mutationFn: async (complexity: ComplexityTier) =>
      readApiJson<{ view: SimpleTemplateView; version: number }>(
        await api.api.templates[':id'].simple.$patch({
          param: { id: view.template.id },
          json: { complexity },
        }),
      ),
    onSuccess: async () => {
      setPendingTier(null);
      await invalidateTemplates(queryClient, view.template.id);
      notify({ title: t('templateDetail.tierChangedToast'), variant: 'success' });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  const selectTier = (tier: ComplexityTier) => {
    if (readOnly || mutation.isPending || tier === current) return;
    if (isTierDowngrade(current, tier)) {
      setPendingTier(tier);
      return;
    }
    mutation.mutate(tier);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs font-medium text-text-muted sm:inline">{t('templateDetail.tierLabel')}</span>
      <div
        ref={containerRef}
        role="radiogroup"
        aria-label={t('templateDetail.tierLabel')}
        data-testid="template-tier-switch"
        data-tier={current}
        className="relative flex items-center gap-0.5 rounded-[var(--radius-md)] border border-border bg-surface p-0.5"
      >
        <SlidingIndicator rect={rect} dataTestId="template-tier-indicator" className="bg-primary/12" />
        {TIER_IDS.map((tier) => {
          const active = tier === current;
          return (
            <button
              key={tier}
              type="button"
              role="radio"
              aria-checked={active}
              data-state={active ? 'active' : 'inactive'}
              data-testid={`template-tier-${tier}`}
              data-rank={tierRank(tier)}
              disabled={readOnly || mutation.isPending}
              onClick={() => selectTier(tier)}
              title={t(`templateDetail.tierDesc.${tier}` as MessageKey)}
              className={`relative z-10 cursor-pointer rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                active ? 'text-primary' : 'text-text-muted hover:text-text'
              }`}
            >
              {t(tierLabelKey(tier))}
            </button>
          );
        })}
      </div>

      <Dialog open={pendingTier !== null} onOpenChange={(open) => (open ? undefined : setPendingTier(null))}>
        <DialogContent data-testid="template-tier-downgrade-dialog" aria-labelledby={confirmTitleId}>
          <DialogHeader>
            <DialogTitle id={confirmTitleId}>{t('templateDetail.tierDowngradeTitle')}</DialogTitle>
            <DialogDescription>{t('templateDetail.tierDowngradeBody')}</DialogDescription>
          </DialogHeader>
          {pendingTier ? (
            <div className="rounded-[var(--radius-sm)] border border-border bg-surface-muted px-3 py-2 text-xs text-text">
              {t('templateDetail.tierDowngradeTarget').replace('{tier}', t(tierLabelKey(pendingTier)))}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingTier(null)} disabled={mutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              data-testid="template-tier-downgrade-confirm"
              disabled={mutation.isPending}
              onClick={() => {
                if (pendingTier) mutation.mutate(pendingTier);
              }}
            >
              {mutation.isPending ? t('common.loading') : t('templateDetail.tierDowngradeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
