import { useEffect, useState, type ReactNode } from 'react';
import { BottomNav } from './BottomNav';
import { DesktopSidebar, TabletSidebarDrawer } from './Sidebar';
import { Topbar } from './Topbar';
import { consumeLoginArrivalFlag } from '../../lib/login-arrival';

export function AppShell({ children }: { children: ReactNode }) {
  const [tabletOpen, setTabletOpen] = useState(false);
  const [loginArrival, setLoginArrival] = useState(() => consumeLoginArrivalFlag());

  useEffect(() => {
    if (!loginArrival) return;
    const timer = window.setTimeout(() => {
      setLoginArrival(false);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [loginArrival]);

  return (
    <div
      data-testid="app-shell"
      className={`flex min-h-screen w-full bg-bg text-text ${loginArrival ? 'login-arrival' : ''}`}
    >
      <DesktopSidebar />
      <TabletSidebarDrawer open={tabletOpen} onClose={() => setTabletOpen(false)} />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Topbar onOpenTabletSidebar={() => setTabletOpen(true)} />
        <main
          data-testid="app-main"
          className="shell-main mx-auto w-full max-w-6xl min-w-0 flex-1 overflow-x-clip px-4 py-5 pb-24 sm:px-6 md:pb-8"
        >
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
