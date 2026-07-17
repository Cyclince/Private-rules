import { useMemo, useState } from 'react';
import type { ClientLink, RulesData } from '../../types/domain-rules';
import type { useDomainAdmin } from '../hooks/use-domain-admin';
import { copyText } from '../lib/clipboard';
import { preferHttpsLink } from '../lib/links';
import { CategoryIcon } from './category-icon';
import { SortToolbar, sortCategoryEntries, usePersistentSort } from './sort-toolbar';
import { UiIcon } from './ui-icon';

type FormatLink = { id: string; title: string; suffix: string; description: string; tone: string; link?: ClientLink };
type AccessPolicy = 'token' | 'public' | 'disabled';

export function LinksPanel({ api, data, links, onToast }: { api: ReturnType<typeof useDomainAdmin>; data: RulesData; links: Record<string, ClientLink[]>; onToast: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState('');
  const { value: sortKey, direction: sortDirection, setValue: setSortKey, setDirection: setSortDirection } = usePersistentSort('subscriptions');
  const selectedCategory = data.categories.find((category) => category.id === selectedId);
  const selectedLinks = selectedId ? links[selectedId] ?? [] : [];
  const sortedCategories = sortCategoryEntries(data.categories.map((category) => ({ category, count: category.ruleCount ?? category.rules.length })), sortKey, sortDirection).map((entry) => entry.category);
  const formats = useMemo<FormatLink[]>(() => [
    { id: 'yaml', title: 'YAML 规则集', suffix: '.yaml', description: '适用于 Mihomo、Clash、OpenClash 与 Stash', tone: 'cyan', link: selectedLinks.find((link) => link.id === 'mihomo') },
    { id: 'list', title: 'LIST 规则集', suffix: '.list', description: '适用于 Loon、Surge、Shadowrocket 与 Egern', tone: 'purple', link: selectedLinks.find((link) => link.id === 'general') },
    { id: 'txt', title: '纯地址列表', suffix: '.txt', description: '仅保留域名与 IP，方便脚本或其他工具继续处理', tone: 'blue', link: selectedLinks.find((link) => link.id === 'url') },
    { id: 'json', title: 'JSON 数据', suffix: '.json', description: '保留结构化规则数据，适合二次开发和自动化', tone: 'orange', link: selectedLinks.find((link) => link.id === 'json') },
  ], [selectedLinks]);

  async function copy(link?: ClientLink) {
    if (!link?.recommendedUrl) { onToast('此规则当前未开放可用的订阅链接'); return; }
    await copyText(preferHttpsLink(link.recommendedUrl));
    onToast('订阅链接已复制');
  }
  async function setAccess(policy: AccessPolicy) {
    if (!selectedCategory) return;
    await api.updateCategory(selectedCategory.id, { tokenLinksEnabled: policy === 'token', publicLinksEnabled: policy === 'public' });
    onToast('规则访问策略已更新');
  }

  if (!selectedCategory) return <div className="page-stack unified-page">
    <header className="page-title"><div><span className="eyebrow">SUBSCRIPTIONS</span><h1>订阅中心</h1><p>选择规则与文件格式，每种格式对应一个通用地址</p></div></header>
    <section className="soft-card unified-card"><div className="section-inline sort-section-head"><div><h2>选择规则</h2><p>每条规则的访问方式都可以单独设置</p></div><SortToolbar value={sortKey} direction={sortDirection} onChange={(key, direction) => { setSortKey(key); setSortDirection(direction); }}/></div><div className="category-summary-grid subscription-categories sort-content-transition" key={`${sortKey}-${sortDirection}`}>{sortedCategories.map((category) => { const policy = category.tokenLinksEnabled !== false ? '私密' : category.publicLinksEnabled !== false ? '公开' : '已禁用'; return <button className="category-summary-card" key={category.id} onClick={() => setSelectedId(category.id)}><CategoryIcon icon={category.icon} name={category.name}/><span><strong>{category.name}</strong><small>{category.enabledRuleCount ?? category.rules.filter((rule) => rule.enabled).length} 条启用规则</small></span><span className={`access-policy-badge ${policy === '已禁用' ? 'disabled' : ''}`}>{policy}</span><UiIcon name="chevronRight" size={19}/></button>; })}</div></section>
  </div>;

  const privateAccess = selectedCategory.tokenLinksEnabled !== false;
  const publicAccess = selectedCategory.publicLinksEnabled !== false;
  const accessPolicy: AccessPolicy = privateAccess ? 'token' : publicAccess ? 'public' : 'disabled';
  return <div className="page-stack unified-page">
    <header className="page-title detail-title"><div><button className="back-button" onClick={() => setSelectedId('')}><UiIcon name="arrowLeft" size={20}/>返回订阅中心</button><div className="detail-name"><CategoryIcon icon={selectedCategory.icon} name={selectedCategory.name} size={58}/><span><h1>{selectedCategory.name} 订阅</h1><p>选择文件后缀后复制地址，同系列客户端可以共用</p></span></div></div></header>
    <section className="soft-card unified-card subscription-access-card"><div><span className="metric-icon blue"><UiIcon name="settings"/></span><span><h2>规则访问策略</h2><p>只影响 {selectedCategory.name} 的订阅链接</p></span></div><select className="app-input access-policy-select" value={accessPolicy} onChange={(event) => setAccess(event.target.value as AccessPolicy)}><option value="token">私密访问（带密钥）</option><option value="public">公开访问</option><option value="disabled">禁止访问</option></select></section>
    <div className="access-banner"><span><UiIcon name="info" size={19}/>{privateAccess ? '优先使用私密地址' : publicAccess ? '当前使用公开地址' : '当前未开放订阅访问'}</span><small>系统会根据当前访问策略自动选择可用地址</small></div>
    <div className="format-link-grid">{formats.map((format) => <section className="format-link-card" key={format.id}><div className="format-link-head"><span className={`metric-icon ${format.tone}`}><UiIcon name="file"/></span><code>{format.suffix}</code></div><h2>{format.title}</h2><p>{format.description}</p><span className="format-file-name">{format.link?.fileName}</span><button className="primary-action icon-action" disabled={!format.link?.recommendedUrl} onClick={() => copy(format.link)}><UiIcon name="copy" size={17}/>复制订阅链接</button></section>)}</div>
  </div>;
}
