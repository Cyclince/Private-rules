import { useState, type ReactNode } from 'react';
import { BottomNav } from './BottomNav';
import { DesktopSidebar, TabletSidebarDrawer } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ children }: { children: ReactNode }) {
  const [tabletOpen, setTabletOpen] = useState(false);

  return (
    <div data-testid="app-shell" className="flex min-h-screen w-full bg-bg text-text">
      <DesktopSidebar />
      <TabletSidebarDrawer open={tabletOpen} onClose={() => setTabletOpen(false)} />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Topbar onOpenTabletSidebar={() => setTabletOpen(true)} />
        <main
          data-testid="app-main"
          className="mx-auto w-full max-w-6xl min-w-0 flex-1 overflow-x-clip px-4 py-5 pb-24 sm:px-6 md:pb-8"
        >
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
