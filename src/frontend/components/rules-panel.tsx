import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DomainRule, DomainRuleType, GeoSourceSuggestion, ImportPreview, RuleCategory } from '../../types/domain-rules';
import { FRIENDLY_RULE_TYPES, getFriendlyRuleDescription, getFriendlyRuleType } from '../../lib/rule-types';
import type { useDomainAdmin } from '../hooks/use-domain-admin';
import { copyText } from '../lib/clipboard';
import { CategoryIcon } from './category-icon';
import { IconPicker } from './icon-picker';
import { UiIcon } from './ui-icon';
import { SortToolbar, sortCategoryEntries, usePersistentSort } from './sort-toolbar';
import { validateCategoryName } from '../../lib/slug';

type Props = { api: ReturnType<typeof useDomainAdmin>; categories: RuleCategory[]; category?: RuleCategory; onSelectCategory: (id: string) => void; onToast: (message: string) => void };
const lines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const DEFAULT_USER_AGENT = 'clash-verge/v2.5.1';
const SYNC_INTERVALS = [
  { value: 15, label: '每 15 分钟' }, { value: 30, label: '每 30 分钟' }, { value: 60, label: '每小时' },
  { value: 360, label: '每 6 小时' }, { value: 720, label: '每 12 小时' }, { value: 1440, label: '每天' },
];

export function RulesPanel({ api, categories, category, onSelectCategory, onToast }: Props) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [type, setType] = useState<DomainRuleType | ''>('');
  const [query, setQuery] = useState('');
  const [allRulesQuery, setAllRulesQuery] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<'manual' | 'upstream'>('manual');
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const [newSources, setNewSources] = useState('');
  const [upstreamKind, setUpstreamKind] = useState<'url' | 'geosite'>('url');
  const [geositeQuery, setGeositeQuery] = useState('');
  const [geositeResults, setGeositeResults] = useState<GeoSourceSuggestion[]>([]);
  const [selectedGeosites, setSelectedGeosites] = useState<string[]>([]);
  const [selectedGeoips, setSelectedGeoips] = useState<string[]>([]);
  const [searchingGeosites, setSearchingGeosites] = useState(false);
  const [newSyncInterval, setNewSyncInterval] = useState(60);
  const [newUserAgent, setNewUserAgent] = useState(DEFAULT_USER_AGENT);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editSources, setEditSources] = useState('');
  const [editGeosites, setEditGeosites] = useState<string[]>([]);
  const [editGeoips, setEditGeoips] = useState<string[]>([]);
  const [editGeositeQuery, setEditGeositeQuery] = useState('');
  const [editGeositeResults, setEditGeositeResults] = useState<GeoSourceSuggestion[]>([]);
  const [searchingEditGeosites, setSearchingEditGeosites] = useState(false);
  const [editSyncInterval, setEditSyncInterval] = useState(60);
  const [editUserAgent, setEditUserAgent] = useState(DEFAULT_USER_AGENT);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [managingRules, setManagingRules] = useState(false);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [openRuleMenuId, setOpenRuleMenuId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRuleValue, setEditRuleValue] = useState('');
  const [editRuleNote, setEditRuleNote] = useState('');
  const [editRuleType, setEditRuleType] = useState<DomainRuleType>('DOMAIN-SUFFIX');
  const [pendingDeleteRuleIds, setPendingDeleteRuleIds] = useState<string[]>([]);
  const [animatingRuleId, setAnimatingRuleId] = useState<string | null>(null);
  const [dockSpaceConstrained, setDockSpaceConstrained] = useState(false);
  const managementControlRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const { value: categorySortKey, direction: categorySortDirection, setValue: setCategorySortKey, setDirection: setCategorySortDirection } = usePersistentSort('rule-categories');
  const customPacks = api.data?.settings.customIconPackUrls ?? [];
  const customPackNames = api.data?.settings.customIconPackNames ?? {};

  const filteredRules = useMemo(() => category?.rules.filter((rule) => `${rule.value} ${rule.note ?? ''} ${rule.sourceName ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [category, query]);
  const manualRules = filteredRules.filter((rule) => !rule.sourceId);
  const hasCustomRules = Boolean(category?.rules.some((rule) => !rule.sourceId));
  const sortedManualRules = useMemo(() => [...manualRules].sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)), [manualRules]);
  const selectedRuleEnabled = selectedRuleIds.length ? category?.rules.find((rule) => rule.id === selectedRuleIds[0])?.enabled : undefined;
  const defaultSelectionEnabled = sortedManualRules.some((rule) => rule.enabled);
  const compatibleManualRules = sortedManualRules.filter((rule) => rule.enabled === (selectedRuleEnabled ?? defaultSelectionEnabled));
  const allCompatibleRulesSelected = compatibleManualRules.length > 0 && compatibleManualRules.every((rule) => selectedRuleIds.includes(rule.id));
  const editingRule = category?.rules.find((rule) => rule.id === editingRuleId && !rule.sourceId);
  const upstreamRules = filteredRules.filter((rule) => Boolean(rule.sourceId));
  const allRules = useMemo(() => categories.flatMap((item) => item.rules.map((rule) => ({ ...rule, category: item }))), [categories]);
  const normalizedAllRulesQuery = allRulesQuery.trim().toLowerCase();
  const searchedAllRules = useMemo(() => !normalizedAllRulesQuery ? allRules : allRules.filter((rule) => [
    rule.value,
    rule.note,
    rule.type,
    rule.displayType,
    rule.sourceName,
    rule.category.name,
    rule.category.description,
  ].some((field) => field?.toLowerCase().includes(normalizedAllRulesQuery))), [allRules, normalizedAllRulesQuery]);
  const newNameError = validateCategoryName(newName);
  const editNameError = validateCategoryName(editName);
  const categorySourceMode = !category?.sources?.length
    ? 'manual'
    : category.sources.every((source) => source.sourceType === 'geosite' || source.sourceType === 'geoip')
      ? 'geo'
      : category.sources.every((source) => source.sourceType === 'url' || !source.sourceType)
        ? 'url'
        : 'mixed';

  useEffect(() => {
    setEditing(false); setConfirmDelete(false); setQuery(''); setManagingRules(false); setSelectedRuleIds([]); setOpenRuleMenuId(null); setEditingRuleId(null); setPendingDeleteRuleIds([]);
    setEditSources(''); setEditGeosites([]); setEditGeoips([]); setEditGeositeQuery(''); setEditGeositeResults([]);
  }, [category?.id]);

  useEffect(() => {
    if (!managingRules) { setDockSpaceConstrained(false); return; }
    const updateDock = () => {
      const topBar = managementControlRef.current?.getBoundingClientRect();
      const bottomBar = dockRef.current?.getBoundingClientRect();
      if (!topBar || !bottomBar) return;
      const globalNav = document.querySelector<HTMLElement>('.bottom-nav');
      const globalNavRect = globalNav && getComputedStyle(globalNav).display !== 'none' ? globalNav.getBoundingClientRect() : null;
      const bottomOffset = globalNavRect?.height ? window.innerHeight - globalNavRect.top + 12 : 18;
      const desiredTop = window.innerHeight - bottomOffset - bottomBar.height;
      const minimumTop = topBar.bottom + 12;
      dockRef.current?.style.setProperty('--management-dock-left', `${topBar.left}px`);
      dockRef.current?.style.setProperty('--management-dock-width', `${topBar.width}px`);
      dockRef.current?.style.setProperty('--management-dock-bottom', `${bottomOffset}px`);
      setDockSpaceConstrained(minimumTop > desiredTop);
    };
    updateDock();
    const interval = window.setInterval(updateDock, 160);
    window.addEventListener('scroll', updateDock, { passive: true });
    window.addEventListener('resize', updateDock);
    document.addEventListener('scroll', updateDock, { passive: true, capture: true });
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('scroll', updateDock);
      window.removeEventListener('resize', updateDock);
      document.removeEventListener('scroll', updateDock, { capture: true });
    };
  }, [managingRules, sortedManualRules.length]);

  async function setRuleEnabled(rule: DomainRule, enabled: boolean) {
    if (!category) return;
    const maxOrder = Math.max(0, ...category.rules.filter((item) => !item.sourceId).map((item) => item.sortOrder ?? 0));
    setAnimatingRuleId(rule.id);
    await api.updateRule(category.id, { ...rule, enabled, sortOrder: maxOrder + 1 });
    window.setTimeout(() => setAnimatingRuleId((current) => current === rule.id ? null : current), 560);
  }

  function beginRuleEdit(rule: DomainRule) {
    setEditingRuleId(rule.id); setEditRuleValue(rule.value); setEditRuleNote(rule.note ?? ''); setEditRuleType(rule.type); setOpenRuleMenuId(null);
  }

  async function saveRuleEdit() {
    if (!category || !editingRule || !editRuleValue.trim()) return;
    await api.updateRule(category.id, { ...editingRule, value: editRuleValue.trim(), note: editRuleNote.trim(), type: editRuleType });
    setEditingRuleId(null); onToast('规则已更新');
  }

  async function copyRules(ruleIds: string[]) {
    if (!category) return;
    const content = category.rules.filter((rule) => ruleIds.includes(rule.id)).map((rule) => rule.value).join('\n');
    await copyText(content); onToast(`已复制 ${ruleIds.length} 条规则`);
  }

  async function runBatchStatus(enabled: boolean) {
    if (!category || !selectedRuleIds.length) return;
    await api.batchRules(category.id, selectedRuleIds, enabled ? 'enable' : 'disable');
    setSelectedRuleIds([]); onToast(enabled ? '所选规则已启用' : '所选规则已禁用');
  }

  async function confirmRuleDeletion() {
    if (!category || !pendingDeleteRuleIds.length) return;
    await api.batchRules(category.id, pendingDeleteRuleIds, 'delete');
    setPendingDeleteRuleIds([]); setSelectedRuleIds([]); setOpenRuleMenuId(null);
    onToast('规则已删除');
  }

  function toggleManagedRule(rule: DomainRule) {
    if (selectedRuleEnabled !== undefined && rule.enabled !== selectedRuleEnabled) return;
    setSelectedRuleIds((current) => current.includes(rule.id) ? current.filter((id) => id !== rule.id) : [...current, rule.id]);
  }

  function selectAllCompatibleRules() {
    setSelectedRuleIds(allCompatibleRulesSelected ? [] : compatibleManualRules.map((rule) => rule.id));
  }

  useEffect(() => {
    if (createMode !== 'upstream' || upstreamKind !== 'geosite' || geositeQuery.trim().length < 2) { setGeositeResults([]); return; }
    const timer = window.setTimeout(async () => {
      setSearchingGeosites(true);
      try { setGeositeResults(await api.searchGeoSources(geositeQuery)); }
      catch { setGeositeResults([]); }
      finally { setSearchingGeosites(false); }
    }, 320);
    return () => window.clearTimeout(timer);
  }, [api.searchGeoSources, createMode, geositeQuery, upstreamKind]);

  useEffect(() => {
    if (!editing || (categorySourceMode !== 'geo' && categorySourceMode !== 'mixed') || editGeositeQuery.trim().length < 2) { setEditGeositeResults([]); return; }
    const timer = window.setTimeout(async () => {
      setSearchingEditGeosites(true);
      try { setEditGeositeResults(await api.searchGeoSources(editGeositeQuery)); }
      catch { setEditGeositeResults([]); }
      finally { setSearchingEditGeosites(false); }
    }, 320);
    return () => window.clearTimeout(timer);
  }, [api.searchGeoSources, categorySourceMode, editGeositeQuery, editing]);

  async function createCategory() {
    const sourceUrls = createMode === 'upstream' && upstreamKind === 'url' ? lines(newSources) : [];
    const geositeNames = createMode === 'upstream' && upstreamKind === 'geosite' ? selectedGeosites : [];
    const geoipNames = createMode === 'upstream' && upstreamKind === 'geosite' ? selectedGeoips : [];
    if (newNameError || (createMode === 'upstream' && !sourceUrls.length && !geositeNames.length && !geoipNames.length)) return;
    await api.createCategory({ name: newName, icon: newIcon, description: newDescription, sourceUrls, geositeNames, geoipNames, syncIntervalMinutes: newSyncInterval, userAgent: newUserAgent, tokenLinksEnabled: createMode === 'manual', publicLinksEnabled: createMode === 'upstream' });
    setNewName(''); setNewDescription(''); setNewIcon(''); setNewSources(''); setSelectedGeosites([]); setSelectedGeoips([]); setGeositeQuery(''); setNewSyncInterval(60); setNewUserAgent(DEFAULT_USER_AGENT); setShowCreate(false);
    onToast(sourceUrls.length || geositeNames.length || geoipNames.length ? '规则已创建并完成首次上游同步' : '自定义规则已创建');
  }

  if (!category) {
    const sources = categories.flatMap((item) => item.sources ?? []);
    const sourceCounts = { all: sources.length, url: sources.filter((source) => source.sourceType === 'url' || !source.sourceType).length, geosite: sources.filter((source) => source.sourceType === 'geosite').length, geoip: sources.filter((source) => source.sourceType === 'geoip').length };
    const sourceTypeById = new Map(sources.map((source) => [source.id, source.sourceType ?? 'url']));
    const ruleGroups = [
      { id: 'manual', label: '自定义规则', description: '可进入规则详情继续编辑', rules: searchedAllRules.filter((rule) => !rule.sourceId) },
      { id: 'url', label: '上游订阅', description: '来自远程订阅链接的只读镜像', rules: searchedAllRules.filter((rule) => rule.sourceId && sourceTypeById.get(rule.sourceId) === 'url') },
      { id: 'geo', label: 'Geo 数据库', description: '来自 GeoSite 与 GeoIP 的只读镜像', rules: searchedAllRules.filter((rule) => rule.sourceId && sourceTypeById.get(rule.sourceId) !== 'url') },
    ];
    const groupedByCategory = (rules: typeof allRules) => categories.map((item) => { const matched = rules.filter((rule) => rule.category.id === item.id); return { category: item, count: matched.length, rules: matched }; }).filter((entry) => entry.count);
    const sortedCategories = sortCategoryEntries(categories.map((item) => ({ category: item, count: item.rules.length })), categorySortKey, categorySortDirection).map((entry) => entry.category);
    return <div className="page-stack unified-page">
      <header className="page-title"><div><span className="eyebrow">RULE LIBRARY</span><h1>规则汇总</h1><p>从零维护规则，或聚合多个上游来源继续处理</p></div><button className="primary-action title-action" onClick={() => setShowCreate(true)}><UiIcon name="plus" size={19}/>新建规则</button></header>
      {showCreate && createPortal(<div className="rules-dialog-backdrop" onMouseDown={() => setShowCreate(false)}><section className="soft-card unified-card category-builder rules-editor-dialog create-rule-dialog" role="dialog" aria-modal="true" aria-labelledby="create-rule-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="builder-head"><div><h2 id="create-rule-title">新建规则</h2><p>选择从零构建或引用持续维护的上游规则</p></div><button className="dialog-close-button" aria-label="关闭新建规则" onClick={() => setShowCreate(false)}><UiIcon name="close" size={18}/></button></div><div className="upstream-kind-tabs creation-mode-tabs"><button className={createMode === 'manual' ? 'active' : ''} onClick={() => setCreateMode('manual')}><UiIcon name="edit" size={17}/>从零构建</button><button className={createMode === 'upstream' ? 'active' : ''} onClick={() => setCreateMode('upstream')}><UiIcon name="links" size={17}/>引用上游</button></div>
        <div className="creation-mode-content" key={createMode}>
          <div className="builder-fields"><label><span>分类名称</span><input className={`app-input ${newName && newNameError ? 'input-invalid' : ''}`} placeholder="例如 Emby_Direct" value={newName} onChange={(event) => setNewName(event.target.value)}/><small className={newName && newNameError ? 'field-error' : ''}>{newName && newNameError ? newNameError : '仅限英文字母、数字、空格和英文标点'}</small></label><label><span>分类说明</span><input className="app-input" placeholder="可留空" value={newDescription} onChange={(event) => setNewDescription(event.target.value)}/></label></div>
          <IconPicker value={newIcon} name={newName} customPackUrls={customPacks} customPackNames={customPackNames} onChange={setNewIcon}/>
          {createMode === 'upstream' && <>
          <div className="upstream-kind-tabs"><button className={upstreamKind === 'url' ? 'active' : ''} onClick={() => setUpstreamKind('url')}><UiIcon name="links" size={17}/>订阅地址</button><button className={upstreamKind === 'geosite' ? 'active' : ''} onClick={() => setUpstreamKind('geosite')}><UiIcon name="database" size={17}/>Geo 数据库</button></div>
          <div className="upstream-kind-content" key={upstreamKind}>{upstreamKind === 'url' ? <div className="upstream-create-fields"><label className="source-input"><span>上游订阅地址，一行一个</span><textarea className="app-input textarea" placeholder={'https://example.com/media.yaml\nhttps://example.com/custom.list'} value={newSources} onChange={(event) => setNewSources(event.target.value)}/><small>首次创建会立即同步，之后按所选间隔自动更新</small></label><div className="upstream-request-fields"><label><span>User-Agent</span><input className="app-input" maxLength={256} placeholder={DEFAULT_USER_AGENT} value={newUserAgent} onChange={(event) => setNewUserAgent(event.target.value)}/><small>常见值：clash-verge/v2.5.1、clash.meta/1.19.20、Clash</small></label><label className="sync-interval-field"><span>自动同步间隔</span><select className="app-input" value={newSyncInterval} onChange={(event) => setNewSyncInterval(Number(event.target.value))}>{SYNC_INTERVALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div></div> : <div className="geosite-builder">
            <div className="geosite-search-row"><label><span>搜索 GeoSite 与 GeoIP</span><div className="search-box geosite-search"><UiIcon name="search" size={18}/><input value={geositeQuery} onChange={(event) => setGeositeQuery(event.target.value)} placeholder="输入关键词，例如 telegram、ai、netflix"/></div><small>同一关键词会同时匹配域名规则与 IP 规则，可组合选择</small></label><label className="sync-interval-field"><span>自动同步间隔</span><select className="app-input" value={newSyncInterval} onChange={(event) => setNewSyncInterval(Number(event.target.value))}>{SYNC_INTERVALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
            {!!(selectedGeosites.length || selectedGeoips.length) && <div className="selected-geosites">{selectedGeosites.map((name) => <button key={`geosite-${name}`} onClick={() => setSelectedGeosites((current) => current.filter((item) => item !== name))}><span>geosite:{name}</span><UiIcon name="close" size={14}/></button>)}{selectedGeoips.map((name) => <button className="geoip-chip" key={`geoip-${name}`} onClick={() => setSelectedGeoips((current) => current.filter((item) => item !== name))}><span>geoip:{name}</span><UiIcon name="close" size={14}/></button>)}</div>}
            <div className="geosite-results">{searchingGeosites && <div className="geosite-loading">正在查询 Geo 数据索引…</div>}{!searchingGeosites && geositeResults.map((result) => { const selected = result.sourceType === 'geosite' ? selectedGeosites.includes(result.name) : selectedGeoips.includes(result.name); const toggle = () => result.sourceType === 'geosite' ? setSelectedGeosites((current) => selected ? current.filter((name) => name !== result.name) : [...current, result.name]) : setSelectedGeoips((current) => selected ? current.filter((name) => name !== result.name) : [...current, result.name]); return <button className={`${selected ? 'selected' : ''} ${result.sourceType}`} key={`${result.sourceType}-${result.name}`} onClick={toggle}><span><strong>{result.sourceType}:{result.name}</strong><small>{result.description}</small></span><em className={result.sourceType}>{result.sourceType === 'geoip' ? 'IP 规则' : result.recommended ? '聚合分类 · 推荐' : '域名规则'}</em><UiIcon name={selected ? 'check' : 'plus'} size={17}/></button>; })}{!searchingGeosites && geositeQuery.trim().length >= 2 && !geositeResults.length && <div className="geosite-loading">没有找到匹配的 Geo 规则</div>}</div>
          </div>}</div>
          </>}
          <div className="builder-submit"><span>{createMode === 'manual' ? '默认私密访问，创建后可在订阅页修改' : upstreamKind === 'url' ? `默认公开访问 · 已填写 ${lines(newSources).length} 个上游来源` : `默认公开访问 · 已选择 ${selectedGeosites.length} 个 GeoSite 与 ${selectedGeoips.length} 个 GeoIP`}</span><button className="primary-action" disabled={Boolean(newNameError) || (createMode === 'upstream' && upstreamKind === 'url' && !lines(newSources).length) || (createMode === 'upstream' && upstreamKind === 'geosite' && !selectedGeosites.length && !selectedGeoips.length)} onClick={createCategory}>创建规则</button></div>
        </div>
      </section></div>, document.body)}
      <div className="summary-strip source-summary-strip"><span><small>上游来源</small><strong>{sourceCounts.all}</strong></span><span><small>上游订阅</small><strong>{sourceCounts.url}</strong></span><span><small>GeoSite</small><strong>{sourceCounts.geosite}</strong></span><span><small>GeoIP</small><strong>{sourceCounts.geoip}</strong></span></div>
      <section className="soft-card unified-card"><div className="section-inline sort-section-head"><div><h2>规则分类</h2><p>点击规则进入来源和同步管理</p></div><SortToolbar value={categorySortKey} direction={categorySortDirection} onChange={(key, direction) => { setCategorySortKey(key); setCategorySortDirection(direction); }}/></div><div className="category-summary-grid sort-content-transition" key={`categories-${categorySortKey}-${categorySortDirection}`}>{sortedCategories.map((item) => <button className="category-summary-card" key={item.id} onClick={() => onSelectCategory(item.id)}><CategoryIcon icon={item.icon} name={item.name}/><span><strong data-no-translate>{item.name}</strong>{item.sources?.length ? <small>{item.sources.length} 个上游 · {item.lastSyncedAt ? `同步于 ${new Date(item.lastSyncedAt).toLocaleString('zh-CN')}` : '等待同步'}</small> : <small data-no-translate={Boolean(item.description)}>{item.description || '手动维护'}</small>}</span><span className="category-count">{item.rules.length}</span><UiIcon name="chevronRight" size={19}/></button>)}</div></section>
      <section className="soft-card unified-card grouped-rules-section">
        <div className="all-rules-header"><div><h2>所有规则</h2><p>按来源与分类折叠，展开后查看具体规则</p></div><label className="search-box all-rules-search"><UiIcon name="search" size={18}/><input aria-label="搜索域名、关键词、IP、类型、来源或分类" placeholder="搜索域名、关键词、IP、类型、来源或分类" value={allRulesQuery} onChange={(event) => setAllRulesQuery(event.target.value)}/></label></div>
        <div className="rule-source-groups sort-content-transition">{ruleGroups.map((group) => <details className={`rule-source-group animated-disclosure ${group.id}`} open={normalizedAllRulesQuery && group.rules.length > 0 ? true : undefined} key={group.id}><summary><span><UiIcon name={group.id === 'manual' ? 'edit' : group.id === 'url' ? 'links' : 'database'} size={19}/><span><strong>{group.label}</strong><small>{group.description}</small></span></span><span><strong>{group.rules.length}</strong> 条<UiIcon name="chevron" size={16}/></span></summary><div className="category-rule-folders">{groupedByCategory(group.rules).map((entry) => <details className="category-rule-folder animated-disclosure" open={Boolean(normalizedAllRulesQuery) || undefined} key={`${group.id}-${entry.category.id}`}><summary><span><CategoryIcon icon={entry.category.icon} name={entry.category.name} size={38}/><strong>{entry.category.name}</strong></span><span>{entry.count} 条<UiIcon name="chevron" size={15}/></span></summary><div className="all-rules-table compact-group-table">{entry.rules.map((rule) => group.id === 'manual' ? <button className="all-rule-row" key={rule.id} onClick={() => onSelectCategory(rule.category.id)}><span className={`rule-state ${rule.enabled ? 'on' : ''}`}/><span className="rule-main"><strong>{rule.value}</strong><small>{getFriendlyRuleType(rule)} · 自定义规则{rule.note ? ` · ${rule.note}` : ''}</small></span><UiIcon name="chevronRight" size={18}/></button> : <div className="all-rule-row readonly-summary-row" key={rule.id}><span className={`rule-state ${rule.enabled ? 'on' : ''}`}/><span className="rule-main"><strong>{rule.value}</strong><small>{getFriendlyRuleType(rule)} · 来自 {rule.sourceName}</small></span><span className="readonly-badge">只读</span></div>)}</div></details>)}{!group.rules.length && <div className="empty-state compact-empty"><span>{normalizedAllRulesQuery ? '没有匹配规则' : `暂无${group.label}`}</span></div>}</div></details>)}</div>
      </section>
    </div>;
  }

  const currentCategory = category;
  async function add() { await api.addRule(currentCategory.id, { value, type: type || undefined, note }); setValue(''); setNote(''); onToast('规则已添加'); }
  async function previewImport() { const result = await api.importPreview(currentCategory.id, bulkText); setPreview(result.preview); }
  async function confirmImport() { await api.confirmImport(currentCategory.id, bulkText); setBulkText(''); setPreview(null); onToast('批量导入完成'); }
  async function editCategory() {
    if (editNameError) return;
    const sourceInput = categorySourceMode === 'url'
      ? { sourceUrls: lines(editSources), geositeNames: [] }
      : categorySourceMode === 'geo'
        ? { sourceUrls: [], geositeNames: editGeosites, geoipNames: editGeoips }
        : categorySourceMode === 'mixed'
          ? { sourceUrls: lines(editSources), geositeNames: editGeosites, geoipNames: editGeoips }
          : {};
    await api.updateCategory(currentCategory.id, { name: editName, description: editDescription, icon: editIcon, syncIntervalMinutes: editSyncInterval, userAgent: editUserAgent, ...sourceInput });
    setEditing(false); onToast('分类配置已更新');
  }
  async function removeCategory() { await api.deleteCategory(currentCategory.id); onSelectCategory(''); setConfirmDelete(false); onToast('分类已删除'); }
  async function syncCategory() { setSyncing(true); try { await api.syncCategory(currentCategory.id); onToast('该分类的上游规则已同步'); } finally { setSyncing(false); } }
  function openEditor() { const urlSource = (currentCategory.sources ?? []).find((source) => source.sourceType === 'url' || !source.sourceType); setEditName(currentCategory.name); setEditDescription(currentCategory.description ?? ''); setEditIcon(currentCategory.icon ?? ''); setEditSources((currentCategory.sources ?? []).filter((source) => source.sourceType === 'url' || !source.sourceType).map((source) => source.url).join('\n')); setEditGeosites((currentCategory.sources ?? []).filter((source) => source.sourceType === 'geosite' && source.geositeName).map((source) => source.geositeName!)); setEditGeoips((currentCategory.sources ?? []).filter((source) => source.sourceType === 'geoip' && source.geoipName).map((source) => source.geoipName!)); setEditGeositeQuery(''); setEditGeositeResults([]); setEditSyncInterval(currentCategory.syncIntervalMinutes ?? 60); setEditUserAgent(urlSource?.userAgent ?? DEFAULT_USER_AGENT); setEditing(true); }

  return <div className="page-stack unified-page">
    <header className="page-title detail-title"><div><button className="back-button" onClick={() => onSelectCategory('')}><UiIcon name="arrowLeft" size={20}/>返回规则汇总</button><div className="detail-name"><CategoryIcon icon={category.icon} name={category.name} size={58}/><span><h1 data-no-translate>{category.name}</h1><p data-no-translate={Boolean(category.description)}>{category.description || '维护这个规则下的内容'}</p></span></div></div><div className="title-actions"><button className="subtle-action" onClick={openEditor}><UiIcon name="edit" size={17}/>编辑规则</button><button className="danger-action icon-action" onClick={() => setConfirmDelete(true)}><UiIcon name="trash" size={17}/>删除规则</button></div></header>
    {editing && createPortal(<div className="rules-dialog-backdrop" onMouseDown={() => setEditing(false)}><section className="soft-card unified-card category-builder rules-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-rule-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="builder-head"><div><h2 id="edit-rule-title">编辑规则</h2><p>来源类型保持独立，远程订阅不会与 Geo 数据配置相互覆盖</p></div><button className="dialog-close-button" aria-label="关闭编辑规则" onClick={() => setEditing(false)}><UiIcon name="close" size={18}/></button></div><span className={`source-type-badge ${categorySourceMode}`}>{categorySourceMode === 'manual' ? '手动维护' : categorySourceMode === 'url' ? '远程订阅' : categorySourceMode === 'geo' ? 'Geo 数据' : '混合来源'}</span>
      <div className="builder-fields"><label><span>分类名称</span><input className={`app-input ${editName && editNameError ? 'input-invalid' : ''}`} value={editName} onChange={(event) => setEditName(event.target.value)}/><small className={editName && editNameError ? 'field-error' : ''}>{editName && editNameError ? editNameError : '保存后订阅链接会立即使用新名称'}</small></label><label><span>分类说明</span><input className="app-input" value={editDescription} onChange={(event) => setEditDescription(event.target.value)}/></label></div>
      {categorySourceMode === 'manual' && <div className="source-lock-notice"><UiIcon name="edit" size={18}/><span><strong>自定义规则</strong><small>仅维护自定义规则，不显示远程订阅或 Geo 数据设置</small></span></div>}
      {(categorySourceMode === 'url' || categorySourceMode === 'mixed') && <div className="upstream-create-fields"><label className="source-input"><span>远程订阅地址，一行一个</span><textarea className="app-input textarea" value={editSources} onChange={(event) => setEditSources(event.target.value)}/><small>继续使用订阅链接作为上游，不会切换为 Geo 数据</small></label><div className="upstream-request-fields"><label><span>User-Agent</span><input className="app-input" maxLength={256} placeholder={DEFAULT_USER_AGENT} value={editUserAgent} onChange={(event) => setEditUserAgent(event.target.value)}/><small>常见值：clash-verge/v2.5.1、clash.meta/1.19.20、Clash</small></label><label className="sync-interval-field"><span>自动同步间隔</span><select className="app-input" value={editSyncInterval} onChange={(event) => setEditSyncInterval(Number(event.target.value))}>{SYNC_INTERVALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div></div>}
      {(categorySourceMode === 'geo' || categorySourceMode === 'mixed') && <div className="geosite-builder edit-geosite-builder"><div className="geosite-search-row"><label><span>更换或追加 GeoSite 与 GeoIP</span><div className="search-box geosite-search"><UiIcon name="search" size={18}/><input value={editGeositeQuery} onChange={(event) => setEditGeositeQuery(event.target.value)} placeholder="输入关键词，例如 telegram、youtube"/></div><small>同时搜索域名与 IP 规则，不会混入远程订阅链接</small></label>{categorySourceMode === 'geo' && <label className="sync-interval-field"><span>自动同步间隔</span><select className="app-input" value={editSyncInterval} onChange={(event) => setEditSyncInterval(Number(event.target.value))}>{SYNC_INTERVALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}</div><div className="selected-geosites">{editGeosites.map((name) => <button key={`geosite-${name}`} onClick={() => setEditGeosites((current) => current.filter((item) => item !== name))}><span>geosite:{name}</span><UiIcon name="close" size={14}/></button>)}{editGeoips.map((name) => <button className="geoip-chip" key={`geoip-${name}`} onClick={() => setEditGeoips((current) => current.filter((item) => item !== name))}><span>geoip:{name}</span><UiIcon name="close" size={14}/></button>)}</div>{editGeositeQuery.trim().length >= 2 && <div className="geosite-results">{searchingEditGeosites && <div className="geosite-loading">正在查询 Geo 数据索引…</div>}{!searchingEditGeosites && editGeositeResults.map((result) => { const selected = result.sourceType === 'geosite' ? editGeosites.includes(result.name) : editGeoips.includes(result.name); const toggle = () => result.sourceType === 'geosite' ? setEditGeosites((current) => selected ? current.filter((name) => name !== result.name) : [...current, result.name]) : setEditGeoips((current) => selected ? current.filter((name) => name !== result.name) : [...current, result.name]); return <button className={`${selected ? 'selected' : ''} ${result.sourceType}`} key={`${result.sourceType}-${result.name}`} onClick={toggle}><span><strong>{result.sourceType}:{result.name}</strong><small>{result.description}</small></span><em className={result.sourceType}>{result.sourceType === 'geoip' ? 'IP 规则' : result.recommended ? '聚合分类 · 推荐' : '域名规则'}</em><UiIcon name={selected ? 'check' : 'plus'} size={17}/></button>; })}</div>}</div>}
      <IconPicker value={editIcon} name={editName} customPackUrls={customPacks} customPackNames={customPackNames} onChange={setEditIcon}/><div className="builder-submit"><span>{categorySourceMode === 'manual' ? '保存规则信息不会添加上游来源' : '保存后可随时同步最新规则'}</span><button className="primary-action" disabled={Boolean(editNameError) || (categorySourceMode === 'geo' && !editGeosites.length && !editGeoips.length)} onClick={editCategory}>保存规则配置</button></div>
    </section></div>, document.body)}
    {confirmDelete && createPortal(<div className="rules-dialog-backdrop delete-dialog-backdrop" onMouseDown={() => setConfirmDelete(false)}><section className="rule-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-rule-title" onMouseDown={(event) => event.stopPropagation()}><span className="action-dialog-icon red"><UiIcon name="trash" size={24}/></span><div><h2 id="delete-rule-title">删除规则 {category.name}</h2><p>将永久删除该规则、上游来源和其中的 {category.rules.length} 条内容，此操作无法撤销</p></div><div className="action-dialog-actions"><button onClick={() => setConfirmDelete(false)}>取消</button><button className="danger-action icon-action" onClick={removeCategory}><UiIcon name="trash" size={17}/>确认删除</button></div></section></div>, document.body)}
    {!!category.sources?.length && <section className="soft-card unified-card source-panel"><div className="section-inline"><div><h2>上游同步</h2><p>{SYNC_INTERVALS.find((item) => item.value === (category.syncIntervalMinutes ?? 60))?.label ?? `每 ${category.syncIntervalMinutes ?? 60} 分钟`}自动更新，镜像规则保持只读</p></div><button className="primary-action icon-action sync-action" disabled={syncing} onClick={syncCategory}><UiIcon name="sync" size={18}/>{syncing ? '正在同步…' : '同步上游'}</button></div><div className="source-list">{category.sources.map((source) => <div className="source-row" key={source.id}><span className={`source-status ${source.lastStatus ?? 'pending'}`}/><span><strong>{source.name}</strong><small>{source.sourceType === 'geoip' ? `geoip:${source.geoipName}` : source.sourceType === 'geosite' ? `geosite:${source.geositeName}` : source.url}</small></span><span><strong>{source.lastCount ?? 0}</strong><small>条规则</small></span><time>{source.lastSyncedAt ? `最后同步 ${new Date(source.lastSyncedAt).toLocaleString('zh-CN')}` : '等待首次同步'}</time></div>)}</div><details className="upstream-rules-disclosure animated-disclosure"><summary className="upstream-rules-toggle"><span><UiIcon name="database" size={18}/>上游镜像规则 <strong>{category.rules.filter((rule) => rule.sourceId).length}</strong></span><span>展开查看 <UiIcon name="chevronRight" size={17}/></span></summary><div className="rule-list upstream-readonly-list">{upstreamRules.map((rule) => <article className="rule-row readonly-rule-row" key={rule.id}><span className="readonly-lock"><UiIcon name="database" size={16}/></span><div><strong>{rule.value}</strong><span>{getFriendlyRuleType(rule)} · 上游：{rule.sourceName}</span></div><span className="readonly-badge">只读</span></article>)}</div></details></section>}
    <div className="detail-layout">
      <section className="soft-card unified-card input-panel add-rule-card"><div className="card-title"><span className="metric-icon blue"><UiIcon name="plus"/></span><div><h2>逐个添加</h2><p>自定义规则不会被上游同步覆盖</p></div></div><label><span>规则地址</span><input className="app-input" placeholder="例如：chatgpt.com、1-79、127.0.0.0/8" value={value} onChange={(event) => setValue(event.target.value)}/></label><div className="rule-type-field"><span>规则类型</span><select className="app-input" value={type} onChange={(event) => setType(event.target.value as DomainRuleType)}><option value="">自动识别</option>{FRIENDLY_RULE_TYPES.filter((item) => item.type).map((item) => <option key={item.label} value={item.type}>{item.label} — {item.description}</option>)}</select></div><label><span>备注，可不填</span><input className="app-input" placeholder="例如：ChatGPT 官网" value={note} onChange={(event) => setNote(event.target.value)}/></label><button className="primary-action" disabled={!value.trim()} onClick={add}>添加规则</button></section>
      <section className="soft-card unified-card input-panel bulk-card"><div className="card-title"><span className="metric-icon purple"><UiIcon name="upload"/></span><div><h2>批量添加</h2><p>一行一条，预览确认后再导入</p></div></div><textarea className="app-input textarea" placeholder={'chatgpt.com\n+.apple.com\n127.0.0.0/8'} value={bulkText} onChange={(event) => setBulkText(event.target.value)}/><div className="card-actions bulk-preview-actions"><button className="preview-action icon-action" onClick={previewImport} disabled={!bulkText.trim()}><UiIcon name="search" size={17}/>预览规则</button></div></section>
    </div>
    {preview && createPortal(<div className="rules-dialog-backdrop" onMouseDown={() => setPreview(null)}><section className="bulk-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-preview-title" onMouseDown={(event) => event.stopPropagation()}><div className="builder-head"><div><h2 id="bulk-preview-title">批量导入预览</h2><p>确认规则类型和重复项，导入后仍可逐条调整</p></div><button className="dialog-close-button" aria-label="关闭导入预览" onClick={() => setPreview(null)}><UiIcon name="close" size={18}/></button></div><div className="import-preview-summary"><span><strong>{preview.rules.length}</strong><small>可导入</small></span><span><strong>{preview.duplicateValues.length}</strong><small>重复</small></span><span><strong>{preview.invalidValues.length}</strong><small>无效</small></span></div><div className="import-preview-list">{preview.rules.map((rule) => <div key={`${rule.type}-${rule.value}`}><span className="rule-state on"/><span><strong>{rule.value}</strong><small>{rule.type}</small></span></div>)}{!preview.rules.length && <div className="empty-state compact-empty"><strong>没有可导入的规则</strong><span>请返回修改批量内容</span></div>}</div><div className="bulk-preview-footer"><button onClick={() => setPreview(null)}>取消导入</button><button className="primary-action icon-action" disabled={!preview.rules.length} onClick={confirmImport}><UiIcon name="upload" size={17}/>确认导入 {preview.rules.length} 条</button></div></section></div>, document.body)}
    <section className={`soft-card unified-card custom-rules-card ${managingRules ? 'managing' : ''}`}><div className="section-inline rules-list-head"><div><h2>自定义规则</h2><p>{manualRules.length} 条，可单条维护或批量管理</p></div><div className="custom-rules-head-actions"><label className="search-box"><UiIcon name="search" size={18}/><input placeholder="搜索规则或来源" value={query} onChange={(event) => setQuery(event.target.value)}/></label></div></div>
      {(hasCustomRules || managingRules) && <div className="rule-management-control" ref={managementControlRef}>{!managingRules ? <button className="manage-rules-button icon-action" onClick={() => { setDockSpaceConstrained(true); setManagingRules(true); setOpenRuleMenuId(null); }}><UiIcon name="manage" size={19}/><span><strong>管理规则</strong><small>批量选择与维护</small></span><UiIcon name="chevronRight" size={17}/></button> : <div className="management-command-bar"><button className="management-modify" title={selectedRuleEnabled === undefined ? '选择规则后修改启用状态' : `修改为${selectedRuleEnabled ? '禁用' : '启用'}`} disabled={!selectedRuleIds.length} onClick={() => runBatchStatus(selectedRuleEnabled === false)}><UiIcon name={selectedRuleEnabled === undefined ? 'edit' : selectedRuleEnabled ? 'close' : 'check'} size={17}/>{selectedRuleEnabled === undefined ? '修改' : selectedRuleEnabled ? '禁用' : '启用'}</button><button className="management-copy" disabled={!selectedRuleIds.length} onClick={() => copyRules(selectedRuleIds)}><UiIcon name="copy" size={17}/>复制</button><button className="management-delete" disabled={!selectedRuleIds.length} onClick={() => setPendingDeleteRuleIds(selectedRuleIds)}><UiIcon name="trash" size={17}/>删除</button></div>}</div>}
      <div className="rule-list modern-rule-list managed-rule-list">{sortedManualRules.map((rule) => { const selected = selectedRuleIds.includes(rule.id); const incompatible = managingRules && selectedRuleEnabled !== undefined && rule.enabled !== selectedRuleEnabled; return <article aria-disabled={incompatible || undefined} className={`rule-row selectable-rule-row ${rule.enabled ? '' : 'disabled'} ${selected ? 'selected' : ''} ${incompatible ? 'selection-incompatible' : ''} ${animatingRuleId === rule.id ? 'state-changing' : ''}`} key={rule.id} onClick={managingRules ? () => toggleManagedRule(rule) : undefined}>{!managingRules && <label className="switch rule-start-switch" title={rule.enabled ? '禁用规则' : '启用规则'}><input checked={rule.enabled} type="checkbox" onChange={(event) => setRuleEnabled(rule, event.target.checked)}/><span/></label>}<div className="rule-card-content"><strong>{rule.value}</strong><span>{getFriendlyRuleType(rule)} · {getFriendlyRuleDescription(rule)} · 手动维护{rule.note ? ` · ${rule.note}` : ''}</span></div>{!managingRules && <div className="rule-more-wrap"><button className={`rule-more-button ${openRuleMenuId === rule.id ? 'active' : ''}`} aria-label={`更多 ${rule.value}`} onClick={(event) => { event.stopPropagation(); setOpenRuleMenuId((current) => current === rule.id ? null : rule.id); }}><UiIcon name="more" size={18}/></button>{openRuleMenuId === rule.id && <div className="rule-more-menu" onClick={(event) => event.stopPropagation()}><button onClick={() => beginRuleEdit(rule)}><UiIcon name="edit" size={16}/>编辑</button><button onClick={async () => { await copyRules([rule.id]); setOpenRuleMenuId(null); }}><UiIcon name="copy" size={16}/>复制</button><button className="danger" onClick={() => { setPendingDeleteRuleIds([rule.id]); setOpenRuleMenuId(null); }}><UiIcon name="trash" size={16}/>删除</button></div>}</div>}</article>; })}{!manualRules.length && <div className="empty-state compact-empty"><UiIcon name="rules" size={26}/><strong>暂无自定义规则</strong><span>上游规则已在来源区域收起展示</span></div>}</div>
    </section>
    {managingRules && createPortal(<div className={`management-bottom-dock ${dockSpaceConstrained ? 'space-constrained' : ''}`} ref={dockRef} role="toolbar" aria-label="规则选择管理" aria-hidden={dockSpaceConstrained}><span className="dock-selection-count"><UiIcon name="manage" size={18}/><small>已选择</small><strong>{selectedRuleIds.length}</strong><small>条</small></span><div className="dock-actions"><button onClick={selectAllCompatibleRules}><UiIcon name={allCompatibleRulesSelected ? 'close' : 'check'} size={17}/>{allCompatibleRulesSelected ? '全不选' : '全选'}</button><button className="dock-exit primary-action" onClick={() => { setManagingRules(false); setSelectedRuleIds([]); }}><UiIcon name="logout" size={17}/>退出管理</button></div></div>, document.body)}
    {editingRule && createPortal(<div className="rules-dialog-backdrop" onMouseDown={() => setEditingRuleId(null)}><section className="rule-item-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-item-title" onMouseDown={(event) => event.stopPropagation()}><div className="builder-head"><div><h2 id="edit-item-title">编辑单条规则</h2><p>修改规则地址、类型和备注</p></div><button className="dialog-close-button" aria-label="关闭单条编辑" onClick={() => setEditingRuleId(null)}><UiIcon name="close" size={18}/></button></div><label><span>规则地址</span><input className="app-input" value={editRuleValue} onChange={(event) => setEditRuleValue(event.target.value)}/></label><label><span>规则类型</span><select className="app-input" value={editRuleType} onChange={(event) => setEditRuleType(event.target.value as DomainRuleType)}>{FRIENDLY_RULE_TYPES.filter((item) => item.type).map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select></label><label><span>备注</span><input className="app-input" value={editRuleNote} onChange={(event) => setEditRuleNote(event.target.value)}/></label><button className="primary-action" disabled={!editRuleValue.trim()} onClick={saveRuleEdit}>保存修改</button></section></div>, document.body)}
    {!!pendingDeleteRuleIds.length && createPortal(<div className="rules-dialog-backdrop" onMouseDown={() => setPendingDeleteRuleIds([])}><section className="rule-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-items-title" onMouseDown={(event) => event.stopPropagation()}><span className="action-dialog-icon red"><UiIcon name="trash" size={24}/></span><div><h2 id="delete-items-title">确认删除 {pendingDeleteRuleIds.length} 条规则？</h2><p>删除后无法撤销，请确认所选规则无误。</p></div><div className="action-dialog-actions"><button onClick={() => setPendingDeleteRuleIds([])}>取消</button><button className="danger-action" onClick={confirmRuleDeletion}>确认删除</button></div></section></div>, document.body)}
  </div>;
}
