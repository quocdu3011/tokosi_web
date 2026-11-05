'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuthStore } from '@/lib/auth/store';
import { NAV_SECTIONS } from '@/lib/navigation';
import { canAny } from '@/lib/permissions';
import { cn } from '@/lib/utils';

/** Menu trái: chỉ hiện mục người dùng có quyền (theo /auth/me, không theo vai trò). */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);

  return (
    <nav className="flex flex-col gap-4 px-3 py-4 text-sm" aria-label="Menu chính">
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((i) => canAny(user, i.permissions));
        if (items.length === 0) return null;
        const Icon = section.icon;
        const single = items.length === 1 && items[0]!.label === section.label;
        return (
          <div key={section.key} className="flex flex-col gap-1">
            {!single && (
              <div className="text-muted-foreground flex items-center gap-2 px-2 pb-1 text-xs font-medium uppercase">
                <Icon className="size-3.5" />
                {section.label}
              </div>
            )}
            {items.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors',
                    active && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
                    !single && 'pl-7',
                  )}
                >
                  {single && <Icon className="size-4" />}
                  <span className="flex-1 truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
