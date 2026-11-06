/**
 * Phần THUẦN (không React, không trình duyệt) của tùy chỉnh bảng theo tài khoản:
 * ghép bản đã lưu với mô tả cột (`mergePrefs`), các phép đổi nhỏ trả về bản ghi mới (`withHidden`…),
 * làm sạch dữ liệu từ server/localStorage, và đọc khóa localStorage CŨ để chuyển lên server một lần.
 * Hook `useTablePrefs` (hooks/use-table-prefs.ts) chỉ nối các hàm này với React Query.
 */
import {
  DEFAULT_PAGE_SIZE,
  TABLE_PREFS_LIMITS,
  isPageSizeOption,
  type PageSizeOption,
  type TablePrefs,
} from '@kiot/shared';

import type { ColumnSpec } from './column-meta';

export type ColumnWidths = Record<string, number>;

/** Độ rộng nhỏ nhất khi kéo mép cột (px) — chặn kéo cột thành vạch mảnh; mức sàn của server là 40. */
export const MIN_COLUMN_WIDTH = 64;

/** Kết quả ghép: cái mà bảng thật sự dùng để vẽ. */
export interface ResolvedPrefs {
  /** Id các cột ẩn (chỉ gồm cột có thật và không `locked`). */
  hidden: ReadonlySet<string>;
  /** Thứ tự MỌI cột (kể cả cột đang ẩn); cột `locked` đứng đúng chỗ mặc định. */
  order: string[];
  /** Độ rộng (px) của MỌI cột. */
  widths: ColumnWidths;
  pageSize: PageSizeOption;
}

/** Kẹp độ rộng vào khoảng server chấp nhận (40..1000) và làm tròn thành số nguyên. */
export function clampWidth(width: number): number {
  const { minColumnWidth, maxColumnWidth } = TABLE_PREFS_LIMITS;
  return Math.round(Math.min(maxColumnWidth, Math.max(minColumnWidth, width)));
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Ghép bản đã lưu (`saved`, có thể thiếu/lỗi thời) với mô tả cột hiện tại (`specs`):
 * - cột lạ (không còn trong `specs`) bị bỏ; cột mới thêm vào CUỐI danh sách có thể đổi chỗ, theo thứ tự mặc định;
 * - cột `locked` luôn hiện, không bị đổi chỗ (đứng đúng vị trí mặc định);
 * - `hidden` chưa lưu → cột `hiddenByDefault`; cột mới (chưa có trong `order` đã lưu) mà mặc định ẩn thì ẩn;
 * - độ rộng kẹp theo `TABLE_PREFS_LIMITS`, thiếu → độ rộng mặc định của cột;
 * - `pageSize` ngoài `PAGE_SIZE_OPTIONS` → `DEFAULT_PAGE_SIZE` (15).
 */
export function mergePrefs(
  specs: readonly ColumnSpec[],
  saved: TablePrefs | null | undefined,
): ResolvedPrefs {
  const byId = new Map<string, ColumnSpec>();
  for (const spec of specs) if (!byId.has(spec.id)) byId.set(spec.id, spec);
  const list = [...byId.values()];

  // Thứ tự: cột đổi chỗ được xếp theo bản lưu, cột mới nối đuôi; cột khóa trở về ô mặc định.
  const savedOrder = unique(saved?.order ?? []).filter((id) => {
    const spec = byId.get(id);
    return spec !== undefined && !spec.locked;
  });
  const placed = new Set(savedOrder);
  const movable = [
    ...savedOrder,
    ...list.filter((spec) => !spec.locked && !placed.has(spec.id)).map((spec) => spec.id),
  ];
  let next = 0;
  const order = list.map((spec) => (spec.locked ? spec.id : (movable[next++] as string)));

  // Ẩn/hiện.
  const hidden = new Set<string>();
  if (saved?.hidden === undefined) {
    for (const spec of list) if (spec.hiddenByDefault && !spec.locked) hidden.add(spec.id);
  } else {
    const explicit = new Set(saved.hidden);
    const known = saved.order ? new Set(saved.order) : null;
    for (const spec of list) {
      if (spec.locked) continue;
      const isNewColumn = known !== null && !known.has(spec.id) && !explicit.has(spec.id);
      if (explicit.has(spec.id) || (isNewColumn && spec.hiddenByDefault)) hidden.add(spec.id);
    }
  }

  const widths: ColumnWidths = {};
  for (const spec of list) {
    const value = saved?.widths?.[spec.id];
    widths[spec.id] =
      typeof value === 'number' && Number.isFinite(value) ? clampWidth(value) : spec.width;
  }

  return {
    hidden,
    order,
    widths,
    pageSize: isPageSizeOption(saved?.pageSize) ? saved.pageSize : DEFAULT_PAGE_SIZE,
  };
}

// ---------------------------------------------------------------------------------------------
// Các phép đổi: nhận bản đã lưu hiện tại, trả bản ghi MỚI (không sửa tại chỗ), giữ nguyên trường khác.
// ---------------------------------------------------------------------------------------------

/** Ẩn/hiện một cột. Cột `locked` hoặc không có thật: không đổi. Ghi rõ toàn bộ tập cột ẩn. */
export function withHidden(
  specs: readonly ColumnSpec[],
  saved: TablePrefs | null | undefined,
  id: string,
  hide: boolean,
): TablePrefs {
  const base = saved ?? {};
  const target = specs.find((spec) => spec.id === id);
  if (!target || target.locked) return base;
  const nextHidden = new Set(mergePrefs(specs, saved).hidden);
  if (hide) nextHidden.add(id);
  else nextHidden.delete(id);
  const known = new Set(specs.map((spec) => spec.id));
  // Giữ id cột hiện không có trên màn (vd. cột theo quyền) để không mất lựa chọn của người dùng.
  const foreign = (base.hidden ?? []).filter((x) => !known.has(x));
  return {
    ...base,
    hidden: [...specs.map((spec) => spec.id).filter((x) => nextHidden.has(x)), ...unique(foreign)],
  };
}

/**
 * Sắp xếp lại các cột trong `ids` (có thể là toàn bộ cột hoặc chỉ cột đang hiện): chúng đổi chỗ cho nhau
 * trong những ô mà chúng đang chiếm; cột không nêu tên (vd. cột đang ẩn) và cột `locked` giữ nguyên chỗ.
 */
export function withOrder(
  specs: readonly ColumnSpec[],
  saved: TablePrefs | null | undefined,
  ids: readonly string[],
): TablePrefs {
  const base = saved ?? {};
  const locked = new Set(specs.filter((spec) => spec.locked).map((spec) => spec.id));
  const known = new Set(specs.map((spec) => spec.id));
  const moving = unique(ids).filter((id) => known.has(id) && !locked.has(id));
  const movingSet = new Set(moving);
  const current = mergePrefs(specs, saved).order;
  const order = [...current];
  let k = 0;
  current.forEach((id, slot) => {
    if (movingSet.has(id)) order[slot] = moving[k++] as string;
  });
  return { ...base, order };
}

/** Đặt độ rộng một cột (px), kẹp trong [MIN_COLUMN_WIDTH, 1000]. */
export function withWidth(
  saved: TablePrefs | null | undefined,
  id: string,
  px: number,
): TablePrefs {
  const base = saved ?? {};
  if (!Number.isFinite(px)) return base;
  const width = Math.max(MIN_COLUMN_WIDTH, clampWidth(px));
  return { ...base, widths: { ...base.widths, [id]: width } };
}

/** Đặt lại độ rộng một cột về mặc định (bỏ giá trị đã lưu). */
export function withoutWidth(saved: TablePrefs | null | undefined, id: string): TablePrefs {
  const base = saved ?? {};
  if (!base.widths || !(id in base.widths)) return base;
  const widths = { ...base.widths };
  delete widths[id];
  const next: TablePrefs = { ...base, widths };
  if (Object.keys(widths).length === 0) delete next.widths;
  return next;
}

/** Đặt số dòng mỗi trang; giá trị ngoài `PAGE_SIZE_OPTIONS` bị bỏ qua. */
export function withPageSize(saved: TablePrefs | null | undefined, size: number): TablePrefs {
  const base = saved ?? {};
  return isPageSizeOption(size) ? { ...base, pageSize: size } : base;
}

// ---------------------------------------------------------------------------------------------
// Làm sạch dữ liệu không tin cậy (server, bản sao nóng localStorage).
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const { maxColumns, maxColumnIdLength } = TABLE_PREFS_LIMITS;
  return unique(
    value.filter(
      (x): x is string => typeof x === 'string' && x.length > 0 && x.length <= maxColumnIdLength,
    ),
  ).slice(0, maxColumns);
}

function cleanWidths(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const { maxColumns, maxColumnIdLength } = TABLE_PREFS_LIMITS;
  const out: Record<string, number> = {};
  for (const [id, width] of Object.entries(value)) {
    if (Object.keys(out).length >= maxColumns) break;
    if (id.length === 0 || id.length > maxColumnIdLength) continue;
    if (typeof width === 'number' && Number.isFinite(width)) out[id] = clampWidth(width);
  }
  return out;
}

/** Làm sạch một bản ghi `TablePrefs`: chỉ giữ trường đúng kiểu, trong giới hạn. Không phải đối tượng → `undefined`. */
export function sanitizePrefs(value: unknown): TablePrefs | undefined {
  if (!isRecord(value)) return undefined;
  const out: TablePrefs = {};
  const hidden = cleanIds(value.hidden);
  if (hidden) out.hidden = hidden;
  const order = cleanIds(value.order);
  if (order) out.order = order;
  const widths = cleanWidths(value.widths);
  if (widths) out.widths = widths;
  if (isPageSizeOption(value.pageSize)) out.pageSize = value.pageSize;
  return out;
}

/** Làm sạch cả bản đồ `{ [tableKey]: TablePrefs }`; bỏ khóa bảng sai mẫu hoặc bản ghi không hợp lệ. */
export function sanitizeTables(value: unknown): Record<string, TablePrefs> {
  const out: Record<string, TablePrefs> = {};
  if (!isRecord(value)) return out;
  for (const [tableKey, prefs] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9:_-]{0,63}$/.test(tableKey)) continue;
    const clean = sanitizePrefs(prefs);
    if (clean) out[tableKey] = clean;
  }
  return out;
}

/** Hai bản ghi có cùng nội dung không (so sánh theo giá trị)? */
export function samePrefs(
  a: TablePrefs | null | undefined,
  b: TablePrefs | null | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// ---------------------------------------------------------------------------------------------
// Khóa localStorage CŨ (theo trình duyệt) → chuyển một lần lên server.
// ---------------------------------------------------------------------------------------------

/** Khóa localStorage cũ của từng bảng: `hidden` = mảng id cột ẩn; `widths` = `{ [id]: px }`. */
export const LEGACY_STORAGE_KEYS: Readonly<Record<string, { hidden?: string; widths?: string }>> = {
  products: { hidden: 'cols:products', widths: 'table:products' },
  users: { hidden: 'cols:users' },
  suppliers: { hidden: 'table:suppliers:hidden', widths: 'table:suppliers' },
  'purchase-orders': { hidden: 'table:purchase-orders:hidden', widths: 'table:purchase-orders' },
  // Màn nhập hàng cũ đặt khóa theo `kind = 'receipts'`; khóa bảng mới là `goods-receipts`.
  'goods-receipts': { hidden: 'table:purchase-receipts:hidden', widths: 'table:purchase-receipts' },
  'purchase-returns': { hidden: 'table:purchase-returns:hidden', widths: 'table:purchase-returns' },
};

export interface LegacyRead {
  /** Nội dung đọc được (có thể rỗng nếu dữ liệu cũ hỏng). */
  prefs: TablePrefs;
  /** Các khóa cũ thực sự có mặt — xóa sau khi đã nhập lên server. */
  keys: string[];
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Đọc tùy chỉnh cũ của một bảng qua `getItem` (vd. `localStorage.getItem`). Không có khóa cũ nào → `null`. */
export function readLegacyPrefs(
  tableKey: string,
  getItem: (key: string) => string | null,
): LegacyRead | null {
  const legacy = LEGACY_STORAGE_KEYS[tableKey];
  if (!legacy) return null;
  const prefs: TablePrefs = {};
  const keys: string[] = [];
  if (legacy.hidden) {
    const raw = getItem(legacy.hidden);
    if (raw !== null) {
      keys.push(legacy.hidden);
      const hidden = cleanIds(parseJson(raw));
      if (hidden) prefs.hidden = hidden;
    }
  }
  if (legacy.widths) {
    const raw = getItem(legacy.widths);
    if (raw !== null) {
      keys.push(legacy.widths);
      const widths = cleanWidths(parseJson(raw));
      if (widths && Object.keys(widths).length > 0) prefs.widths = widths;
    }
  }
  return keys.length > 0 ? { prefs, keys } : null;
}

/**
 * Chỉ giữ phần thật sự là tùy chỉnh của người dùng: bỏ cột không còn, độ rộng bằng mặc định,
 * và `hidden` trùng tập ẩn mặc định. Không còn gì → `null` (không cần gửi lên server).
 */
export function pruneLegacyPrefs(
  prefs: TablePrefs,
  specs: readonly ColumnSpec[],
): TablePrefs | null {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const out: TablePrefs = {};

  if (prefs.hidden) {
    const hidden = prefs.hidden.filter((id) => {
      const spec = byId.get(id);
      return spec !== undefined && !spec.locked;
    });
    const defaults = specs.filter((spec) => spec.hiddenByDefault && !spec.locked).map((s) => s.id);
    const same = hidden.length === defaults.length && defaults.every((id) => hidden.includes(id));
    if (!same) out.hidden = hidden;
  }

  if (prefs.widths) {
    const widths: Record<string, number> = {};
    for (const [id, width] of Object.entries(prefs.widths)) {
      const spec = byId.get(id);
      if (spec && width !== spec.width) widths[id] = width;
    }
    if (Object.keys(widths).length > 0) out.widths = widths;
  }

  return Object.keys(out).length > 0 ? out : null;
}
