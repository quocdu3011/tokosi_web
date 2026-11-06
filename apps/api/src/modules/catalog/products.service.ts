import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  LIQUIDATION_STATUS_LABELS,
  formatComponents,
  parseComponents,
  type ProductType,
} from '@kiot/shared';
import { dec } from '../../common/costing.js';
import {
  writeSheet,
  type CellValue,
  type SheetColumn,
} from '../../common/excel.js';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/auth-user.js';
import { pageMeta, pageParams, parseSort } from '../../common/pagination.js';
import { vnDayStart } from '../../common/vn-date.js';
import { uniqueViolation } from '../../common/pg-errors.js';
import { DB, type Database, type DbOrTx } from '../../db/database.module.js';
import { categoryWithDescendants } from '../../db/category-tree.js';
import { searchWhere } from '../../db/search.js';
import {
  categories,
  goodsReceiptItems,
  invoiceItems,
  orderItems,
  orders,
  productComponents,
  productImages,
  products,
  purchaseReturnItems,
  salesReturnItems,
  stockMovements,
  stockTransferItems,
  stocks,
} from '../../db/schema/index.js';
import { productSearchExpr } from '../../db/schema/_search.js';
import {
  comboFigures,
  effectiveOnHandSql,
  loadComponents,
  type ComboComponent,
  type ComboFigures,
} from './combo.js';
import { onOrderByProduct } from '../purchasing/order-status.js';
import { AuditService } from '../audit/audit.service.js';
import { PermissionsService } from '../authorization/permissions.service.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import {
  PRODUCT_SORT_FIELDS,
  type CreateProductDto,
  type ListProductsQueryDto,
  type ProductBranchDto,
  type ProductDto,
  type ProductImageDto,
  type ProductLookupDto,
  type StockCardDto,
  type StockCardQueryDto,
  type UpdateProductDto,
} from './products.dto.js';

/** Tối đa số dòng khi xuất Excel. */
export const EXPORT_MAX_ROWS = 10_000;

type ProductRow = typeof products.$inferSelect;

/** Dòng kết quả truy vấn danh sách: hàng + các cột theo chi nhánh làm việc. */
interface JoinedRow {
  p: ProductRow;
  onHand: string | null;
  costPrice: string | null;
  lastPurchasePrice: string | null;
  reserved: string | null;
}

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
    private readonly permissions: PermissionsService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // ------------------------------------------------------------------ danh sách

  /**
   * Danh sách hàng hóa theo chi nhánh làm việc. `mode = 'export'` bỏ phân trang (tối đa EXPORT_MAX_ROWS dòng).
   */
  async list(
    user: AuthUser,
    branchId: string,
    q: ListProductsQueryDto,
    mode: 'page' | 'export' = 'page',
  ) {
    const canSeeCost = await this.permissions.has(
      user.role,
      'product.cost.view',
    );
    const categoryIds = q.categoryId
      ? await categoryWithDescendants(this.db, q.categoryId)
      : undefined;

    const onHandExpr = effectiveOnHandSql(branchId);
    const conditions: Array<SQL | undefined> = [
      isNull(products.deletedAt),
      searchWhere(productSearchExpr(products), q.q),
      q.isActive === undefined ? undefined : eq(products.isActive, q.isActive),
      q.productType ? eq(products.productType, q.productType) : undefined,
      q.liquidationStatus
        ? eq(products.liquidationStatus, q.liquidationStatus)
        : undefined,
      categoryIds ? inArray(products.categoryId, categoryIds) : undefined,
      q.inStock === undefined
        ? undefined
        : q.inStock
          ? gt(onHandExpr, sql`0`)
          : sql`${onHandExpr} <= 0`,
    ];
    const where = and(...conditions);

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(products)
      .leftJoin(
        stocks,
        and(eq(stocks.productId, products.id), eq(stocks.branchId, branchId)),
      )
      .where(where);

    const sort = parseSort(q.sort, PRODUCT_SORT_FIELDS);
    const direction = sort?.desc ? desc : asc;
    const sortColumn: SQL | PgColumn =
      sort?.field === 'name'
        ? products.name
        : sort?.field === 'onHand'
          ? onHandExpr
          : sort?.field === 'createdAt'
            ? products.createdAt
            : products.code;

    const { page, limit, offset } =
      mode === 'export'
        ? { page: 1, limit: EXPORT_MAX_ROWS, offset: 0 }
        : pageParams(q);

    const rows = await this.joinedQuery(this.db, branchId)
      .where(where)
      .orderBy(direction(sortColumn), asc(products.id))
      .limit(limit)
      .offset(offset);

    return {
      data: await this.toDtos(rows, branchId, canSeeCost),
      meta: pageMeta(page, limit, total),
    };
  }

  /**
   * Xuất Excel theo đúng bộ lọc (bỏ phân trang, tối đa EXPORT_MAX_ROWS dòng). Tiêu đề cột trùng file KiotViet nên
   * nhập lại được; cột giá vốn / giá nhập cuối chỉ có khi người gọi có quyền xem giá vốn.
   */
  async exportXlsx(
    user: AuthUser,
    branchId: string,
    q: ListProductsQueryDto,
  ): Promise<Buffer> {
    const { data } = await this.list(user, branchId, q, 'export');
    const withCost = data.some((p) => p.costPrice !== undefined);
    const num = (v: string | null | undefined): CellValue =>
      v === null || v === undefined ? null : Number(v);
    const columns: SheetColumn[] = [
      { header: 'Mã hàng', width: 16 },
      { header: 'Tên hàng', width: 38 },
      { header: 'Nhóm hàng(3 Cấp)', width: 30 },
      { header: 'Loại hàng', width: 12 },
      { header: 'Hàng thành phần', width: 30 },
      { header: 'Trạng thái thanh lý', width: 18 },
      ...(withCost
        ? [
            { header: 'Giá vốn', width: 14 },
            { header: 'Giá nhập cuối', width: 14 },
          ]
        : []),
      { header: 'Tồn kho', width: 12 },
      { header: 'KH đặt', width: 12 },
      { header: 'Mô tả', width: 30 },
      { header: 'Đang kinh doanh', width: 16 },
      { header: 'Hình ảnh (url1,url2...)', width: 40 },
    ];
    const rows = data.map((p): CellValue[] => [
      p.code,
      p.name,
      p.categoryPath ? p.categoryPath.replaceAll(' > ', '>>') : null,
      p.productType === 'combo' ? 'Combo' : 'Hàng hóa',
      p.components || null,
      LIQUIDATION_STATUS_LABELS[p.liquidationStatus],
      ...(withCost ? [num(p.costPrice), num(p.lastPurchasePrice)] : []),
      num(p.onHand),
      num(p.reserved),
      p.description,
      p.isActive ? 1 : 0,
      p.images.map((i) => i.url).join(',') || null,
    ]);
    return writeSheet('Hàng hóa', columns, rows);
  }

  async get(user: AuthUser, branchId: string, id: string): Promise<ProductDto> {
    const canSeeCost = await this.permissions.has(
      user.role,
      'product.cost.view',
    );
    return this.getDto(this.db, branchId, id, canSeeCost);
  }

  /** Tìm nhanh cho ô chọn hàng: tối đa 20 dòng, chỉ hàng đang kinh doanh và được bán. */
  async lookup(branchId: string, q?: string): Promise<ProductLookupDto[]> {
    const needle = (q ?? '').trim();
    const rows = await this.joinedQuery(this.db, branchId)
      .where(
        and(
          isNull(products.deletedAt),
          eq(products.isActive, true),
          searchWhere(productSearchExpr(products), q),
        ),
      )
      .orderBy(
        // mã trùng khớp hoàn toàn lên đầu, rồi theo mã
        ...(needle
          ? [desc(sql`lower(${products.code}) = lower(${needle})`)]
          : []),
        asc(products.code),
      )
      .limit(20);
    const images = await this.imagesOf(rows.map((r) => r.p.id));
    const comboIds = rows
      .filter((r) => r.p.productType === 'combo')
      .map((r) => r.p.id);
    const [figures, comps] = await Promise.all([
      comboFigures(this.db, branchId, comboIds),
      loadComponents(this.db, comboIds),
    ]);
    return rows.map((r) => {
      const onHand = dec(r.onHand ?? '0');
      return {
        id: r.p.id,
        code: r.p.code,
        name: r.p.name,
        productType: r.p.productType,
        components: componentsText(comps.get(r.p.id)),
        available:
          figures.get(r.p.id)?.available ??
          onHand.minus(dec(r.reserved ?? '0')).toFixed(3),
        imageUrl: images.get(r.p.id)?.[0]?.url ?? null,
      };
    });
  }

  // ------------------------------------------------------------------ tạo / sửa

  async create(
    user: AuthUser,
    branchId: string,
    input: CreateProductDto,
  ): Promise<ProductDto> {
    if (input.categoryId) await this.assertCategory(this.db, input.categoryId);
    const productType: ProductType = input.productType ?? 'goods';
    const entries = this.parseComponentInput(productType, input.components);
    const id = await this.db
      .transaction(async (tx) => {
        const [row] = await tx
          .insert(products)
          .values({
            code: input.code,
            name: input.name.trim(),
            categoryId: input.categoryId ?? null,
            productType,
            liquidationStatus: input.liquidationStatus ?? 'normal',
            description: input.description ?? null,
            createdBy: user.id,
          })
          .returning();
        const resolved = await this.replaceComponents(tx, row!.id, entries);
        await this.auditLog.record(tx, {
          action: 'product.create',
          entityType: 'product',
          entityId: row!.id,
          after: auditView(row!, resolved),
        });
        return row!.id;
      })
      .catch(rethrowDuplicateCode);
    return this.get(user, branchId, id);
  }

  /**
   * Sửa hàng hóa. Người có `product.edit` sửa mọi trường; người chỉ có `product.content.edit` chỉ sửa được mô tả.
   * Mã hàng chỉ đổi được khi hàng chưa có giao dịch nào.
   */
  async update(
    user: AuthUser,
    branchId: string,
    id: string,
    input: UpdateProductDto,
    canEditAll: boolean,
  ): Promise<ProductDto> {
    if (!canEditAll) {
      const forbidden = (
        Object.keys(input) as Array<keyof UpdateProductDto>
      ).filter((k) => input[k] !== undefined && k !== 'description');
      if (forbidden.length > 0) {
        throw new AppError(
          403,
          'FORBIDDEN',
          'Bạn chỉ được sửa mô tả hàng hóa (thiếu quyền: Thêm/sửa hàng hóa)',
          { permission: 'product.edit', fields: forbidden },
        );
      }
    }
    if (input.categoryId) await this.assertCategory(this.db, input.categoryId);

    await this.db
      .transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(products)
          .where(and(eq(products.id, id), isNull(products.deletedAt)))
          .for('update');
        if (!before) {
          throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy hàng hóa');
        }
        if (input.code !== undefined && input.code !== before.code) {
          if (await this.hasTransactions(tx, id)) {
            throw new AppError(
              400,
              'INVALID_STATE',
              'Hàng đã có giao dịch nên không đổi được mã hàng',
            );
          }
        }
        const nextType: ProductType = input.productType ?? before.productType;
        const typeChanged = nextType !== before.productType;
        if (typeChanged) {
          if (await this.hasTransactions(tx, id)) {
            throw new AppError(
              400,
              'INVALID_STATE',
              'Hàng đã có giao dịch nên không đổi được loại hàng',
            );
          }
          if (await this.isComponentOfCombo(tx, id)) {
            throw new AppError(
              400,
              'INVALID_STATE',
              'Hàng đang là thành phần của một combo nên không đổi được loại hàng',
            );
          }
        }
        const beforeComps = componentsText(
          (await loadComponents(tx, [id])).get(id),
        );
        // Đổi sang combo: bắt buộc gửi thành phần; combo giữ nguyên loại: thành phần là tùy chọn
        const entries =
          input.components === undefined &&
          !(typeChanged && nextType === 'combo')
            ? undefined
            : this.parseComponentInput(nextType, input.components);
        const patch: Partial<typeof products.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (typeChanged) patch.productType = nextType;
        if (input.liquidationStatus !== undefined)
          patch.liquidationStatus = input.liquidationStatus;
        if (input.code !== undefined) patch.code = input.code;
        if (input.name !== undefined) patch.name = input.name.trim();
        if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
        if (input.description !== undefined)
          patch.description = input.description;
        if (input.isActive !== undefined) patch.isActive = input.isActive;

        const [after] = await tx
          .update(products)
          .set(patch)
          .where(eq(products.id, id))
          .returning();
        // Đổi combo → hàng hóa thì bỏ thành phần
        const afterComps =
          nextType === 'goods'
            ? await this.replaceComponents(tx, id, [])
            : entries
              ? await this.replaceComponents(tx, id, entries)
              : beforeComps;
        await this.auditLog.record(tx, {
          action: 'product.update',
          entityType: 'product',
          entityId: id,
          before: auditView(before, beforeComps),
          after: auditView(after!, afterComps),
        });
      })
      .catch(rethrowDuplicateCode);
    return this.get(user, branchId, id);
  }

  // ------------------------------------------------------------------ theo chi nhánh

  /** Chi tiết hàng ở từng chi nhánh người dùng được phép: tồn, giá vốn (theo quyền), min/max, vị trí, giá 7 bảng giá. */
  async branchesOf(user: AuthUser, id: string): Promise<ProductBranchDto[]> {
    const product = await this.findOrThrow(this.db, id);
    const isCombo = product.productType === 'combo';
    const canSeeCost = await this.permissions.has(
      user.role,
      'product.cost.view',
    );
    const allowed = await this.branchAccess.listAllowed(user);
    if (allowed.length === 0) return [];
    const ids = allowed.map((b) => b.id);
    const figuresBy = new Map<string, ComboFigures>();
    if (isCombo) {
      for (const b of allowed) {
        const f = (await comboFigures(this.db, b.id, [id])).get(id);
        if (f) figuresBy.set(b.id, f);
      }
    }

    const [stockRows, reservedRows] = await Promise.all([
      this.db
        .select()
        .from(stocks)
        .where(and(eq(stocks.productId, id), inArray(stocks.branchId, ids))),
      this.db
        .select({
          branchId: orders.branchId,
          qty: sql<string>`sum(${orderItems.qty})`,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(
          and(
            eq(orderItems.productId, id),
            eq(orders.status, 'draft'),
            inArray(orders.branchId, ids),
          ),
        )
        .groupBy(orders.branchId),
    ]);
    const stockBy = new Map(stockRows.map((s) => [s.branchId, s]));
    const reservedBy = new Map(reservedRows.map((r) => [r.branchId, r.qty]));

    return allowed.map((b) => {
      const s = stockBy.get(b.id);
      const onHand = dec(s?.onHand ?? '0');
      const reserved = dec(reservedBy.get(b.id) ?? '0');
      const fig = figuresBy.get(b.id);
      const dto: ProductBranchDto = {
        branchId: b.id,
        branchCode: b.code,
        branchName: b.name,
        onHand: fig ? fig.onHand : onHand.toFixed(3),
        reserved: isCombo ? '0.000' : reserved.toFixed(3),
        available: fig ? fig.available : onHand.minus(reserved).toFixed(3),
      };
      if (canSeeCost) {
        dto.costPrice = fig ? fig.costPrice : (s?.costPrice ?? '0.0000');
        dto.lastPurchasePrice = fig
          ? fig.lastPurchasePrice
          : (s?.lastPurchasePrice ?? null);
      }
      return dto;
    });
  }

  // ------------------------------------------------------------------ thẻ kho

  async stockCard(
    user: AuthUser,
    branchId: string,
    id: string,
    q: StockCardQueryDto,
  ): Promise<StockCardDto> {
    const product = await this.findOrThrow(this.db, id);
    if (product.productType === 'combo') {
      throw new AppError(
        400,
        'INVALID_STATE',
        'Combo không có thẻ kho; hãy xem thẻ kho của từng hàng thành phần',
      );
    }
    const canSeeCost = await this.permissions.has(
      user.role,
      'product.cost.view',
    );
    const from = q.from ? vnDayStart(q.from, 'from') : undefined;
    const toExclusive = q.to
      ? new Date(vnDayStart(q.to, 'to').getTime() + 24 * 3600 * 1000)
      : undefined;
    if (from && toExclusive && from >= toExclusive) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Khoảng ngày không hợp lệ', [
        {
          field: 'to',
          message: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu',
        },
      ]);
    }
    const base = and(
      eq(stockMovements.productId, id),
      eq(stockMovements.branchId, branchId),
    );

    let opening = dec(0);
    if (from) {
      const [sum] = await this.db
        .select({
          qty: sql<string>`coalesce(sum(${stockMovements.qtyDelta}), 0)`,
        })
        .from(stockMovements)
        .where(and(base, lt(stockMovements.occurredAt, from)));
      opening = dec(sum!.qty);
    }
    const rows = await this.db
      .select()
      .from(stockMovements)
      .where(
        and(
          base,
          from ? gte(stockMovements.occurredAt, from) : undefined,
          toExclusive ? lt(stockMovements.occurredAt, toExclusive) : undefined,
        ),
      )
      .orderBy(
        asc(stockMovements.occurredAt),
        asc(stockMovements.createdAt),
        asc(stockMovements.id),
      );

    let balance = opening;
    const movements = rows.map((m) => {
      balance = balance.plus(dec(m.qtyDelta));
      const line: StockCardDto['movements'][number] = {
        occurredAt: m.occurredAt.toISOString(),
        refType: m.refType,
        refId: m.refId,
        refCode: m.refCode,
        qtyDelta: dec(m.qtyDelta).toFixed(3),
        balance: balance.toFixed(3),
      };
      if (canSeeCost) line.unitCost = m.unitCost;
      return line;
    });
    return {
      branchId,
      openingQty: opening.toFixed(3),
      movements,
      closingQty: balance.toFixed(3),
    };
  }

  // ------------------------------------------------------------------ nội bộ

  /** Truy vấn nền: hàng + tồn + số đang giữ, tất cả theo MỘT chi nhánh. */
  private joinedQuery(db: DbOrTx, branchId: string) {
    const reserved = db
      .select({
        productId: orderItems.productId,
        qty: sql<string>`sum(${orderItems.qty})`.as('reserved_qty'),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orders.branchId, branchId), eq(orders.status, 'draft')))
      .groupBy(orderItems.productId)
      .as('reserved_q');
    return db
      .select({
        p: products,
        onHand: stocks.onHand,
        costPrice: stocks.costPrice,
        lastPurchasePrice: stocks.lastPurchasePrice,
        reserved: reserved.qty,
      })
      .from(products)
      .leftJoin(
        stocks,
        and(eq(stocks.productId, products.id), eq(stocks.branchId, branchId)),
      )
      .leftJoin(reserved, eq(reserved.productId, products.id))
      .$dynamic();
  }

  private async getDto(
    db: DbOrTx,
    branchId: string,
    id: string,
    canSeeCost: boolean,
  ): Promise<ProductDto> {
    const rows = await this.joinedQuery(db, branchId).where(
      and(eq(products.id, id), isNull(products.deletedAt)),
    );
    if (rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy hàng hóa');
    }
    return (await this.toDtos(rows as JoinedRow[], branchId, canSeeCost))[0]!;
  }

  private async toDtos(
    rows: JoinedRow[],
    branchId: string,
    canSeeCost: boolean,
  ): Promise<ProductDto[]> {
    const comboIds = rows
      .filter((r) => r.p.productType === 'combo')
      .map((r) => r.p.id);
    const [images, paths, figures, comps, onOrder] = await Promise.all([
      this.imagesOf(rows.map((r) => r.p.id)),
      this.categoryPaths(),
      comboFigures(this.db, branchId, comboIds),
      loadComponents(this.db, comboIds),
      onOrderByProduct(
        this.db,
        branchId,
        rows.map((r) => r.p.id),
      ),
    ]);
    return rows.map((r) => {
      const fig = figures.get(r.p.id);
      const isCombo = r.p.productType === 'combo';
      const items = comps.get(r.p.id) ?? [];
      const onHand = dec(r.onHand ?? '0');
      const reserved = dec(r.reserved ?? '0');
      const dto: ProductDto = {
        id: r.p.id,
        code: r.p.code,
        name: r.p.name,
        categoryId: r.p.categoryId,
        categoryPath: r.p.categoryId
          ? (paths.get(r.p.categoryId) ?? null)
          : null,
        productType: r.p.productType,
        liquidationStatus: r.p.liquidationStatus,
        components: componentsText(items),
        componentItems: items.map((c) => ({
          productId: c.productId,
          code: c.code,
          name: c.name,
          qty: c.qty,
        })),
        branchId,
        onHand: fig ? fig.onHand : onHand.toFixed(3),
        reserved: isCombo ? '0.000' : reserved.toFixed(3),
        available: fig ? fig.available : onHand.minus(reserved).toFixed(3),
        onOrder: dec(onOrder.get(r.p.id) ?? '0').toFixed(3),
        description: r.p.description,
        images: images.get(r.p.id) ?? [],
        isActive: r.p.isActive,
        createdAt: r.p.createdAt.toISOString(),
        updatedAt: r.p.updatedAt.toISOString(),
      };
      if (canSeeCost) {
        dto.costPrice = fig ? fig.costPrice : (r.costPrice ?? '0.0000');
        dto.lastPurchasePrice = fig
          ? fig.lastPurchasePrice
          : r.lastPurchasePrice;
      }
      return dto;
    });
  }

  private async imagesOf(
    productIds: string[],
  ): Promise<Map<string, ProductImageDto[]>> {
    const map = new Map<string, ProductImageDto[]>();
    if (productIds.length === 0) return map;
    const rows = await this.db
      .select()
      .from(productImages)
      .where(inArray(productImages.productId, productIds))
      .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt));
    for (const r of rows) {
      const list = map.get(r.productId) ?? [];
      list.push({ id: r.id, url: r.url, sortOrder: r.sortOrder });
      map.set(r.productId, list);
    }
    return map;
  }

  /** "ĐIỆN GIA DỤNG > Quạt điện" cho từng nhóm. */
  private async categoryPaths(): Promise<Map<string, string>> {
    const rows = await this.db
      .select()
      .from(categories)
      .where(isNull(categories.deletedAt));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const paths = new Map<string, string>();
    for (const r of rows) {
      const names: string[] = [];
      for (
        let cur: (typeof rows)[number] | undefined = r;
        cur;
        cur = cur.parentId ? byId.get(cur.parentId) : undefined
      ) {
        names.unshift(cur.name);
      }
      paths.set(r.id, names.join(' > '));
    }
    return paths;
  }

  private async assertCategory(db: DbOrTx, categoryId: string): Promise<void> {
    const [row] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)));
    if (!row) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Nhóm hàng không tồn tại', [
        { field: 'categoryId', message: 'Nhóm hàng không tồn tại' },
      ]);
    }
  }

  /**
   * Đọc chuỗi `MSP/SL,MSP/SL` theo loại hàng: combo bắt buộc có ít nhất 1 thành phần; hàng hóa không được có.
   */
  private parseComponentInput(
    type: ProductType,
    text: string | undefined,
  ): Array<{ code: string; qty: number }> {
    const fail = (message: string): never => {
      throw new AppError(400, 'VALIDATION_ERROR', message, [
        { field: 'components', message },
      ]);
    };
    const parsed = parseComponents(text ?? '');
    if (!parsed.ok) return fail(parsed.error);
    if (type === 'goods') {
      if (parsed.items.length > 0)
        fail('Hàng hóa không có hàng thành phần (chỉ Combo mới có)');
      return [];
    }
    if (parsed.items.length === 0)
      fail('Combo phải có ít nhất một hàng thành phần');
    return parsed.items;
  }

  /**
   * Thay toàn bộ thành phần của một hàng bằng `entries` (mã → hàng hóa chưa xóa, loại `goods`, không phân biệt
   * hoa thường). Trả chuỗi `MSP/SL,MSP/SL` theo mã chuẩn của CSDL.
   */
  private async replaceComponents(
    tx: DbOrTx,
    comboId: string,
    entries: Array<{ code: string; qty: number }>,
  ): Promise<string> {
    await tx
      .delete(productComponents)
      .where(eq(productComponents.comboId, comboId));
    if (entries.length === 0) return '';
    const found = await tx
      .select({
        id: products.id,
        code: products.code,
        productType: products.productType,
      })
      .from(products)
      .where(
        and(
          isNull(products.deletedAt),
          inArray(
            sql`lower(${products.code})`,
            entries.map((e) => e.code.toLowerCase()),
          ),
        ),
      );
    const byCode = new Map(found.map((f) => [f.code.toLowerCase(), f]));
    const missing = entries
      .filter((e) => !byCode.has(e.code.toLowerCase()))
      .map((e) => e.code);
    const nested = entries
      .filter((e) => byCode.get(e.code.toLowerCase())?.productType === 'combo')
      .map((e) => e.code);
    const problem =
      missing.length > 0
        ? `Không tìm thấy hàng thành phần: ${missing.join(', ')}`
        : nested.length > 0
          ? `Thành phần phải là hàng hóa, không được là combo: ${nested.join(', ')}`
          : null;
    if (problem) {
      throw new AppError(400, 'VALIDATION_ERROR', problem, [
        { field: 'components', message: problem },
      ]);
    }
    await tx.insert(productComponents).values(
      entries.map((e, i) => ({
        comboId,
        componentId: byCode.get(e.code.toLowerCase())!.id,
        qty: e.qty,
        sortOrder: i,
      })),
    );
    return formatComponents(
      entries.map((e) => ({
        code: byCode.get(e.code.toLowerCase())!.code,
        qty: e.qty,
      })),
    );
  }

  private async isComponentOfCombo(
    db: DbOrTx,
    productId: string,
  ): Promise<boolean> {
    const rows = await db
      .select({ one: sql`1` })
      .from(productComponents)
      .where(eq(productComponents.componentId, productId))
      .limit(1);
    return rows.length > 0;
  }

  private async findOrThrow(db: DbOrTx, id: string): Promise<ProductRow> {
    const [row] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), isNull(products.deletedAt)));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy hàng hóa');
    return row;
  }

  /** Hàng đã có dòng ở sổ cái kho hoặc bất kỳ chứng từ nào → không đổi mã. */
  private async hasTransactions(
    db: DbOrTx,
    productId: string,
  ): Promise<boolean> {
    const checks = [
      db
        .select({ one: sql`1` })
        .from(stockMovements)
        .where(eq(stockMovements.productId, productId))
        .limit(1),
      db
        .select({ one: sql`1` })
        .from(orderItems)
        .where(eq(orderItems.productId, productId))
        .limit(1),
      db
        .select({ one: sql`1` })
        .from(invoiceItems)
        .where(eq(invoiceItems.productId, productId))
        .limit(1),
      db
        .select({ one: sql`1` })
        .from(goodsReceiptItems)
        .where(eq(goodsReceiptItems.productId, productId))
        .limit(1),
      db
        .select({ one: sql`1` })
        .from(salesReturnItems)
        .where(eq(salesReturnItems.productId, productId))
        .limit(1),
      db
        .select({ one: sql`1` })
        .from(purchaseReturnItems)
        .where(eq(purchaseReturnItems.productId, productId))
        .limit(1),
      db
        .select({ one: sql`1` })
        .from(stockTransferItems)
        .where(eq(stockTransferItems.productId, productId))
        .limit(1),
    ];
    for (const check of checks) {
      if ((await check).length > 0) return true;
    }
    return false;
  }
}

/** Các trường an toàn để ghi nhật ký. */
function auditView(p: ProductRow, components: string) {
  return {
    code: p.code,
    name: p.name,
    categoryId: p.categoryId,
    productType: p.productType,
    liquidationStatus: p.liquidationStatus,
    components,
    description: p.description,
    isActive: p.isActive,
  };
}

/** Chuỗi `MSP/SL,MSP/SL` của một combo (rỗng nếu không có thành phần). */
function componentsText(items: ComboComponent[] | undefined): string {
  return formatComponents(
    (items ?? []).map((c) => ({ code: c.code, qty: c.qty })),
  );
}

function rethrowDuplicateCode(e: unknown): never {
  if (uniqueViolation(e)) {
    throw new AppError(409, 'DUPLICATE_CODE', 'Mã hàng đã tồn tại', [
      { field: 'code', message: 'Mã hàng đã tồn tại' },
    ]);
  }
  throw e;
}
