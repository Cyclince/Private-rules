import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { apiKeyNoteFormSchema, type ApiKeyNoteFormValues } from '../../../shared/schemas/settings';
import { useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import { apiKeysQueryOptions, invalidateSettings, type ApiKeySummary } from '../../lib/query';
import { useToast } from '../../lib/toast';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';

const DeleteConfirmDialog = lazy(() =>
  import('../rulesets/DeleteConfirmDialog').then((m) => ({ default: m.DeleteConfirmDialog })),
);

function formatTime(iso?: string | null, fallback = '-'): string {
  if (!iso) return fallback;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : fallback;
}

export function ApiKeysTab() {
  const { t, locale } = useI18n();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const keysQuery = useQuery(apiKeysQueryOptions());
  const keys = keysQuery.data?.keys ?? [];

  const [createdSecret, setCreatedSecret] = useState<{ apiKey: string; note: string } | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ApiKeySummary | null>(null);

  const createForm = useForm<ApiKeyNoteFormValues>({
    resolver: zodResolver(apiKeyNoteFormSchema),
    defaultValues: { note: '' },
  });

  const createMutation = useMutation({
    mutationFn: async (values: ApiKeyNoteFormValues) =>
      readApiJson<{ id: string; apiKey: string; note: string; keyPrefix: string }>(
        await api.api['api-keys'].$post({ json: { note: values.note.trim() } }),
      ),
    onSuccess: async (payload) => {
      setCreatedSecret({ apiKey: payload.apiKey, note: payload.note });
      setCopiedSecret(false);
      createForm.reset({ note: '' });
      await invalidateSettings(queryClient);
      notify({ title: t('apiKeys.createdToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async (args: { id: string; note: string }) =>
      readApiJson(
        await api.api['api-keys'][':id'].$patch({
          param: { id: args.id },
          json: { note: args.note.trim() },
        }),
      ),
    onSuccess: async () => {
      setEditingId(null);
      await invalidateSettings(queryClient);
      notify({ title: t('apiKeys.noteUpdated'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => readApiJson(await api.api['api-keys'][':id'].$delete({ param: { id } })),
    onSuccess: async () => {
      setDeleteTarget(null);
      await invalidateSettings(queryClient);
      notify({ title: t('apiKeys.deletedToast'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const copySecret = async () => {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret.apiKey);
      setCopiedSecret(true);
      notify({ title: t('common.copied'), variant: 'success' });
    } catch {
      notify({ title: t('links.copyFailed'), variant: 'danger' });
    }
  };

  return (
    <Card data-testid="settings-api-keys-tab">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <span>{t('apiKeys.title')}</span>
        </CardTitle>
        <CardDescription>{t('apiKeys.desc')}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <form
          onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <Input
            data-testid="api-key-note-input"
            placeholder={t('apiKeys.notePlaceholder')}
            className="flex-1"
            {...createForm.register('note')}
          />
          <Button type="submit" size="sm" data-testid="api-key-create-btn" disabled={createMutation.isPending}>
            <Plus className="h-4 w-4" />
            <span>{createMutation.isPending ? t('common.loading') : t('apiKeys.createBtn')}</span>
          </Button>
        </form>

        {createdSecret ? (
          <div
            data-testid="api-key-secret-once"
            className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-warning bg-surface-muted p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-warning">{t('apiKeys.createdOnceTitle')}</span>
              <Button size="sm" variant="ghost" onClick={() => setCreatedSecret(null)}>
                {t('common.close')}
              </Button>
            </div>
            <p className="text-xs text-text-muted">{t('apiKeys.createdOnceDesc')}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code
                data-testid="api-key-plaintext"
                className="flex-1 break-all rounded-[var(--radius-sm)] bg-surface px-3 py-2 font-mono text-xs text-text"
              >
                {createdSecret.apiKey}
              </code>
              <Button size="sm" variant="secondary" data-testid="api-key-copy-secret" onClick={() => void copySecret()}>
                {copiedSecret ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedSecret ? t('common.copied') : t('common.copy')}</span>
              </Button>
            </div>
          </div>
        ) : null}

        {keysQuery.isLoading ? (
          <div className="h-20 animate-pulse rounded bg-surface-muted" />
        ) : keys.length === 0 ? (
          <div
            data-testid="api-keys-empty"
            className="rounded-[var(--radius-md)] border border-border bg-surface-muted/40 py-8 text-center text-sm text-text-muted"
          >
            {t('apiKeys.empty')}
          </div>
        ) : (
          <div
            className="flex flex-col divide-y divide-border rounded-[var(--radius-md)] border border-border"
            data-testid="api-keys-list"
          >
            {keys.map((key) => {
              const isEditing = editingId === key.id;
              return (
                <div
                  key={key.id}
                  data-testid={`api-key-row-${key.id}`}
                  className="flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        {key.keyPrefix}
                      </Badge>
                      {isEditing ? (
                        <div className="flex flex-1 flex-wrap items-center gap-1.5">
                          <Input
                            data-testid={`api-key-edit-input-${key.id}`}
                            value={editingNote}
                            onChange={(event) => setEditingNote(event.target.value)}
                            className="h-8 max-w-xs text-xs"
                          />
                          <Button
                            size="sm"
                            data-testid={`api-key-edit-save-${key.id}`}
                            disabled={updateNoteMutation.isPending}
                            onClick={() => updateNoteMutation.mutate({ id: key.id, note: editingNote })}
                          >
                            {t('common.save')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                            {t('common.cancel')}
                          </Button>
                        </div>
                      ) : (
                        <span className="truncate text-sm font-medium" data-testid={`api-key-note-${key.id}`}>
                          {key.note || '-'}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-text-muted">
                      <span>
                        {t('apiKeys.createdAt')}: {formatTime(key.createdAt)}
                      </span>
                      <span>
                        {t('apiKeys.lastUsed')}: {formatTime(key.lastUsedAt, t('apiKeys.neverUsed'))}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-1.5">
                    {!isEditing ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('common.edit')}
                        data-testid={`api-key-edit-btn-${key.id}`}
                        onClick={() => {
                          setEditingId(key.id);
                          setEditingNote(key.note);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('common.delete')}
                      data-testid={`api-key-delete-btn-${key.id}`}
                      onClick={() => setDeleteTarget(key)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Suspense fallback={null}>
        {deleteTarget ? (
          <DeleteConfirmDialog
            open={Boolean(deleteTarget)}
            title={t('apiKeys.deleteConfirmTitle')}
            description={t('apiKeys.deleteConfirmBody')}
            itemName={`${deleteTarget.keyPrefix} (${deleteTarget.note || deleteTarget.id})`}
            submitting={deleteMutation.isPending}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            onConfirm={async () => {
              await deleteMutation.mutateAsync(deleteTarget.id);
            }}
          />
        ) : null}
      </Suspense>
    </Card>
  );
}
