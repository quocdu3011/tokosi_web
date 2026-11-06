/** Thứ tự và tiêu đề cột của file Excel hàng hóa. */
export const PRODUCT_EXPORT_COLUMNS = [
  { id: 'code', label: 'Mã hàng' },
  { id: 'name', label: 'Tên hàng' },
  { id: 'productType', label: 'Loại hàng' },
  { id: 'components', label: 'Hàng thành phần' },
  { id: 'liquidationStatus', label: 'Trạng thái thanh lý' },
  { id: 'costPrice', label: 'Giá vốn' },
  { id: 'lastPurchasePrice', label: 'Giá nhập cuối' },
  { id: 'onHand', label: 'Tồn kho' },
  { id: 'reserved', label: 'KH đặt' },
  { id: 'description', label: 'Mô tả' },
  { id: 'isActive', label: 'Đang kinh doanh' },
  { id: 'images', label: 'Hình ảnh (url1,url2...)' },
] as const;

export type ProductExportColumnId = (typeof PRODUCT_EXPORT_COLUMNS)[number]['id'];

export function isProductCostColumn(id: string): boolean {
  return id === 'costPrice' || id === 'lastPurchasePrice';
}
