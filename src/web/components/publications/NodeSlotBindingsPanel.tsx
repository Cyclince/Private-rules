import { useMutation } from '@tanstack/react-query';
import { KeyRound, Lock, RefreshCw, Server, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { MaskedNodeBinding } from '../../../application/publications';
import type { PublicationWithLinks } from '../../../server/routes/publications';
import type { NodeSlot } from '../../../shared/schemas/template';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

type NodeSlotBindingsPanelProps = {
  publication: PublicationWithLinks;
  readOnly: boolean;
  onChanged: () => Promise<void>;
};

function NodeSlotCard({
  publication,
  slot,
  binding,
  readOnly,
  onChanged,
}: {
  publication: PublicationWithLinks;
  slot: NodeSlot;
  binding?: MaskedNodeBinding;
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const { notify } = useToast();

  const [replacing, setReplacing] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [uaInput, setUaInput] = useState(binding?.userAgent ?? '');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [fetchedNames, setFetchedNames] = useState<string[] | null>(null);

  const isPublic = publication.access === 'public';
  const bindDisabled = readOnly || isPublic;

  const upsertMutation = useMutation({
    mutationFn: async (payload: { subscriptionUrl: string; userAgent?: string | null }) =>
      readApiJson<{ binding: MaskedNodeBinding }>(
        await api.api.publications[':id'].slots[':slotId'].$put({
          param: { id: publication.id, slotId: slot.id },
          json: payload,
        }),
      ),
    onSuccess: async () => {
      // Immediately scrub plaintext subscription URL from client state / DOM
      setUrlInput('');
      setUrlError(null);
      setReplacing(false);
      await onChanged();
      notify({ title: t('publications.slotBoundToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () =>
      readApiJson(
        await api.api.publications[':id'].slots[':slotId'].$delete({
          param: { id: publication.id, slotId: slot.id },
        }),
      ),
    onSuccess: async () => {
      setUrlInput('');
      setUaInput('');
      setReplacing(false);
      setFetchedNames(null);
      await onChanged();
      notify({ title: t('publications.slotRemovedToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const fetchNamesMutation = useMutation({
    mutationFn: async () =>
      readApiJson<{ slotId: string; nodeNames: string[]; count: number; fetchedAt: string }>(
        await api.api.publications[':id'].slots[':slotId']['fetch-names'].$post({
          param: { id: publication.id, slotId: slot.id },
        }),
      ),
    onSuccess: async (data) => {
      setFetchedNames(data.nodeNames);
      await onChanged();
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError(t('publications.slotUrlRequired'));
      return;
    }
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setUrlError(t('publications.slotUrlRequired'));
        return;
      }
    } catch {
      setUrlError(t('publications.slotUrlRequired'));
      return;
    }
    setUrlError(null);
    upsertMutation.mutate({
      subscriptionUrl: trimmed,
      userAgent: uaInput.trim() || null,
    });
  };

  const showForm = !binding || replacing;

  return (
    <div
      data-testid={`node-slot-${slot.id}`}
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Server className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-sm font-semibold text-text">{slot.name}</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {slot.id}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          {binding ? (
            binding.needsRebind ? (
              <Badge variant="warning" data-testid={`node-slot-rebind-${slot.id}`}>
                {t('publications.slotNeedsRebind')}
              </Badge>
            ) : (
              <Badge variant="success" data-testid={`node-slot-status-${slot.id}`}>
                {t('publications.slotBound')}
              </Badge>
            )
          ) : (
            <Badge variant="outline" data-testid={`node-slot-status-${slot.id}`}>
              {t('publications.slotUnbound')}
            </Badge>
          )}
        </div>
      </div>

      {binding && !replacing ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-border bg-surface-muted/60 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
              <Lock className="h-3.5 w-3.5 text-primary" />
              <span>{t('publications.slotMaskedLabel')}</span>
            </div>
            <code
              data-testid={`node-slot-masked-${slot.id}`}
              className="break-all font-mono text-xs font-medium text-text"
            >
              {binding.maskedUrl}
            </code>
            <p className="text-[11px] text-text-muted">{t('publications.slotWriteOnlyHint')}</p>
            {binding.userAgent ? (
              <div className="mt-1 font-mono text-[11px] text-text-muted">User-Agent: {binding.userAgent}</div>
            ) : null}
            {typeof binding.lastNodeCount === 'number' ? (
              <div className="text-[11px] text-text-muted">
                {t('publications.slotFetchedNodes')}: {binding.lastNodeCount}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={bindDisabled}
              data-testid={`node-slot-replace-${slot.id}`}
              onClick={() => {
                setUrlInput('');
                setUaInput(binding.userAgent ?? '');
                setReplacing(true);
              }}
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>{t('publications.slotReplaceBtn')}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={readOnly || fetchNamesMutation.isPending}
              data-testid={`node-slot-fetch-names-${slot.id}`}
              onClick={() => fetchNamesMutation.mutate()}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${fetchNamesMutation.isPending ? 'animate-spin' : ''}`} />
              <span>
                {fetchNamesMutation.isPending
                  ? t('publications.slotFetchingNames')
                  : t('publications.slotFetchNamesBtn')}
              </span>
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={readOnly || removeMutation.isPending}
              data-testid={`node-slot-remove-${slot.id}`}
              onClick={() => removeMutation.mutate()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{t('publications.slotRemoveBtn')}</span>
            </Button>
          </div>

          {fetchedNames && fetchedNames.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface-muted/40 p-2.5">
              {fetchedNames.slice(0, 30).map((nodeName, idx) => (
                <Badge key={`${nodeName}-${idx}`} variant="outline" className="text-[11px]">
                  {nodeName}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {showForm ? (
        <form onSubmit={handleSave} className="flex flex-col gap-2.5" noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor={`slot-url-${slot.id}`} className="text-xs font-medium text-text">
              {t('publications.slotUrlLabel')}
            </label>
            <Input
              id={`slot-url-${slot.id}`}
              type="password"
              autoComplete="new-password"
              data-testid={`node-slot-url-${slot.id}`}
              disabled={bindDisabled || upsertMutation.isPending}
              value={urlInput}
              onChange={(event) => {
                setUrlInput(event.target.value);
                if (urlError) setUrlError(null);
              }}
              placeholder={t('publications.slotUrlPlaceholder')}
            />
            {urlError ? (
              <p className="text-xs text-danger" role="alert">
                {urlError}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`slot-ua-${slot.id}`} className="text-xs font-medium text-text-muted">
              {t('publications.slotUaLabel')}
            </label>
            <Input
              id={`slot-ua-${slot.id}`}
              data-testid={`node-slot-ua-${slot.id}`}
              disabled={bindDisabled || upsertMutation.isPending}
              value={uaInput}
              onChange={(event) => setUaInput(event.target.value)}
              placeholder={t('publications.slotUaPlaceholder')}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={bindDisabled || upsertMutation.isPending}
              data-testid={`node-slot-save-${slot.id}`}
            >
              <Lock className="h-3.5 w-3.5" />
              <span>{upsertMutation.isPending ? t('common.loading') : t('publications.slotBindBtn')}</span>
            </Button>
            {replacing ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setUrlInput('');
                  setUrlError(null);
                  setReplacing(false);
                }}
              >
                {t('publications.slotCancelReplace')}
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function NodeSlotBindingsPanel({ publication, readOnly, onChanged }: NodeSlotBindingsPanelProps) {
  const { t } = useI18n();
  const bindingBySlot = new Map(publication.bindings.map((b) => [b.slotId, b]));

  return (
    <div data-testid="node-slots-panel" className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-text">{t('publications.nodesTitle')}</h3>
        <p className="text-xs text-text-muted">{t('publications.nodesDesc')}</p>
      </div>

      {publication.access === 'public' ? (
        <div
          data-testid="node-binding-public-blocked"
          className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warning/50 bg-surface-muted p-3 text-xs text-text-muted"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>{t('publications.nodesPublicBlocked')}</span>
        </div>
      ) : null}

      {publication.slots.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-border bg-surface-muted/40 p-4 text-xs text-text-muted">
          {t('publications.nodesEmpty')}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {publication.slots.map((slot) => (
            <NodeSlotCard
              key={slot.id}
              publication={publication}
              slot={slot}
              binding={bindingBySlot.get(slot.id)}
              readOnly={readOnly}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}
