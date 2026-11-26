import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { APP_VERSION } from '../../../shared/version';
import aboutEmblemUrl from '../../assets/miku-about-emblem.webp';
import { useI18n } from '../../i18n';
import { healthQueryOptions } from '../../lib/query';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

const OSS_LICENSES = [
  { name: 'React & React DOM', license: 'MIT', url: 'https://github.com/facebook/react/blob/main/LICENSE' },
  { name: 'Hono & @hono/zod-validator', license: 'MIT', url: 'https://github.com/honojs/hono/blob/main/LICENSE' },
  { name: 'Tailwind CSS', license: 'MIT', url: 'https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE' },
  { name: 'Radix UI Primitives', license: 'MIT', url: 'https://github.com/radix-ui/primitives/blob/main/LICENSE' },
  { name: 'TanStack Router & Query', license: 'MIT', url: 'https://github.com/TanStack/router/blob/main/LICENSE' },
  { name: 'React Hook Form & Zod', license: 'MIT', url: 'https://github.com/colinhacks/zod/blob/main/LICENSE' },
  { name: 'Drizzle ORM', license: 'Apache-2.0', url: 'https://github.com/drizzle-team/drizzle-orm/blob/main/LICENSE' },
  { name: 'Lucide Icons', license: 'ISC', url: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE' },
];

export function AboutTab() {
  const { t } = useI18n();
  const healthQuery = useQuery(healthQueryOptions());

  return (
    <div className="flex flex-col gap-4" data-testid="settings-about-tab">
      <Card>
        <CardHeader className="flex flex-row items-center gap-4">
          <img
            src={aboutEmblemUrl}
            alt="Private Rules"
            className="h-16 w-16 shrink-0 rounded-[var(--radius-md)] border border-border object-cover"
          />
          <div className="min-w-0">
            <CardTitle>{t('about.title')}</CardTitle>
            <CardDescription>{t('app.tagline')}</CardDescription>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="primary" data-testid="about-app-version">
                {t('about.versionLabel')}: v{APP_VERSION}
              </Badge>
              <Badge variant="outline">
                {t('about.runtimeLabel')}: {healthQuery.data?.runtime ?? '-'}
              </Badge>
              <Badge variant={healthQuery.data?.ok ? 'success' : 'outline'}>
                {t('about.databaseLabel')}: {healthQuery.data?.database ?? '…'}
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('about.licenseTitle')}</CardTitle>
          <CardDescription>{t('about.licenseDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-xs">
          <div className="rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-text">{t('about.pclTitle')}</span>
              <a
                href="https://piapro.jp/license/pcl"
                target="_blank"
                rel="noreferrer"
                data-testid="about-pcl-link"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <span>piapro.jp/license/pcl</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <p className="mt-1 text-text-muted">{t('about.pclDesc')}</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="font-semibold text-text">{t('about.ossTitle')}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {OSS_LICENSES.map((pkg) => (
                <a
                  key={pkg.name}
                  href={pkg.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border bg-surface-muted/40 px-3 py-2 transition-colors hover:border-primary"
                >
                  <span className="truncate font-medium text-text">{pkg.name}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-text-muted">
                    <Badge variant="outline" className="text-[10px]">
                      {pkg.license}
                    </Badge>
                    <ExternalLink className="h-3 w-3" />
                  </span>
                </a>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
