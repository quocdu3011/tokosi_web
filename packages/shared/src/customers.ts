/**
 * Hằng số dùng chung của phân hệ Khách hàng (theo file TKS_Bao_cao_kinh_doanh_customers).
 */

/** "Level giá": giá trị lưu trong CSDL -> nhãn hiển thị (cột "Level giá" của file TKS). */
export const CUSTOMER_PRICE_LEVELS = {
  new: 'Mới',
  medium: 'Vừa',
  large: 'Lớn',
  vip: 'Vip',
} as const;
export type CustomerPriceLevel = keyof typeof CUSTOMER_PRICE_LEVELS;
export const CUSTOMER_PRICE_LEVEL_CODES = Object.keys(
  CUSTOMER_PRICE_LEVELS,
) as CustomerPriceLevel[];

/** "Hình thức bán hàng" của khách (chọn nhiều). */
export const CUSTOMER_SALES_METHODS = [
  'Bán cửa hàng',
  'FB live',
  'Kho buôn',
  'Bán sàn',
  'Sang tay',
  'FB ads',
  'Khác',
] as const;
export type CustomerSalesMethod = (typeof CUSTOMER_SALES_METHODS)[number];
