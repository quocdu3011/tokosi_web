'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';

/**
 * Chuyển giữa Tối (mặc định) và Sáng. Biểu tượng hiện theo `data-theme` bằng CSS nên không lệch khi hydrate.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      id="theme-toggle"
      variant="ghost"
      size="icon"
      className="theme-toggle"
      aria-label="Đổi giao diện sáng/tối"
      onClick={() => setTheme(resolvedTheme === 'light' ? 'dark' : 'light')}
    >
      <Sun className="theme-icon-sun" />
      <Moon className="theme-icon-moon" />
    </Button>
  );
}
