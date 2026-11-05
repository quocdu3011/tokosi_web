'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** Thông báo nổi (toast) theo MASTER 5.8; màu lấy từ token `--toast-*` qua biến của Sonner. */
function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === 'light' ? 'light' : 'dark'}
      className="toaster"
      richColors
      closeButton
      style={
        {
          '--normal-bg': 'var(--panel)',
          '--normal-text': 'var(--text)',
          '--normal-border': 'var(--border)',
          '--success-bg': 'var(--toast-success-bg)',
          '--success-text': 'var(--toast-success-fg)',
          '--success-border': 'var(--toast-success-border)',
          '--error-bg': 'var(--toast-error-bg)',
          '--error-text': 'var(--toast-error-fg)',
          '--error-border': 'var(--toast-error-border)',
          '--border-radius': 'var(--radius-md)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
