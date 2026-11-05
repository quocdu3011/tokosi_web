import type { Metadata } from 'next';
import { Be_Vietnam_Pro, Inter, Roboto } from 'next/font/google';

import { AppProviders } from '@/components/providers/app-providers';

import './globals.css';

// Bộ phông theo design system: tiêu đề / nội dung / số liệu (MASTER 4.2)
const display = Be_Vietnam_Pro({
  variable: '--font-be-vietnam',
  subsets: ['latin', 'vietnamese'],
  weight: ['500', '600', '700', '800'],
  display: 'swap',
});
const body = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'vietnamese'],
  display: 'swap',
});
const data = Roboto({
  variable: '--font-roboto',
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Tokosi – Quản lý bán hàng sỉ', template: '%s · Tokosi' },
  description: 'Hệ thống quản lý bán hàng sỉ nội bộ Tokosi',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // suppressHydrationWarning: next-themes gắn data-theme lên <html> trước khi React hydrate
    <html
      lang="vi"
      data-theme="dark"
      className={`${display.variable} ${body.variable} ${data.variable}`}
      suppressHydrationWarning
    >
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
