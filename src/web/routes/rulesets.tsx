import { createFileRoute } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useI18n } from '../i18n';
import { requireAuthBeforeLoad } from '../lib/auth-guard';

type SourceFilter = 'all' | 'manual' | 'upstream';

type RulesetsSearch = {
  q?: string;
  source?: SourceFilter;
  selected?: string;
};

const VALID_SOURCES = new Set<SourceFilter>(['all', 'manual', 'upstream']);

const PLACEHOLDER_RULESETS = [
  { id: 'ai', name: 'AI Services', slug: 'ai-services', source: 'upstream' as const, count: 42 },
  { id: 'direct', name: 'Direct LAN', slug: 'direct-lan', source: 'manual' as const, count: 16 },
  { id: 'streaming', name: 'Streaming Media', slug: 'streaming-media', source: 'upstream' as const, count: 128 },
];

export const Route = createFileRoute('/rulesets')({
  validateSearch: (search: Record<string, unknown>): RulesetsSearch => {
    const q = typeof search.q === 'string' && search.q ? search.q : undefined;
    const rawSource = typeof search.source === 'string' ? (search.source as SourceFilter) : undefined;
    const source = rawSource && VALID_SOURCES.has(rawSource) && rawSource !== 'all' ? rawSource : undefined;
    const selected = typeof search.selected === 'string' && search.selected ? search.selected : undefined;
    return {
      ...(q ? { q } : {}),
      ...(source ? { source } : {}),
      ...(selected ? { selected } : {}),
    };
  },
  beforeLoad: ({ context, location }) => requireAuthBeforeLoad(context.queryClient, location.href),
  component: RulesetsPage,
});

function RulesetsPage() {
  const { t } = useI18n();
  const rawSearch = Route.useSearch();
  const search = {
    q: rawSearch.q ?? '',
    source: rawSearch.source ?? ('all' as SourceFilter),
    selected: rawSearch.selected ?? '',
  };
  const navigate = Route.useNavigate();

  const filtered = PLACEHOLDER_RULESETS.filter((item) => {
    if (search.source !== 'all' && item.source !== search.source) return false;
    if (search.q.trim()) {
      const needle = search.q.trim().toLowerCase();
      return item.name.toLowerCase().includes(needle) || item.slug.includes(needle);
    }
    return true;
  });

  const updateSearch = (patch: Partial<RulesetsSearch>) => {
    void navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('rulesets.title')}</CardTitle>
          <CardDescription>{t('rulesets.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              data-testid="rulesets-search-input"
              value={search.q}
              onChange={(event) => updateSearch({ q: event.target.value })}
              placeholder={t('rulesets.searchPlaceholder')}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'manual', 'upstream'] as const).map((item) => (
              <Button
                key={item}
                size="sm"
                data-testid={`rulesets-source-${item}`}
                variant={search.source === item ? 'primary' : 'outline'}
                onClick={() => updateSearch({ source: item })}
              >
                {item === 'all'
                  ? t('rulesets.filterAll')
                  : item === 'manual'
                    ? t('rulesets.filterManual')
                    : t('rulesets.filterUpstream')}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-2 pt-5">
            {filtered.map((item) => {
              const isSelected = search.selected === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`ruleset-item-${item.id}`}
                  onClick={() => updateSearch({ selected: item.id })}
                  className={`flex items-center justify-between rounded-[var(--radius-md)] border px-3.5 py-3 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-primary bg-surface-muted text-text'
                      : 'border-border bg-surface text-text hover:bg-surface-muted'
                  }`}
                >
                  <div>
                    <div className="text-sm font-medium">{item.name}</div>
                    <div className="font-mono text-xs text-text-muted">{item.slug}</div>
                  </div>
                  <Badge variant={isSelected ? 'primary' : 'outline'}>{item.count}</Badge>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('rulesets.selectedLabel')}</CardTitle>
            <CardDescription data-testid="rulesets-selected-value">
              {search.selected || t('rulesets.noneSelected')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="block rounded-[var(--radius-sm)] bg-surface-muted p-3 text-xs text-text-muted">
              ?q={encodeURIComponent(search.q)}&source={search.source}&selected={encodeURIComponent(search.selected)}
            </code>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
