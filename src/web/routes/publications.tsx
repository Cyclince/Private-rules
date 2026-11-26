import { createFileRoute } from '@tanstack/react-router';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { loadPageTranslations, useI18n } from '../i18n';
import { requireAuthBeforeLoad } from '../lib/auth-guard';

type ClientFilter = 'all' | 'mihomo' | 'surge' | 'sing-box';

type PublicationsSearch = {
  client?: ClientFilter;
};

const VALID_CLIENTS = new Set<ClientFilter>(['all', 'mihomo', 'surge', 'sing-box']);

export const Route = createFileRoute('/publications')({
  validateSearch: (search: Record<string, unknown>): PublicationsSearch => {
    const raw = typeof search.client === 'string' ? (search.client as ClientFilter) : undefined;
    return raw && VALID_CLIENTS.has(raw) && raw !== 'all' ? { client: raw } : {};
  },
  beforeLoad: async ({ context, location }) => {
    await Promise.all([requireAuthBeforeLoad(context.queryClient, location.href), loadPageTranslations()]);
  },
  component: PublicationsPage,
});

function PublicationsPage() {
  const { t } = useI18n();
  const search = Route.useSearch();
  const client: ClientFilter = search.client ?? 'all';
  const navigate = Route.useNavigate();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{t('publications.title')}</CardTitle>
            <CardDescription>{t('publications.subtitle')}</CardDescription>
          </div>
          <Badge variant="accent">M4</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {(['all', 'mihomo', 'surge', 'sing-box'] as const).map((item) => (
          <Button
            key={item}
            size="sm"
            variant={client === item ? 'primary' : 'outline'}
            onClick={() => navigate({ search: { client: item }, replace: true })}
          >
            {item === 'all' ? t('publications.clientAll') : item}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
