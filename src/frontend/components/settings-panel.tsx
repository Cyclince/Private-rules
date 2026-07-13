import { useRef, useState } from 'react';
import type { RulesData } from '../../types/domain-rules';
import type { useDomainAdmin } from '../hooks/use-domain-admin';
import { UiIcon } from './ui-icon';
import { PRESET_ICON_PACKS } from './icon-picker';
import { useLocale } from '../i18n';

export function SettingsPanel({ api, data, theme, onThemeChange, onToast }: { api: ReturnType<typeof useDomainAdmin>; data: RulesData; theme: string; onThemeChange: (theme: string) => void; onToast: (message: string) => void }) {
  const { locale, setLocale } = useLocale();
  const [baseUrl, setBaseUrl] = useState(data.settings.baseUrl);
  const [policyName, setPolicyName] = useState(data.settings.policyName);
  const [customIconPackUrls, setCustomIconPackUrls] = useState(data.settings.customIconPackUrls ?? []);
  const [customIconPackNames, setCustomIconPackNames] = useState(data.settings.customIconPackNames ?? {});
  const [iconPackNameInput, setIconPackNameInput] = useState('');
  const [iconPackInput, setIconPackInput] = useState('');
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function save() {
    await api.updateSettings({ baseUrl, policyName, customIconPackUrls, customIconPackNames });
    onToast('设置已保存');
  }
  async function addIconPack() {
    const url = iconPackInput.trim();
    if (!/^https?:\/\//i.test(url) || customIconPackUrls.includes(url)) return;
    const nextUrls = [...customIconPackUrls, url];
    const nextNames = { ...customIconPackNames, [url]: iconPackNameInput.trim() || '我的图标包' };
    setCustomIconPackUrls(nextUrls);
    setCustomIconPackNames(nextNames);
    setIconPackInput('');
    setIconPackNameInput('');
    await api.updateSettings({ customIconPackUrls: nextUrls, customIconPackNames: nextNames });
    onToast('图标包已添加');
  }
  function removeIconPack(url: string) {
    setCustomIconPackUrls((current) => current.filter((item) => item !== url));
    setCustomIconPackNames((current) => { const next = { ...current }; delete next[url]; return next; });
  }
  function updateIconPackUrl(index: number, nextUrl: string) {
    const previousUrl = customIconPackUrls[index];
    const nextUrls = customIconPackUrls.map((url, itemIndex) => itemIndex === index ? nextUrl : url);
    const nextNames = { ...customIconPackNames, [nextUrl]: customIconPackNames[previousUrl] ?? '我的图标包' };
    if (previousUrl !== nextUrl) delete nextNames[previousUrl];
    setCustomIconPackUrls(nextUrls);
    setCustomIconPackNames(nextNames);
  }
  async function exportBackup() {
    const content = await api.exportData();
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `private-rules-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    onToast('JSON 备份已导出');
  }
  async function importBackup() {
    if (!backupFile) return;
    try {
      const json = await backupFile.text();
      const parsed = JSON.parse(json) as Partial<RulesData>;
      if (parsed.version !== 1 || !Array.isArray(parsed.categories) || !parsed.settings) throw new Error('备份结构不完整');
      await api.importData(json);
      setBackupFile(null);
      if (fileInput.current) fileInput.current.value = '';
      onToast('备份已恢复');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '无法导入备份');
    }
  }

  return <div className="page-stack unified-page">
    <header className="page-title"><div><span className="eyebrow">PREFERENCES</span><h1>设置</h1><p>统一管理基础配置、界面主题和数据备份</p></div></header>
    <section className="soft-card unified-card settings-section">
      <div className="card-title"><span className="metric-icon blue"><UiIcon name="settings"/></span><div><h2>基础设置</h2><p>配置订阅地址与生成规则时使用的默认策略组</p></div></div>
      <div className="settings-form compact-settings-form"><label><span>站点基础 URL</span><input className="app-input" placeholder="https://example.com" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)}/></label><label><span>默认策略组名称</span><input className="app-input" placeholder="可留空" value={policyName} onChange={(event) => setPolicyName(event.target.value)}/></label></div>
    </section>
    <section className="soft-card unified-card settings-section"><div className="card-title"><span className="metric-icon purple"><UiIcon name="settings"/></span><div><h2>外观</h2><p>主题与语言会应用到整个管理界面</p></div></div><div className="appearance-settings-grid"><label><span className="field-label">主题</span><select className="app-input" value={theme} onChange={(event) => onThemeChange(event.target.value)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label><label><span className="field-label">语言</span><select className="app-input" value={locale} onChange={(event) => setLocale(event.target.value as typeof locale)}><option value="zh-CN">简体中文</option><option value="zh-TW">繁体中文</option><option value="en">English</option></select></label></div></section>
    <section className="soft-card unified-card settings-section"><div className="card-title"><span className="metric-icon cyan"><UiIcon name="domain"/></span><div><h2>分类图标包</h2><p>保留 Qure Color，自定义图标包可随时修改名称和订阅地址</p></div></div><div className="icon-pack-list">{PRESET_ICON_PACKS.map((pack) => <div key={pack.url}><span className="rule-state on"/><span><strong>{pack.label}</strong><small>{pack.url}</small></span><em>预置</em></div>)}{customIconPackUrls.map((url, index) => <div className="custom-icon-pack-row editable-pack-row" key={index}><span className="rule-state on"/><span><input className="app-input icon-pack-name-input" aria-label={`${url} 的图标包名称`} value={customIconPackNames[url] ?? ''} placeholder="图标包名称" onChange={(event) => setCustomIconPackNames((current) => ({ ...current, [url]: event.target.value }))}/><input className="app-input icon-pack-url-input" aria-label={`${customIconPackNames[url] || '自定义图标包'} 的订阅地址`} value={url} placeholder="https://example.com/icons.json" onChange={(event) => updateIconPackUrl(index, event.target.value)}/></span><button className="danger-icon-button" aria-label="移除自定义图标包" onClick={() => removeIconPack(url)}><UiIcon name="trash" size={16}/></button></div>)}</div><div className="add-pack-row named-pack-row"><input className="app-input" placeholder="图标包名称" value={iconPackNameInput} onChange={(event) => setIconPackNameInput(event.target.value)}/><input className="app-input" placeholder="https://example.com/icons.json" value={iconPackInput} onChange={(event) => setIconPackInput(event.target.value)}/><button className="subtle-action icon-action" disabled={!/^https?:\/\//i.test(iconPackInput.trim())} onClick={addIconPack}><UiIcon name="plus" size={17}/>添加图标包</button></div></section>
    <section className="soft-card unified-card settings-section backup-section"><div className="card-title"><span className="metric-icon green"><UiIcon name="download"/></span><div><h2>数据备份</h2><p>备份覆盖分类、规则、上游来源、同步间隔和访问设置</p></div></div><div className="backup-grid"><div className="backup-box backup-flow-card"><div className="backup-card-head"><span className="backup-icon green"><UiIcon name="download" size={25}/></span><span><strong>导出完整备份</strong><small>生成可随时恢复的标准 JSON 快照</small></span></div><div className="backup-card-meta"><span>文件格式</span><strong>.json</strong></div><button className="primary-action icon-action" onClick={exportBackup}><UiIcon name="download" size={17}/>下载备份文件</button></div><div className="backup-box backup-flow-card"><div className="backup-card-head"><span className="backup-icon purple"><UiIcon name="upload" size={25}/></span><span><strong>恢复备份</strong><small>{backupFile ? backupFile.name : '选择由 Private Rules 导出的 JSON 文件'}</small></span></div><input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => setBackupFile(event.target.files?.[0] ?? null)}/><div className="backup-card-actions"><button className="file-select-button icon-action" onClick={() => fileInput.current?.click()}><UiIcon name="file" size={17}/>{backupFile ? '更换文件' : '选择文件'}</button><button className="primary-action icon-action" disabled={!backupFile} onClick={importBackup}><UiIcon name="refresh" size={17}/>开始恢复</button></div></div></div></section>
    <section className="soft-card unified-card settings-section"><div className="card-title"><span className="metric-icon orange"><UiIcon name="database"/></span><div><h2>服务状态</h2><p>这里只显示配置状态，不展示敏感值</p></div></div><div className="service-grid"><span><i className={api.meta.d1Ready ? 'ok' : ''}/>D1 数据库<strong>{api.meta.d1Ready ? '已连接' : '未连接'}</strong></span><span><i className={api.meta.passwordConfigured ? 'ok' : ''}/>后台密码<strong>{api.meta.passwordConfigured ? '已配置' : '未配置'}</strong></span><span><i className={api.meta.ruleTokenConfigured ? 'ok' : ''}/>RULE_TOKEN<strong>{api.meta.ruleTokenConfigured ? '已配置' : '未配置'}</strong></span><span><i className={api.meta.sessionSecretConfigured ? 'ok' : ''}/>SESSION_SECRET<strong>{api.meta.sessionSecretConfigured ? '已配置' : '未配置'}</strong></span></div></section>
    <div className="settings-savebar"><span>保存站点地址、策略组和自定义图标包设置</span><button className="primary-action icon-action" onClick={save}><UiIcon name="download" size={17}/>保存全部设置</button></div>
  </div>;
}
