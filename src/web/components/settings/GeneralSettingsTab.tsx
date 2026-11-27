import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Monitor, Moon, RefreshCw, ShieldAlert, Sparkles, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  settingsFormSchema,
  telegramNotificationFormSchema,
  type SettingsFormValues,
  type TelegramNotificationFormValues,
} from '../../../shared/schemas/settings';
import type { ManualRuleOptimizationPreview } from '../../../types/domain-rules';
import { SUPPORTED_LOCALES, useI18n } from '../../i18n';
import { api, formatApiError, readApiJson } from '../../lib/api';
import {
  invalidateRulesets,
  invalidateSettings,
  settingsDetailQueryOptions,
  telegramAuditLogsQueryOptions,
  telegramNotificationsQueryOptions,
} from '../../lib/query';
import { useToast } from '../../lib/toast';
import { useTheme, type ThemePreference } from '../../theme/ThemeProvider';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';

type GeneralSettingsTabProps = {
  inTelegram: boolean;
};

function formatTime(iso?: string | null): string {
  if (!iso) return '-';
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : '-';
}

export function GeneralSettingsTab({ inTelegram }: GeneralSettingsTabProps) {
  const { t, locale, setLocale } = useI18n();
  const { themePreference, setThemePreference } = useTheme();
  const { notify } = useToast();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery(settingsDetailQueryOptions());
  const tgNotifyQuery = useQuery({
    ...telegramNotificationsQueryOptions(),
    enabled: !inTelegram,
  });
  const tgAuditQuery = useQuery({
    ...telegramAuditLogsQueryOptions(30),
    enabled: !inTelegram,
  });

  const [optPreview, setOptPreview] = useState<ManualRuleOptimizationPreview | null>(null);
  const [optLoading, setOptLoading] = useState(false);

  const settingsForm = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      baseUrl: '',
      policyName: '',
      githubMirrorUrl: '',
      publicLinksEnabled: true,
      tokenLinksEnabled: true,
      customIconPackUrlsText: '',
      iconPackAutoUpdate: true,
      iconPackUpdateIntervalHours: 24,
    },
  });

  const tgForm = useForm<TelegramNotificationFormValues>({
    resolver: zodResolver(telegramNotificationFormSchema),
    defaultValues: {
      mode: 'off',
      muted: false,
      digestTime: '09:00',
      syncFailed: true,
      syncCompleted: false,
      securityAlerts: true,
    },
  });

  useEffect(() => {
    const s = settingsQuery.data?.settings;
    if (!s) return;
    settingsForm.reset({
      baseUrl: s.baseUrl ?? '',
      policyName: s.policyName ?? '',
      githubMirrorUrl: s.githubMirrorUrl ?? '',
      publicLinksEnabled: s.publicLinksEnabled,
      tokenLinksEnabled: s.tokenLinksEnabled,
      customIconPackUrlsText: (s.customIconPackUrls ?? []).join('\n'),
      iconPackAutoUpdate: s.iconPackAutoUpdate,
      iconPackUpdateIntervalHours: s.iconPackUpdateIntervalHours || 24,
    });
  }, [settingsQuery.data, settingsForm]);

  useEffect(() => {
    const p = tgNotifyQuery.data?.preferences;
    if (!p) return;
    tgForm.reset({
      mode: p.mode,
      muted: Boolean(p.muted),
      digestTime: p.digestTime || '09:00',
      syncFailed: p.syncFailed !== false,
      syncCompleted: Boolean(p.syncCompleted),
      securityAlerts: p.securityAlerts !== false,
    });
  }, [tgNotifyQuery.data, tgForm]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (values: SettingsFormValues) => {
      const payload = inTelegram
        ? {
            policyName: values.policyName.trim(),
            iconPackAutoUpdate: values.iconPackAutoUpdate,
            iconPackUpdateIntervalHours: values.iconPackUpdateIntervalHours,
          }
        : {
            baseUrl: values.baseUrl.trim(),
            policyName: values.policyName.trim(),
            githubMirrorUrl: values.githubMirrorUrl.trim(),
            publicLinksEnabled: values.publicLinksEnabled,
            tokenLinksEnabled: values.tokenLinksEnabled,
            customIconPackUrls: values.customIconPackUrlsText
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean),
            iconPackAutoUpdate: values.iconPackAutoUpdate,
            iconPackUpdateIntervalHours: values.iconPackUpdateIntervalHours,
          };
      return readApiJson(await api.api.settings.$patch({ json: payload }));
    },
    onSuccess: async () => {
      await Promise.all([invalidateSettings(queryClient), invalidateRulesets(queryClient)]);
      notify({ title: t('settings.saved'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const refreshIconPacksMutation = useMutation({
    mutationFn: async () =>
      readApiJson<{ results: Array<{ ok: boolean; count: number }> }>(await api.api['icon-packs'].refresh.$post()),
    onSuccess: async (payload) => {
      await invalidateSettings(queryClient);
      const okCount = payload.results.filter((item) => item.ok).length;
      notify({
        title: t('settings.iconPackRefreshed'),
        description: `${okCount}/${payload.results.length}`,
        variant: 'success',
      });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const handlePreviewOptimization = async () => {
    setOptLoading(true);
    try {
      const payload = await readApiJson<{ preview: ManualRuleOptimizationPreview }>(
        await api.api.settings['manual-rule-optimization'].$get(),
      );
      setOptPreview(payload.preview);
    } catch (error) {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    } finally {
      setOptLoading(false);
    }
  };

  const executeOptimizationMutation = useMutation({
    mutationFn: async () =>
      readApiJson<{ preview: ManualRuleOptimizationPreview }>(
        await api.api.settings['manual-rule-optimization'].$post(),
      ),
    onSuccess: async (payload) => {
      setOptPreview(payload.preview);
      await invalidateRulesets(queryClient);
      notify({
        title: t('settings.optDone'),
        description: `${payload.preview.removals.length} ${t('rules.unitItems')}`,
        variant: 'success',
      });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const saveTgNotifyMutation = useMutation({
    mutationFn: async (values: TelegramNotificationFormValues) =>
      readApiJson(await api.api.telegram.notifications.$put({ json: values })),
    onSuccess: async () => {
      await invalidateSettings(queryClient);
      notify({ title: t('settings.tgNotifySaved'), variant: 'success' });
    },
    onError: (error) => {
      notify({ title: formatApiError(error, locale), variant: 'danger' });
    },
  });

  const themeOptions: ReadonlyArray<{ id: ThemePreference; label: string; Icon: typeof Monitor }> = [
    { id: 'system', label: t('theme.system'), Icon: Monitor },
    { id: 'light', label: t('theme.light'), Icon: Sun },
    { id: 'dark', label: t('theme.dark'), Icon: Moon },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="settings-general-tab">
      <Card data-testid="settings-appearance-card">
        <CardHeader>
          <CardTitle>{t('settings.appearanceCardTitle')}</CardTitle>
          <CardDescription>{t('settings.appearanceCardDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text">
              <Globe className="h-3.5 w-3.5 text-text-muted" />
              {t('lang.label')}
            </span>
            <div
              role="radiogroup"
              aria-label={t('lang.label')}
              data-testid="settings-locale-group"
              className="grid grid-cols-3 gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-1"
            >
              {SUPPORTED_LOCALES.map((item) => {
                const active = locale === item;
                return (
                  <button
                    key={item}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    data-testid={`settings-locale-${item}`}
                    onClick={() => setLocale(item)}
                    className={`cursor-pointer rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-primary ${
                      active
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-text-muted hover:bg-surface hover:text-text'
                    }`}
                  >
                    {t(`lang.${item}`)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text">
              <Monitor className="h-3.5 w-3.5 text-text-muted" />
              {t('theme.label')}
            </span>
            {inTelegram ? (
              <div
                data-testid="settings-theme-telegram-note"
                className="flex min-h-[38px] items-center rounded-[var(--radius-md)] border border-border bg-surface-muted/60 px-3 py-2 text-xs text-text-muted"
              >
                {t('theme.telegramManaged')}
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-label={t('theme.label')}
                data-testid="settings-theme-group"
                className="grid grid-cols-3 gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 p-1"
              >
                {themeOptions.map(({ id, label, Icon }) => {
                  const active = themePreference === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-testid={`settings-theme-${id}`}
                      onClick={() => setThemePreference(id)}
                      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-primary ${
                        active
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-text-muted hover:bg-surface hover:text-text'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.generalCardTitle')}</CardTitle>
          <CardDescription>{t('settings.generalCardDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {inTelegram ? (
            <div
              data-testid="settings-telegram-infra-hidden"
              className="mb-4 flex items-start gap-2 rounded-[var(--radius-sm)] border border-warning/40 bg-surface-muted px-3 py-2 text-xs text-text-muted"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{t('settings.infraHiddenInTelegram')}</span>
            </div>
          ) : null}

          <form
            onSubmit={settingsForm.handleSubmit((values) => saveSettingsMutation.mutate(values))}
            className="flex flex-col gap-4"
            noValidate
          >
            {!inTelegram ? (
              <div className="grid gap-4 sm:grid-cols-2" data-testid="settings-infra-fields">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="settings-base-url" className="text-xs font-medium">
                    {t('settings.baseUrl')}
                  </label>
                  <Input
                    id="settings-base-url"
                    data-testid="settings-base-url"
                    placeholder={t('settings.baseUrlPlaceholder')}
                    className="font-mono text-xs"
                    {...settingsForm.register('baseUrl')}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="settings-gh-mirror" className="text-xs font-medium">
                    {t('settings.githubMirrorUrl')}
                  </label>
                  <Input
                    id="settings-gh-mirror"
                    data-testid="settings-github-mirror"
                    placeholder={t('settings.githubMirrorPlaceholder')}
                    className="font-mono text-xs"
                    {...settingsForm.register('githubMirrorUrl')}
                  />
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="settings-policy-name" className="text-xs font-medium">
                  {t('settings.policyName')}
                </label>
                <Input
                  id="settings-policy-name"
                  data-testid="settings-policy-name"
                  placeholder={t('settings.policyNamePlaceholder')}
                  {...settingsForm.register('policyName')}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="settings-icon-interval" className="text-xs font-medium">
                  {t('settings.iconPackInterval')}
                </label>
                <Input
                  id="settings-icon-interval"
                  type="number"
                  min={1}
                  max={720}
                  data-testid="settings-icon-interval"
                  {...settingsForm.register('iconPackUpdateIntervalHours', { valueAsNumber: true })}
                />
              </div>
            </div>

            {!inTelegram ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="settings-icon-urls" className="text-xs font-medium">
                  {t('settings.customIconPackUrls')}
                </label>
                <textarea
                  id="settings-icon-urls"
                  rows={3}
                  data-testid="settings-icon-urls"
                  placeholder={t('settings.customIconPackPlaceholder')}
                  {...settingsForm.register('customIconPackUrlsText')}
                  className="w-full rounded-[var(--radius-sm)] border border-border bg-surface p-2.5 font-mono text-xs text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-primary"
                />
              </div>
            ) : null}

            <div className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface-muted/50 p-3">
              {!inTelegram ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{t('settings.publicLinksDefault')}</span>
                    <Controller
                      control={settingsForm.control}
                      name="publicLinksEnabled"
                      render={({ field }) => (
                        <Switch
                          data-testid="settings-public-default"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{t('settings.tokenLinksDefault')}</span>
                    <Controller
                      control={settingsForm.control}
                      name="tokenLinksEnabled"
                      render={({ field }) => (
                        <Switch
                          data-testid="settings-token-default"
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    />
                  </div>
                </>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{t('settings.iconPackAutoUpdate')}</span>
                <Controller
                  control={settingsForm.control}
                  name="iconPackAutoUpdate"
                  render={({ field }) => (
                    <Switch data-testid="settings-icon-auto" checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                {!inTelegram ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid="settings-refresh-icons-btn"
                      disabled={refreshIconPacksMutation.isPending}
                      onClick={() => refreshIconPacksMutation.mutate()}
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${refreshIconPacksMutation.isPending ? 'animate-spin' : ''}`}
                      />
                      <span>{t('settings.iconPackRefresh')}</span>
                    </Button>
                    <span>
                      {t('settings.iconPackLastUpdated')}:{' '}
                      {formatTime(settingsQuery.data?.settings.iconPackLastUpdatedAt)}
                    </span>
                  </>
                ) : null}
              </div>
              <Button type="submit" size="sm" data-testid="settings-save-btn" disabled={saveSettingsMutation.isPending}>
                {saveSettingsMutation.isPending ? t('common.loading') : t('common.save')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {!inTelegram ? (
        <>
          {/* Manual Rule Optimization */}
          <Card data-testid="settings-optimization-card">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span>{t('settings.optCardTitle')}</span>
                </CardTitle>
                <CardDescription>{t('settings.optCardDesc')}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="settings-opt-preview-btn"
                  disabled={optLoading}
                  onClick={() => void handlePreviewOptimization()}
                >
                  {optLoading ? t('common.loading') : t('settings.optPreview')}
                </Button>
                <Button
                  size="sm"
                  data-testid="settings-opt-execute-btn"
                  disabled={executeOptimizationMutation.isPending || !optPreview || optPreview.removals.length === 0}
                  onClick={() => executeOptimizationMutation.mutate()}
                >
                  {executeOptimizationMutation.isPending ? t('common.loading') : t('settings.optExecute')}
                </Button>
              </div>
            </CardHeader>
            {optPreview ? (
              <CardContent className="flex flex-col gap-3" data-testid="settings-opt-result">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-[var(--radius-sm)] border border-border bg-surface-muted p-2.5">
                    <div className="text-[11px] text-text-muted">{t('settings.optScanned')}</div>
                    <div className="text-lg font-bold">{optPreview.scanned}</div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] border border-border bg-surface-muted p-2.5">
                    <div className="text-[11px] text-text-muted">{t('settings.optRemovable')}</div>
                    <div className="text-lg font-bold text-warning">{optPreview.removals.length}</div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] border border-border bg-surface-muted p-2.5">
                    <div className="text-[11px] text-text-muted">{t('settings.optRemaining')}</div>
                    <div className="text-lg font-bold">{optPreview.remaining}</div>
                  </div>
                </div>
                {optPreview.removals.length === 0 ? (
                  <p className="text-xs text-text-muted">{t('settings.optNone')}</p>
                ) : (
                  <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded border border-border text-xs">
                    {optPreview.removals.slice(0, 30).map((item) => (
                      <li key={item.rule.id} className="px-3 py-2">
                        <div className="font-mono">
                          {item.rule.type},{item.rule.value} ← {item.keptRule.type},{item.keptRule.value}
                        </div>
                        <div className="text-[11px] text-text-muted">
                          {item.categoryName} · {item.reason}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            ) : null}
          </Card>

          {/* Telegram Notifications */}
          <Card data-testid="settings-telegram-notify-card">
            <CardHeader>
              <CardTitle>{t('settings.tgNotifyTitle')}</CardTitle>
              <CardDescription>{t('settings.tgNotifyDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {tgNotifyQuery.data && !tgNotifyQuery.data.enabled ? (
                <p className="text-xs text-text-muted">{t('settings.tgNotConfigured')}</p>
              ) : (
                <form
                  onSubmit={tgForm.handleSubmit((values) => saveTgNotifyMutation.mutate(values))}
                  className="flex flex-col gap-3"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="tg-mode" className="text-xs font-medium">
                        {t('settings.tgMode')}
                      </label>
                      <select
                        id="tg-mode"
                        data-testid="settings-tg-mode"
                        {...tgForm.register('mode')}
                        className="flex h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <option value="immediate">{t('settings.tgModeImmediate')}</option>
                        <option value="digest">{t('settings.tgModeDigest')}</option>
                        <option value="off">{t('settings.tgModeOff')}</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="tg-digest-time" className="text-xs font-medium">
                        {t('settings.tgDigestTime')}
                      </label>
                      <Input
                        id="tg-digest-time"
                        data-testid="settings-tg-digest-time"
                        placeholder="09:00"
                        {...tgForm.register('digestTime')}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/50 p-3 sm:grid-cols-2">
                    {(
                      [
                        ['muted', 'settings.tgMuted'],
                        ['syncFailed', 'settings.tgSyncFailed'],
                        ['syncCompleted', 'settings.tgSyncCompleted'],
                        ['securityAlerts', 'settings.tgSecurityAlerts'],
                      ] as const
                    ).map(([fieldName, labelKey]) => (
                      <div key={fieldName} className="flex items-center justify-between gap-2">
                        <span className="text-xs">{t(labelKey)}</span>
                        <Controller
                          control={tgForm.control}
                          name={fieldName}
                          render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      size="sm"
                      data-testid="settings-tg-save-btn"
                      disabled={saveTgNotifyMutation.isPending}
                    >
                      {saveTgNotifyMutation.isPending ? t('common.loading') : t('common.save')}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          {/* Telegram Audit Logs */}
          <Card data-testid="settings-telegram-audit-card">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>{t('settings.tgAuditTitle')}</CardTitle>
                <CardDescription>{t('settings.tgAuditDesc')}</CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                data-testid="settings-tg-audit-refresh"
                onClick={() => void tgAuditQuery.refetch()}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${tgAuditQuery.isFetching ? 'animate-spin' : ''}`} />
                <span>{t('common.refresh')}</span>
              </Button>
            </CardHeader>
            <CardContent>
              {tgAuditQuery.isLoading ? (
                <div className="h-16 animate-pulse rounded bg-surface-muted" />
              ) : (tgAuditQuery.data?.logs.length ?? 0) === 0 ? (
                <p className="text-xs text-text-muted">{t('settings.tgAuditEmpty')}</p>
              ) : (
                <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-[var(--radius-md)] border border-border">
                  {tgAuditQuery.data!.logs.map((log) => (
                    <div
                      key={log.id}
                      className="flex flex-col gap-1 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant={
                              log.result === 'denied' || log.result === 'failure'
                                ? 'danger'
                                : log.result === 'success'
                                  ? 'success'
                                  : 'outline'
                            }
                          >
                            {log.result}
                          </Badge>
                          <span className="break-all font-mono">{log.action}</span>
                        </div>
                        {log.summary ? <div className="mt-0.5 text-[11px] text-text-muted">{log.summary}</div> : null}
                      </div>
                      <span className="shrink-0 text-[11px] text-text-muted">{formatTime(log.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
