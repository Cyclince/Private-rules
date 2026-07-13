import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import type { RuleCategory } from '../../types/domain-rules';
import { useDomainAdmin } from '../hooks/use-domain-admin';
import { AboutPanel } from './about-panel';
import { DashboardPanel } from './dashboard-panel';
import { LinksPanel } from './links-panel';
import { RulesPanel } from './rules-panel';
import { SettingsPanel } from './settings-panel';
import { UiIcon, type IconName } from './ui-icon';
import privateRulesAvatar from '../assets/private-rules-avatar.png';
import { transitionTheme } from '../i18n';

type View = 'dashboard' | 'rules' | 'links' | 'settings' | 'about';

const NAV: { id: View; label: string; english: string; icon: IconName }[] = [
  { id: 'dashboard', label: '概览', english: 'OVERVIEW', icon: 'home' },
  { id: 'rules', label: '规则', english: 'RULES', icon: 'rules' },
  { id: 'links', label: '订阅', english: 'SUBSCRIPTIONS', icon: 'links' },
  { id: 'settings', label: '设置', english: 'SETTINGS', icon: 'settings' },
];
const ABOUT_META = { label: '关于', english: 'ABOUT' };

function initialView(): View {
  if (typeof window === 'undefined') return 'dashboard';
  const candidate = new URLSearchParams(window.location.search).get('view') ?? localStorage.getItem('rule-admin-view');
  return ['dashboard', 'rules', 'links', 'settings', 'about'].includes(candidate ?? '') ? candidate as View : 'dashboard';
}

export function DomainAdmin() {
  const api = useDomainAdmin();
  const [view, setView] = useState<View>(initialView);
  const [selectedId, setSelectedId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('category') ?? localStorage.getItem('rule-admin-category') ?? '';
  });
  const [theme, setTheme] = useState('system');
  const [toast, setToast] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionDialog, setActionDialog] = useState<'sync' | 'logout' | null>(null);
  const [loginArrival, setLoginArrival] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('enter') === 'login');

  const selectedCategory = useMemo(
    () => api.data?.categories.find((category) => category.id === selectedId),
    [api.data?.categories, selectedId],
  );
  const pageMeta = view === 'about' ? ABOUT_META : NAV.find((item) => item.id === view) ?? NAV[0];

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  }

  function openCategory(category: RuleCategory) {
    setSelectedId(category.id);
    setView('rules');
  }

  function navigate(nextView: View) {
    setView(nextView);
    if (nextView === 'rules') setSelectedId('');
    setProfileOpen(false);
  }

  function changeTheme(nextTheme: string) {
    if (nextTheme === theme) return;
    transitionTheme(() => {
      const dark = nextTheme === 'dark' || (nextTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      localStorage.setItem('rule-admin-theme', nextTheme);
      flushSync(() => setTheme(nextTheme));
    });
  }

  async function logout() {
    setActionDialog(null);
    await fetch('/api/auth/logout', { method: 'POST' });
    document.documentElement.classList.add('session-leaving');
    window.setTimeout(() => { window.location.href = '/admin/login'; }, 520);
  }

  async function syncNow() {
    setSyncing(true);
    try { await api.syncAll(); showToast('上游规则同步完成'); }
    finally { setSyncing(false); setProfileOpen(false); setActionDialog(null); }
  }

  useEffect(() => {
    setTheme(localStorage.getItem('rule-admin-theme') ?? 'system');
  }, []);

  useEffect(() => {
    const applyTheme = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      localStorage.setItem('rule-admin-theme', theme);
    };
    applyTheme();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('rule-admin-view', view);
    if (selectedId) localStorage.setItem('rule-admin-category', selectedId);
    else localStorage.removeItem('rule-admin-category');
    const params = new URLSearchParams(window.location.search);
    params.set('view', view);
    if (selectedId) params.set('category', selectedId);
    else params.delete('category');
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, [selectedId, view]);

  useEffect(() => {
    if (!api.data || !selectedId) return;
    if (!api.data.categories.some((category) => category.id === selectedId)) setSelectedId('');
  }, [api.data, selectedId]);

  useEffect(() => {
    let timer = 0;
    const onScroll = () => {
      document.documentElement.classList.add('is-scrolling');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => document.documentElement.classList.remove('is-scrolling'), 1900);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); window.clearTimeout(timer); document.documentElement.classList.remove('is-scrolling'); };
  }, []);

  useEffect(() => {
    if (!api.error) return;
    showToast(api.error);
    api.clearError();
  }, [api.error]);

  useEffect(() => {
    if (!loginArrival) return;
    const timer = window.setTimeout(() => {
      setLoginArrival(false);
      const params = new URLSearchParams(window.location.search);
      params.delete('enter');
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    }, 980);
    return () => window.clearTimeout(timer);
  }, [loginArrival]);

  return (
    <div className={`app-shell ${loginArrival ? 'login-arrival' : ''}`}>
      <aside className="desktop-sidebar">
        <div className="sidebar-brand">
          <img src={privateRulesAvatar} alt="Private Rules 规则守护者" />
          <div><strong>Private Rules</strong><span>规则控制台</span></div>
        </div>
        {NAV.map((item) => (
          <button className={`nav-item ${view === item.id ? 'active' : ''}`} key={item.id} onClick={() => navigate(item.id)}>
            <UiIcon name={item.icon} />{item.label}
          </button>
        ))}
        <div className="sidebar-status"><span className="status-dot" />服务运行正常</div>
      </aside>
      <main className="app-main">
        <header className="app-topbar">
          <div className="mobile-brand"><img src={privateRulesAvatar} alt="" /><div><strong>Private Rules</strong><span>规则控制台</span></div></div>
          <div className="topbar-title"><span>{pageMeta.english}</span><strong>{pageMeta.label}</strong></div>
          <div className="topbar-actions"><span className="sync-status"><span className="status-dot" />已同步{api.data?.lastSyncedAt ? ` · ${new Date(api.data.lastSyncedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ' · 暂无上游'}</span><button className="icon-button" aria-label="更多操作" onClick={() => setProfileOpen((open) => !open)}><UiIcon name="more" /></button></div>
          {profileOpen && <div className="profile-menu"><div className="mobile-sync-menu-meta"><span className="status-dot"/><span><strong>上游同步</strong><small>{api.data?.lastSyncedAt ? `最后同步 ${new Date(api.data.lastSyncedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '暂无同步记录'}</small></span></div><button disabled={syncing} onClick={() => { setProfileOpen(false); setActionDialog('sync'); }}><UiIcon name="sync" size={19}/>手动同步</button><button onClick={() => navigate('about')}><UiIcon name="info" size={18}/>关于</button><button className="danger-menu" onClick={() => { setProfileOpen(false); setActionDialog('logout'); }}><UiIcon name="logout" size={18}/>退出登录</button></div>}
        </header>
        {api.loading || !api.data ? (
          <div className="skeleton-card" />
        ) : (
          <div className="view-transition" key={`${view}-${selectedId}`}>
            {view === 'dashboard' && <DashboardPanel data={api.data} onOpenCategory={openCategory} />}
            {view === 'rules' && <RulesPanel api={api} categories={api.data.categories} category={selectedCategory} onSelectCategory={setSelectedId} onToast={showToast} />}
            {view === 'links' && <LinksPanel api={api} data={api.data} links={api.links} onToast={showToast} />}
            {view === 'settings' && <SettingsPanel api={api} data={api.data} onThemeChange={changeTheme} onToast={showToast} theme={theme} />}
            {view === 'about' && <AboutPanel />}
          </div>
        )}
      </main>
      {actionDialog && <div className="action-dialog-backdrop" role="presentation" onMouseDown={() => !syncing && setActionDialog(null)}><section className={`action-dialog ${actionDialog}`} role="dialog" aria-modal="true" aria-labelledby="action-dialog-title" onMouseDown={(event) => event.stopPropagation()}><span className={`action-dialog-icon ${actionDialog === 'sync' ? 'cyan' : 'red'}`}><UiIcon name={actionDialog === 'sync' ? 'sync' : 'logout'} size={25}/></span><div><h2 id="action-dialog-title">{actionDialog === 'sync' ? '同步全部上游规则' : '退出当前账号'}</h2><p>{actionDialog === 'sync' ? '立即检查远程订阅与 Geo 数据源，完成后会自动刷新规则统计' : '退出后需要重新输入后台密码才能继续管理规则'}</p></div><div className="action-dialog-actions"><button disabled={syncing} onClick={() => setActionDialog(null)}>取消</button><button className={actionDialog === 'sync' ? 'primary-action sync-action' : 'danger-action'} disabled={syncing} onClick={actionDialog === 'sync' ? syncNow : logout}>{actionDialog === 'sync' ? <><UiIcon name="sync" size={17}/>{syncing ? '正在同步…' : '开始同步'}</> : '确认退出'}</button></div></section></div>}
      <nav className="bottom-nav">
        {NAV.map((item) => (
          <button className={view === item.id ? 'active' : ''} key={item.id} onClick={() => navigate(item.id)}>
            <UiIcon name={item.icon} /><span>{item.label}</span>
          </button>
        ))}
      </nav>
      {toast && <div className="app-toast">{toast}</div>}
    </div>
  );
}
