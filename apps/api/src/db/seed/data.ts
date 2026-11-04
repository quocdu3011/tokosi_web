/**
 * Dữ liệu khởi tạo cố định. Chỉ chứa cấu hình/danh mục, KHÔNG có dữ liệu khách hàng thật.
 * Seed chỉ THÊM khi chưa có (theo mã), không bao giờ ghi đè thứ người dùng đã chỉnh.
 */
import { USER_CODE_PREFIX } from '@kiot/shared';

/**
 * Hai chi nhánh dùng chung một hệ thống (cùng hàng hóa, khách hàng, nhà cung cấp) nhưng khác giá, tồn kho,
 * công nợ, quỹ và đơn hàng. Chi nhánh mặc định = Sài Gòn (đa số khách trong dữ liệu KiotViet có tiền tố "SG");
 * chưa xác nhận "Chi nhánh trung tâm" cũ là chi nhánh nào — xử lý khi nhập dữ liệu (docs/TAI_LIEU_THIET_KE.md).
 */
export const BRANCHES = [
  { code: 'SG', name: 'Chi nhánh Sài Gòn', isDefault: true },
  { code: 'HN', name: 'Chi nhánh Hà Nội', isDefault: false },
] as const;

/**
 * 7 bảng giá theo hạng khách của công ty (theo hóa đơn KiotViet). Thiếu giá ở bảng nào thì lùi về bảng chung.
 * Chưa biết khách hạng "Mới" dùng bảng nào — xem docs/TAI_LIEU_THIET_KE.md mục 5.8.
 */
export const PRICE_BOOKS = [
  {
    code: 'CHUNG',
    name: 'Bảng giá chung',
    withVat: false,
    isDefault: true,
    sortOrder: 0,
  },
  { code: 'LON', name: 'Lớn', withVat: false, isDefault: false, sortOrder: 1 },
  { code: 'VUA', name: 'Vừa', withVat: false, isDefault: false, sortOrder: 2 },
  { code: 'VIP', name: 'VIP', withVat: false, isDefault: false, sortOrder: 3 },
  {
    code: 'LON_VAT',
    name: 'Lớn VAT',
    withVat: true,
    isDefault: false,
    sortOrder: 4,
  },
  {
    code: 'VUA_VAT',
    name: 'Vừa VAT',
    withVat: true,
    isDefault: false,
    sortOrder: 5,
  },
  {
    code: 'VIP_VAT',
    name: 'VIP VAT',
    withVat: true,
    isDefault: false,
    sortOrder: 6,
  },
] as const;

/** Mỗi chi nhánh có quỹ tiền mặt và tài khoản ngân hàng RIÊNG; tên quỹ = `<tên> <tên chi nhánh>`. */
export const CASH_ACCOUNT_TEMPLATES = [
  { name: 'Tiền mặt', type: 'cash' },
  { name: 'Ngân hàng', type: 'bank' },
] as const;

/** Tên rút gọn dùng đặt tên quỹ. */
export const BRANCH_SHORT_NAMES: Record<string, string> = {
  SG: 'Sài Gòn',
  HN: 'Hà Nội',
};

/**
 * Danh mục thu chi. `isSystem` = mã nghiệp vụ tự dùng (khóa theo `code`), không cho xóa/đổi hướng.
 * Các khoản chi vận hành lấy từ sổ quỹ KiotViet (cước, bến bãi, thuê xe, xăng xe, sửa chữa kho…).
 */
export const CASH_CATEGORIES = [
  {
    code: 'customer_payment',
    name: 'Tiền khách trả',
    direction: 'in',
    isSystem: true,
  },
  {
    code: 'supplier_refund',
    name: 'Hoàn tiền từ nhà cung cấp',
    direction: 'in',
    isSystem: true,
  },
  { code: 'other_in', name: 'Thu khác', direction: 'in', isSystem: false },
  {
    code: 'supplier_payment',
    name: 'Công nợ nhà cung cấp',
    direction: 'out',
    isSystem: true,
  },
  {
    code: 'customer_refund',
    name: 'Hoàn tiền khách',
    direction: 'out',
    isSystem: true,
  },
  {
    code: 'freight',
    name: 'Cước vận chuyển',
    direction: 'out',
    isSystem: false,
  },
  { code: 'cod_fee', name: 'Phí thu hộ', direction: 'out', isSystem: false },
  {
    code: 'return_freight',
    name: 'Cước hàng hoàn',
    direction: 'out',
    isSystem: false,
  },
  {
    code: 'port_pallet',
    name: 'Bến bãi, palet',
    direction: 'out',
    isSystem: false,
  },
  {
    code: 'outsourced_truck',
    name: 'Thuê xe ngoài',
    direction: 'out',
    isSystem: false,
  },
  { code: 'fuel', name: 'Xăng xe', direction: 'out', isSystem: false },
  {
    code: 'warehouse_repair',
    name: 'Sửa chữa kho',
    direction: 'out',
    isSystem: false,
  },
  {
    code: 'defect_handling',
    name: 'Xử lý hàng lỗi, hàng hoàn',
    direction: 'out',
    isSystem: false,
  },
  {
    code: 'cash_withdraw',
    name: 'Chuyển/rút tiền',
    direction: 'out',
    isSystem: false,
  },
  { code: 'other_out', name: 'Chi khác', direction: 'out', isSystem: false },
] as const;

/**
 * Bộ đếm mã chứng từ: `next` = số của chứng từ TIẾP THEO.
 * Giá trị lấy từ mã lớn nhất trong dữ liệu KiotViet xuất ngày 03/11/2026 cộng 1 để mã mới không
 * trùng mã cũ. PHẢI cập nhật lại theo số liệu mới nhất vào ngày cắt chuyển.
 */
export const CODE_SEQUENCES = [
  { prefix: 'KH', next: 6975, digits: 6 },
  { prefix: 'NCC', next: 56, digits: 6 },
  { prefix: 'DH', next: 22296, digits: 6 },
  { prefix: 'HD', next: 16891, digits: 6 },
  { prefix: 'TH', next: 1077, digits: 6 },
  { prefix: 'PDN', next: 395, digits: 6 },
  { prefix: 'PN', next: 949, digits: 6 },
  { prefix: 'THN', next: 193, digits: 6 },
  { prefix: 'TT', next: 19328, digits: 6 },
  { prefix: 'CTM', next: 2306, digits: 6 },
  { prefix: 'CH', next: 1, digits: 6 }, // phiếu chuyển kho giữa chi nhánh
  { prefix: USER_CODE_PREFIX, next: 1, digits: 4 },
] as const;
