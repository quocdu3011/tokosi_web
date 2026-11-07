import type { PermissionCode, PermissionScope } from '@kiot/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/auth-user.js';
import type { Decimal } from 'decimal.js';
import { dec, lineTotal, roundMoney } from '../../common/costing.js';
import type { DbOrTx } from '../../db/database.module.js';
import {
  customerBranchTerms,
  customers,
  debtLedger,
  orderItems,
  orders,
  stocks,
} from '../../db/schema/index.js';
import type { PermissionsService } from '../authorization/permissions.service.js';
import { QTY_PATTERN } from '../purchasing/purchase-lines.js';

/** Tiền và đơn giá bán: số nguyên đồng không âm (chuỗi). */
export const MONEY_PATTERN = /^\d{1,15}$/;

/** Một dòng hàng bán: client gửi Đơn giá (trước giảm) và giảm giá trên 1 đơn vị; Giá bán và thành tiền do server tính. */
export class SaleLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({
    example: '2000',
    description: 'Số lượng > 0, tối đa 3 chữ số thập phân',
  })
  @IsString()
  @Matches(QTY_PATTERN, { message: 'Số lượng không hợp lệ' })
  qty!: string;
  @ApiProperty({
    example: '13100',
    description: 'Đơn giá trước giảm (số nguyên đồng)',
  })
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'Đơn giá phải là số nguyên đồng ≥ 0' })
  price!: string;
  @ApiPropertyOptional({
    example: '500',
    default: '0',
    description: 'Giảm giá trên 1 đơn vị (số tiền, không phải %), ≤ đơn giá',
  })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'Giảm giá phải là số nguyên đồng ≥ 0' })
  discountPerUnit?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export interface PricedSaleLine {
  lineNo: number;
  productId: string;
  qty: string;
  price: string;
  discountPerUnit: string;
  unitPrice: string;
  lineTotal: string;
  note: string | null;
}

/**
 * Tính tiền phiếu bán bằng Decimal. Một mặt hàng ĐƯỢC lặp nhiều dòng (dữ liệu KiotViet có). Giá bán = đơn giá − giảm
 * giá/đơn vị; thành tiền = SL × giá bán (làm tròn đồng); tổng = Σ thành tiền − giảm giá phiếu.
 */
export function priceSaleLines(
  lines: SaleLineDto[],
  discount: string | undefined,
): { lines: PricedSaleLine[]; subtotal: string; discount: string; total: string } {
  const priced = lines.map((l, i): PricedSaleLine => {
    if (dec(l.qty).lte(0)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Số lượng phải lớn hơn 0', [
        { field: `items.${i}.qty`, message: 'Số lượng phải lớn hơn 0' },
      ]);
    }
    const off = l.discountPerUnit ?? '0';
    if (dec(off).gt(dec(l.price))) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Giảm giá lớn hơn đơn giá', [
        {
          field: `items.${i}.discountPerUnit`,
          message: 'Giảm giá trên 1 đơn vị không được lớn hơn đơn giá',
        },
      ]);
    }
    const unitPrice = dec(l.price).minus(dec(off)).toFixed(0);
    return {
      lineNo: i + 1,
      productId: l.productId,
      qty: l.qty,
      price: dec(l.price).toFixed(0),
      discountPerUnit: dec(off).toFixed(0),
      unitPrice,
      lineTotal: lineTotal(l.qty, unitPrice),
      note: l.note?.trim() || null,
    };
  });
  const subtotal = roundMoney(
    priced.reduce((s, l) => s.plus(dec(l.lineTotal)), dec(0)),
  );
  const disc = dec(discount ?? '0');
  if (disc.gt(dec(subtotal))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Giảm giá phiếu lớn hơn tổng tiền hàng', [
      { field: 'discount', message: 'Giảm giá phiếu không được lớn hơn tổng tiền hàng' },
    ]);
  }
  return {
    lines: priced,
    subtotal,
    discount: disc.toFixed(0),
    total: dec(subtotal).minus(disc).toFixed(0),
  };
}

/** Khách của chứng từ bán: tồn tại, chưa xóa, không phải khách nội bộ (chuyển kho đi đường riêng); phiếu mới cần đang hoạt động. */
export async function loadCustomer(
  db: DbOrTx,
  customerId: string,
  requireActive: boolean,
) {
  const [c] = await db
    .select({
      id: customers.id,
      code: customers.code,
      name: customers.name,
      phone: customers.phone,
      isActive: customers.isActive,
    })
    .from(customers)
    .where(
      and(
        eq(customers.id, customerId),
        isNull(customers.deletedAt),
        isNull(customers.linkedBranchId),
      ),
    );
  if (!c) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy khách hàng');
  if (requireActive && !c.isActive) {
    throw new AppError(422, 'INVALID_STATE', 'Khách hàng đã ngưng giao dịch');
  }
  return c;
}

/** Phạm vi của một quyền với người dùng (`null` = không có quyền). */
export async function scopeOf(
  permissions: PermissionsService,
  user: AuthUser,
  code: PermissionCode,
): Promise<PermissionScope | null> {
  const g = await permissions.getGrant(user.role, code);
  return g ? g.scope : null;
}

/** Có được thấy công nợ của khách này không (`debt.view`: tất cả, hoặc "chỉ của mình" = khách do mình phụ trách). */
export async function canSeeDebt(
  db: DbOrTx,
  permissions: PermissionsService,
  user: AuthUser,
  customerId: string,
): Promise<boolean> {
  const scope = await scopeOf(permissions, user, 'debt.view');
  if (scope === 'all') return true;
  if (scope !== 'own') return false;
  const [c] = await db
    .select({ owner: customers.salesOwnerId })
    .from(customers)
    .where(eq(customers.id, customerId));
  return c?.owner === user.id;
}

/** Quyền tạo/sửa "chỉ của mình": người bán luôn là chính mình (gửi người khác → 403). */
export function sellerFor(
  scope: PermissionScope | null,
  user: AuthUser,
  requested: string | undefined,
  code: PermissionCode,
): string | undefined {
  if (scope !== 'own') return requested;
  if (requested && requested !== user.id) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Bạn chỉ được lập chứng từ do chính mình bán',
      { permission: code },
    );
  }
  return user.id;
}

export interface SaleWarning {
  code: 'STOCK_RESERVED' | 'CREDIT_LIMIT_EXCEEDED';
  message: string;
  productId?: string;
  productCode?: string;
  requested?: string;
  available?: string;
  creditLimit?: string;
  balanceAfter?: string;
}

/** Có thể bán từng mặt hàng tại chi nhánh = tồn − hàng đang giữ cho phiếu tạm KHÁC (`excludeOrderId` = phiếu đang lập). */
export async function availableByProduct(
  db: DbOrTx,
  branchId: string,
  productIds: string[],
  excludeOrderId?: string,
): Promise<Map<string, Decimal>> {
  const out = new Map<string, Decimal>();
  if (productIds.length === 0) return out;
  const onHand = new Map(
    (
      await db
        .select({ id: stocks.productId, onHand: stocks.onHand })
        .from(stocks)
        .where(and(eq(stocks.branchId, branchId), inArray(stocks.productId, productIds)))
    ).map((r) => [r.id, dec(r.onHand)]),
  );
  const reserved = new Map(
    (
      await db
        .select({
          id: orderItems.productId,
          qty: sql<string>`sum(${orderItems.qty})`,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(
          and(
            eq(orders.branchId, branchId),
            eq(orders.status, 'draft'),
            inArray(orderItems.productId, productIds),
            excludeOrderId ? ne(orders.id, excludeOrderId) : undefined,
          ),
        )
        .groupBy(orderItems.productId)
    ).map((r) => [r.id, dec(r.qty)]),
  );
  for (const id of productIds) {
    out.set(id, (onHand.get(id) ?? dec(0)).minus(reserved.get(id) ?? dec(0)));
  }
  return out;
}

/** Cảnh báo mềm "vượt có thể bán": Σ số lượng mỗi mặt hàng (cộng các dòng trùng) so với số có thể bán. */
export async function stockWarnings(
  db: DbOrTx,
  branchId: string,
  lines: Array<{ productId: string; qty: string }>,
  codes: Map<string, { code: string }>,
  excludeOrderId?: string,
): Promise<SaleWarning[]> {
  const need = new Map<string, Decimal>();
  for (const l of lines) {
    need.set(l.productId, (need.get(l.productId) ?? dec(0)).plus(dec(l.qty)));
  }
  const avail = await availableByProduct(db, branchId, [...need.keys()], excludeOrderId);
  const out: SaleWarning[] = [];
  for (const [id, qty] of need) {
    const available = avail.get(id) ?? dec(0);
    if (qty.gt(available)) {
      const code = codes.get(id)?.code ?? id;
      out.push({
        code: 'STOCK_RESERVED',
        message: `${code}: cần ${qty.toFixed(3)}, chỉ còn có thể bán ${available.toFixed(3)}`,
        productId: id,
        productCode: code,
        requested: qty.toFixed(3),
        available: available.toFixed(3),
      });
    }
  }
  return out;
}

/** Cảnh báo mềm vượt hạn mức: nợ hiện tại của khách tại chi nhánh + `addDebt` > hạn mức (không có hạn mức = không giới hạn). */
export async function creditWarning(
  db: DbOrTx,
  customerId: string,
  branchId: string,
  addDebt: string,
  showAmounts: boolean,
): Promise<SaleWarning | null> {
  const [terms] = await db
    .select({ creditLimit: customerBranchTerms.creditLimit })
    .from(customerBranchTerms)
    .where(
      and(
        eq(customerBranchTerms.customerId, customerId),
        eq(customerBranchTerms.branchId, branchId),
      ),
    );
  if (!terms || terms.creditLimit === null) return null;
  const [row] = await db
    .select({ v: sql<string>`coalesce(sum(${debtLedger.amount}), 0)` })
    .from(debtLedger)
    .where(
      and(
        eq(debtLedger.partyType, 'customer'),
        eq(debtLedger.partyId, customerId),
        eq(debtLedger.branchId, branchId),
      ),
    );
  const after = dec(row!.v).plus(dec(addDebt));
  if (after.lte(dec(terms.creditLimit))) return null;
  // Không có quyền xem nợ khách này thì chỉ báo "vượt", không lộ số tiền
  if (!showAmounts) {
    return {
      code: 'CREDIT_LIMIT_EXCEEDED',
      message: 'Vượt hạn mức công nợ của khách tại chi nhánh',
    };
  }
  return {
    code: 'CREDIT_LIMIT_EXCEEDED',
    message: `Vượt hạn mức công nợ ${dec(after).minus(dec(terms.creditLimit)).toFixed(0)} ₫ (hạn mức ${dec(terms.creditLimit).toFixed(0)} ₫, nợ sau chứng từ ${after.toFixed(0)} ₫)`,
    creditLimit: dec(terms.creditLimit).toFixed(0),
    balanceAfter: after.toFixed(0),
  };
}
