import { ArrowRight, X } from 'lucide-react';
import { getApp, type AppDefinition } from '../../../../shared/apps';
import { useI18n } from '../../../i18n';
import { AppIcon } from '../../apps/AppIcon';
import { AppPicker } from '../../apps/AppPicker';
import { Button } from '../../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';

type WizardStepAppsProps = {
  selectedAppIds: readonly string[];
  validationError: string | null;
  onChange: (nextAppIds: string[]) => void;
  onNext: () => void;
};

export function WizardStepApps({ selectedAppIds, validationError, onChange, onNext }: WizardStepAppsProps) {
  const { t } = useI18n();
  const selectedApps = selectedAppIds.map((id) => getApp(id)).filter((app): app is AppDefinition => Boolean(app));

  return (
    <Card data-testid="wizard-step-1">
      <CardHeader>
        <CardTitle className="text-lg">{t('wizard.step1Title')}</CardTitle>
        <CardDescription>{t('wizard.step1Desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {selectedApps.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="wizard-selected-apps-bar">
            {selectedApps.map((app) => (
              <span
                key={app.id}
                data-testid={`wizard-selected-chip-${app.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-1 pr-2 pl-1.5 text-xs font-medium text-text"
              >
                <AppIcon app={app} size="sm" className="h-5 w-5 text-[10px]" />
                <span>{app.name}</span>
                {selectedApps.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`${t('common.delete')} ${app.name}`}
                    onClick={() => onChange(selectedAppIds.filter((id) => id !== app.id))}
                    className="rounded-full p-0.5 text-text-muted hover:bg-surface hover:text-text"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}

        <AppPicker mode="multiple" value={selectedAppIds} onChange={onChange} />

        {validationError ? (
          <p role="alert" data-testid="wizard-step1-error" className="text-xs font-medium text-danger">
            {validationError}
          </p>
        ) : null}

        <div className="flex justify-end border-t border-border pt-4">
          <Button type="button" data-testid="wizard-next-btn" onClick={onNext}>
            <span>{t('wizard.nextBtn')}</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
