import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DomainRuleType, GeoSourceSuggestion, ImportPreview, RuleCategory } from '../../types/domain-rules';
import { FRIENDLY_RULE_TYPES, getFriendlyRuleDescription, getFriendlyRuleType } from '../../lib/rule-types';
import type { useDomainAdmin } from '../hooks/use-domain-admin';
import { copyText } from '../lib/clipboard';
import { CategoryIcon } from './category-icon';
import { IconPicker } from './icon-picker';
import { UiIcon } from './ui-icon';
import { SortToolbar, sortCategoryEntries, usePersistentSort } from './sort-toolbar';

type Props = { api: ReturnType<typeof useDomainAdmin>; categories: RuleCategory[]; category?: RuleCategory; onSelectCategory: (id: string) => void; onToast: (message: string) => void };
const lines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const SYNC_INTERVALS = [
  { value: 15, label: '每 15 分钟' }, { value: 30, label: '每 30 分钟' }, { value: 60, label: '每小时' },
  { value: 360, label: '每 6 小时' }, { value: 720, label: '每 12 小时' }, { value: 1440, label: '每天' },
];

export function RulesPanel({ api, categories, category, onSelectCategory, onToast }: Props) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [type, setType] = useState<DomainRuleType | ''>('');
  const [query, setQuery] = useState('');
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const { value: categorySortKey, direction: categorySortDirection, setValue: setCategorySortKey, setDirection: setCategorySortDirection } = usePersistentSort('rule-categories');
  const { value: rulesSortKey, direction: rulesSortDirection, setValue: setRulesSortKey, setDirection: setRulesSortDirection } = usePersistentSort('all-rules');
  const summarySortKey = rulesSortKey;
  const summarySortDirection = rulesSortDirection;
  const customPacks = api.data?.settings.customIconPackUrls ?? [];
  const customPackNames = api.data?.settings.customIconPackNames ?? {};

  const filteredRules = useMemo(() => category?.rules.filter((rule) => `${rule.value} ${rule.note ?? ''} ${rule.sourceName ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [category, query]);
  const manualRules = filteredRules.filter((rule) => !rule.sourceId);
  const upstreamRules = filteredRules.filter((rule) => Boolean(rule.sourceId));
  const allRules = useMemo(() => categories.flatMap((item) => item.rules.map((rule) => ({ ...rule, category: item }))), [categories]);
  const categorySourceMode = !category?.sources?.length
    ? 'manual'
    : category.sources.every((source) => source.sourceType === 'geosite' || source.sourceType === 'geoip')
      ? 'geo'
      : category.sources.every((source) => source.sourceType === 'url' || !source.sourceType)
        ? 'url'
        : 'mixed';

  useEffect(() => {
    setEditing(false); setConfirmDelete(false); setQuery('');
    setEditSources(''); setEditGeosites([]); setEditGeoips([]); setEditGeositeQuery(''); setEditGeositeResults([]);
  }, [category?.id]);

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
    if (!newName.trim() || (createMode === 'upstream' && !sourceUrls.length && !geositeNames.length && !geoipNames.length)) return;
    await api.createCategory({ name: newName, icon: newIcon, description: newDescription, sourceUrls, geositeNames, geoipNames, syncIntervalMinutes: newSyncInterval });
    setNewName(''); setNewDescription(''); setNewIcon(''); setNewSources(''); setSelectedGeosites([]); setSelectedGeoips([]); setGeositeQuery(''); setNewSyncInterval(60); setShowCreate(false);
    onToast(sourceUrls.length || geositeNames.length || geoipNames.length ? '规则已创建并完成首次上游同步' : '自定义规则已创建');
  }

  if (!category) {
    const sources = categories.flatMap((item) => item.sources ?? []);
    const sourceCounts = { all: sources.length, url: sources.filter((source) => source.sourceType === 'url' || !source.sourceType).length, geosite: sources.filter((source) => source.sourceType === 'geosite').length, geoip: sources.filter((source) => source.sourceType === 'geoip').length };
    const sourceTypeById = new Map(sources.map((source) => [source.id, source.sourceType ?? 'url']));
    const ruleGroups = [
      { id: 'manual', label: '自定义规则', description: '可进入规则详情继续编辑', rules: allRules.filter((rule) => !rule.sourceId) },
      { id: 'url', label: '上游订阅', description: '来自远程订阅链接的只读镜像', rules: allRules.filter((rule) => rule.sourceId && sourceTypeById.get(rule.sourceId) === 'url') },
      { id: 'geo', label: 'Geo 数据库', description: '来自 GeoSite 与 GeoIP 的只读镜像', rules: allRules.filter((rule) => rule.sourceId && sourceTypeById.get(rule.sourceId) !== 'url') },
    ];
    const groupedByCategory = (rules: typeof allRules) => sortCategoryEntries(categories.map((item) => { const matched = rules.filter((rule) => rule.category.id === item.id); return { category: item, count: matched.length, rules: matched }; }).filter((entry) => entry.count), rulesSortKey, rulesSortDirection);
    const sortedCategories = sortCategoryEntries(categories.map((item) => ({ category: item, count: item.rules.length })), categorySortKey, categorySortDirection).map((entry) => entry.category);
    return <div className="page-stack unified-page">
      <header className="page-title"><div><span className="eyebrow">RULE LIBRARY</span><h1>规则汇总</h1><p>从零维护规则，或聚合多个上游来源继续处理</p></div><button className="primary-action title-action" onClick={() => setShowCreate(true)}><UiIcon name="plus" size={19}/>新建规则</button></header>
      {showCreate && createPortal(<div className="rules-dialog-backdrop" onMouseDown={() => setShowCreate(false)}><section className="soft-card unified-card category-builder rules-editor-dialog create-rule-dialog" role="dialog" aria-modal="true" aria-labelledby="create-rule-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="builder-head"><div><h2 id="create-rule-title">新建规则</h2><p>选择从零构建或引用持续维护的上游规则</p></div><button className="dialog-close-button" aria-label="关闭新建规则" onClick={() => setShowCreate(false)}><UiIcon name="close" size={18}/></button></div><div className="upstream-kind-tabs creation-mode-tabs"><button className={createMode === 'manual' ? 'active' : ''} onClick={() => setCreateMode('manual')}><UiIcon name="edit" size={17}/>从零构建</button><button className={createMode === 'upstream' ? 'active' : ''} onClick={() => setCreateMode('upstream')}><UiIcon name="links" size={17}/>引用上游</button></div>
        <div className="creation-mode-content" key={createMode}>
          <div className="builder-fields"><label><span>分类名称</span><input className="app-input" placeholder="例如 Emby" value={newName} onChange={(event) => setNewName(event.target.value)}/></label><label><span>分类说明</span><input className="app-input" placeholder="可留空" value={newDescription} onChange={(event) => setNewDescription(event.target.value)}/></label></div>
          <IconPicker value={newIcon} name={newName} customPackUrls={customPacks} customPackNames={customPackNames} onChange={setNewIcon}/>
          {createMode === 'upstream' && <>
          <div className="upstream-kind-tabs"><button className={upstreamKind === 'url' ? 'active' : ''} onClick={() => setUpstreamKind('url')}><UiIcon name="links" size={17}/>订阅地址</button><button className={upstreamKind === 'geosite' ? 'active' : ''} onClick={() => setUpstreamKind('geosite')}><UiIcon name="database" size={17}/>Geo 数据库</button></div>
          <div className="upstream-kind-content" key={upstreamKind}>{upstreamKind === 'url' ? <div className="upstream-create-fields"><label className="source-input"><span>上游订阅地址，一行一个</span><textarea className="app-input textarea" placeholder={'https://example.com/media.yaml\nhttps://example.com/custom.list'} value={newSources} onChange={(event) => setNewSources(event.target.value)}/><small>首次创建会立即同步，之后按所选间隔自动更新</small></label><label className="sync-interval-field"><span>自动同步间隔</span><select className="app-input" value={newSyncInterval} onChange={(event) => setNewSyncInterval(Number(event.target.value))}>{SYNC_INTERVALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div> : <div className="geosite-builder">
            <div className="geosite-search-row"><label><span>搜索 GeoSite 与 GeoIP</span><div className="search-box geosite-search"><UiIcon name="search" size={18}/><input value={geositeQuery} onChange={(event) => setGeositeQuery(event.target.value)} placeholder="输入关键词，例如 telegram、ai、netflix"/></div><small>同一关键词会同时匹配域名规则与 IP 规则，可组合选择</small></label><label className="sync-interval-field"><span>自动同步间隔</span><select className="app-input" value={newSyncInterval} onChange={(event) => setNewSyncInterval(Number(event.target.value))}>{SYNC_INTERVALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
            {!!(selectedGeosites.length || selectedGeoips.length) && <div className="selected-geosites">{selectedGeosites.map((name) => <button key={`geosite-${name}`} onClick={() => setSelectedGeosites((current) => current.filter((item) => item !== name))}><span>geosite:{name}</span><UiIcon name="close" size={14}/></button>)}{selectedGeoips.map((name) => <button className="geoip-chip" key={`geoip-${name}`} onClick={() => setSelectedGeoips((current) => current.filter((item) => item !== name))}><span>geoip:{name}</span><UiIcon name="close" size={14}/></button>)}</div>}
            <div className="geosite-results">{searchingGeosites && <div className="geosite-loading">正在查询 Geo 数据索引…</div>}{!searchingGeosites && geositeResults.map((result) => { const selected = result.sourceType === 'geosite' ? selectedGeosites.includes(result.name) : selectedGeoips.includes(result.name); const toggle = () => result.sourceType === 'geosite' ? setSelectedGeosites((current) => selected ? current.filter((name) => name !== result.name) : [...current, result.name]) : setSelectedGeoips((current) => selected ? current.filter((name) => name !== result.name) : [...current, result.name]); return <button className={`${selected ? 'selected' : ''} ${result.sourceType}`} key={`${result.sourceType}-${result.name}`} onClick={toggle}><span><strong>{result.sourceType}:{result.name}</strong><small>{result.description}</small></span><em className={result.sourceType}>{result.sourceType === 'geoip' ? 'IP 规则' : result.recommended ? '聚合分类 · 推荐' : '域名规则'}</em><UiIcon name={selected ? 'check' : 'plus'} size={17}/></button>; })}{!searchingGeosites && geositeQuery.trim().length >= 2 && !geositeResults.length && <div className="geosite-loading">没有找到匹配的 Geo 规则</div>}</div>
          </div>}</div>
          </>}
          <div className="builder-submit"><span>{createMode === 'manual' ? '创建后可添加单条规则或批量导入' : upstreamKind === 'url' ? `已填写 ${lines(newSources).length} 个上游来源` : `已选择 ${selectedGeosites.length} 个 GeoSite 与 ${selectedGeoips.length} 个 GeoIP`}</span><button className="primary-action" disabled={!newName.trim() || (createMode === 'upstream' && upstreamKind === 'url' && !lines(newSources).length) || (createMode === 'upstream' && upstreamKind === 'geosite' && !selectedGeosites.length && !selectedGeoips.length)} onClick={createCategory}>创建规则</button></div>
        </div>
      </section></div>, document.body)}
      <div className="summary-strip source-summary-strip"><span><small>上游来源</small><strong>{sourceCounts.all}</strong></span><span><small>上游订阅</small><strong>{sourceCounts.url}</strong></span><span><small>GeoSite</small><strong>{sourceCounts.geosite}</strong></span><span><small>GeoIP</small><strong>{sourceCounts.geoip}</strong></span></div>
      <section className="soft-card unified-card"><div className="section-inline sort-section-head"><div><h2>规则分类</h2><p>点击规则进入来源和同步管理</p></div><SortToolbar value={categorySortKey} direction={categorySortDirection} onChange={(key, direction) => { setCategorySortKey(key); setCategorySortDirection(direction); }}/></div><div className="category-summary-grid sort-content-transition" key={`categories-${categorySortKey}-${categorySortDirection}`}>{sortedCategories.map((item) => <button className="category-summary-card" key={item.id} onClick={() => onSelectCategory(item.id)}><CategoryIcon icon={item.icon} name={item.name}/><span><strong>{item.name}</strong><small>{item.sources?.length ? `${item.sources.length} 个上游 · ${item.lastSyncedAt ? `同步于 ${new Date(item.lastSyncedAt).toLocaleString('zh-CN')}` : '等待同步'}` : item.description || '自定义维护'}</small></span><span className="category-count">{item.rules.length}</span><UiIcon name="chevronRight" size={19}/></button>)}</div></section>
      <section className="soft-card unified-card grouped-rules-section">
        <div className="section-inline sort-section-head"><div><h2>所有规则</h2><p>按来源与分类折叠，展开后查看具体规则</p></div><SortToolbar value={rulesSortKey} direction={rulesSortDirection} onChange={(key, direction) => { setRulesSortKey(key); setRulesSortDirection(direction); }}/></div>
        <div className="rule-source-groups sort-content-transition" key={`groups-${summarySortKey}-${summarySortDirection}`}>{ruleGroups.map((group) => <details className={`rule-source-group animated-disclosure ${group.id}`} key={group.id}><summary><span><UiIcon name={group.id === 'manual' ? 'edit' : group.id === 'url' ? 'links' : 'database'} size={19}/><span><strong>{group.label}</strong><small>{group.description}</small></span></span><span><strong>{group.rules.length}</strong> 条<UiIcon name="chevron" size={16}/></span></summary><div className="category-rule-folders">{groupedByCategory(group.rules).map((entry) => <details className="category-rule-folder animated-disclosure" key={`${group.id}-${entry.category.id}`}><summary><span><CategoryIcon icon={entry.category.icon} name={entry.category.name} size={38}/><strong>{entry.category.name}</strong></span><span>{entry.count} 条<UiIcon name="chevron" size={15}/></span></summary><div className="all-rules-table compact-group-table">{entry.rules.map((rule) => group.id === 'manual' ? <button className="all-rule-row" key={rule.id} onClick={() => onSelectCategory(rule.category.id)}><span className={`rule-state ${rule.enabled ? 'on' : ''}`}/><span className="rule-main"><strong>{rule.value}</strong><small>{getFriendlyRuleType(rule)} · 自定义规则</small></span><UiIcon name="chevronRight" size={18}/></button> : <div className="all-rule-row readonly-summary-row" key={rule.id}><span className={`rule-state ${rule.enabled ? 'on' : ''}`}/><span className="rule-main"><strong>{rule.value}</strong><small>{getFriendlyRuleType(rule)} · 来自 {rule.sourceName}</small></span><span className="readonly-badge">只读</span></div>)}</div></details>)}{!group.rules.length && <div className="empty-state compact-empty"><span>暂无{group.label}</span></div>}</div></details>)}</div>
      </section>
    </div>;
  }

  const currentCategory = category;
  async function add() { await api.addRule(currentCategory.id, { value, type: type || undefined, note }); setValue(''); setNote(''); onToast('规则已添加'); }
  async function previewImport() { const result = await api.importPreview(currentCategory.id, bulkText); setPreview(result.preview); }
  async function confirmImport() { await api.confirmImport(currentCategory.id, bulkText); setBulkText(''); setPreview(null); onToast('批量导入完成'); }
  async function editCategory() {
    if (!editName.trim()) return;
    const sourceInput = categorySourceMode === 'url'
      ? { sourceUrls: lines(editSources), geositeNames: [] }
      : categorySourceMode === 'geo'
        ? { sourceUrls: [], geositeNames: editGeosites, geoipNames: editGeoips }
        : categorySourceMode === 'mixed'
          ? { sourceUrls: lines(editSources), geositeNames: editGeosites, geoipNames: editGeoips }
          : {};
    await api.updateCategory(currentCategory.id, { name: editName, description: editDescription, icon: editIcon, syncIntervalMinutes: editSyncInterval, ...sourceInput });
    setEditing(false); onToast('分类配置已更新');
  }
  async function removeCategory() { await api.deleteCategory(currentCategory.id); onSelectCategory(''); setConfirmDelete(false); onToast('分类已删除'); }
  async function syncCategory() { setSyncing(true); try { await api.syncCategory(currentCategory.id); onToast('该分类的上游规则已同步'); } finally { setSyncing(false); } }
  function openEditor() { setEditName(currentCategory.name); setEditDescription(currentCategory.description ?? ''); setEditIcon(currentCategory.icon ?? ''); setEditSources((currentCategory.sources ?? []).filter((source) => source.sourceType === 'url' || !source.sourceType).map((source) => source.url).join('\n')); setEditGeosites((currentCategory.sources ?? []).filter((source) => source.sourceType === 'geosite' && source.geositeName).map((source) => source.geositeName!)); setEditGeoips((currentCategory.sources ?? []).filter((source) => source.sourceType === 'geoip' && source.geoipName).map((source) => source.geoipName!)); setEditGeositeQuery(''); setEditGeositeResults([]); setEditSyncInterval(currentCategory.syncIntervalMinutes ?? 60); setEditing(true); }

  return <div className="page-stack unified-page">
    <header className="page-title detail-title"><div><button className="back-button" onClick={() => onSelectCategory('')}><UiIcon name="arrowLeft" size={20}/>返回规则汇总</button><div className="detail-name"><CategoryIcon icon={category.icon} name={category.name} size={58}/><span><h1>{category.name}</h1><p>{category.description || '维护这个规则下的内容'}</p></span></div></div><div className="title-actions"><button className="subtle-action" onClick={openEditor}><UiIcon name="edit" size={17}/>编辑规则</button><button className="danger-action icon-action" onClick={() => setConfirmDelete(true)}><UiIcon name="trash" size={17}/>删除规则</button></div></header>
    {editing && createPortal(<div className="rules-dialog-backdrop" onMouseDown={() => setEditing(false)}><section className="soft-card unified-card category-builder rules-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-rule-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="builder-head"><div><h2 id="edit-rule-title">编辑规则</h2><p>来源类型保持独立，远程订阅不会与 Geo 数据配置相互覆盖</p></div><button className="dialog-close-button" aria-label="关闭编辑规则" onClick={() => setEditing(false)}><UiIcon name="close" size={18}/></button></div><span className={`source-type-badge ${categorySourceMode}`}>{categorySourceMode === 'manual' ? '自定义维护' : categorySourceMode === 'url' ? '远程订阅' : categorySourceMode === 'geo' ? 'Geo 数据' : '混合来源'}</span>
      <div className="builder-fields"><label><span>分类名称</span><input className="app-input" value={editName} onChange={(event) => setEditName(event.target.value)}/></label><label><span>分类说明</span><input className="app-input" value={editDescription} onChange={(event) => setEditDescription(event.target.value)}/></label></div>
      {categorySourceMode === 'manual' && <div className="source-lock-notice"><UiIcon name="edit" size={18}/><span><strong>自定义规则</strong><small>仅维护自定义规则，不显示远程订阅或 Geo 数据设置</small></span></div>}
      {(categorySourceMode === 'url' || categorySourceMode === 'mixed') && <div className="upstream-create-fields"><label className="source-input"><span>远程订阅地址，一行一个</span><textarea className="app-input textarea" value={editSources} onChange={(event) => setEditSources(event.target.value)}/><small>继续使用订阅链接作为上游，不会切换为 Geo 数据</small></label><label className="sync-interval-field"><span>自动同步间隔</span><select className="app-input" value={editSyncInterval} onChange={(event) => setEditSyncInterval(Number(event.target.value))}>{SYNC_INTERVALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>}
      {(categorySourceMode === 'geo' || categorySourceMode === 'mixed') && <div className="geosite-builder edit-geosite-builder"><div className="geosite-search-row"><label><span>更换或追加 GeoSite 与 GeoIP</span><div className="search-box geosite-search"><UiIcon name="search" size={18}/><input value={editGeositeQuery} onChange={(event) => setEditGeositeQuery(event.target.value)} placeholder="输入关键词，例如 telegram、youtube"/></div><small>同时搜索域名与 IP 规则，不会混入远程订阅链接</small></label>{categorySourceMode === 'geo' && <label className="sync-interval-field"><span>自动同步间隔</span><select className="app-input" value={editSyncInterval} onChange={(event) => setEditSyncInterval(Number(event.target.value))}>{SYNC_INTERVALS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}</div><div className="selected-geosites">{editGeosites.map((name) => <button key={`geosite-${name}`} onClick={() => setEditGeosites((current) => current.filter((item) => item !== name))}><span>geosite:{name}</span><UiIcon name="close" size={14}/></button>)}{editGeoips.map((name) => <button className="geoip-chip" key={`geoip-${name}`} onClick={() => setEditGeoips((current) => current.filter((item) => item !== name))}><span>geoip:{name}</span><UiIcon name="close" size={14}/></button>)}</div>{editGeositeQuery.trim().length >= 2 && <div className="geosite-results">{searchingEditGeosites && <div className="geosite-loading">正在查询 Geo 数据索引…</div>}{!searchingEditGeosites && editGeositeResults.map((result) => { const selected = result.sourceType === 'geosite' ? editGeosites.includes(result.name) : editGeoips.includes(result.name); const toggle = () => result.sourceType === 'geosite' ? setEditGeosites((current) => selected ? current.filter((name) => name !== result.name) : [...current, result.name]) : setEditGeoips((current) => selected ? current.filter((name) => name !== result.name) : [...current, result.name]); return <button className={`${selected ? 'selected' : ''} ${result.sourceType}`} key={`${result.sourceType}-${result.name}`} onClick={toggle}><span><strong>{result.sourceType}:{result.name}</strong><small>{result.description}</small></span><em className={result.sourceType}>{result.sourceType === 'geoip' ? 'IP 规则' : result.recommended ? '聚合分类 · 推荐' : '域名规则'}</em><UiIcon name={selected ? 'check' : 'plus'} size={17}/></button>; })}</div>}</div>}
      <IconPicker value={editIcon} name={editName} customPackUrls={customPacks} customPackNames={customPackNames} onChange={setEditIcon}/><div className="builder-submit"><span>{categorySourceMode === 'manual' ? '保存规则信息不会添加上游来源' : '保存后可随时同步最新规则'}</span><button className="primary-action" disabled={!editName.trim() || (categorySourceMode === 'geo' && !editGeosites.length && !editGeoips.length)} onClick={editCategory}>保存规则配置</button></div>
    </section></div>, document.body)}
    {confirmDelete && createPortal(<div className="rules-dialog-backdrop delete-dialog-backdrop" onMouseDown={() => setConfirmDelete(false)}><section className="rule-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-rule-title" onMouseDown={(event) => event.stopPropagation()}><span className="action-dialog-icon red"><UiIcon name="trash" size={24}/></span><div><h2 id="delete-rule-title">删除规则 {category.name}</h2><p>将永久删除该规则、上游来源和其中的 {category.rules.length} 条内容，此操作无法撤销</p></div><div className="action-dialog-actions"><button onClick={() => setConfirmDelete(false)}>取消</button><button className="danger-action icon-action" onClick={removeCategory}><UiIcon name="trash" size={17}/>确认删除</button></div></section></div>, document.body)}
    {!!category.sources?.length && <section className="soft-card unified-card source-panel"><div className="section-inline"><div><h2>上游同步</h2><p>{SYNC_INTERVALS.find((item) => item.value === (category.syncIntervalMinutes ?? 60))?.label ?? `每 ${category.syncIntervalMinutes ?? 60} 分钟`}自动更新，镜像规则保持只读</p></div><button className="primary-action icon-action sync-action" disabled={syncing} onClick={syncCategory}><UiIcon name="sync" size={18}/>{syncing ? '正在同步…' : '同步上游'}</button></div><div className="source-list">{category.sources.map((source) => <div className="source-row" key={source.id}><span className={`source-status ${source.lastStatus ?? 'pending'}`}/><span><strong>{source.name}</strong><small>{source.sourceType === 'geoip' ? `geoip:${source.geoipName}` : source.sourceType === 'geosite' ? `geosite:${source.geositeName}` : source.url}</small></span><span><strong>{source.lastCount ?? 0}</strong><small>条规则</small></span><time>{source.lastSyncedAt ? `最后同步 ${new Date(source.lastSyncedAt).toLocaleString('zh-CN')}` : '等待首次同步'}</time></div>)}</div><details className="upstream-rules-disclosure animated-disclosure"><summary className="upstream-rules-toggle"><span><UiIcon name="database" size={18}/>上游镜像规则 <strong>{category.rules.filter((rule) => rule.sourceId).length}</strong></span><span>展开查看 <UiIcon name="chevronRight" size={17}/></span></summary><div className="rule-list upstream-readonly-list">{upstreamRules.map((rule) => <article className="rule-row readonly-rule-row" key={rule.id}><span className="readonly-lock"><UiIcon name="database" size={16}/></span><div><strong>{rule.value}</strong><span>{getFriendlyRuleType(rule)} · 上游：{rule.sourceName}</span></div><span className="readonly-badge">只读</span></article>)}</div></details></section>}
    <div className="detail-layout">
      <section className="soft-card unified-card input-panel add-rule-card"><div className="card-title"><span className="metric-icon blue"><UiIcon name="plus"/></span><div><h2>逐个添加</h2><p>自定义规则不会被上游同步覆盖</p></div></div><label><span>规则地址</span><input className="app-input" placeholder="例如：chatgpt.com、+.apple.com、127.0.0.0/8" value={value} onChange={(event) => setValue(event.target.value)}/></label><div className="rule-type-field"><span>规则类型</span><select className="app-input" value={type} onChange={(event) => setType(event.target.value as DomainRuleType)}><option value="">自动识别</option>{FRIENDLY_RULE_TYPES.map((item) => <option key={item.label} value={item.type}>{item.label} — {item.description}</option>)}</select></div><label><span>备注，可不填</span><input className="app-input" placeholder="例如：ChatGPT 官网" value={note} onChange={(event) => setNote(event.target.value)}/></label><button className="primary-action" disabled={!value.trim()} onClick={add}>添加规则</button></section>
      <section className="soft-card unified-card input-panel bulk-card"><div className="card-title"><span className="metric-icon purple"><UiIcon name="upload"/></span><div><h2>批量添加</h2><p>一行一条，预览确认后再导入</p></div></div><textarea className="app-input textarea" placeholder={'chatgpt.com\n+.apple.com\n127.0.0.0/8'} value={bulkText} onChange={(event) => setBulkText(event.target.value)}/><div className="card-actions bulk-preview-actions"><button className="preview-action icon-action" onClick={previewImport} disabled={!bulkText.trim()}><UiIcon name="search" size={17}/>预览规则</button></div></section>
    </div>
    {preview && createPortal(<div className="rules-dialog-backdrop" onMouseDown={() => setPreview(null)}><section className="bulk-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-preview-title" onMouseDown={(event) => event.stopPropagation()}><div className="builder-head"><div><h2 id="bulk-preview-title">批量导入预览</h2><p>确认规则类型和重复项，导入后仍可逐条调整</p></div><button className="dialog-close-button" aria-label="关闭导入预览" onClick={() => setPreview(null)}><UiIcon name="close" size={18}/></button></div><div className="import-preview-summary"><span><strong>{preview.rules.length}</strong><small>可导入</small></span><span><strong>{preview.duplicateValues.length}</strong><small>重复</small></span><span><strong>{preview.invalidValues.length}</strong><small>无效</small></span></div><div className="import-preview-list">{preview.rules.map((rule) => <div key={`${rule.type}-${rule.value}`}><span className="rule-state on"/><span><strong>{rule.value}</strong><small>{rule.type}</small></span></div>)}{!preview.rules.length && <div className="empty-state compact-empty"><strong>没有可导入的规则</strong><span>请返回修改批量内容</span></div>}</div><div className="bulk-preview-footer"><button onClick={() => setPreview(null)}>取消导入</button><button className="primary-action icon-action" disabled={!preview.rules.length} onClick={confirmImport}><UiIcon name="upload" size={17}/>确认导入 {preview.rules.length} 条</button></div></section></div>, document.body)}
    <section className="soft-card unified-card"><div className="section-inline rules-list-head"><div><h2>自定义规则</h2><p>{manualRules.length} 条，仅这里的规则可以禁用或删除</p></div><label className="search-box"><UiIcon name="search" size={18}/><input placeholder="搜索规则或来源" value={query} onChange={(event) => setQuery(event.target.value)}/></label></div><div className="card-actions"><button onClick={async () => { await copyText(category.rules.map((rule) => rule.value).sort().join('\n')); onToast('规则列表已复制'); }}><UiIcon name="copy" size={17}/>复制全部</button></div><div className="rule-list modern-rule-list">{manualRules.map((rule) => <article className="rule-row" key={rule.id}><label className="switch"><input checked={rule.enabled} type="checkbox" onChange={(event) => api.updateRule(category.id, { ...rule, enabled: event.target.checked })}/><span/></label><div><strong>{rule.value}</strong><span>{getFriendlyRuleType(rule)} · {getFriendlyRuleDescription(rule)} · 自定义维护{rule.note ? ` · ${rule.note}` : ''}</span></div><button className="danger-icon-button" aria-label={`删除 ${rule.value}`} onClick={() => api.deleteRule(category.id, rule.id).then(() => onToast('规则已删除'))}><UiIcon name="trash" size={17}/></button></article>)}{!manualRules.length && <div className="empty-state compact-empty"><UiIcon name="rules" size={26}/><strong>暂无自定义规则</strong><span>上游规则已在来源区域收起展示</span></div>}</div></section>
  </div>;
}
