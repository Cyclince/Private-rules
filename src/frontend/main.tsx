import React from 'react';
import { createRoot } from 'react-dom/client';
import { DomainAdmin } from './components/domain-admin';
import { LoginPage } from './pages/LoginPage';
import { LocaleProvider } from './i18n';
import './styles/app.css';

function Router() {
  if (window.location.pathname === '/admin/login') return <LoginPage />;
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
