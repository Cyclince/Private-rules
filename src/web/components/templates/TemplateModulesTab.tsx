import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Puzzle, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SimpleTemplateView } from '../../../application/templates';
import { listEnhancementModuleMetadata, MODULE_GROUP_DEFINITIONS } from '../../../domain/templates/modules/metadata';
import { TEMPLATE_CLIENTS, type TemplateClientId } from '../../../shared/clients';
import type { TemplateModuleBinding, TemplateOverlayOp } from '../../../shared/schemas/template';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { invalidateTemplates, templateDetailQueryOptions } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { Switch } from '../ui/switch';
import { checkModuleToggleConflict } from '../../lib/module-checks';
import { appendOverlayOp } from '../../lib/overlay-ops';
import { describeModuleAvailability, templateClientIds } from './detail/template-detail-data';

type TemplateModulesTabProps = {
  view: SimpleTemplateView;
  readOnly: boolean;
};

function clientLabel(client: string): string {
  return TEMPLATE_CLIENTS[client as TemplateClientId]?.label ?? client;
}

/**
 * Modules tab (design §5.3): cards grouped by module group, greyed out when the
 * template's chosen software cannot compile them, and blocked when two enabled
 * modules conflict.
 */
export function TemplateModulesTab({ view, readOnly }: TemplateModulesTabProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const detailQuery = useQuery(templateDetailQueryOptions(view.template.id));
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  const modules = useMemo<TemplateModuleBinding[]>(
    () => detailQuery.data?.resolvedBody.modules ?? [],
    [detailQuery.data?.resolvedBody.modules],
  );
  const enabledMap = useMemo(() => new Map(modules.map((item) => [item.id, item.enabled])), [modules]);
  const templateClients = useMemo(() => templateClientIds(view), [view]);
  const metadata = useMemo(() => listEnhancementModuleMetadata(), []);

  const mutation = useMutation({
    mutationFn: async (op: TemplateOverlayOp) => {
      const detail = await queryClient.ensureQueryData(templateDetailQueryOptions(view.template.id));
      const overlay = appendOverlayOp(detail.template.overlay, op);
      return readApiJson<{ template: { currentVersion: number } }>(
        await api.api.templates[':id'].$patch({
          param: { id: view.template.id },
          json: { overlay, note: '更新附加功能' },
        }),
      );
    },
    onSuccess: async () => {
      setBlockedReason(null);
      await Promise.all([
        invalidateTemplates(queryClient, view.template.id),
        queryClient.invalidateQueries({ queryKey: ['templates', 'detail'] }),
      ]);
      notify({ title: t('templateDetail.modulesSavedToast'), variant: 'success' });
    },
    onError: (err) => notify({ title: formatApiError(err, locale), variant: 'danger' }),
  });

  const handleToggle = (moduleId: string, nextEnabled: boolean) => {
    if (readOnly) return;
    const check = checkModuleToggleConflict(modules, moduleId, nextEnabled);
    if (!check.allowed) {
      setBlockedReason(check.reason ?? t('templates.editorModuleConflictFallback'));
      return;
    }
    setBlockedReason(null);
    mutation.mutate({ op: 'setModule', moduleId, enabled: nextEnabled });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="simple-modules-tab">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Puzzle className="h-4 w-4 text-primary" />
            <span>{t('templateDetail.modulesTitle')}</span>
          </CardTitle>
          <CardDescription>{t('templateDetail.modulesDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {blockedReason ? (
            <div
              role="alert"
              data-testid="simple-module-conflict-alert"
              className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-danger bg-danger/10 px-3 py-2.5 text-xs text-text"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <span>{blockedReason}</span>
            </div>
          ) : null}

          {detailQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-16" />
              ))}
            </div>
          ) : (
            MODULE_GROUP_DEFINITIONS.map((group) => {
              const groupModules = metadata.filter((mod) => mod.group === group.id).sort((a, b) => a.order - b.order);
              if (groupModules.length === 0) return null;
              return (
                <section key={group.id} data-testid={`module-group-${group.id}`}>
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-text">
                    <span aria-hidden="true">{group.icon}</span>
                    <span>{group.name}</span>
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {groupModules.map((mod) => {
                      const enabled = enabledMap.get(mod.id) ?? false;
                      const availability = describeModuleAvailability(mod.supportedClients, templateClients);
                      const disabledClients = availability.unsupportedClients.map(clientLabel);
                      const conflict = !enabled ? checkModuleToggleConflict(modules, mod.id, true) : null;
                      const conflictHint = conflict && !conflict.allowed ? conflict.reason : null;
                      return (
                        <div
                          key={mod.id}
                          data-testid={`simple-module-${mod.id}`}
                          data-enabled={enabled ? 'true' : 'false'}
                          data-unsupported={availability.supported ? 'false' : 'true'}
                          className={`flex items-start justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-bg p-3 ${
                            availability.supported ? '' : 'opacity-60'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span aria-hidden="true">{mod.icon}</span>
                              <span className="text-sm font-medium text-text">{mod.name}</span>
                              {!availability.supported ? (
                                <Badge variant="outline" data-testid={`simple-module-unsupported-${mod.id}`}>
                                  {t('templateDetail.moduleUnsupported')}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-text-muted">{mod.description}</p>
                            {!availability.supported ? (
                              <p
                                className="mt-1 text-[11px] text-warning"
                                data-testid={`simple-module-unsupported-reason-${mod.id}`}
                              >
                                {t('templateDetail.moduleUnsupportedReason').replace(
                                  '{clients}',
                                  disabledClients.join('、'),
                                )}
                              </p>
                            ) : conflictHint ? (
                              <p
                                className="mt-1 text-[11px] text-warning"
                                data-testid={`simple-module-conflict-hint-${mod.id}`}
                              >
                                {conflictHint}
                              </p>
                            ) : null}
                          </div>
                          <Switch
                            checked={enabled}
                            disabled={readOnly || !availability.supported || mutation.isPending}
                            data-testid={`simple-module-switch-${mod.id}`}
                            aria-label={mod.name}
                            onCheckedChange={(checked) => handleToggle(mod.id, checked)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
