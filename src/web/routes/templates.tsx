import { createFileRoute } from '@tanstack/react-router';
import emptyStateUrl from '../assets/miku-empty-state.webp';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useI18n } from '../i18n';

type TemplateTier = 'all' | 'minimal' | 'light' | 'standard' | 'heavy';

type TemplatesSearch = {
  tier?: TemplateTier;
};

const VALID_TIERS = new Set<TemplateTier>(['all', 'minimal', 'light', 'standard', 'heavy']);

export const Route = createFileRoute('/templates')({
  validateSearch: (search: Record<string, unknown>): TemplatesSearch => {
    const raw = typeof search.tier === 'string' ? (search.tier as TemplateTier) : undefined;
    return raw && VALID_TIERS.has(raw) && raw !== 'all' ? { tier: raw } : {};
  },
  component: TemplatesPage,
});

function TemplatesPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const tier: TemplateTier = search.tier ?? 'all';
  const navigate = Route.useNavigate();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{t('templates.title')}</CardTitle>
            <CardDescription>{t('templates.subtitle')}</CardDescription>
          </div>
          <Badge variant="accent">M4</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <div className="flex flex-wrap gap-2 self-start">
          {(['all', 'minimal', 'light', 'standard', 'heavy'] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={tier === item ? 'primary' : 'outline'}
              onClick={() => navigate({ search: { tier: item }, replace: true })}
            >
              {item === 'all'
                ? t('templates.tierAll')
                : item === 'minimal'
                  ? t('templates.tierMinimal')
                  : item === 'light'
                    ? t('templates.tierLight')
                    : item === 'standard'
                      ? t('templates.tierStandard')
                      : t('templates.tierHeavy')}
            </Button>
          ))}
        </div>
        <img
          src={emptyStateUrl}
          alt={t('templates.title')}
          className="h-44 w-72 max-w-full rounded-[var(--radius-md)] border border-border object-cover"
        />
      </CardContent>
    </Card>
  );
}
