import { Check, Database, Globe, Link2, PenLine, Plus, Search, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { CatalogItem, ListCatalogResult } from '../../../application/catalog';
import { validateCategoryName } from '../../../domain/rules/slug';
import type { GeoSourceSuggestion, RuleCategory, RuleOptimizationMode } from '../../../types/domain-rules';
import { useI18n } from '../../i18n';
import { api, readApiJson } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { IconPicker } from './IconPicker';
import { SYNC_INTERVAL_OPTIONS, splitNonEmptyLines } from './rule-library-helpers';

const DEFAULT_USER_AGENT = 'clash-verge/v2.5.1';

export type CreateRuleCategoryInput = {
  name: string;
  description: string;
  icon: string;
  mode: 'manual' | 'upstream';
  sourceUrls: string[];
  geositeNames: string[];
  geoipNames: string[];
  syncIntervalMinutes: number;
  userAgent: string;
  ruleOptimization: RuleOptimizationMode;
  tokenLinksEnabled: boolean;
  publicLinksEnabled: boolean;
};

export type EditRuleCategoryInput = {
  name: string;
  description: string;
  icon: string;
};

type RuleCategoryDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: RuleCategory | null;
  customIconPackUrls?: string[];
  customIconPackNames?: Record<string, string>;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate?: (input: CreateRuleCategoryInput) => Promise<void> | void;
  onEdit?: (input: EditRuleCategoryInput) => Promise<void> | void;
};

type CreateStartMode = 'manual' | 'upstream';
type UpstreamKind = 'url' | 'geo' | 'community';

function OptimizationPicker({
  value,
  onChange,
}: {
  value: RuleOptimizationMode;
  onChange: (next: RuleOptimizationMode) => void;
}) {
  const { t } = useI18n();
  const options: ReadonlyArray<{ value: RuleOptimizationMode; title: string; description: string }> = [
    { value: 'none', title: t('ruleDialog.optNoneTitle'), description: t('ruleDialog.optNoneDesc') },
    {
      value: 'conservative',
      title: t('ruleDialog.optConservativeTitle'),
      description: t('ruleDialog.optConservativeDesc'),
    },
    { value: 'aggressive', title: t('ruleDialog.optAggressiveTitle'), description: t('ruleDialog.optAggressiveDesc') },
  ];

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium text-text">{t('ruleDialog.optLegend')}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              data-testid={`create-opt-${option.value}`}
              className={`flex cursor-pointer items-start gap-2 rounded-[var(--radius-md)] border p-2.5 transition-colors ${
                selected
                  ? 'border-primary bg-primary/8 text-text'
                  : 'border-border bg-surface text-text hover:bg-surface-muted/60'
              }`}
            >
              <input
                type="radio"
                name="rule-optimization"
                checked={selected}
                onChange={() => onChange(option.value)}
                className="mt-0.5 accent-primary"
              />
              <span className="min-w-0 flex-1">
                <strong className="block text-xs font-semibold text-text">{option.title}</strong>
                <small className="mt-0.5 block text-[11px] leading-snug text-text-muted">{option.description}</small>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function RuleCategoryDialog({
  open,
  mode,
  initial,
  customIconPackUrls = [],
  customIconPackNames = {},
  submitting,
  onOpenChange,
  onCreate,
  onEdit,
}: RuleCategoryDialogProps) {
  const { t } = useI18n();

  const [createMode, setCreateMode] = useState<CreateStartMode>('manual');
  const [upstreamKind, setUpstreamKind] = useState<UpstreamKind>('url');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [sourceUrlsText, setSourceUrlsText] = useState('');
  const [userAgent, setUserAgent] = useState(DEFAULT_USER_AGENT);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(60);
  const [ruleOptimization, setRuleOptimization] = useState<RuleOptimizationMode>('none');

  // Geo database search state
  const [geoQuery, setGeoQuery] = useState('');
  const [geoResults, setGeoResults] = useState<GeoSourceSuggestion[]>([]);
  const [geoSearching, setGeoSearching] = useState(false);
  const [selectedGeosites, setSelectedGeosites] = useState<string[]>([]);
  const [selectedGeoips, setSelectedGeoips] = useState<string[]>([]);

  // Community rules search state (reusing /api/catalog?kind=builtin)
  const [communityQuery, setCommunityQuery] = useState('');
  const [communityResults, setCommunityResults] = useState<CatalogItem[]>([]);
  const [communitySearching, setCommunitySearching] = useState(false);
  const [selectedCommunity, setSelectedCommunity] = useState<CatalogItem[]>([]);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initial) {
      setName(initial.name);
      setDescription(initial.description ?? '');
      setIcon(initial.icon ?? '');
    } else {
      setCreateMode('manual');
      setUpstreamKind('url');
      setName('');
      setDescription('');
      setIcon('');
      setSourceUrlsText('');
      setUserAgent(DEFAULT_USER_AGENT);
      setSyncIntervalMinutes(60);
      setRuleOptimization('none');
      setGeoQuery('');
      setGeoResults([]);
      setSelectedGeosites([]);
      setSelectedGeoips([]);
      setCommunityQuery('');
      setCommunityResults([]);
      setSelectedCommunity([]);
    }
  }, [open, mode, initial]);

  // Debounced GeoSite / GeoIP search
  useEffect(() => {
    if (!open || mode !== 'create' || createMode !== 'upstream' || upstreamKind !== 'geo') {
      return;
    }
    const trimmed = geoQuery.trim();
    if (trimmed.length < 2) {
      setGeoResults([]);
      setGeoSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setGeoSearching(true);
      void (async () => {
        try {
          const payload = await readApiJson<{ results: GeoSourceSuggestion[] }>(
            await api.api.geo.search.$get({ query: { q: trimmed } }),
          );
          if (!cancelled) setGeoResults(payload.results ?? []);
        } catch {
          if (!cancelled) setGeoResults([]);
        } finally {
          if (!cancelled) setGeoSearching(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, mode, createMode, upstreamKind, geoQuery]);

  // Debounced community rules search (reuses /api/catalog?kind=builtin)
  useEffect(() => {
    if (!open || mode !== 'create' || createMode !== 'upstream' || upstreamKind !== 'community') {
      return;
    }
    let cancelled = false;
    const trimmed = communityQuery.trim();
    const timer = window.setTimeout(() => {
      setCommunitySearching(true);
      void (async () => {
        try {
          const payload = await readApiJson<ListCatalogResult>(
            await api.api.catalog.$get({
              query: {
                kind: 'builtin',
                ...(trimmed ? { q: trimmed } : {}),
                limit: '30',
              },
            }),
          );
          if (!cancelled) {
            setCommunityResults((payload.items ?? []).filter((item) => Boolean(item.sourceUrl)));
          }
        } catch {
          if (!cancelled) setCommunityResults([]);
        } finally {
          if (!cancelled) setCommunitySearching(false);
        }
      })();
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, mode, createMode, upstreamKind, communityQuery]);

  const nameError = useMemo(
    () => (mode === 'edit' && name === initial?.name ? '' : validateCategoryName(name)),
    [mode, name, initial?.name],
  );
  const parsedUrls = useMemo(() => splitNonEmptyLines(sourceUrlsText), [sourceUrlsText]);

  const hasValidUpstreamSelection = useMemo(() => {
    if (createMode === 'manual') return true;
    if (upstreamKind === 'url') return parsedUrls.length > 0;
    if (upstreamKind === 'geo') return selectedGeosites.length > 0 || selectedGeoips.length > 0;
    return selectedCommunity.length > 0;
  }, [
    createMode,
    upstreamKind,
    parsedUrls.length,
    selectedGeosites.length,
    selectedGeoips.length,
    selectedCommunity.length,
  ]);

  const canSubmit = !submitting && !nameError && (mode === 'edit' || hasValidUpstreamSelection);

  const toggleGeoSelection = (item: GeoSourceSuggestion) => {
    if (item.sourceType === 'geosite') {
      setSelectedGeosites((prev) =>
        prev.includes(item.name) ? prev.filter((entry) => entry !== item.name) : [...prev, item.name],
      );
    } else {
      setSelectedGeoips((prev) =>
        prev.includes(item.name) ? prev.filter((entry) => entry !== item.name) : [...prev, item.name],
      );
    }
  };

  const toggleCommunitySelection = (item: CatalogItem) => {
    setSelectedCommunity((prev) =>
      prev.some((entry) => entry.id === item.id) ? prev.filter((entry) => entry.id !== item.id) : [...prev, item],
    );
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    if (mode === 'edit') {
      await onEdit?.({
        name: name === initial?.name ? name : name.trim(),
        description: description.trim(),
        icon: icon.trim(),
      });
      return;
    }

    const sourceUrls =
      createMode === 'upstream' && upstreamKind === 'url'
        ? parsedUrls
        : createMode === 'upstream' && upstreamKind === 'community'
          ? selectedCommunity.map((item) => item.sourceUrl!).filter(Boolean)
          : [];
    const geositeNames = createMode === 'upstream' && upstreamKind === 'geo' ? selectedGeosites : [];
    const geoipNames = createMode === 'upstream' && upstreamKind === 'geo' ? selectedGeoips : [];

    await onCreate?.({
      name: name.trim(),
      description: description.trim(),
      icon: icon.trim(),
      mode: createMode,
      sourceUrls,
      geositeNames,
      geoipNames,
      syncIntervalMinutes,
      userAgent: userAgent.trim() || DEFAULT_USER_AGENT,
      ruleOptimization: createMode === 'upstream' && upstreamKind !== 'geo' ? ruleOptimization : 'none',
      tokenLinksEnabled: createMode === 'manual',
      publicLinksEnabled: createMode === 'upstream',
    });
  };

  const footerStatusText = useMemo(() => {
    if (createMode === 'manual') return t('ruleDialog.footerManual');
    if (upstreamKind === 'url') {
      return `${t('ruleDialog.footerPublicPrefix')}${t('ruleDialog.footerUrlsPrefix')} ${parsedUrls.length} ${t('ruleDialog.footerUrlsSuffix')}`;
    }
    if (upstreamKind === 'geo') {
      return `${t('ruleDialog.footerPublicPrefix')}${t('ruleDialog.footerGeoPrefix')} ${selectedGeosites.length} ${t('ruleDialog.footerGeoMid')} ${selectedGeoips.length} ${t('ruleDialog.footerGeoSuffix')}`;
    }
    return `${t('ruleDialog.footerPublicPrefix')}${t('ruleDialog.footerGeoPrefix')} ${selectedCommunity.length} ${t('ruleDialog.footerCommunitySuffix')}`;
  }, [
    createMode,
    upstreamKind,
    parsedUrls.length,
    selectedGeosites.length,
    selectedGeoips.length,
    selectedCommunity.length,
    t,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="ruleset-form-dialog">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('ruleDialog.createTitle') : t('ruleDialog.editTitle')}</DialogTitle>
          <DialogDescription>
            {mode === 'create' ? t('ruleDialog.createSubtitle') : t('ruleDialog.editSubtitle')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4" noValidate>
          {mode === 'create' ? (
            <div
              role="tablist"
              aria-label={t('ruleDialog.createTitle')}
              className="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-border bg-surface-muted p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={createMode === 'manual'}
                data-testid="create-mode-manual"
                onClick={() => setCreateMode('manual')}
                className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors ${
                  createMode === 'manual' ? 'bg-surface text-primary shadow-sm' : 'text-text-muted hover:text-text'
                }`}
              >
                <PenLine className="h-4 w-4" />
                <span>{t('ruleDialog.modeManual')}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={createMode === 'upstream'}
                data-testid="create-mode-upstream"
                onClick={() => setCreateMode('upstream')}
                className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors ${
                  createMode === 'upstream' ? 'bg-surface text-primary shadow-sm' : 'text-text-muted hover:text-text'
                }`}
              >
                <Link2 className="h-4 w-4" />
                <span>{t('ruleDialog.modeUpstream')}</span>
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rule-cat-name" className="text-xs font-medium text-text">
                {t('ruleDialog.fieldName')}
              </label>
              <Input
                id="rule-cat-name"
                data-testid="ruleset-form-name"
                placeholder={t('ruleDialog.fieldNamePlaceholder')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={Boolean(name && nameError)}
              />
              <small
                className={`text-[11px] ${name && nameError ? 'text-danger' : 'text-text-muted'}`}
                role={name && nameError ? 'alert' : undefined}
              >
                {name && nameError ? t('ruleDialog.fieldNameInvalid') : t('ruleDialog.fieldNameHint')}
              </small>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="rule-cat-desc" className="text-xs font-medium text-text">
                {t('ruleDialog.fieldDesc')}
              </label>
              <Input
                id="rule-cat-desc"
                data-testid="ruleset-form-description"
                placeholder={t('ruleDialog.fieldDescPlaceholder')}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>

          <IconPicker
            value={icon}
            name={name}
            customPackUrls={customIconPackUrls}
            customPackNames={customIconPackNames}
            onChange={setIcon}
          />

          {mode === 'create' && createMode === 'upstream' ? (
            <div className="flex flex-col gap-3.5">
              <div
                role="tablist"
                aria-label={t('ruleDialog.modeUpstream')}
                className="grid grid-cols-3 gap-1 rounded-[var(--radius-md)] border border-border bg-surface-muted p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={upstreamKind === 'url'}
                  data-testid="upstream-kind-url"
                  onClick={() => setUpstreamKind('url')}
                  className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-xs font-medium transition-colors sm:text-sm ${
                    upstreamKind === 'url' ? 'bg-surface text-primary shadow-sm' : 'text-text-muted hover:text-text'
                  }`}
                >
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t('ruleDialog.upstreamTabUrl')}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={upstreamKind === 'geo'}
                  data-testid="upstream-kind-geo"
                  onClick={() => setUpstreamKind('geo')}
                  className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-xs font-medium transition-colors sm:text-sm ${
                    upstreamKind === 'geo' ? 'bg-surface text-primary shadow-sm' : 'text-text-muted hover:text-text'
                  }`}
                >
                  <Database className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t('ruleDialog.upstreamTabGeo')}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={upstreamKind === 'community'}
                  data-testid="upstream-kind-community"
                  onClick={() => setUpstreamKind('community')}
                  className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-xs font-medium transition-colors sm:text-sm ${
                    upstreamKind === 'community'
                      ? 'bg-surface text-primary shadow-sm'
                      : 'text-text-muted hover:text-text'
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t('ruleDialog.upstreamTabCommunity')}</span>
                </button>
              </div>

              {upstreamKind === 'url' ? (
                <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface-muted/30 p-3.5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="create-upstream-urls" className="text-xs font-medium text-text">
                        {t('ruleDialog.upstreamUrlsLabel')}
                      </label>
                      <textarea
                        id="create-upstream-urls"
                        data-testid="create-upstream-urls"
                        rows={4}
                        placeholder={t('ruleDialog.upstreamUrlsPlaceholder')}
                        value={sourceUrlsText}
                        onChange={(event) => setSourceUrlsText(event.target.value)}
                        className="w-full rounded-[var(--radius-sm)] border border-border bg-surface p-2.5 font-mono text-xs text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-primary"
                      />
                      <span className="text-[11px] text-primary">{t('ruleDialog.upstreamSyncHint')}</span>
                    </div>

                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="create-upstream-ua" className="text-xs font-medium text-text">
                          {t('ruleDialog.userAgentLabel')}
                        </label>
                        <Input
                          id="create-upstream-ua"
                          data-testid="create-upstream-ua"
                          value={userAgent}
                          onChange={(event) => setUserAgent(event.target.value)}
                          className="font-mono text-xs"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label htmlFor="create-sync-interval" className="text-xs font-medium text-text">
                          {t('ruleDialog.syncIntervalLabel')}
                        </label>
                        <select
                          id="create-sync-interval"
                          data-testid="create-sync-interval"
                          value={syncIntervalMinutes}
                          onChange={(event) => setSyncIntervalMinutes(Number(event.target.value))}
                          className="flex h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          {SYNC_INTERVAL_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {t(opt.labelKey)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <OptimizationPicker value={ruleOptimization} onChange={setRuleOptimization} />
                </div>
              ) : null}

              {upstreamKind === 'geo' ? (
                <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface-muted/30 p-3.5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="create-geo-search" className="text-xs font-medium text-text">
                        {t('ruleDialog.geoSearchLabel')}
                      </label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                        <Input
                          id="create-geo-search"
                          data-testid="create-geo-search-input"
                          placeholder={t('ruleDialog.geoSearchPlaceholder')}
                          value={geoQuery}
                          onChange={(event) => setGeoQuery(event.target.value)}
                          className="pl-9"
                        />
                      </div>
                      <span className="text-[11px] text-primary">{t('ruleDialog.geoSearchHint')}</span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="create-geo-interval" className="text-xs font-medium text-text">
                        {t('ruleDialog.syncIntervalLabel')}
                      </label>
                      <select
                        id="create-geo-interval"
                        value={syncIntervalMinutes}
                        onChange={(event) => setSyncIntervalMinutes(Number(event.target.value))}
                        className="flex h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {SYNC_INTERVAL_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {selectedGeosites.length > 0 || selectedGeoips.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5" data-testid="create-geo-selected-chips">
                      {selectedGeosites.map((item) => (
                        <button
                          key={`geosite:${item}`}
                          type="button"
                          onClick={() => setSelectedGeosites((prev) => prev.filter((x) => x !== item))}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success"
                        >
                          <span>geosite:{item}</span>
                          <X className="h-3 w-3" />
                        </button>
                      ))}
                      {selectedGeoips.map((item) => (
                        <button
                          key={`geoip:${item}`}
                          type="button"
                          onClick={() => setSelectedGeoips((prev) => prev.filter((x) => x !== item))}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                        >
                          <span>geoip:{item}</span>
                          <X className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {geoSearching ? (
                    <p className="py-3 text-center text-xs text-text-muted">{t('ruleDialog.geoSearching')}</p>
                  ) : geoQuery.trim().length >= 2 && geoResults.length === 0 ? (
                    <p className="py-3 text-center text-xs text-text-muted">{t('ruleDialog.geoEmpty')}</p>
                  ) : geoResults.length > 0 ? (
                    <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto" data-testid="create-geo-results">
                      {geoResults.map((item) => {
                        const selected =
                          item.sourceType === 'geosite'
                            ? selectedGeosites.includes(item.name)
                            : selectedGeoips.includes(item.name);
                        return (
                          <button
                            key={`${item.sourceType}:${item.name}`}
                            type="button"
                            data-testid={`create-geo-option-${item.sourceType}-${item.name}`}
                            onClick={() => toggleGeoSelection(item)}
                            className={`flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3.5 py-2.5 text-left transition-colors ${
                              selected
                                ? 'border-primary bg-primary/10'
                                : 'border-border bg-surface hover:bg-surface-muted/60'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-mono text-xs font-semibold text-text">
                                {item.sourceType}:{item.name}
                              </div>
                              {item.description ? (
                                <div className="mt-0.5 truncate text-[11px] text-text-muted">{item.description}</div>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Badge variant={item.sourceType === 'geosite' ? 'success' : 'primary'}>
                                {item.sourceType === 'geosite'
                                  ? t('ruleDialog.geoTypeDomain')
                                  : t('ruleDialog.geoTypeIp')}
                              </Badge>
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-text-muted">
                                {selected ? (
                                  <Check className="h-3.5 w-3.5 text-primary" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5" />
                                )}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {upstreamKind === 'community' ? (
                <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface-muted/30 p-3.5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="create-community-search" className="text-xs font-medium text-text">
                        {t('ruleDialog.communitySearchLabel')}
                      </label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                        <Input
                          id="create-community-search"
                          data-testid="create-community-search-input"
                          placeholder={t('ruleDialog.communitySearchPlaceholder')}
                          value={communityQuery}
                          onChange={(event) => setCommunityQuery(event.target.value)}
                          className="pl-9"
                        />
                      </div>
                      <span className="text-[11px] text-primary">{t('ruleDialog.communitySearchHint')}</span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="create-community-interval" className="text-xs font-medium text-text">
                        {t('ruleDialog.syncIntervalLabel')}
                      </label>
                      <select
                        id="create-community-interval"
                        value={syncIntervalMinutes}
                        onChange={(event) => setSyncIntervalMinutes(Number(event.target.value))}
                        className="flex h-10 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {SYNC_INTERVAL_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {selectedCommunity.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5" data-testid="create-community-selected-chips">
                      {selectedCommunity.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleCommunitySelection(item)}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                        >
                          <span>{item.name}</span>
                          <X className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {communitySearching ? (
                    <p className="py-3 text-center text-xs text-text-muted">{t('common.loading')}</p>
                  ) : communityResults.length === 0 ? (
                    <p className="py-3 text-center text-xs text-text-muted">{t('ruleDialog.communityEmpty')}</p>
                  ) : (
                    <div
                      className="flex max-h-48 flex-col gap-1.5 overflow-y-auto"
                      data-testid="create-community-results"
                    >
                      {communityResults.map((item) => {
                        const selected = selectedCommunity.some((entry) => entry.id === item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            data-testid={`create-community-option-${item.id}`}
                            onClick={() => toggleCommunitySelection(item)}
                            className={`flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3.5 py-2.5 text-left transition-colors ${
                              selected
                                ? 'border-primary bg-primary/10'
                                : 'border-border bg-surface hover:bg-surface-muted/60'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-semibold text-text">{item.name}</div>
                              <div className="mt-0.5 truncate font-mono text-[11px] text-text-muted">
                                {item.sourceUrl}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Badge variant="outline">{item.provider}</Badge>
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-text-muted">
                                {selected ? (
                                  <Check className="h-3.5 w-3.5 text-primary" />
                                ) : (
                                  <Plus className="h-3.5 w-3.5" />
                                )}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <OptimizationPicker value={ruleOptimization} onChange={setRuleOptimization} />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            {mode === 'create' ? (
              <span className="text-xs text-text-muted" data-testid="create-rule-footer-status">
                {footerStatusText}
              </span>
            ) : (
              <span />
            )}
            <div className="flex items-center justify-end gap-2">
              {mode === 'edit' ? (
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                  {t('common.cancel')}
                </Button>
              ) : null}
              <Button type="submit" data-testid="ruleset-form-submit" disabled={!canSubmit}>
                {submitting
                  ? mode === 'create'
                    ? t('ruleDialog.submitCreating')
                    : t('common.loading')
                  : mode === 'create'
                    ? t('ruleDialog.submitCreate')
                    : t('ruleDialog.submitSave')}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
