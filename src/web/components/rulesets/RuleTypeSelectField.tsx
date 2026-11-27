import { HelpCircle, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getGroupedRuleTypeOptions, getRuleTypeDescriptionKey } from '../../../domain/rules/friendly';
import type { DomainRuleType } from '../../../types/domain-rules';
import { useI18n } from '../../i18n';

export type RuleTypeSelectValue = 'AUTO' | DomainRuleType;

type RuleTypeSelectFieldProps = {
  id: string;
  value: RuleTypeSelectValue;
  onChange: (next: RuleTypeSelectValue) => void;
  includeAuto?: boolean;
  disabled?: boolean;
  selectTestId?: string;
  helpBtnTestId?: string;
  helpPanelTestId?: string;
  selectedDescTestId?: string;
};

export function RuleTypeSelectField({
  id,
  value,
  onChange,
  includeAuto = true,
  disabled = false,
  selectTestId,
  helpBtnTestId = 'rule-type-help-btn',
  helpPanelTestId = 'rule-type-help-panel',
  selectedDescTestId = 'rule-type-selected-desc',
}: RuleTypeSelectFieldProps) {
  const { t } = useI18n();
  const grouped = useMemo(() => getGroupedRuleTypeOptions(), []);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!helpOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHelpOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [helpOpen]);

  const selectedDescription = t(getRuleTypeDescriptionKey(value));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-xs font-medium text-text">
          {t('ruleDetail.fieldType')}
        </label>
        <button
          type="button"
          data-testid={helpBtnTestId}
          aria-label={t('ruleDetail.typeHelpAria')}
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((prev) => !prev)}
          className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </div>

      <select
        id={id}
        data-testid={selectTestId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as RuleTypeSelectValue)}
        className="flex h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
      >
        <optgroup label={t('ruleDetail.typeGroupCommon')}>
          {includeAuto ? <option value="AUTO">{t('rules.typeAuto')}</option> : null}
          {grouped.common.map((option) => (
            <option key={option.type} value={option.type}>
              {t(option.optionLabelKey)}
            </option>
          ))}
        </optgroup>
        <optgroup label={t('ruleDetail.typeGroupAdvanced')}>
          {grouped.advanced.map((option) => (
            <option key={option.type} value={option.type}>
              {t(option.optionLabelKey)}
            </option>
          ))}
        </optgroup>
      </select>

      <p data-testid={selectedDescTestId} className="text-[11px] leading-relaxed text-text-muted">
        {selectedDescription}
      </p>

      {helpOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setHelpOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('ruleDetail.typeHelpTitle')}
            data-testid={helpPanelTestId}
            className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-[var(--radius-lg)] border border-border bg-surface shadow-xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-text">{t('ruleDetail.typeHelpTitle')}</h3>
                <p className="mt-0.5 text-xs text-text-muted">{t('ruleDetail.typeHelpSubtitle')}</p>
              </div>
              <button
                type="button"
                aria-label={t('common.close')}
                data-testid={`${helpPanelTestId}-close`}
                onClick={() => setHelpOpen(false)}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-4 overflow-y-auto px-4 py-3.5">
              <div className="flex flex-col gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                  {t('ruleDetail.typeGroupCommon')}
                </div>
                <dl className="flex flex-col divide-y divide-border/70 rounded-[var(--radius-md)] border border-border bg-surface-muted/30">
                  <div className="px-3 py-2">
                    <dt className="text-xs font-semibold text-text">{t('rules.typeAuto')}</dt>
                    <dd className="mt-0.5 text-xs leading-relaxed text-text-muted">{t('ruleTypeDesc.AUTO')}</dd>
                  </div>
                  {grouped.common.map((option) => (
                    <div key={option.type} className="px-3 py-2">
                      <dt className="text-xs font-semibold text-text">{t(option.optionLabelKey)}</dt>
                      <dd className="mt-0.5 text-xs leading-relaxed text-text-muted">{t(option.descriptionKey)}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  {t('ruleDetail.typeGroupAdvanced')}
                </div>
                <dl className="flex flex-col divide-y divide-border/70 rounded-[var(--radius-md)] border border-border bg-surface-muted/30">
                  {grouped.advanced.map((option) => (
                    <div key={option.type} className="px-3 py-2">
                      <dt className="text-xs font-semibold text-text">{t(option.optionLabelKey)}</dt>
                      <dd className="mt-0.5 text-xs leading-relaxed text-text-muted">{t(option.descriptionKey)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
