import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Eye, Plus, Search, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { CatalogItem } from '../../../application/catalog';
import {
  CATALOG_CATEGORY_VALUES,
  GROUP_TYPE_VALUES,
  REMOTE_RULE_BEHAVIOR_VALUES,
  REMOTE_RULE_FORMAT_VALUES,
  STAGE_VALUES,
  catalogCategorySchema,
  groupTypeSchema,
  remoteRuleBehaviorSchema,
  remoteRuleFormatSchema,
  stageSchema,
  type AppCard,
  type AppCardGroup,
  type CatalogCategory,
  type Matcher,
  type Stage,
} from '../../../shared/schemas/card';
import { useI18n, type MessageKey } from '../../i18n';
import { catalogListQueryOptions, rulesetsListQueryOptions } from '../../lib/query';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import {
  formatConditionLine,
  parseInlineRulesText,
  parsePolicyRef,
  ROUTE_PRESET_OPTIONS,
  serializePolicyRef,
} from './card-helpers';

const CatalogDetailSheet = lazy(() =>
  import('../catalog/CatalogDetailSheet').then((m) => ({ default: m.CatalogDetailSheet })),
);

const MATCHER_KINDS = ['catalog', 'ruleset', 'geosite', 'geoip', 'remote', 'inline'] as const;
type MatcherKind = (typeof MATCHER_KINDS)[number];

const matcherRowSchema = z.object({
  kind: z.enum(MATCHER_KINDS),
  value: z.string(),
  noResolve: z.boolean().optional(),
  behavior: remoteRuleBehaviorSchema.optional(),
  format: remoteRuleFormatSchema.optional(),
});

const cardEditorFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .max(80)
    .refine((value) => value === '' || /^[a-z0-9][a-z0-9_-]*$/i.test(value), { message: 'invalid_slug' }),
  icon: z.string().trim().max(120),
  category: catalogCategorySchema,
  stage: stageSchema,
  groupType: groupTypeSchema,
  defaultRoute: z.string().trim().min(1),
  extraCandidates: z.array(z.object({ value: z.string().trim().min(1) })),
  matchers: z.array(matcherRowSchema),
});

type CardEditorFormValues = z.infer<typeof cardEditorFormSchema>;

export type CardSubmitPayload = {
  name: string;
  slug?: string;
  icon?: string;
  category: CatalogCategory;
  stage: Stage;
  group: AppCardGroup;
  matchers: Matcher[];
};

type CardFormDialogProps = {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: AppCard | null;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CardSubmitPayload) => Promise<void> | void;
};

function matcherToRow(matcher: Matcher): CardEditorFormValues['matchers'][number] {
  switch (matcher.kind) {
    case 'catalog':
      return { kind: 'catalog', value: matcher.entryId };
    case 'ruleset':
      return { kind: 'ruleset', value: matcher.ruleSetId };
    case 'geosite':
      return { kind: 'geosite', value: matcher.name };
    case 'geoip':
      return { kind: 'geoip', value: matcher.name, noResolve: matcher.noResolve ?? true };
    case 'remote':
      return {
        kind: 'remote',
        value: matcher.url,
        behavior: matcher.behavior,
        format: matcher.format ?? 'text',
      };
    case 'inline':
      return {
        kind: 'inline',
        value: matcher.conditions.map(formatConditionLine).join('\n'),
      };
  }
}

function rowToMatcher(row: CardEditorFormValues['matchers'][number], fallbackMatcher?: Matcher): Matcher | null {
  const value = row.value.trim();
  if (!value) return null;
  switch (row.kind) {
    case 'catalog':
      return { kind: 'catalog', entryId: value };
    case 'ruleset':
      return { kind: 'ruleset', ruleSetId: value };
    case 'geosite':
      return { kind: 'geosite', name: value };
    case 'geoip':
      return { kind: 'geoip', name: value, ...(row.noResolve ? { noResolve: true } : {}) };
    case 'remote': {
      try {
        new URL(value);
      } catch {
        return null;
      }
      return {
        kind: 'remote',
        url: value,
        behavior: row.behavior ?? 'classical',
        format: row.format ?? 'text',
      };
    }
    case 'inline': {
      const parsed = parseInlineRulesText(value);
      if (parsed.length > 0) {
        return { kind: 'inline', conditions: parsed };
      }
      if (fallbackMatcher?.kind === 'inline') {
        return fallbackMatcher;
      }
      return null;
    }
  }
}

const selectClassName =
  'h-10 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 text-sm text-text focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50';

export function CardFormDialog({ open, mode, initial, submitting, onOpenChange, onSubmit }: CardFormDialogProps) {
  const { t } = useI18n();

  const catalogQuery = useQuery({
    ...catalogListQueryOptions({ kind: 'builtin', limit: 200 }),
    enabled: open,
  });
  const rulesetsQuery = useQuery({
    ...rulesetsListQueryOptions(),
    enabled: open,
  });

  const catalogEntries = useMemo(() => catalogQuery.data?.items ?? [], [catalogQuery.data?.items]);
  const rulesets = rulesetsQuery.data?.data.categories ?? [];

  const [browsingRowIndex, setBrowsingRowIndex] = useState<number | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState<CatalogCategory | ''>('');
  const [inspectCatalogItem, setInspectCatalogItem] = useState<CatalogItem | null>(null);

  const filteredCatalogEntries = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return catalogEntries.filter((entry) => {
      if (catalogCategory && entry.category !== catalogCategory) return false;
      if (!q) return true;
      return (
        entry.id.toLowerCase().includes(q) ||
        entry.name.toLowerCase().includes(q) ||
        entry.provider.toLowerCase().includes(q) ||
        entry.aliases.some((alias) => alias.toLowerCase().includes(q))
      );
    });
  }, [catalogCategory, catalogEntries, catalogSearch]);

  const form = useForm<CardEditorFormValues>({
    resolver: zodResolver(cardEditorFormSchema),
    defaultValues: {
      name: '',
      slug: '',
      icon: '',
      category: 'other',
      stage: 'app',
      groupType: 'select',
      defaultRoute: 'card:proxy-select',
      extraCandidates: [{ value: 'builtin:DIRECT' }],
      matchers: [],
    },
  });

  const candidateFields = useFieldArray({ control: form.control, name: 'extraCandidates' });
  const matcherFields = useFieldArray({ control: form.control, name: 'matchers' });

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initial) {
      const [first, ...rest] = initial.group.candidates;
      form.reset({
        name: initial.name,
        slug: initial.slug,
        icon: initial.icon ?? '',
        category: initial.category,
        stage: initial.stage,
        groupType: initial.group.type,
        defaultRoute: first ? serializePolicyRef(first) : 'card:proxy-select',
        extraCandidates: rest.map((ref) => ({ value: serializePolicyRef(ref) })),
        matchers: initial.matchers.map(matcherToRow),
      });
    } else {
      form.reset({
        name: '',
        slug: '',
        icon: '',
        category: 'other',
        stage: 'app',
        groupType: 'select',
        defaultRoute: 'card:proxy-select',
        extraCandidates: [{ value: 'builtin:DIRECT' }],
        matchers: [{ kind: 'geosite', value: '' }],
      });
    }
  }, [open, mode, initial, form]);

  const knownPresetValues = new Set(ROUTE_PRESET_OPTIONS.map((item) => item.value));
  const currentRouteValues = new Set<string>([
    form.watch('defaultRoute'),
    ...form.watch('extraCandidates').map((c) => c.value),
  ]);
  const customRouteValues = [...currentRouteValues].filter((val) => val && !knownPresetValues.has(val));

  const handleValidSubmit = form.handleSubmit(async (values) => {
    const candidateKeys: string[] = [];
    for (const key of [values.defaultRoute, ...values.extraCandidates.map((c) => c.value)]) {
      const trimmed = key.trim();
      if (trimmed && !candidateKeys.includes(trimmed)) {
        candidateKeys.push(trimmed);
      }
    }
    const candidates = candidateKeys.map(parsePolicyRef);
    const matchers = values.matchers
      .map((row, idx) => rowToMatcher(row, mode === 'edit' ? initial?.matchers[idx] : undefined))
      .filter((item): item is Matcher => item !== null);

    await onSubmit({
      name: values.name.trim(),
      ...(values.slug.trim() ? { slug: values.slug.trim() } : {}),
      icon: values.icon.trim() || undefined,
      category: values.category,
      stage: values.stage,
      group: {
        type: values.groupType,
        candidates: candidates.length > 0 ? candidates : [{ kind: 'builtin', id: 'DIRECT' }],
        ...(mode === 'edit' && initial?.group.test ? { test: initial.group.test } : {}),
      },
      matchers,
    });
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="card-form-dialog" className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? t('cards.create') : t('cards.edit')}</DialogTitle>
            <DialogDescription>{t('cards.subtitle')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleValidSubmit} className="flex flex-col gap-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="card-name" className="text-xs font-medium text-text">
                  {t('cards.fieldName')}
                </label>
                <Input
                  id="card-name"
                  data-testid="card-form-name"
                  placeholder={t('cards.fieldNamePlaceholder')}
                  {...form.register('name')}
                />
                {form.formState.errors.name ? (
                  <p className="text-xs text-danger" role="alert">
                    {t('cards.validationNameRequired')}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="card-icon" className="text-xs font-medium text-text">
                  {t('cards.fieldIcon')}
                </label>
                <Input
                  id="card-icon"
                  data-testid="card-form-icon"
                  placeholder={t('cards.fieldIconPlaceholder')}
                  {...form.register('icon')}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="card-slug" className="text-xs font-medium text-text">
                  {t('cards.fieldSlug')}
                </label>
                <Input
                  id="card-slug"
                  data-testid="card-form-slug"
                  placeholder={t('cards.fieldSlugPlaceholder')}
                  {...form.register('slug')}
                />
                {form.formState.errors.slug ? (
                  <p className="text-xs text-danger" role="alert">
                    {t('cards.validationSlugInvalid')}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="card-category" className="text-xs font-medium text-text">
                  {t('cards.fieldCategory')}
                </label>
                <select
                  id="card-category"
                  data-testid="card-form-category"
                  className={selectClassName}
                  {...form.register('category')}
                >
                  {CATALOG_CATEGORY_VALUES.map((cat) => (
                    <option key={cat} value={cat}>
                      {t(`taxonomy.category.${cat}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="card-stage" className="text-xs font-medium text-text">
                  {t('cards.fieldStage')}
                </label>
                <select
                  id="card-stage"
                  data-testid="card-form-stage"
                  className={selectClassName}
                  {...form.register('stage')}
                >
                  {STAGE_VALUES.map((stage) => (
                    <option key={stage} value={stage}>
                      {t(`taxonomy.stage.${stage}` as MessageKey)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border bg-surface-muted/40 p-3.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="card-group-type" className="text-xs font-medium text-text">
                    {t('cards.fieldGroupType')}
                  </label>
                  <select
                    id="card-group-type"
                    data-testid="card-form-group-type"
                    className={selectClassName}
                    {...form.register('groupType')}
                  >
                    {GROUP_TYPE_VALUES.map((gt) => (
                      <option key={gt} value={gt}>
                        {gt}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="card-default-route" className="text-xs font-medium text-text">
                    {t('cards.fieldDefaultRoute')}
                  </label>
                  <select
                    id="card-default-route"
                    data-testid="card-form-default-route"
                    className={selectClassName}
                    {...form.register('defaultRoute')}
                  >
                    {ROUTE_PRESET_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {t(opt.labelKey)}
                      </option>
                    ))}
                    {customRouteValues.map((val) => (
                      <option key={val} value={val}>
                        {val}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-text-muted">{t('cards.fieldExtraCandidates')}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => candidateFields.append({ value: 'builtin:DIRECT' })}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{t('cards.addCandidate')}</span>
                  </Button>
                </div>
                {candidateFields.fields.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {candidateFields.fields.map((field, index) => (
                      <div key={field.id} className="flex items-center gap-2">
                        <select
                          className={`${selectClassName} h-9 text-xs`}
                          {...form.register(`extraCandidates.${index}.value`)}
                        >
                          {ROUTE_PRESET_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {t(opt.labelKey)}
                            </option>
                          ))}
                          {customRouteValues.map((val) => (
                            <option key={val} value={val}>
                              {val}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t('common.delete')}
                          onClick={() => candidateFields.remove(index)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface-muted/40 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-text">{t('cards.fieldMatchers')}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="card-form-add-matcher"
                  onClick={() => matcherFields.append({ kind: 'catalog', value: '' })}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('cards.addMatcher')}</span>
                </Button>
              </div>

              {matcherFields.fields.length === 0 ? (
                <p className="text-xs text-text-muted">{t('cards.detailNoMatchers')}</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {matcherFields.fields.map((field, index) => {
                    const kind = form.watch(`matchers.${index}.kind`) as MatcherKind;
                    return (
                      <div
                        key={field.id}
                        data-testid={`card-form-matcher-${index}`}
                        className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-border bg-surface p-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <select
                            data-testid={`card-form-matcher-kind-${index}`}
                            className={`${selectClassName} h-9 w-40 shrink-0 text-xs`}
                            {...form.register(`matchers.${index}.kind`)}
                          >
                            {MATCHER_KINDS.map((item) => (
                              <option key={item} value={item}>
                                {t(`cards.matcherKind.${item}` as MessageKey)}
                              </option>
                            ))}
                          </select>

                          {kind === 'catalog' ? (
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                              <Input
                                list={`catalog-options-${index}`}
                                data-testid={`card-form-matcher-value-${index}`}
                                placeholder="ai-openai"
                                className="h-9 text-xs font-mono"
                                {...form.register(`matchers.${index}.value`)}
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant={browsingRowIndex === index ? 'primary' : 'outline'}
                                data-testid={`card-form-browse-catalog-${index}`}
                                onClick={() => {
                                  setBrowsingRowIndex((prev) => (prev === index ? null : index));
                                  setCatalogSearch('');
                                  setCatalogCategory('');
                                }}
                              >
                                <BookOpen className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">{t('cards.browseCommunityRules')}</span>
                              </Button>
                              <datalist id={`catalog-options-${index}`}>
                                {catalogEntries.map((entry) => (
                                  <option key={entry.id} value={entry.id}>
                                    {entry.name}
                                  </option>
                                ))}
                              </datalist>
                            </div>
                          ) : kind === 'ruleset' ? (
                            <select
                              data-testid={`card-form-matcher-value-${index}`}
                              className={`${selectClassName} h-9 min-w-0 flex-1 text-xs`}
                              {...form.register(`matchers.${index}.value`)}
                            >
                              <option value="">—</option>
                              {rulesets.map((rs) => (
                                <option key={rs.id} value={rs.id}>
                                  {rs.name} ({rs.slug})
                                </option>
                              ))}
                            </select>
                          ) : kind === 'inline' ? null : (
                            <Input
                              data-testid={`card-form-matcher-value-${index}`}
                              placeholder={
                                kind === 'remote'
                                  ? t('cards.matcherRemoteUrlPlaceholder')
                                  : kind === 'geoip'
                                    ? 'cn'
                                    : 'openai'
                              }
                              className="h-9 min-w-0 flex-1 font-mono text-xs"
                              {...form.register(`matchers.${index}.value`)}
                            />
                          )}

                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={t('common.delete')}
                            data-testid={`card-form-matcher-remove-${index}`}
                            onClick={() => matcherFields.remove(index)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-danger" />
                          </Button>
                        </div>

                        {kind === 'catalog' && browsingRowIndex === index ? (
                          <div
                            data-testid={`card-form-catalog-browser-${index}`}
                            className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-border bg-bg/60 p-2.5"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <div className="relative min-w-[160px] flex-1">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                                <Input
                                  value={catalogSearch}
                                  onChange={(e) => setCatalogSearch(e.target.value)}
                                  placeholder={t('catalog.searchPlaceholder')}
                                  data-testid={`card-form-catalog-search-${index}`}
                                  className="h-8 pl-8 text-xs"
                                />
                              </div>
                              <select
                                aria-label={t('cards.fieldCategory')}
                                value={catalogCategory}
                                onChange={(e) => setCatalogCategory(e.target.value as CatalogCategory | '')}
                                data-testid={`card-form-catalog-category-${index}`}
                                className={`${selectClassName} h-8 w-32 text-xs`}
                              >
                                <option value="">{t('taxonomy.categoryAll')}</option>
                                {CATALOG_CATEGORY_VALUES.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {t(`taxonomy.category.${cat}` as MessageKey)}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-[var(--radius-sm)] border border-border bg-surface">
                              {filteredCatalogEntries.length === 0 ? (
                                <div className="px-3 py-4 text-center text-xs text-text-muted">
                                  {t('catalog.empty')}
                                </div>
                              ) : (
                                filteredCatalogEntries.slice(0, 60).map((entry) => {
                                  const isSelected = form.watch(`matchers.${index}.value`) === entry.id;
                                  return (
                                    <div
                                      key={entry.id}
                                      data-testid={`card-form-catalog-item-${entry.id}`}
                                      className={`flex items-center justify-between gap-2 px-2.5 py-2 text-xs ${
                                        isSelected ? 'bg-primary/10' : 'hover:bg-surface-muted/60'
                                      }`}
                                    >
                                      <button
                                        type="button"
                                        data-testid={`card-form-catalog-pick-${entry.id}`}
                                        onClick={() => {
                                          form.setValue(`matchers.${index}.value`, entry.id, { shouldValidate: true });
                                          setBrowsingRowIndex(null);
                                        }}
                                        className="flex min-w-0 flex-1 cursor-pointer flex-col items-start text-left"
                                      >
                                        <span className="truncate font-medium text-text">{entry.name}</span>
                                        <span className="truncate font-mono text-[11px] text-text-muted">
                                          {entry.id} · {entry.provider}
                                        </span>
                                      </button>
                                      <div className="flex shrink-0 items-center gap-1">
                                        <Badge variant="outline" className="text-[10px]">
                                          {t(`taxonomy.category.${entry.category}` as MessageKey)}
                                        </Badge>
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="ghost"
                                          aria-label={t('catalog.viewDetail')}
                                          data-testid={`card-form-catalog-detail-${entry.id}`}
                                          onClick={() => setInspectCatalogItem(entry)}
                                        >
                                          <Eye className="h-3.5 w-3.5 text-text-muted" />
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        ) : null}

                        {kind === 'geoip' ? (
                          <div className="flex items-center justify-between gap-2 pl-1 text-xs text-text-muted">
                            <span>{t('cards.matcherNoResolve')}</span>
                            <Controller
                              control={form.control}
                              name={`matchers.${index}.noResolve`}
                              render={({ field: switchField }) => (
                                <Switch checked={Boolean(switchField.value)} onCheckedChange={switchField.onChange} />
                              )}
                            />
                          </div>
                        ) : null}

                        {kind === 'remote' ? (
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              className={`${selectClassName} h-8 text-xs`}
                              {...form.register(`matchers.${index}.behavior`)}
                            >
                              {REMOTE_RULE_BEHAVIOR_VALUES.map((b) => (
                                <option key={b} value={b}>
                                  {b}
                                </option>
                              ))}
                            </select>
                            <select
                              className={`${selectClassName} h-8 text-xs`}
                              {...form.register(`matchers.${index}.format`)}
                            >
                              {REMOTE_RULE_FORMAT_VALUES.map((f) => (
                                <option key={f} value={f}>
                                  {f}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}

                        {kind === 'inline' ? (
                          <textarea
                            rows={3}
                            data-testid={`card-form-matcher-value-${index}`}
                            placeholder={t('cards.matcherInlinePlaceholder')}
                            className="w-full rounded-[var(--radius-sm)] border border-border bg-surface-muted/40 p-2 font-mono text-xs text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-primary"
                            {...form.register(`matchers.${index}.value`)}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" data-testid="card-form-submit" disabled={submitting}>
                {submitting ? t('common.loading') : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {inspectCatalogItem ? (
        <Suspense fallback={null}>
          <CatalogDetailSheet
            open={Boolean(inspectCatalogItem)}
            entryId={inspectCatalogItem.id}
            initialItem={inspectCatalogItem}
            allItems={catalogEntries}
            providers={catalogQuery.data?.providers ?? {}}
            onSelectEntry={(nextId) => {
              const found = catalogEntries.find((entry) => entry.id === nextId);
              if (found) setInspectCatalogItem(found);
            }}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setInspectCatalogItem(null);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
