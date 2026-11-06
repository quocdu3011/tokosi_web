'use client';

import { Menu } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

import { BranchSwitcher } from './branch-switcher';
import { SidebarNav } from './sidebar-nav';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Tokosi – về trang chủ">
      <span className="brand-mark">
        <Image src="/logo.jpg" alt="" width={36} height={36} priority />
      </span>
      <span>
        Tokosi
        <span className="brand-sub">Quản lý bán sỉ</span>
      </span>
    </Link>
  );
}

/** Khung trang quản trị: thanh bên (máy tính) / ngăn kéo (điện thoại) + thanh trên. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="app-shell">
      <aside id="desktop-sidebar" className="sidebar" data-collapsed={!sidebarOpen}>
        <div className="sidebar-header">
          <Button
            id="toggle-desktop-menu"
            variant="ghost"
            size="icon"
            className="desktop-menu-btn"
            aria-label={sidebarOpen ? 'Thu gọn menu' : 'Mở menu'}
            aria-expanded={sidebarOpen}
            aria-controls="desktop-sidebar-content"
            title={sidebarOpen ? 'Thu gọn menu' : 'Mở menu'}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <Menu />
          </Button>
          {sidebarOpen && <Brand />}
        </div>
        <div id="desktop-sidebar-content" hidden={!sidebarOpen}>
          <SidebarNav />
        </div>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                id="open-menu"
                variant="ghost"
                size="icon"
                className="menu-btn"
                aria-label="Mở menu"
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <div className="sidebar-drawer">
                <Brand />
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <BranchSwitcher />
          <div className="app-header-end">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
