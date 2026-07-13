import { useEffect, useState } from 'react';
import { UiIcon } from './ui-icon';

export type CategorySortKey = 'modified' | 'created' | 'count' | 'alpha';
export type SortDirection = 'desc' | 'asc';

export function usePersistentSort(scope: string) {
  const [value, setValue] = useState<CategorySortKey>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(`private-rules-sort-${scope}`) : null;
    const key = saved?.split(':')[0];
    return ['alpha', 'count', 'created', 'modified'].includes(key ?? '') ? key as CategorySortKey : 'alpha';
  });
  const [direction, setDirection] = useState<SortDirection>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(`private-rules-sort-${scope}`) : null;
    return saved?.split(':')[1] === 'desc' ? 'desc' : 'asc';
  });
  useEffect(() => { localStorage.setItem(`private-rules-sort-${scope}`, `${value}:${direction}`); }, [direction, scope, value]);
  return { value, direction, setValue, setDirection };
}

const OPTIONS: Array<{ key: CategorySortKey; label: string }> = [
  { key: 'alpha', label: '名称' },
  { key: 'count', label: '规则数量' },
  { key: 'created', label: '创建时间' },
  { key: 'modified', label: '修改时间' },
];

export function SortToolbar({ value, direction, onChange }: { value: CategorySortKey; direction: SortDirection; onChange: (key: CategorySortKey, direction: SortDirection) => void }) {
  function choose(key: CategorySortKey) {
    onChange(key, key === value ? direction === 'desc' ? 'asc' : 'desc' : key === 'alpha' ? 'asc' : 'desc');
  }
  return <div className="sort-toolbar" aria-label="分类排序">
    {OPTIONS.map((option) => <button className={value === option.key ? 'active' : ''} key={option.key} onClick={() => choose(option.key)}>{option.label}{value === option.key && <span className={direction === 'asc' ? 'sort-asc' : ''}><UiIcon name="chevron" size={14}/></span>}</button>)}
  </div>;
}

export function sortCategoryEntries<T extends { category: { name: string; createdAt?: string; updatedAt: string }; count: number }>(entries: T[], key: CategorySortKey, direction: SortDirection): T[] {
  const sign = direction === 'desc' ? -1 : 1;
  return [...entries].sort((a, b) => {
    if (key === 'alpha') return a.category.name.localeCompare(b.category.name, 'zh-CN') * sign;
    if (key === 'count') return (a.count - b.count) * sign;
    const aTime = key === 'created' ? a.category.createdAt : a.category.updatedAt;
    const bTime = key === 'created' ? b.category.createdAt : b.category.updatedAt;
    return (new Date(aTime ?? 0).getTime() - new Date(bTime ?? 0).getTime()) * sign;
  });
}
