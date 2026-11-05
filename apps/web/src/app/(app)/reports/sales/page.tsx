import type { Metadata } from 'next';

import { PlaceholderPage } from '@/components/common/placeholder-page';

export const metadata: Metadata = { title: 'Báo cáo doanh số' };

// Backend chưa có API cho phân hệ này → để trống (không dùng dữ liệu giả).
export default function Page() {
  return <PlaceholderPage href="/reports/sales" />;
}
