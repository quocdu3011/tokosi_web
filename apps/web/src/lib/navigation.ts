import {
  ArrowLeftRight,
  BarChart3,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * Sơ đồ điều hướng theo docs/TAI_LIEU_THIET_KE.md mục 7.2.
 * - `permissions`: hiện mục khi người dùng có ÍT NHẤT MỘT quyền trong danh sách (không xét vai trò).
 * - `ready`: backend đã có API (docs/api/openapi.json). Mục chưa sẵn sàng vẫn hiện trên menu
 *   nhưng trang chỉ là trang trống "đang được xây dựng" — FE không dùng dữ liệu giả.
 */
export interface NavItem {
  href: string;
  label: string;
  permissions: string[];
  ready: boolean;
}

export interface NavSection {
  key: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'dashboard',
    label: 'Tổng quan',
    icon: LayoutDashboard,
    items: [{ href: '/', label: 'Tổng quan', permissions: ['dashboard.view'], ready: false }],
  },
  {
    key: 'products',
    label: 'Hàng hóa',
    icon: Package,
    items: [
      {
        href: '/products',
        label: 'Danh sách hàng hóa',
        permissions: ['product.view'],
        ready: true,
      },
    ],
  },
  {
    key: 'purchase',
    label: 'Mua hàng',
    icon: Truck,
    items: [
      { href: '/suppliers', label: 'Nhà cung cấp', permissions: ['purchase.view'], ready: false },
      { href: '/goods-receipts', label: 'Nhập hàng', permissions: ['purchase.view'], ready: false },
      {
        href: '/purchase-returns',
        label: 'Trả hàng nhập',
        permissions: ['purchase.view'],
        ready: false,
      },
    ],
  },
  {
    key: 'sales',
    label: 'Đơn hàng',
    icon: ShoppingCart,
    items: [
      { href: '/orders', label: 'Đặt hàng', permissions: ['order.view'], ready: false },
      { href: '/invoices', label: 'Hóa đơn', permissions: ['invoice.view'], ready: false },
      { href: '/sales-returns', label: 'Trả hàng', permissions: ['invoice.view'], ready: false },
    ],
  },
  {
    key: 'customers',
    label: 'Khách hàng',
    icon: Users,
    items: [
      { href: '/customers', label: 'Khách hàng', permissions: ['customer.view'], ready: false },
    ],
  },
  {
    key: 'cash',
    label: 'Sổ quỹ',
    icon: Wallet,
    items: [{ href: '/cash', label: 'Sổ quỹ', permissions: ['cash.view'], ready: false }],
  },
  {
    key: 'transfers',
    label: 'Chuyển kho',
    icon: ArrowLeftRight,
    items: [
      {
        href: '/stock-transfers',
        label: 'Chuyển kho',
        permissions: ['transfer.view'],
        ready: false,
      },
    ],
  },
  {
    key: 'reports',
    label: 'Báo cáo',
    icon: BarChart3,
    items: [
      {
        href: '/reports/customer-debt',
        label: 'Công nợ khách',
        permissions: ['report.debt'],
        ready: false,
      },
      {
        href: '/reports/supplier-debt',
        label: 'Công nợ NCC',
        permissions: ['report.debt'],
        ready: false,
      },
      { href: '/reports/sales', label: 'Doanh số', permissions: ['report.sales'], ready: false },
      {
        href: '/reports/inventory',
        label: 'Tồn kho',
        permissions: ['report.inventory'],
        ready: false,
      },
      { href: '/reports/cash-book', label: 'Sổ quỹ', permissions: ['report.cash'], ready: false },
    ],
  },
  {
    key: 'system',
    label: 'Hệ thống',
    icon: Settings,
    items: [
      { href: '/settings/users', label: 'Người dùng', permissions: ['user.manage'], ready: true },
      { href: '/settings/roles', label: 'Phân quyền', permissions: ['role.manage'], ready: true },
      {
        href: '/settings/auth',
        label: 'Đăng nhập Google',
        permissions: ['user.manage'],
        ready: true,
      },
    ],
  },
];

/**
 * Mục menu có đang được chọn không: khớp đường dẫn hiện tại và là khớp DÀI NHẤT, để
 * `/settings/users` không làm sáng cả mục cha `/settings` nếu cùng có trong menu.
 */
export function isNavActive(pathname: string, href: string): boolean {
  const matches = (h: string) =>
    h === '/' ? pathname === '/' : pathname === h || pathname.startsWith(`${h}/`);
  if (!matches(href)) return false;
  return !NAV_SECTIONS.some((s) =>
    s.items.some((i) => i.href.length > href.length && matches(i.href)),
  );
}

/** Tìm mục menu theo đường dẫn (khớp chính xác). */
export function findNavItem(href: string): NavItem | undefined {
  for (const section of NAV_SECTIONS) {
    const item = section.items.find((i) => i.href === href);
    if (item) return item;
  }
  return undefined;
}
