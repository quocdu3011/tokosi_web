'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { useAuthStore } from '@/lib/auth/store';
import { NAV_SECTIONS } from '@/lib/navigation';
import { canAny } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/**
 * Menu trái: chỉ hiện mục người dùng có quyền (theo /auth/me, không theo vai trò).
 * Nhóm nhiều mục là accordion (mặc định mở nhóm đang chứa trang hiện tại).
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  // Chỉ lưu nhóm người dùng đã bấm; chưa bấm thì theo trang hiện tại.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <nav className="nav" aria-label="Menu chính">
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((i) => canAny(user, i.permissions));
        if (items.length === 0) return null;
        const Icon = section.icon;
        const single = items.length === 1 && items[0]!.label === section.label;

        if (single) {
          const item = items[0]!;
          const active = isActive(item.href);
          return (
            <Link
              key={section.key}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn('nav-item', active && 'active')}
            >
              <Icon />
              <span>{item.label}</span>
            </Link>
          );
        }

        const hasActive = items.some((i) => isActive(i.href));
        const open = toggled[section.key] ?? hasActive;
        const listId = `nav-group-${section.key}`;
        return (
          <div key={section.key}>
            <button
              type="button"
              id={`nav-toggle-${section.key}`}
              className={cn('nav-group-toggle', hasActive && 'has-active')}
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setToggled((s) => ({ ...s, [section.key]: !open }))}
            >
              <Icon />
              <span>{section.label}</span>
              <ChevronDown className="nav-group-chevron" />
            </button>
            <div id={listId} className="nav-group-list" hidden={!open}>
              {items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn('nav-item', active && 'active')}
                  >
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
