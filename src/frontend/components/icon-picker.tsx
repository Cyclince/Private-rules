import { useEffect, useMemo, useState } from 'react';
import { CategoryIcon } from './category-icon';
import { UiIcon } from './ui-icon';

export const PRESET_ICON_PACKS = [
  { label: 'Qure Color', url: 'https://raw.githubusercontent.com/Koolson/Qure/master/Other/QureColor-All.json' },
];

type PackIcon = { name: string; url: string };

function readPackIcons(payload: unknown): PackIcon[] {
  if (Array.isArray(payload)) return payload as PackIcon[];
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.icons)) return record.icons as PackIcon[];
  return Object.entries(record)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, url]) => ({ name, url }));
}

export function IconPicker({ value, name, customPackUrls, customPackNames, onChange }: { value?: string; name: string; customPackUrls: string[]; customPackNames?: Record<string, string>; onChange: (url: string) => void }) {
  const packs = useMemo(() => [...PRESET_ICON_PACKS, ...customPackUrls.map((url, index) => ({ label: customPackNames?.[url]?.trim() || `自定义图标包 ${index + 1}`, url }))], [customPackNames, customPackUrls]);
  const [packUrl, setPackUrl] = useState(packs[0]?.url ?? '');
  const [icons, setIcons] = useState<PackIcon[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!packs.some((pack) => pack.url === packUrl)) setPackUrl(packs[0]?.url ?? '');
  }, [packs, packUrl]);

  useEffect(() => {
    if (!packUrl) return;
    const controller = new AbortController();
    setStatus('正在加载图标包');
    fetch(packUrl, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as unknown;
      setIcons(readPackIcons(payload).filter((icon) => icon.name && /^https?:\/\//i.test(icon.url)));
      setStatus('');
    }).catch((error) => { if (error.name !== 'AbortError') setStatus(`图标包加载失败：${error.message}`); });
    return () => controller.abort();
  }, [packUrl]);

  const visible = icons.filter((icon) => icon.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <details className="icon-picker icon-picker-disclosure animated-disclosure">
    <summary className="icon-picker-current"><CategoryIcon icon={value} name={name || '规则'} size={52}/><span><strong>规则图标</strong><small>{value ? '已选择图标，可展开继续更换' : '默认收起，展开后可浏览完整图标包'}</small></span><span className="icon-picker-summary-meta">{visible.length} 个<UiIcon name="chevron" size={16}/></span></summary>
    <div className="icon-picker-content"><div className="icon-picker-tools"><select className="app-input" value={packUrl} onChange={(event) => setPackUrl(event.target.value)}>{packs.map((pack) => <option key={pack.url} value={pack.url}>{pack.label}</option>)}</select><input className="app-input" placeholder="搜索图标，例如 Emby、AI" value={query} onChange={(event) => setQuery(event.target.value)}/></div>{status ? <p className="helper-text">{status}</p> : <div className="icon-grid full-icon-grid">{visible.map((icon) => <button className={value === icon.url ? 'active' : ''} key={`${icon.name}-${icon.url}`} title={icon.name} onClick={() => onChange(icon.url)}><img src={icon.url} alt="" loading="lazy" referrerPolicy="no-referrer"/><span>{icon.name.replace(/\.png$/i, '')}</span></button>)}{!visible.length && <div className="icon-empty-state">没有匹配的图标</div>}</div>}</div>
  </details>;
}
