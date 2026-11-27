import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { getApp } from '../../../shared/apps';
import { useI18n } from '../../i18n';
import { AppIcon } from './AppIcon';
import { AppPicker } from './AppPicker';

type AppSelectorProps = {
  /** Currently remembered software id, or null before the first choice. */
  appId: string | null;
  onChange: (appId: string | null) => void;
  testId?: string;
  className?: string;
};

/**
 * "你的软件：[图标 + 名称 ▾]" row used by the subscription list and detail pages.
 * Collapsed to the remembered software; opens the shared AppPicker for a new choice.
 */
export function AppSelector({ appId, onChange, testId = 'app-selector', className = '' }: AppSelectorProps) {
  const { t } = useI18n();
  const app = appId ? (getApp(appId) ?? null) : null;
  const [open, setOpen] = useState(() => !app);

  return (
    <section data-testid={testId} className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold tracking-tight text-text">{t('apps.picker.yourApp')}</h3>
        <button
          type="button"
          data-testid={`${testId}-toggle`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="motion-btn inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary"
        >
          {app ? (
            <>
              <AppIcon app={app} size="sm" />
              <span data-testid={`${testId}-current`}>{app.name}</span>
            </>
          ) : (
            <span data-testid={`${testId}-current`} className="text-text-muted">
              {t('apps.picker.chooseApp')}
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${open ? 'rotate-180 text-primary' : ''}`}
          />
        </button>
      </div>

      {open ? (
        <AppPicker
          mode="single"
          value={appId ? [appId] : []}
          onChange={(next) => {
            onChange(next[0] ?? null);
            if (next[0]) setOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
