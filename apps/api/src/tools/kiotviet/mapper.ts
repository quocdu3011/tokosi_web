import { PRODUCT_CODE_PATTERN } from '../../modules/catalog/products.dto.js';
import type { CellValue, SheetColumn } from '../../common/excel.js';

/** Dạng dữ liệu tối thiểu của API công khai KiotViet mà công cụ dùng (các trường khác bị bỏ qua). */
export interface KvCategory {
  categoryId: number;
  categoryName: string;
  parentId?: number | null;
}
export interface KvInventory {
  branchId: number;
  branchName?: string;
  onHand: number;
  cost: number;
}
export interface KvProduct {
  code: string;
  name: string;
  /** Tên kèm quy cách "(T24)": khớp cột "Tên hàng" của file Excel KiotViet. */
  fullName?: string;
  categoryId?: number | null;
  /** 1 = combo/đóng gói, 2 = hàng hóa, 3 = dịch vụ. */
  type: number;
  isActive?: boolean;
  description?: string | null;
  images?: string[] | null;
  inventories?: KvInventory[] | null;
}

/** Cột theo đúng tiêu đề file KiotViet mà bộ nhập hàng hóa (`products.importer.ts`) nhận ra. */
export const PRODUCT_COLUMNS: SheetColumn[] = [
  { header: 'Mã hàng', width: 16 },
  { header: 'Tên hàng', width: 40 },
  { header: 'Nhóm hàng(3 Cấp)', width: 30 },
  { header: 'Loại hàng', width: 12 },
  { header: 'Tồn kho', width: 12 },
  { header: 'Giá vốn', width: 14 },
  { header: 'Mô tả', width: 30 },
  { header: 'Đang kinh doanh', width: 16 },
  { header: 'Hình ảnh (url1,url2...)', width: 40 },
];

const GOODS_TYPE = 2;
const MAX_NAME = 255;
const MAX_IMAGES = 10;
const MAX_CATEGORY_DEPTH = 3;

/** id nhóm → đường dẫn "Cha>>Con" (đã bỏ khoảng trắng thừa). Nhóm có vòng lặp cha-con bị cắt ở chỗ lặp. */
export function buildCategoryPaths(cats: KvCategory[]): Map<number, string[]> {
  const byId = new Map(cats.map((c) => [c.categoryId, c]));
  const out = new Map<number, string[]>();
  for (const c of cats) {
    const path: string[] = [];
    const seen = new Set<number>();
    let cur: KvCategory | undefined = c;
    while (cur && !seen.has(cur.categoryId)) {
      seen.add(cur.categoryId);
      path.unshift(cur.categoryName.replace(/>>/g, '>').trim());
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    out.set(c.categoryId, path);
  }
  return out;
}

/** Số lượng → chuỗi tối đa 3 chữ số thập phân, không đuôi 0 ("592.722", "2123.6", "50"). */
export function formatQty(n: number): string {
  return String(Number(n.toFixed(3)));
}
/** Giá vốn → chuỗi tối đa 4 chữ số thập phân (CSDL lưu NUMERIC(18,4)). */
export function formatCost(n: number): string {
  return Number(n.toFixed(4)).toFixed(4).replace(/\.?0+$/, '');
}

export type SkipReason =
  | 'ma-khong-hop-le'
  | 'ma-trung'
  | 'khong-phai-hang-hoa'
  | 'ten-qua-dai'
  | 'nhom-qua-3-cap';

export interface MapContext {
  /** id chi nhánh KiotViet cần lấy tồn/giá vốn. */
  branchId: number;
  categoryPaths: Map<number, string[]>;
}

export interface MapReport {
  rows: CellValue[][];
  skipped: Array<{ code: string; reason: SkipReason }>;
  /** Số hàng có tồn âm ở KiotViet: không nhập tồn (hệ thống không cho tồn âm). */
  negativeStock: number;
  /** Số hàng có ảnh vượt giới hạn nên bị cắt bớt. */
  imagesTrimmed: number;
}

/** Đổi danh sách hàng KiotViet thành các dòng theo `PRODUCT_COLUMNS`; hàng không nhập được bị liệt kê, KHÔNG sửa mã. */
export function mapProducts(products: KvProduct[], ctx: MapContext): MapReport {
  const report: MapReport = {
    rows: [],
    skipped: [],
    negativeStock: 0,
    imagesTrimmed: 0,
  };
  const seen = new Set<string>();
  for (const p of products) {
    const code = p.code.trim();
    const skip = (reason: SkipReason) =>
      report.skipped.push({ code, reason });

    if (!PRODUCT_CODE_PATTERN.test(code)) {
      skip('ma-khong-hop-le');
      continue;
    }
    if (p.type !== GOODS_TYPE) {
      skip('khong-phai-hang-hoa');
      continue;
    }
    const key = code.toLowerCase();
    if (seen.has(key)) {
      skip('ma-trung');
      continue;
    }
    const name = (p.fullName ?? p.name).trim();
    if (!name || name.length > MAX_NAME) {
      skip('ten-qua-dai');
      continue;
    }
    const path = p.categoryId
      ? ctx.categoryPaths.get(p.categoryId)
      : undefined;
    if (path && path.length > MAX_CATEGORY_DEPTH) {
      skip('nhom-qua-3-cap');
      continue;
    }
    seen.add(key);

    const inv = p.inventories?.find((i) => i.branchId === ctx.branchId);
    let qty: string | null = null;
    let cost: string | null = null;
    if (inv && inv.onHand > 0) {
      qty = formatQty(inv.onHand);
      cost = formatCost(Math.max(0, inv.cost ?? 0));
    } else if (inv && inv.onHand < 0) {
      report.negativeStock++;
    }

    const images = [...new Set((p.images ?? []).map((u) => u.trim()))].filter(
      Boolean,
    );
    if (images.length > MAX_IMAGES) report.imagesTrimmed++;

    report.rows.push([
      code,
      name,
      path ? path.join('>>') : null,
      'Hàng hóa',
      qty,
      cost,
      p.description?.trim() || null,
      p.isActive === false ? 0 : 1,
      images.slice(0, MAX_IMAGES).join(',') || null,
    ]);
  }
  return report;
}
