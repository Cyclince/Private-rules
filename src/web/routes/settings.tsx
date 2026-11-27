import { useQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { ShieldAlert } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { SlidingIndicator, useSlidingIndicator } from '../components/ui/sliding-indicator';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { loadPageTranslations, useI18n } from '../i18n';
import { isTelegramSession, requireAuthBeforeLoad, TELEGRAM_HIDDEN_SETTINGS_TABS } from '../lib/auth-guard';
import { authMeQueryOptions } from '../lib/query';

const GeneralSettingsTab = lazy(() =>
  import('../components/settings/GeneralSettingsTab').then((m) => ({ default: m.GeneralSettingsTab })),
);
const ApiKeysTab = lazy(() => import('../components/settings/ApiKeysTab').then((m) => ({ default: m.ApiKeysTab })));
const BackupTab = lazy(() => import('../components/settings/BackupTab').then((m) => ({ default: m.BackupTab })));
const AboutTab = lazy(() => import('../components/settings/AboutTab').then((m) => ({ default: m.AboutTab })));

type SettingsTab = 'general' | 'api-keys' | 'backup' | 'about';

type SettingsSearch = {
  tab?: SettingsTab;
};

const VALID_TABS = new Set<SettingsTab>(['general', 'api-keys', 'backup', 'about']);

export const Route = createFileRoute('/settings')({
  validateSearch: (search: Record<string, unknown>): SettingsSearch => {
    const raw = typeof search.tab === 'string' ? (search.tab as SettingsTab) : undefined;
    return raw && VALID_TABS.has(raw) && raw !== 'general' ? { tab: raw } : {};
  },
  beforeLoad: async ({ context, location, search }) => {
    const [me] = await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
    if (isTelegramSession(me) && search.tab && TELEGRAM_HIDDEN_SETTINGS_TABS.has(search.tab)) {
      throw redirect({ to: '/settings', search: {} });
    }
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const authQuery = useQuery(authMeQueryOptions());
  const inTelegram = isTelegramSession(authQuery.data);
  const { containerRef: tabsRef, rect: tabsRect } = useSlidingIndicator<HTMLDivElement>({
    selector: '[role="tab"][aria-selected="true"]',
  });

  const rawTab: SettingsTab = search.tab ?? 'general';
  const tab: SettingsTab = inTelegram && TELEGRAM_HIDDEN_SETTINGS_TABS.has(rawTab) ? 'general' : rawTab;

  const allTabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'general', label: t('settings.tabGeneral') },
    { id: 'api-keys', label: t('settings.tabApiKeys') },
    { id: 'backup', label: t('settings.tabBackup') },
    { id: 'about', label: t('settings.tabAbout') },
  ];
  const visibleTabs = inTelegram ? allTabs.filter((item) => !TELEGRAM_HIDDEN_SETTINGS_TABS.has(item.id)) : allTabs;

  return (
    <div className="flex flex-col gap-4" data-testid="settings-page">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>{t('settings.title')}</CardTitle>
              <CardDescription>{t('settings.subtitle')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            ref={tabsRef}
            role="tablist"
            aria-label={t('settings.title')}
            data-testid="settings-tab-list"
            className="relative flex flex-wrap gap-2"
          >
            <SlidingIndicator rect={tabsRect} dataTestId="settings-tab-indicator" className="bg-primary shadow-sm" />
            {visibleTabs.map((item) => {
              const active = tab === item.id;
              return (
                <Button
                  key={item.id}
                  type="button"
                  role="tab"
                  size="sm"
                  variant="ghost"
                  aria-selected={active}
                  data-testid={`settings-tab-${item.id}`}
                  onClick={() => navigate({ search: item.id === 'general' ? {} : { tab: item.id }, replace: true })}
                  className={`relative z-10 border ${
                    active
                      ? 'border-transparent text-primary-foreground hover:bg-transparent'
                      : 'border-border text-text'
                  }`}
                >
                  {item.label}
                </Button>
              );
            })}
          </div>
          {inTelegram ? (
            <div
              data-testid="telegram-restricted-notice"
              className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted px-3.5 py-2.5 text-xs text-text-muted"
            >
              <ShieldAlert className="h-4 w-4 shrink-0 text-primary" />
              <span>{t('auth.telegramRestricted')}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Suspense fallback={<div className="h-40 animate-pulse rounded-[var(--radius-lg)] bg-surface-muted" />}>
        <div key={tab} className="motion-tab-panel">
          {tab === 'general' ? <GeneralSettingsTab inTelegram={inTelegram} /> : null}
          {tab === 'api-keys' && !inTelegram ? <ApiKeysTab /> : null}
          {tab === 'backup' && !inTelegram ? <BackupTab /> : null}
          {tab === 'about' ? <AboutTab /> : null}
        </div>
      </Suspense>
    </div>
  );
}
