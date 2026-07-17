import type { RuleCategory, RulesData } from '../../types/domain-rules';
import { UiIcon, type IconName } from './ui-icon';
import { CategoryIcon } from './category-icon';
import { SortToolbar, sortCategoryEntries, usePersistentSort, type CategorySortKey } from './sort-toolbar';

const SORT_COPY: Record<CategorySortKey, string> = { modified: '按最后修改时间排列', created: '按规则分类创建时间排列', count: '按分类规则数量排列', alpha: '按分类名称首字母排列' };
const SORT_TITLE: Record<CategorySortKey, string> = { alpha: '名称', count: '规则数量', created: '创建时间', modified: '修改时间' };

export function DashboardPanel({ data, onOpenCategory }: { data: RulesData; onOpenCategory: (category: RuleCategory) => void }) {
  const { value: sortKey, direction: sortDirection, setValue: setSortKey, setDirection: setSortDirection } = usePersistentSort('dashboard');
  const totalRules = data.categories.reduce((sum, category) => sum + (category.ruleCount ?? category.rules.length), 0);
  const activeRules = data.categories.reduce((sum, category) => sum + (category.enabledRuleCount ?? category.rules.filter((rule) => rule.enabled).length), 0);
  const disabledRules = totalRules - activeRules;
  const recentCategories = sortCategoryEntries(data.categories.map((category) => ({ category, count: category.ruleCount ?? category.rules.length })), sortKey, sortDirection).map((entry) => entry.category);
  const metrics: { label: string; value: string; icon: IconName; tone: string }[] = [
    { label: '全部规则', value: totalRules.toLocaleString('zh-CN'), icon: 'domain', tone: 'blue' },
    { label: '规则分类', value: data.categories.length.toLocaleString('zh-CN'), icon: 'rules', tone: 'purple' },
    { label: '已启用', value: activeRules.toLocaleString('zh-CN'), icon: 'pulse', tone: 'green' },
    { label: '已停用', value: disabledRules.toLocaleString('zh-CN'), icon: 'database', tone: 'orange' },
  ];
  return <div className="page-stack dashboard-page">
    <header className="page-title"><div><span className="eyebrow">PRIVATE RULES</span><h1>概览</h1><p>查看规则状态与分类变化</p></div></header>
    <div className="metric-grid dashboard-metrics compact-metrics">{metrics.map((metric) => <section className="metric-card" key={metric.label}><span className={`metric-icon ${metric.tone}`}><UiIcon name={metric.icon}/></span><span className="metric-label">{metric.label}</span><strong>{metric.value}</strong></section>)}</div>
    <section className="soft-card unified-card recent-section">
      <div className="section-inline sort-section-head"><div><h2>{SORT_TITLE[sortKey]}</h2><p>{SORT_COPY[sortKey]} · {sortDirection === 'desc' ? '从大到小' : '从小到大'}</p></div><SortToolbar value={sortKey} direction={sortDirection} onChange={(key, direction) => { setSortKey(key); setSortDirection(direction); }}/></div>
      <div className="category-summary-grid dashboard-rule-grid sort-content-transition" key={`${sortKey}-${sortDirection}`}>{recentCategories.map((category) => <button className="category-summary-card dashboard-rule-card" key={category.id} onClick={() => onOpenCategory(category)}><CategoryIcon icon={category.icon} name={category.name}/><span><strong data-no-translate>{category.name}</strong><small data-no-translate={category.description ? '' : undefined}>{category.description || '暂无分类说明'}</small></span><span className="dashboard-rule-count"><strong>{category.ruleCount ?? category.rules.length}</strong><small>条规则</small></span><UiIcon name="chevronRight" size={19}/></button>)}{!recentCategories.length && <div className="empty-state"><UiIcon name="rules" size={30}/><strong>还没有规则分类</strong><span>前往规则页创建第一个分类</span></div>}</div>
    </section>
  </div>;
}
