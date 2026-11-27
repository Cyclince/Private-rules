import { Check, Copy, Smartphone } from 'lucide-react';
import type {
  QuickCreatePublicationLink,
  QuickCreateTemplateResult,
} from '../../../application/templates/quick-create';
import { getApp, type AppDefinition } from '../../../shared/apps';
import type { TemplateClientId } from '../../../shared/clients';
import { useI18n, type MessageKey } from '../../i18n';
import { AppIcon } from '../apps/AppIcon';
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

function fallbackIconApp(pub: QuickCreatePublicationLink): Pick<AppDefinition, 'id' | 'name'> {
  return {
    id: pub.client,
    name: pub.clientLabel,
  };
}

function isApplePublication(pub: QuickCreatePublicationLink): boolean {
  return (
    pub.client === 'shadowrocket' ||
    pub.client === 'stash' ||
    pub.client === 'surge' ||
    pub.client === 'loon' ||
    pub.client === 'quantumult-x'
  );
}

type DoneCardEntry = {
  key: string;
  title: string;
  app: AppDefinition | null;
  pub: QuickCreatePublicationLink;
  isFirstForClient: boolean;
  isAppleFamily: boolean;
};

export function WizardDoneLinks({
  publications,
  name,
  copiedKey,
  onCopy,
  onUrlElement,
  selectedAppIds,
  subscriptionNames,
}: {
  publications: QuickCreateTemplateResult['publications'];
  name: string;
  copiedKey: string | null;
  onCopy: (id: string, url: string) => void;
  onUrlElement: (id: string, element: HTMLElement | null) => void;
  selectedAppIds?: readonly string[];
  subscriptionNames?: readonly string[];
}) {
  const { t } = useI18n();
  const pubByClient = new Map(publications.map((pub) => [pub.client, pub]));
  const seenClientTestIds = new Set<TemplateClientId>();

  const entries: DoneCardEntry[] = [];
  if (selectedAppIds && selectedAppIds.length > 0) {
    const seenAppIds = new Set<string>();
    for (const appId of selectedAppIds) {
      if (seenAppIds.has(appId)) continue;
      seenAppIds.add(appId);
      const app = getApp(appId);
      if (!app?.templateClientId) continue;
      const pub = pubByClient.get(app.templateClientId);
      if (!pub) continue;
      const isFirstForClient = !seenClientTestIds.has(pub.client);
      if (isFirstForClient) seenClientTestIds.add(pub.client);
      entries.push({
        key: app.id,
        title: app.name,
        app,
        pub,
        isFirstForClient,
        isAppleFamily: app.family === 'apple',
      });
    }
  }

  if (entries.length === 0) {
    for (const pub of publications) {
      entries.push({
        key: pub.id,
        title: pub.clientLabel,
        app: null,
        pub,
        isFirstForClient: true,
        isAppleFamily: isApplePublication(pub),
      });
    }
  }

  const normalizedSubNames = (subscriptionNames ?? []).map((item) => item.trim()).filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      {entries.map((entry) => {
        const { pub, app, isFirstForClient, isAppleFamily } = entry;
        const copyStateId = app ? `app:${app.id}` : pub.id;
        const isCopied = copiedKey === copyStateId || copiedKey === pub.id;
        const urlRefKey = app ? `app:${app.id}` : pub.id;

        const copyTestId = isFirstForClient ? `wizard-done-copy-${pub.client}` : `wizard-done-copy-${entry.key}`;
        const importTestId = isFirstForClient ? `wizard-done-import-${pub.client}` : `wizard-done-import-${entry.key}`;
        const urlTestId = isFirstForClient ? `wizard-done-url-${pub.client}` : `wizard-done-url-${entry.key}`;

        const cardBody = (
          <div
            data-testid={isFirstForClient ? `wizard-done-link-${pub.client}` : undefined}
            className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <AppIcon app={app ?? fallbackIconApp(pub)} size="sm" />
                <span className="truncate text-sm font-semibold text-text">{entry.title}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {pub.url ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={isCopied ? 'outline' : 'primary'}
                    data-testid={copyTestId}
                    onClick={() => {
                      if (pub.url) void onCopy(copyStateId, pub.url);
                    }}
                  >
                    {isCopied ? (
                      <Check className="motion-success-icon h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>{isCopied ? t('wizard.doneCopiedBtn') : t('wizard.doneCopyBtn')}</span>
                  </Button>
                ) : null}
                <ClientImportButton
                  client={pub.client}
                  url={pub.supported ? pub.url : null}
                  name={name}
                  label={t('wizard.doneImportBtn')}
                  testId={importTestId}
                />
              </div>
            </div>

            {pub.url ? (
              <code
                ref={(el) => {
                  if (el) onUrlElement(urlRefKey, el);
                  else onUrlElement(urlRefKey, null);
                }}
                data-testid={urlTestId}
                className="block overflow-x-auto break-all rounded-[var(--radius-sm)] border border-border bg-surface-muted px-2.5 py-2 font-mono text-xs text-text select-all"
              >
                {pub.url}
              </code>
            ) : null}

            <div className="rounded-[var(--radius-sm)] bg-surface-muted/50 px-3 py-2 text-xs leading-relaxed text-text-muted">
              <div className="font-medium text-text">{t('wizard.doneHowToTitle')}</div>
              <div className="mt-1 whitespace-pre-line">{t(clientGuideKey(pub.client))}</div>
            </div>

            {isAppleFamily && normalizedSubNames.length > 0 ? (
              <div
                data-testid={`wizard-done-apple-subs-${entry.key}`}
                className="flex flex-col gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface-muted/35 px-3 py-2.5 text-xs text-text"
              >
                <div className="flex items-center gap-1.5 font-semibold text-text">
                  <Smartphone className="h-3.5 w-3.5 text-primary" />
                  <span>{t('wizard.doneAppleSubsTitle')}</span>
                </div>
                <p className="text-text-muted">{t('wizard.doneAppleSubsDesc')}</p>
                <ul className="flex flex-wrap gap-1.5 pt-0.5">
                  {normalizedSubNames.map((subName, idx) => (
                    <li
                      key={`${entry.key}-sub-${idx}`}
                      data-testid={`wizard-done-apple-sub-name-${entry.key}-${idx}`}
                      className="rounded-full border border-border bg-surface px-2.5 py-0.5 font-medium text-text"
                    >
                      {subName}
                    </li>
                  ))}
                </ul>
                <p className="text-text-muted">{t('wizard.doneAppleSubsStep').replace('{app}', entry.title)}</p>
              </div>
            ) : null}
          </div>
        );

        return app ? (
          <div key={entry.key} data-testid={`wizard-done-app-${app.id}`}>
            {cardBody}
          </div>
        ) : (
          <div key={entry.key}>{cardBody}</div>
        );
      })}
    </div>
  );
}
