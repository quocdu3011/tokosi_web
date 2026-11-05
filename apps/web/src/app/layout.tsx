import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { AppProviders } from '@/components/providers/app-providers';

import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'vietnamese'],
});

export const metadata: Metadata = {
  title: { default: 'Kiot – Quản lý bán hàng sỉ', template: '%s · Kiot' },
  description: 'Hệ thống quản lý bán hàng sỉ nội bộ',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // suppressHydrationWarning: next-themes gắn class sáng/tối lên <html> trước khi React hydrate
    <html lang="vi" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full font-sans">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
