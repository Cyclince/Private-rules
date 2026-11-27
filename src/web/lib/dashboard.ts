import { type QueryClient, queryOptions } from '@tanstack/react-query';
type DashboardTemplate = { id: string; baseBody: { wizardMeta?: { previewSummary?: { status?: string } } } };
type DashboardOutput = {
  templateId: string;
  clients: readonly string[];
  bindings: readonly { needsRebind: boolean; lastStatus?: string }[];
};

type AirportStatus = 'ok' | 'bound' | 'error' | 'empty';

export function summarizeDashboardTemplates(
  templates: readonly DashboardTemplate[],
  publications: readonly DashboardOutput[],
) {
  const airports: Record<AirportStatus, number> = { ok: 0, bound: 0, error: 0, empty: 0 };
  for (const template of templates) {
    const bindings = publications.filter((item) => item.templateId === template.id).flatMap((item) => item.bindings);
    const preview = template.baseBody.wizardMeta?.previewSummary;
    let status: AirportStatus = 'empty';
    if (bindings.length) {
      if (
        bindings.some((binding) => binding.needsRebind || binding.lastStatus === 'error') ||
        preview?.status === 'error'
      )
        status = 'error';
      else if (bindings.some((binding) => binding.lastStatus === 'ok') || preview?.status === 'ok') status = 'ok';
      else status = 'bound';
    }
    airports[status] += 1;
  }
  return {
    templateCount: templates.length,
    outputCount: publications.reduce((sum, item) => sum + item.clients.length, 0),
    airports,
  };
}

/** Follow existing cursor APIs so large installations do not show partial totals as global counts. */
export async function collectDashboardPages<T>(
  load: (cursor?: string) => Promise<{ items: T[]; hasMore: boolean; nextCursor: string | null }>,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await load(cursor);
    items.push(...page.items);
    if (!page.hasMore) return items;
    if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('Invalid dashboard pagination cursor');
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

export function dashboardTemplatesQueryOptions(queryClient: QueryClient) {
  return queryOptions({
    queryKey: ['templates', 'dashboard'] as const,
    staleTime: 0,
    queryFn: async () => {
      // Loaded inside the query function: the dashboard's own first paint does not
      // need the shared query-option module, so it must not be part of its chunk.
      const { publicationsListQueryOptions, templatesListQueryOptions } = await import('./query');
      const [templates, publications] = await Promise.all([
        collectDashboardPages(async (cursor) => {
          const page = await queryClient.fetchQuery(templatesListQueryOptions({ cursor, limit: 100 }));
          return { ...page, items: page.templates };
        }),
        collectDashboardPages(async (cursor) => {
          const page = await queryClient.fetchQuery(publicationsListQueryOptions({ cursor, limit: 100 }));
          return { ...page, items: page.publications };
        }),
      ]);
      return summarizeDashboardTemplates(templates, publications);
    },
  });
}
