import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Server } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { AppCard } from '../../../shared/schemas/card';
import type {
  TemplateBody,
  TemplateOverlay,
  TemplateOverlayOp,
  TemplateRecord,
} from '../../../shared/schemas/template';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import {
  cardsListQueryOptions,
  invalidatePublications,
  invalidateTemplates,
  publicationsListQueryOptions,
  templateDetailQueryOptions,
} from '../../lib/query';
import { useToast } from '../../lib/toast';
import { NodeSlotBindingsPanel } from '../publications/NodeSlotBindingsPanel';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { appendOverlayOp, resolveDraftBody } from './template-editor-helpers';

const TemplateCanvas = lazy(() => import('./TemplateCanvas').then((m) => ({ default: m.TemplateCanvas })));

type TemplateAdvancedNodesPanelProps = {
  templateId: string;
  readOnly: boolean;
  onGoToOutput: () => void;
};

/**
 * Advanced Nodes view (lazily loaded when "高级编辑" is on):
 * - Multi-slot encrypted bindings via existing `NodeSlotBindingsPanel`
 * - Multi-slot definitions, node filters, region groups, and health check via `TemplateCanvas` (`groups` tab)
 */
export function TemplateAdvancedNodesPanel({ templateId, readOnly, onGoToOutput }: TemplateAdvancedNodesPanelProps) {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const detailQuery = useQuery(templateDetailQueryOptions(templateId));
  const pubsQuery = useQuery(publicationsListQueryOptions({ templateId, limit: 100 }));
  const cardsQuery = useQuery(cardsListQueryOptions({ limit: 200 }));

  const publications = useMemo(() => pubsQuery.data?.publications ?? [], [pubsQuery.data?.publications]);
  const [selectedPubId, setSelectedPubId] = useState<string | null>(null);

  useEffect(() => {
    if (publications.length === 0) {
      setSelectedPubId(null);
      return;
    }
    if (!selectedPubId || !publications.some((p) => p.id === selectedPubId)) {
      setSelectedPubId(publications[0].id);
    }
  }, [publications, selectedPubId]);

  const selectedPub = publications.find((p) => p.id === selectedPubId) ?? publications[0] ?? null;

  const serverTemplate = detailQuery.data?.template;
  const [baseBody, setBaseBody] = useState<TemplateBody | null>(null);
  const [overlay, setOverlay] = useState<TemplateOverlay>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!serverTemplate) return;
    setBaseBody(serverTemplate.baseBody);
    setOverlay(serverTemplate.overlay);
    setDirty(false);
  }, [serverTemplate]);

  const resolvedBody = useMemo(() => {
    if (!baseBody) return null;
    return resolveDraftBody(baseBody, overlay);
  }, [baseBody, overlay]);

  const cardMap = useMemo(() => {
    const cards = cardsQuery.data?.cards ?? [];
    return new Map<string, AppCard>(cards.map((card) => [card.id, card]));
  }, [cardsQuery.data?.cards]);

  const handleApplyOp = (op: TemplateOverlayOp) => {
    if (readOnly) return;
    setOverlay((prev) => appendOverlayOp(prev, op));
    setDirty(true);
  };

  const handleApplyOps = (ops: TemplateOverlayOp[]) => {
    if (readOnly || ops.length === 0) return;
    setOverlay((prev) => ops.reduce((acc, op) => appendOverlayOp(acc, op), prev));
    setDirty(true);
  };

  const saveSlotsMutation = useMutation({
    mutationFn: async () => {
      if (!serverTemplate || !baseBody) throw new Error('Template not loaded');
      return readApiJson<{ template: TemplateRecord; resolvedBody: TemplateBody }>(
        await api.api.templates[':id'].$patch({
          param: { id: serverTemplate.id },
          json: {
            baseBody,
            overlay,
            note: '更新节点槽位与地区组配置',
          },
        }),
      );
    },
    onSuccess: async (data) => {
      setDirty(false);
      await Promise.all([invalidateTemplates(queryClient, data.template.id), invalidatePublications(queryClient)]);
      notify({
        title: `${t('templates.editorSavedToast')} (v${data.template.currentVersion})`,
        variant: 'success',
      });
    },
    onError: (err) => {
      notify({ title: formatApiError(err, locale), variant: 'danger' });
    },
  });

  return (
    <div className="flex flex-col gap-4" data-testid="advanced-nodes-panel">
      {/* Multi-slot subscription bindings per publication */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4 text-primary" />
                <span>{t('publications.nodesTitle')}</span>
              </CardTitle>
              <CardDescription>{t('publications.nodesDesc')}</CardDescription>
            </div>
            {publications.length > 1 ? (
              <div className="flex flex-wrap items-center gap-1.5" data-testid="advanced-nodes-pub-selector">
                {publications.map((pub) => (
                  <Button
                    key={pub.id}
                    size="sm"
                    variant={selectedPub?.id === pub.id ? 'primary' : 'outline'}
                    data-testid={`advanced-nodes-pub-${pub.id}`}
                    onClick={() => setSelectedPubId(pub.id)}
                  >
                    <span className="font-mono text-xs">{pub.slug}</span>
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {selectedPub ? (
            <NodeSlotBindingsPanel
              publication={selectedPub}
              readOnly={readOnly}
              onChanged={async () => {
                await Promise.all([
                  invalidatePublications(queryClient, selectedPub.id),
                  invalidateTemplates(queryClient, templateId),
                ]);
              }}
            />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-dashed border-border p-4 text-xs text-text-muted">
              <span>{t('templateDetail.nodesNoClientError')}</span>
              <Button size="sm" variant="outline" onClick={onGoToOutput}>
                {t('templateDetail.nodesGoAddClient')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Template-level slots, filters, region groups & health check */}
      {resolvedBody ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">{t('templateDetail.advancedNodesConfigTitle')}</CardTitle>
                {dirty ? <Badge variant="warning">{t('templates.editorDirtyBadge')}</Badge> : null}
              </div>
              {!readOnly ? (
                <Button
                  size="sm"
                  data-testid="advanced-nodes-save-btn"
                  disabled={!dirty || saveSlotsMutation.isPending}
                  onClick={() => saveSlotsMutation.mutate()}
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{saveSlotsMutation.isPending ? t('common.loading') : t('templates.editorSaveVersionBtn')}</span>
                </Button>
              ) : null}
            </div>
            <CardDescription>{t('templateDetail.advancedNodesConfigDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<div className="h-64 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />}>
              <TemplateCanvas
                body={resolvedBody}
                cardMap={cardMap}
                activeTab="groups"
                readOnly={readOnly}
                onTabChange={() => {}}
                onApplyOp={handleApplyOp}
                onApplyOps={handleApplyOps}
              />
            </Suspense>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
