import { Check, Copy } from 'lucide-react';
import type { QuickCreateTemplateResult } from '../../../application/templates/quick-create';
import type { TemplateClientId } from '../../../shared/clients';
import { useI18n, type MessageKey } from '../../i18n';
import { Button } from '../ui/button';
import { ClientImportButton } from './ClientImportButton';

function clientGuideKey(client: TemplateClientId): MessageKey {
  switch (client) {
    case 'mihomo':
      return 'wizard.guide.mihomo';
    case 'sing-box':
      return 'wizard.guide.sing-box';
    case 'shadowrocket':
      return 'wizard.guide.shadowrocket';
    case 'stash':
      return 'wizard.guide.stash';
    case 'surge':
      return 'wizard.guide.surge';
    case 'loon':
      return 'wizard.guide.loon';
    case 'quantumult-x':
      return 'wizard.guide.quantumult-x';
    default:
      return 'wizard.guide.generic';
  }
}

export function WizardDoneLinks({
  publications,
  name,
  copiedKey,
  onCopy,
  onUrlElement,
}: {
  publications: QuickCreateTemplateResult['publications'];
  name: string;
  copiedKey: string | null;
  onCopy: (id: string, url: string) => void;
  onUrlElement: (id: string, element: HTMLElement | null) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      {publications.map((pub) => {
        const isCopied = copiedKey === pub.id;
        return (
          <div
            key={pub.id}
            data-testid={`wizard-done-link-${pub.client}`}
            className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface p-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-text">{pub.clientLabel}</span>
              <div className="flex flex-wrap gap-2">
                {pub.url ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={isCopied ? 'outline' : 'primary'}
                    data-testid={`wizard-done-copy-${pub.client}`}
                    onClick={() => {
                      if (pub.url) void onCopy(pub.id, pub.url);
                    }}
                  >
                    {isCopied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{isCopied ? t('wizard.doneCopiedBtn') : t('wizard.doneCopyBtn')}</span>
                  </Button>
                ) : null}
                <ClientImportButton
                  client={pub.client}
                  url={pub.supported ? pub.url : null}
                  name={name}
                  label={t('wizard.doneImportBtn')}
                  testId={`wizard-done-import-${pub.client}`}
                />
              </div>
            </div>

            {pub.url ? (
              <code
                ref={(el) => {
                  if (el) onUrlElement(pub.id, el);
                  else onUrlElement(pub.id, null);
                }}
                data-testid={`wizard-done-url-${pub.client}`}
                className="block overflow-x-auto rounded-[var(--radius-sm)] border border-border bg-surface-muted px-2.5 py-2 font-mono text-xs text-text select-all"
              >
                {pub.url}
              </code>
            ) : null}

            <div className="rounded-[var(--radius-sm)] bg-surface-muted/50 px-3 py-2 text-xs leading-relaxed text-text-muted">
              <span className="font-medium text-text">{t('wizard.doneHowToTitle')}：</span>
              {t(clientGuideKey(pub.client))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
