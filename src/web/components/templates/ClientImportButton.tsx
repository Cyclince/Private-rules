import { getImportLink } from '../../../shared/client-import';
import type { TemplateClientId } from '../../../shared/clients';
import { Button } from '../ui/button';

export function ClientImportButton({
  client,
  url,
  name,
  label,
  testId,
}: {
  client: TemplateClientId;
  url: string | null;
  name: string;
  label: string;
  testId: string;
}) {
  const href = url ? getImportLink(client, url, name) : null;
  if (!href) return null;
  return (
    <Button asChild size="sm" variant="outline">
      <a href={href} data-testid={testId}>
        {label}
      </a>
    </Button>
  );
}
