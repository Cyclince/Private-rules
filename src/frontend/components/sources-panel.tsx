import { useEffect, useMemo, useState } from 'react';
import type { RuleSource, RulesData } from '../../types/domain-rules';
import type { useDomainAdmin } from '../hooks/use-domain-admin';
import { CategoryIcon } from './category-icon';
import { UiIcon } from './ui-icon';

const INTERVALS = [15, 30, 60, 360, 720, 1440];

function sourceInput(source?: RuleSource) {
  return {
    sourceType: source?.sourceType ?? 'url',
    name: source?.name ?? '',
    url: source?.url ?? '',
    geositeName: source?.geositeName ?? '',
    geoipName: source?.geoipName ?? '',
    userAgent: source?.userAgent ?? 'clash-verge/v2.5.1',
    syncIntervalMinutes: source?.syncIntervalMinutes ?? 60,
    ruleOptimization: source?.ruleOptimization ?? 'none',
    enabled: source?.enabled ?? true,
  };
}

export function SourcesPanel({ api, data, initialCategoryId, onToast }: {
  api: ReturnType<typeof useDomainAdmin>;
  data: RulesData;
  initialCategoryId?: string;
  onToast: (message: string) => void;
}) {
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? data.categories[0]?.id ?? '');
  const category = data.categories.find((item) => item.id === categoryId);
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('source') ?? '');
  const selected = category?.sources?.find((source) => source.id === selectedId);
  const [form, setForm] = useState(() => sourceInput(selected));
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<{ count: number; originalCount: number; rules: Array<{ type: string; value: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canAdmin = api.can('source:write');
  const canOperate = api.can('toggle');
  const changeForm = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null);
  };

  useEffect(() => {
    if (!category && data.categories[0]) setCategoryId(data.categories[0].id);
  }, [category, data.categories]);
  useEffect(() => {
    setForm(sourceInput(selected));
    setPreview(null);
    setCreating(false);
  }, [selected?.id, selected?.url, selected?.enabled, selected?.syncIntervalMinutes]);

  const payload = useMemo(() => ({
    ...form,
    sourceType: form.sourceType as 'url' | 'geosite' | 'geoip',
    url: form.sourceType === 'url' ? form.url : undefined,
    geositeName: form.sourceType === 'geosite' ? form.geositeName : undefined,
    geoipName: form.sourceType === 'geoip' ? form.geoipName : undefined,
  }), [form]);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try { await action(); onToast(message); } finally { setBusy(false); }
  }

  async function previewNow() {
    const result = await api.previewSource(categoryId, payload) as { preview?: typeof preview };
    setPreview(result.preview ?? null);
  }

  async function save() {
    await run(async () => {
      if (creating) await api.createSource(categoryId, payload);
      else if (selected) await api.updateSource(categoryId, selected.id, payload);
      setCreating(false);
    }, creating ? '来源已创建；首次同步需单独执行' : '来源已更新；旧镜像会保留到下次成功同步');
  }

  if (!data.categories.length) return <div className="empty-state"><strong>还没有规则分类</strong><span>请先创建分类，再维护上游来源。</span></div>;

  return <div className="page-stack unified-page">
    <header className="page-title"><div><span className="eyebrow">UPSTREAM SOURCES</span><h1>上游来源</h1><p>逐个维护 Remote、GeoSite 与 GeoIP；上游镜像保持只读</p></div>{canAdmin && <button className="primary-action title-action" onClick={() => { setSelectedId(''); setCreating(true); setForm(sourceInput()); }}><UiIcon name="plus" size={18}/>新增来源</button>}</header>
    <section className="soft-card unified-card">
      <label><span>规则分类</span><select className="app-input" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setSelectedId(''); setCreating(false); }}>{data.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="source-list">{(category?.sources ?? []).map((source) => <button className={`source-row ${selectedId === source.id ? 'selected' : ''}`} key={source.id} onClick={() => setSelectedId(source.id)}><span className={`source-status ${source.lastStatus ?? 'pending'}`}/><span><strong>{source.name}</strong><small>{source.sourceType === 'url' ? source.url : `${source.sourceType}:${source.geositeName ?? source.geoipName}`}</small></span><span><strong>{source.lastCount ?? 0}</strong><small>条镜像规则</small></span><UiIcon name="chevronRight" size={18}/></button>)}</div>
    </section>

    {(selected || creating) && <section className="soft-card unified-card settings-section">
      <div className="card-title"><CategoryIcon icon={category?.icon} name={category?.name ?? '规则'}/><div><h2>{creating ? '新增来源' : selected?.name}</h2><p>修改配置不会先删除上一次成功镜像</p></div></div>
      <div className="settings-form">
        <label><span>来源类型</span><select className="app-input" disabled={!creating || !canAdmin} value={form.sourceType} onChange={(event) => changeForm({ sourceType: event.target.value as typeof form.sourceType })}><option value="url">Remote</option><option value="geosite">GeoSite</option><option value="geoip">GeoIP</option></select></label>
        <label><span>名称</span><input className="app-input" disabled={!canAdmin} value={form.name} onChange={(event) => changeForm({ name: event.target.value })}/></label>
        {form.sourceType === 'url' && <><label><span>Remote URL</span><input className="app-input" disabled={!canAdmin} value={form.url} onChange={(event) => changeForm({ url: event.target.value })}/></label><label><span>User-Agent</span><input className="app-input" disabled={!canAdmin} value={form.userAgent} onChange={(event) => changeForm({ userAgent: event.target.value })}/></label></>}
        {form.sourceType === 'geosite' && <label><span>GeoSite 名称</span><input className="app-input" disabled={!canAdmin} value={form.geositeName} onChange={(event) => changeForm({ geositeName: event.target.value })}/></label>}
        {form.sourceType === 'geoip' && <label><span>GeoIP 名称</span><input className="app-input" disabled={!canAdmin} value={form.geoipName} onChange={(event) => changeForm({ geoipName: event.target.value })}/></label>}
        <label><span>同步周期</span><select className="app-input" disabled={!canOperate} value={form.syncIntervalMinutes} onChange={(event) => changeForm({ syncIntervalMinutes: Number(event.target.value) })}>{INTERVALS.map((interval) => <option key={interval} value={interval}>{interval} 分钟</option>)}</select></label>
      </div>
      {preview && <div className="access-banner"><span>预览：{preview.count} 条（原始 {preview.originalCount} 条）</span><small>{preview.rules.slice(0, 3).map((rule) => `${rule.type},${rule.value}`).join(' · ')}</small></div>}
      <div className="card-actions">
        {canAdmin && <button disabled={busy} onClick={previewNow}>安全预览</button>}
        {canAdmin && <button className="primary-action" disabled={busy || !preview} onClick={save}>{creating ? '确认创建' : '保存来源'}</button>}
        {!creating && selected && canOperate && <button disabled={busy} onClick={() => run(() => api.updateSourceInterval(categoryId, selected.id, form.syncIntervalMinutes), '同步周期已更新')}>保存周期</button>}
        {!creating && selected && canOperate && <button disabled={busy} onClick={() => run(() => api.toggleSource(categoryId, selected.id, !selected.enabled), selected.enabled ? '来源已停用' : '来源已启用')}>{selected.enabled ? '停用' : '启用'}</button>}
        {!creating && selected && api.can('sync') && <button disabled={busy || !selected.enabled} onClick={() => run(() => api.syncSource(categoryId, selected.id), '来源同步完成')}>立即同步</button>}
        {!creating && selected && api.can('delete') && <button className="danger-action" onClick={() => setConfirmDelete(true)}>删除来源</button>}
      </div>
      {confirmDelete && selected && <div className="action-dialog-backdrop"><section className="action-dialog"><div><h2>确认删除 {selected.name}？</h2><p>分类：{category?.name} · 镜像规则：{selected.lastCount ?? 0} 条。删除后相关规则将从订阅移除。</p></div><div className="action-dialog-actions"><button onClick={() => setConfirmDelete(false)}>取消</button><button className="danger-action" disabled={busy} onClick={() => run(async () => { await api.deleteSource(categoryId, selected.id); setSelectedId(''); setConfirmDelete(false); }, '来源及镜像规则已删除')}>确认删除</button></div></section></div>}
    </section>}
  </div>;
}
