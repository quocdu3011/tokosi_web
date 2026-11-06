import { ADMIN_ROLE } from '@kiot/shared';
import { ApiProperty } from '@nestjs/swagger';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StreamableFile } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { AppError } from '../../common/app-error.js';
import { searchWhere } from '../../db/search.js';
import { dec, lineTotal, roundMoney } from '../../common/costing.js';
import { vnDayStart } from '../../common/vn-date.js';
import type { DbOrTx } from '../../db/database.module.js';
import {
  products,
  suppliers,
  userBranches,
  users,
} from '../../db/schema/index.js';
import { assertNoCombo } from '../catalog/combo.js';

export const MAX_LINES = 500;
/** Số lượng: số dương tối đa 3 chữ số thập phân (chuỗi). */
export const QTY_PATTERN = /^\d{1,11}(\.\d{1,3})?$/;
/** Đơn giá: số không âm tối đa 4 chữ số thập phân (chuỗi). */
export const PRICE_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;
/** Chứng từ không được ghi lùi/tiến quá xa: chấp nhận lệch đồng hồ tối đa 5 phút. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Một dòng hàng của phiếu đặt/phiếu nhập: client chỉ gửi hàng, số lượng, giá nhập (tiền do server tính). */
export class PurchaseLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({
    example: '1095',
    description: 'Số lượng > 0, tối đa 3 chữ số thập phân',
  })
  @IsString()
  @Matches(QTY_PATTERN, { message: 'Số lượng không hợp lệ' })
  qty!: string;
  @ApiProperty({
    example: '219967.9800',
    description: 'Giá nhập ≥ 0, tối đa 4 chữ số thập phân',
  })
  @IsString()
  @Matches(PRICE_PATTERN, { message: 'Giá nhập không hợp lệ' })
  unitCost!: string;
}

export class ReturnLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ example: '10' })
  @IsString()
  @Matches(QTY_PATTERN, { message: 'Số lượng không hợp lệ' })
  qty!: string;
  @ApiProperty({
    example: '8450.2200',
    description: 'Giá trả lại ≥ 0, tối đa 4 chữ số thập phân',
  })
  @IsString()
  @Matches(PRICE_PATTERN, { message: 'Giá trả lại không hợp lệ' })
  returnPrice!: string;
}

/** Decorator dùng chung cho mảng dòng hàng (1–500 dòng). */
export function Lines(type: new () => object) {
  return (target: object, key: string) => {
    ArrayMinSize(1, { message: 'Phiếu cần ít nhất một dòng hàng' })(
      target,
      key,
    );
    ArrayMaxSize(MAX_LINES)(target, key);
    IsArray()(target, key);
    ValidateNested({ each: true })(target, key);
    Type(() => type)(target, key);
  };
}

export interface RawLine {
  productId: string;
  qty: string;
  price: string;
}
export interface PricedLine extends RawLine {
  lineTotal: string;
}
export interface ProductInfo {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/** Kiểm tra dòng (không lặp, số lượng > 0), tính thành tiền từng dòng và tổng bằng Decimal. */
export function priceLines(lines: RawLine[]): {
  lines: PricedLine[];
  total: string;
} {
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (seen.has(l.productId)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Hàng hóa bị lặp trong phiếu',
        [
          {
            field: `items.${i}.productId`,
            message: 'Mỗi hàng hóa chỉ một dòng',
          },
        ],
      );
    }
    seen.add(l.productId);
    if (dec(l.qty).lte(0)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Số lượng phải lớn hơn 0', [
        { field: `items.${i}.qty`, message: 'Số lượng phải lớn hơn 0' },
      ]);
    }
  });
  const priced = lines.map((l) => ({
    ...l,
    lineTotal: lineTotal(l.qty, l.price),
  }));
  const total = roundMoney(
    priced.reduce((sum, l) => sum.plus(dec(l.lineTotal)), dec(0)),
  );
  return { lines: priced, total };
}

/**
 * Nạp hàng hóa của các dòng: phải tồn tại, KHÔNG phải combo; `requireActive` (đặt/nhập) chặn hàng đã ngưng kinh doanh,
 * trả hàng thì vẫn cho phép.
 */
export async function loadLineProducts(
  db: DbOrTx,
  productIds: string[],
  requireActive: boolean,
): Promise<Map<string, ProductInfo>> {
  const rows = await db
    .select({
      id: products.id,
      code: products.code,
      name: products.name,
      isActive: products.isActive,
    })
    .from(products)
    .where(and(inArray(products.id, productIds), isNull(products.deletedAt)));
  const map = new Map(rows.map((r) => [r.id, r]));
  productIds.forEach((id, i) => {
    if (!map.has(id)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Không tìm thấy hàng hóa', [
        { field: `items.${i}.productId`, message: 'Hàng hóa không tồn tại' },
      ]);
    }
  });
  await assertNoCombo(db, productIds);
  if (requireActive) {
    const off = rows.filter((r) => !r.isActive).map((r) => r.code);
    if (off.length > 0) {
      throw new AppError(
        422,
        'INVALID_STATE',
        `Hàng đã ngưng kinh doanh: ${off.join(', ')}`,
        { products: off },
      );
    }
  }
  return map;
}

/** Nhà cung cấp phải tồn tại, không phải NCC nội bộ (đại diện chi nhánh); phiếu mới cần NCC đang hoạt động. */
export async function loadSupplier(
  db: DbOrTx,
  supplierId: string,
  requireActive: boolean,
) {
  const [s] = await db
    .select({
      id: suppliers.id,
      code: suppliers.code,
      name: suppliers.name,
      isActive: suppliers.isActive,
    })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        isNull(suppliers.deletedAt),
        isNull(suppliers.linkedBranchId),
      ),
    );
  if (!s) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy nhà cung cấp');
  if (requireActive && !s.isActive) {
    throw new AppError(422, 'INVALID_STATE', 'Nhà cung cấp đã ngưng giao dịch');
  }
  return s;
}

/**
 * Người đặt/nhập/trả: mặc định là người đang đăng nhập. Người khác phải là tài khoản đang hoạt động và được làm
 * việc ở chi nhánh của phiếu (Quản lý thì mọi chi nhánh).
 */
export async function resolvePerson(
  db: DbOrTx,
  personId: string | undefined,
  self: string,
  branchId: string,
  field: string,
): Promise<string> {
  if (!personId || personId === self) return self;
  const [u] = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, personId));
  let ok = !!u && u.isActive;
  if (ok && u!.role !== ADMIN_ROLE) {
    const [link] = await db
      .select({ id: userBranches.userId })
      .from(userBranches)
      .where(
        and(
          eq(userBranches.userId, personId),
          eq(userBranches.branchId, branchId),
        ),
      );
    ok = !!link;
  }
  if (!ok) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Người thực hiện không hợp lệ',
      [
        {
          field,
          message:
            'Tài khoản không tồn tại, đã khóa hoặc không thuộc chi nhánh',
        },
      ],
    );
  }
  return personId;
}

/** Thời điểm chứng từ: mặc định bây giờ; không được ở tương lai (quá 5 phút). */
export function resolveTime(value: string | undefined, field: string): Date {
  if (!value) return new Date();
  const d = new Date(value);
  if (
    Number.isNaN(d.getTime()) ||
    d.getTime() > Date.now() + FUTURE_TOLERANCE_MS
  ) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Thời gian không hợp lệ', [
      { field, message: 'Thời gian không hợp lệ hoặc ở tương lai' },
    ]);
  }
  return d;
}

/** Khoảng ngày `from`–`to` (giờ Việt Nam, cả hai đầu gồm cả ngày) → [bắt đầu, kết thúc không gồm]. */
export function dayRange(
  from: string | undefined,
  to: string | undefined,
): { start?: Date; endExclusive?: Date } {
  const start = from ? vnDayStart(from, 'from') : undefined;
  const endExclusive = to
    ? new Date(vnDayStart(to, 'to').getTime() + 24 * 3600 * 1000)
    : undefined;
  if (start && endExclusive && start >= endExclusive) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Khoảng ngày không hợp lệ', [
      { field: 'to', message: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu' },
    ]);
  }
  return { start, endExclusive };
}

export const notFound = (what: string) =>
  new AppError(404, 'NOT_FOUND', `Không tìm thấy ${what}`);

/** Tìm không dấu theo mã phiếu, mã và tên nhà cung cấp. */
export function docSearch(
  docCode: AnyPgColumn,
  supplierCode: AnyPgColumn,
  supplierName: AnyPgColumn,
  q: string | undefined,
): SQL | undefined {
  return searchWhere(
    sql`f_search_text(${docCode} || ' ' || ${supplierCode} || ' ' || ${supplierName})`,
    q,
  );
}

/** Tổng số lượng và số mặt hàng của các dòng (tính khi đọc, không lưu). */
export function summarizeLines(items: Array<{ qty: string }>): {
  totalQty: string;
  itemCount: number;
} {
  return {
    totalQty: items.reduce((s, i) => s.plus(dec(i.qty)), dec(0)).toFixed(3),
    itemCount: items.length,
  };
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Trả file Excel tải về, tên có ngày theo giờ Việt Nam (vd `nhap-hang-20261106.xlsx`). */
export function xlsxFile(buffer: Buffer, prefix: string): StreamableFile {
  const day = new Date(Date.now() + 7 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');
  return new StreamableFile(buffer, {
    type: XLSX_TYPE,
    disposition: `attachment; filename="${prefix}-${day}.xlsx"`,
  });
}
