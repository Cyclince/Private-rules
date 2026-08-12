import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DomainAdmin } from './components/domain-admin';
import { LoginPage } from './pages/LoginPage';
import { LocaleProvider } from './i18n';
import './styles/app.css';
import { authenticateTelegramMiniApp } from './telegram/telegram-auth';
import { applyTelegramTheme } from './telegram/telegram-theme';
import { isTelegramMiniApp } from './telegram/telegram-webapp';

function Router() {
  if (window.location.pathname === '/admin/login') return <LoginPage />;
  return <TelegramSessionGate />;
}

function TelegramSessionGate() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() => isTelegramMiniApp() ? 'loading' : 'ready');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!isTelegramMiniApp()) return;
    applyTelegramTheme();
    authenticateTelegramMiniApp().then(() => setState('ready')).catch((cause) => {
      setMessage(cause instanceof Error ? cause.message : 'Telegram 登录失败。');
      setState('error');
    });
  }, []);
  if (state === 'loading') return <main className="telegram-session-state">正在验证 Telegram 会话…</main>;
  if (state === 'error') return <main className="telegram-session-state"><strong>无法打开规则面板</strong><span>{message}</span></main>;
  return <DomainAdmin />;
}

const container = document.getElementById('root')!;
const root = import.meta.hot?.data.root ?? createRoot(container);
if (import.meta.hot) import.meta.hot.data.root = root;

root.render(
  <React.StrictMode>
    <LocaleProvider><Router /></LocaleProvider>
  </React.StrictMode>,
);
