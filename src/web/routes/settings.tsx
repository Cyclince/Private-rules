import { createFileRoute } from '@tanstack/react-router';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useI18n } from '../i18n';

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
  component: SettingsPage,
});

function SettingsPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const tab: SettingsTab = search.tab ?? 'general';
  const navigate = Route.useNavigate();

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'general', label: t('settings.tabGeneral') },
    { id: 'api-keys', label: t('settings.tabApiKeys') },
    { id: 'backup', label: t('settings.tabBackup') },
    { id: 'about', label: t('settings.tabAbout') },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{t('settings.title')}</CardTitle>
            <CardDescription>{t('settings.subtitle')}</CardDescription>
          </div>
          <Badge variant="outline">tab={tab}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <Button
            key={item.id}
            size="sm"
            data-testid={`settings-tab-${item.id}`}
            variant={tab === item.id ? 'primary' : 'outline'}
            onClick={() => navigate({ search: { tab: item.id }, replace: true })}
          >
            {item.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
