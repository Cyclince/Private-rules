import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  Code2,
  GripVertical,
  Info,
  Layers,
  Plus,
  Puzzle,
  Server,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import type { LintIssue } from '../../../domain/templates/lint';
import { listEnhancementModules } from '../../../domain/templates/modules';
import {
  checkStageOrdering,
  getStageMetadata,
  STAGES,
  type StageOrderingViolation,
} from '../../../domain/templates/stages';
import {
  TEMPLATE_CLIENT_IDS,
  TEMPLATE_CLIENTS,
  type OutputProfile,
  type TemplateClientId,
} from '../../../shared/clients';
import type { AppCard, GroupType, PolicyRef, Stage } from '../../../shared/schemas/card';
import type {
  DnsMode,
  NodeSlot,
  RegionGroup,
  TemplateBody,
  TemplateCardRef,
  TemplateGroupMode,
  TemplateOverlayOp,
} from '../../../shared/schemas/template';
import { useI18n } from '../../i18n';
import { parsePolicyRef, serializePolicyRef } from '../cards/card-helpers';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { buildMoveCardOp, buildSortByStageOps, checkModuleToggleConflict } from './template-editor-helpers';

const CodeMirrorEditor = lazy(() => import('./CodeMirrorEditor').then((m) => ({ default: m.CodeMirrorEditor })));

export type EditorCenterTab = 'rules' | 'groups' | 'modules' | 'patches';

type PolicyOption = {
  value: string;
  label: string;
};

type TemplateCanvasProps = {
  body: TemplateBody;
  cardMap: ReadonlyMap<string, AppCard>;
  activeTab: EditorCenterTab;
  readOnly?: boolean;
  reorderDiffIssue?: LintIssue;
  onTabChange: (tab: EditorCenterTab) => void;
  onApplyOp: (op: TemplateOverlayOp) => void;
  onApplyOps: (ops: TemplateOverlayOp[]) => void;
};

const REGION_PRESETS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'HK', name: '🇭🇰 香港节点' },
  { code: 'TW', name: '🇹🇼 台湾节点' },
  { code: 'JP', name: '🇯🇵 日本节点' },
  { code: 'SG', name: '🇸🇬 新加坡节点' },
  { code: 'US', name: '🇺🇸 美国节点' },
  { code: 'KR', name: '🇰🇷 韩国节点' },
  { code: 'GB', name: '🇬🇧 英国节点' },
  { code: 'DE', name: '🇩🇪 德国节点' },
  { code: 'FR', name: '🇫🇷 法国节点' },
  { code: 'NL', name: '🇳🇱 荷兰节点' },
  { code: 'CA', name: '🇨🇦 加拿大节点' },
  { code: 'AU', name: '🇦🇺 澳大利亚节点' },
];

type SortableCardRowProps = {
  cardRef: TemplateCardRef;
  index: number;
  card?: AppCard;
  violation?: StageOrderingViolation;
  policyOptions: readonly PolicyOption[];
  readOnly: boolean;
  onToggleEnabled: (cardId: string, enabled: boolean) => void;
  onRemove: (cardId: string) => void;
  onSetOverride: (cardId: string, overrides: TemplateCardRef['overrides'] | null) => void;
};

function SortableCardRow({
  cardRef,
  index,
  card,
  violation,
  policyOptions,
  readOnly,
  onToggleEnabled,
  onRemove,
  onSetOverride,
}: SortableCardRowProps) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: cardRef.cardId,
    disabled: readOnly,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const effectiveStage: Stage = cardRef.overrides?.stage ?? card?.stage ?? 'app';
  const stageMeta = getStageMetadata(effectiveStage);
  const currentPrimaryPolicy: PolicyRef | undefined =
    cardRef.overrides?.group?.candidates?.[0] ?? card?.group.candidates[0];
  const currentGroupType: GroupType = cardRef.overrides?.group?.type ?? card?.group.type ?? 'select';
  const displayName = cardRef.overrides?.name ?? card?.name ?? cardRef.cardId;

  const handlePrimaryPolicyChange = (serialized: string) => {
    const parsed = parsePolicyRef(serialized);
    const existingCandidates = cardRef.overrides?.group?.candidates ?? card?.group.candidates ?? [];
    const rest = existingCandidates.filter((item) => serializePolicyRef(item) !== serialized);
    onSetOverride(cardRef.cardId, {
      ...cardRef.overrides,
      group: {
        ...cardRef.overrides?.group,
        candidates: [parsed, ...rest],
      },
    });
  };

  const handleGroupTypeChange = (nextType: GroupType) => {
    onSetOverride(cardRef.cardId, {
      ...cardRef.overrides,
      group: {
        ...cardRef.overrides?.group,
        type: nextType,
      },
    });
  };

  const handleStageOverrideChange = (nextStage: Stage) => {
    onSetOverride(cardRef.cardId, {
      ...cardRef.overrides,
      stage: nextStage,
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`template-card-row-${cardRef.cardId}`}
      data-card-index={index}
      data-dragging={isDragging ? 'true' : undefined}
      className={`rounded-[var(--radius-md)] border bg-bg transition-colors ${
        isDragging
          ? 'z-20 border-primary shadow-md ring-2 ring-primary/40'
          : violation
            ? 'border-warning bg-warning/5'
            : 'border-border'
      } ${cardRef.enabled ? '' : 'opacity-65'}`}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button
          ref={setActivatorNodeRef}
          type="button"
          data-testid={`drag-handle-${cardRef.cardId}`}
          aria-label={`${t('templates.editorDragHandle')} ${displayName}`}
          disabled={readOnly}
          {...attributes}
          {...listeners}
          className="inline-flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-primary active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <span className="w-6 shrink-0 font-mono text-[11px] text-text-muted">#{index + 1}</span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-text">{displayName}</span>
            <Badge variant={violation ? 'warning' : 'outline'} className="px-1.5 py-0 text-[10px]">
              {locale === 'en' ? stageMeta.labelEn : stageMeta.labelZh}
            </Badge>
            {card?.hidden ? (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                {t('templates.editorBaseGroupBadge')}
              </Badge>
            ) : null}
          </div>
          {violation ? (
            <p
              data-testid={`stage-violation-inline-${cardRef.cardId}`}
              className="mt-0.5 flex items-center gap-1 text-[11px] text-warning"
            >
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="truncate">{violation.message}</span>
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            data-testid={`expand-card-${cardRef.cardId}`}
            onClick={() => setExpanded((prev) => !prev)}
            aria-label={t('templates.editorConfigureCard')}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-surface-muted hover:text-text"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          <Switch
            checked={cardRef.enabled}
            disabled={readOnly}
            aria-label={`${displayName} ${t('common.enabled')}`}
            data-testid={`toggle-card-${cardRef.cardId}`}
            onCheckedChange={(checked) => onToggleEnabled(cardRef.cardId, checked)}
          />

          {!readOnly ? (
            <button
              type="button"
              data-testid={`remove-card-${cardRef.cardId}`}
              aria-label={`${t('common.delete')} ${displayName}`}
              onClick={() => onRemove(cardRef.cardId)}
              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-surface-muted hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div
          data-testid={`card-override-panel-${cardRef.cardId}`}
          className="grid grid-cols-1 gap-2.5 border-t border-border/70 bg-surface-muted/40 px-3 py-2.5 sm:grid-cols-3"
        >
          <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
            <span>{t('templates.editorPrimaryRoute')}</span>
            <select
              disabled={readOnly}
              value={currentPrimaryPolicy ? serializePolicyRef(currentPrimaryPolicy) : 'builtin:DIRECT'}
              onChange={(e) => handlePrimaryPolicyChange(e.target.value)}
              className="h-8 rounded-[var(--radius-sm)] border border-border bg-bg px-2 text-xs text-text"
            >
              {policyOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
            <span>{t('cards.fieldGroupType')}</span>
            <select
              disabled={readOnly}
              value={currentGroupType}
              onChange={(e) => handleGroupTypeChange(e.target.value as GroupType)}
              className="h-8 rounded-[var(--radius-sm)] border border-border bg-bg px-2 text-xs text-text"
            >
              <option value="select">select</option>
              <option value="url-test">url-test</option>
              <option value="fallback">fallback</option>
              <option value="load-balance">load-balance</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
            <span>{t('cards.fieldStage')}</span>
            <select
              disabled={readOnly}
              value={effectiveStage}
              onChange={(e) => handleStageOverrideChange(e.target.value as Stage)}
              className="h-8 rounded-[var(--radius-sm)] border border-border bg-bg px-2 text-xs text-text"
            >
              {STAGES.map((stage) => {
                const meta = getStageMetadata(stage);
                return (
                  <option key={stage} value={stage}>
                    {locale === 'en' ? meta.labelEn : meta.labelZh}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}

export function TemplateCanvas({
  body,
  cardMap,
  activeTab,
  readOnly = false,
  reorderDiffIssue,
  onTabChange,
  onApplyOp,
  onApplyOps,
}: TemplateCanvasProps) {
  const { t } = useI18n();
  const [moduleBlockError, setModuleBlockError] = useState<{ moduleId: string; reason: string } | null>(null);
  const [patchClient, setPatchClient] = useState<TemplateClientId>('mihomo');

  // New slot form
  const [newSlotId, setNewSlotId] = useState('');
  const [newSlotName, setNewSlotName] = useState('');

  // New region group form
  const [newRegionCode, setNewRegionCode] = useState('GB');
  const [newRegionType, setNewRegionType] = useState<GroupType>('url-test');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const stageViolations = useMemo(() => checkStageOrdering(body.cards, cardMap), [body.cards, cardMap]);
  const violationByCardId = useMemo(() => new Map(stageViolations.map((v) => [v.cardId, v])), [stageViolations]);

  const policyOptions = useMemo<PolicyOption[]>(() => {
    const opts: PolicyOption[] = [
      { value: 'builtin:DIRECT', label: 'DIRECT' },
      { value: 'builtin:REJECT', label: 'REJECT' },
      { value: 'builtin:REJECT-DROP', label: 'REJECT-DROP' },
    ];
    for (const ref of body.cards) {
      const card = cardMap.get(ref.cardId);
      opts.push({
        value: `card:${ref.cardId}`,
        label: card ? `${card.name} (${ref.cardId})` : ref.cardId,
      });
    }
    for (const rg of body.regionGroups) {
      opts.push({ value: `region:${rg.id}`, label: `${rg.name} (${rg.id})` });
    }
    for (const slot of body.slots) {
      opts.push({ value: `slot:${slot.id}`, label: `${slot.name} (${slot.id})` });
    }
    return opts;
  }, [body.cards, body.regionGroups, body.slots, cardMap]);

  const enhancementModules = useMemo(() => listEnhancementModules(), []);
  const moduleEnabledMap = useMemo(() => new Map(body.modules.map((m) => [m.id, m.enabled])), [body.modules]);

  const handleDragEnd = (event: DragEndEvent) => {
    if (readOnly) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const moved = buildMoveCardOp(body.cards, String(active.id), String(over.id));
    if (moved) {
      onApplyOp(moved.op);
    }
  };

  const handleSortByStage = () => {
    if (readOnly) return;
    const ops = buildSortByStageOps(body.cards, cardMap);
    if (ops.length > 0) {
      onApplyOps(ops);
    }
  };

  const handleModuleToggle = (moduleId: string, nextEnabled: boolean) => {
    if (readOnly) return;
    const check = checkModuleToggleConflict(body.modules, moduleId, nextEnabled);
    if (!check.allowed) {
      setModuleBlockError({
        moduleId,
        reason: check.reason ?? t('templates.editorModuleConflictFallback'),
      });
      return;
    }
    setModuleBlockError(null);
    onApplyOp({ op: 'setModule', moduleId, enabled: nextEnabled });
  };

  const handleAddSlot = () => {
    if (readOnly) return;
    const id = newSlotId.trim() || `slot-${body.slots.length + 1}`;
    const name = newSlotName.trim() || `${t('templates.editorSlotDefaultName')} ${body.slots.length + 1}`;
    if (body.slots.some((s) => s.id === id)) return;
    const slot: NodeSlot = { id, name, excludeInfo: true, udp: true };
    onApplyOp({ op: 'addSlot', slot });
    setNewSlotId('');
    setNewSlotName('');
  };

  const handleAddRegionGroup = () => {
    if (readOnly) return;
    const preset = REGION_PRESETS.find((r) => r.code === newRegionCode);
    const id = `region-${newRegionCode.toLowerCase()}`;
    if (body.regionGroups.some((rg) => rg.id === id)) return;
    const group: RegionGroup = {
      id,
      name: preset?.name ?? `${newRegionCode} Nodes`,
      region: newRegionCode,
      type: newRegionType,
      slotId: body.slots[0]?.id,
    };
    onApplyOp({ op: 'addRegionGroup', regionGroup: group });
  };

  const currentPatchValue = body.clientPatches?.[patchClient] ?? '';

  return (
    <section
      data-testid="editor-center-canvas"
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-3.5"
    >
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-2.5">
        {(
          [
            { id: 'rules', icon: Layers, label: t('templates.editorTabRules') },
            { id: 'groups', icon: Server, label: t('templates.editorTabGroups') },
            { id: 'modules', icon: Puzzle, label: t('templates.editorTabModules') },
            { id: 'patches', icon: Code2, label: t('templates.editorTabPatches') },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          return (
            <Button
              key={tab.id}
              size="sm"
              data-testid={`editor-center-tab-${tab.id}`}
              variant={activeTab === tab.id ? 'primary' : 'outline'}
              onClick={() => onTabChange(tab.id)}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </Button>
          );
        })}
      </div>

      {activeTab === 'rules' ? (
        <div className="flex flex-col gap-3">
          {/* Core Template Mode / Output / DNS / Final */}
          <div className="grid grid-cols-1 gap-2.5 rounded-[var(--radius-md)] border border-border bg-bg p-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-text-muted">{t('templates.fieldGroupMode')}</span>
              <div className="flex gap-1">
                {(['select', 'fallback'] as const).map((mode: TemplateGroupMode) => (
                  <Button
                    key={mode}
                    size="sm"
                    data-testid={`editor-group-mode-${mode}`}
                    variant={body.groupMode === mode ? 'primary' : 'outline'}
                    disabled={readOnly}
                    onClick={() => onApplyOp({ op: 'setGroupMode', groupMode: mode })}
                    className="h-7 flex-1 text-xs"
                  >
                    {mode === 'select' ? t('templates.groupModeSelect') : t('templates.groupModeFallback')}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-text-muted">{t('templates.fieldOutput')}</span>
              <div className="flex gap-1">
                {(['full', 'minimal'] as const).map((out: OutputProfile) => (
                  <Button
                    key={out}
                    size="sm"
                    data-testid={`editor-output-${out}`}
                    variant={body.output === out ? 'primary' : 'outline'}
                    disabled={readOnly}
                    onClick={() => onApplyOp({ op: 'setOutput', output: out })}
                    className="h-7 flex-1 text-xs"
                  >
                    {out === 'full' ? t('templates.outputFull') : t('templates.outputMinimal')}
                  </Button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
              <span>{t('templates.editorDnsMode')}</span>
              <select
                data-testid="editor-dns-mode"
                disabled={readOnly}
                value={body.dns.mode}
                onChange={(e) => onApplyOp({ op: 'setDns', dns: { ...body.dns, mode: e.target.value as DnsMode } })}
                className="h-8 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-xs text-text"
              >
                <option value="fake-ip">fake-ip</option>
                <option value="redir-host">redir-host</option>
                <option value="custom">custom</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
              <span>{t('templates.editorFinalPolicy')}</span>
              <select
                data-testid="editor-final-policy"
                disabled={readOnly}
                value={serializePolicyRef(body.final)}
                onChange={(e) => onApplyOp({ op: 'setFinal', final: parsePolicyRef(e.target.value) })}
                className="h-8 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-xs text-text"
              >
                {policyOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {body.groupMode === 'fallback' ? (
            <div
              data-testid="editor-fallback-warning"
              className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warning bg-surface-muted px-3 py-2 text-xs text-text"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{t('templates.fallbackModeWarning')}</span>
            </div>
          ) : null}

          {stageViolations.length > 0 ? (
            <div
              role="alert"
              data-testid="editor-cross-stage-warning"
              className="flex flex-wrap items-start justify-between gap-2 rounded-[var(--radius-md)] border border-warning bg-warning/10 px-3 py-2.5 text-xs text-text"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div>
                  <div className="font-semibold">{t('templates.editorCrossStageWarningTitle')}</div>
                  <p className="mt-0.5 text-text-muted">{stageViolations[0].message}</p>
                </div>
              </div>
              {!readOnly ? (
                <Button size="sm" variant="outline" data-testid="editor-sort-by-stage-btn" onClick={handleSortByStage}>
                  <ArrowDownUp className="h-3.5 w-3.5" />
                  <span>{t('templates.editorSortByStageBtn')}</span>
                </Button>
              ) : null}
            </div>
          ) : null}

          {reorderDiffIssue ? (
            <div
              data-testid="editor-reorder-diff-banner"
              className="flex items-start gap-2 rounded-[var(--radius-md)] border border-primary/50 bg-primary/10 px-3 py-2 text-xs text-text"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{reorderDiffIssue.message}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-text-muted">
              {t('templates.editorDragHint')} ({body.cards.length})
            </div>
            {!readOnly && body.cards.length > 1 ? (
              <Button size="sm" variant="outline" onClick={handleSortByStage} className="h-7 text-xs">
                <ArrowDownUp className="h-3 w-3" />
                <span>{t('templates.editorSortByStageBtn')}</span>
              </Button>
            ) : null}
          </div>

          {body.cards.length === 0 ? (
            <div className="rounded-[var(--radius-md)] border border-dashed border-border bg-bg p-6 text-center text-xs text-text-muted">
              {t('templates.editorNoCardsHint')}
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={body.cards.map((c) => c.cardId)} strategy={verticalListSortingStrategy}>
                <div data-testid="editor-sortable-cards" className="flex flex-col gap-1.5">
                  {body.cards.map((ref, idx) => (
                    <SortableCardRow
                      key={ref.cardId}
                      cardRef={ref}
                      index={idx}
                      card={cardMap.get(ref.cardId)}
                      violation={violationByCardId.get(ref.cardId)}
                      policyOptions={policyOptions}
                      readOnly={readOnly}
                      onToggleEnabled={(cardId, enabled) => onApplyOp({ op: 'setCardEnabled', cardId, enabled })}
                      onRemove={(cardId) => onApplyOp({ op: 'removeCard', cardId })}
                      onSetOverride={(cardId, overrides) =>
                        onApplyOp({ op: 'setCardOverride', cardId, overrides: overrides ?? null })
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      ) : activeTab === 'groups' ? (
        <div data-testid="editor-groups-tab" className="flex flex-col gap-4">
          {/* Node Slots */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-text">{t('templates.editorSlotsTitle')}</h3>
            <div className="flex flex-col gap-2">
              {body.slots.map((slot) => (
                <div
                  key={slot.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-bg px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-text">{slot.name}</div>
                    <div className="font-mono text-[11px] text-text-muted">{slot.id}</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-1.5">
                      <Switch
                        checked={slot.excludeInfo}
                        disabled={readOnly}
                        onCheckedChange={(checked) =>
                          onApplyOp({ op: 'updateSlot', slotId: slot.id, patch: { excludeInfo: checked } })
                        }
                      />
                      <span className="text-text-muted">{t('templates.editorSlotExcludeInfo')}</span>
                    </label>
                    {!readOnly && body.slots.length > 1 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onApplyOp({ op: 'removeSlot', slotId: slot.id })}
                        aria-label={t('common.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {!readOnly ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={newSlotId}
                  onChange={(e) => setNewSlotId(e.target.value)}
                  placeholder="slot-backup"
                  className="h-8 w-36 text-xs"
                />
                <Input
                  value={newSlotName}
                  onChange={(e) => setNewSlotName(e.target.value)}
                  placeholder={t('templates.editorSlotNamePlaceholder')}
                  className="h-8 flex-1 text-xs"
                />
                <Button size="sm" variant="outline" onClick={handleAddSlot}>
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('templates.editorAddSlotBtn')}</span>
                </Button>
              </div>
            ) : null}
          </div>

          {/* Region Groups */}
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <h3 className="text-xs font-semibold text-text">
              {t('templates.editorRegionGroupsTitle')} ({body.regionGroups.length})
            </h3>
            <div className="flex flex-col gap-2">
              {body.regionGroups.map((rg) => (
                <div
                  key={rg.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-bg px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
                      <span>{rg.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {rg.region}
                      </Badge>
                    </div>
                    <div className="font-mono text-[11px] text-text-muted">{rg.id}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      disabled={readOnly}
                      value={rg.type}
                      onChange={(e) =>
                        onApplyOp({
                          op: 'updateRegionGroup',
                          regionGroupId: rg.id,
                          patch: { type: e.target.value as GroupType },
                        })
                      }
                      className="h-7 rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-xs text-text"
                    >
                      <option value="url-test">url-test</option>
                      <option value="fallback">fallback</option>
                      <option value="select">select</option>
                      <option value="load-balance">load-balance</option>
                    </select>
                    {!readOnly ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onApplyOp({ op: 'removeRegionGroup', regionGroupId: rg.id })}
                        aria-label={t('common.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {!readOnly ? (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={newRegionCode}
                  onChange={(e) => setNewRegionCode(e.target.value)}
                  className="h-8 rounded-[var(--radius-sm)] border border-border bg-bg px-2 text-xs text-text"
                >
                  {REGION_PRESETS.map((preset) => (
                    <option key={preset.code} value={preset.code}>
                      {preset.name} ({preset.code})
                    </option>
                  ))}
                </select>
                <select
                  value={newRegionType}
                  onChange={(e) => setNewRegionType(e.target.value as GroupType)}
                  className="h-8 rounded-[var(--radius-sm)] border border-border bg-bg px-2 text-xs text-text"
                >
                  <option value="url-test">url-test</option>
                  <option value="fallback">fallback</option>
                  <option value="select">select</option>
                  <option value="load-balance">load-balance</option>
                </select>
                <Button size="sm" variant="outline" onClick={handleAddRegionGroup}>
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('templates.editorAddRegionBtn')}</span>
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : activeTab === 'modules' ? (
        <div data-testid="editor-modules-tab" className="flex flex-col gap-3">
          {moduleBlockError ? (
            <div
              role="alert"
              data-testid="editor-module-conflict-alert"
              className="flex items-start gap-2 rounded-[var(--radius-md)] border border-danger bg-danger/10 px-3 py-2.5 text-xs text-text"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <div>
                <div className="font-semibold text-danger">{t('templates.editorModuleConflictTitle')}</div>
                <p className="mt-0.5">{moduleBlockError.reason}</p>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            {enhancementModules.map((mod) => {
              const enabled = moduleEnabledMap.get(mod.id) ?? false;
              const checkIfTurningOn = !enabled ? checkModuleToggleConflict(body.modules, mod.id, true) : null;
              return (
                <div
                  key={mod.id}
                  data-testid={`editor-module-${mod.id}`}
                  className="flex items-start justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-bg p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-text">{mod.name}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {mod.id}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-text-muted">{mod.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {mod.affects.map((affect) => (
                        <Badge key={affect} variant="outline" className="px-1.5 py-0 text-[10px]">
                          {affect}
                        </Badge>
                      ))}
                      {mod.conflictsWith && mod.conflictsWith.length > 0 ? (
                        <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                          {t('templates.editorConflictsWith')}: {mod.conflictsWith.join(', ')}
                        </Badge>
                      ) : null}
                    </div>
                    {checkIfTurningOn && !checkIfTurningOn.allowed ? (
                      <p className="mt-1 text-[11px] text-warning">{checkIfTurningOn.reason}</p>
                    ) : null}
                  </div>
                  <Switch
                    checked={enabled}
                    disabled={readOnly}
                    data-testid={`editor-module-switch-${mod.id}`}
                    aria-label={mod.name}
                    onCheckedChange={(checked) => handleModuleToggle(mod.id, checked)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div data-testid="editor-patches-tab" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {TEMPLATE_CLIENT_IDS.map((clientId) => {
              const client = TEMPLATE_CLIENTS[clientId];
              const hasPatch = Boolean(body.clientPatches?.[clientId]?.trim());
              return (
                <Button
                  key={clientId}
                  size="sm"
                  data-testid={`editor-patch-client-${clientId}`}
                  variant={patchClient === clientId ? 'primary' : 'outline'}
                  onClick={() => setPatchClient(clientId)}
                >
                  <span>{client.label}</span>
                  {hasPatch ? <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-accent" /> : null}
                </Button>
              );
            })}
          </div>

          <p className="text-xs text-text-muted">{t('templates.editorPatchesHint')}</p>

          <Suspense fallback={<div className="h-60 animate-pulse rounded-[var(--radius-md)] bg-surface-muted" />}>
            <CodeMirrorEditor
              testId="editor-patch-codemirror"
              ariaLabel={`${patchClient} client patch`}
              value={currentPatchValue}
              readOnly={readOnly}
              language={patchClient === 'mihomo' || patchClient === 'stash' ? 'yaml' : 'text'}
              placeholder={
                patchClient === 'mihomo'
                  ? '# mihomo YAML patch merged/appended to compiled output\n# e.g.\n# tun:\n#   enable: true'
                  : `# ${patchClient} raw patch`
              }
              minHeight="240px"
              maxHeight="440px"
              onChange={(nextVal) =>
                onApplyOp({
                  op: 'setPatch',
                  client: patchClient,
                  patch: nextVal.trim().length > 0 ? nextVal : null,
                })
              }
            />
          </Suspense>
        </div>
      )}
    </section>
  );
}
