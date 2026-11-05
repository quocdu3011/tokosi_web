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
import { dec } from '../../common/costing.js';
import {
  writeSheet,
  type CellValue,
  type SheetColumn,
} from '../../common/excel.js';
import { AppError } from '../../common/app-error.js';
import type { AuthUser } from '../../common/auth-user.js';
import { pageMeta, pageParams, parseSort } from '../../common/pagination.js';
import { uniqueViolation } from '../../common/pg-errors.js';
import { DB, type Database, type DbOrTx } from '../../db/database.module.js';
import { categoryWithDescendants } from '../../db/category-tree.js';
import { searchWhere } from '../../db/search.js';
import {
  branches,
  categories,
  goodsReceiptItems,
  invoiceItems,
  orderItems,
  orders,
  priceBookItems,
  priceBooks,
  productImages,
  products,
  purchaseReturnItems,
  salesReturnItems,
  stockMovements,
  stockTransferItems,
  stocks,
} from '../../db/schema/index.js';
import { productSearchExpr } from '../../db/schema/_search.js';
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
  type SetProductBranchSettingsDto,
  type StockCardDto,
  type StockCardQueryDto,
  type UpdateProductDto,
} from './products.dto.js';

/** Tối đa số dòng khi xuất Excel. */
export const EXPORT_MAX_ROWS = 10_000;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const VN_OFFSET = '+07:00';

type ProductRow = typeof products.$inferSelect;

/** Dòng kết quả truy vấn danh sách: hàng + các cột theo chi nhánh làm việc. */
interface JoinedRow {
  p: ProductRow;
  onHand: string | null;
  costPrice: string | null;
  lastPurchasePrice: string | null;
  minStock: string | null;
  maxStock: string | null;
  location: string | null;
  basePrice: string | null;
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
    const defaultBookId = await this.defaultBookId(this.db);
    const categoryIds = q.categoryId
      ? await categoryWithDescendants(this.db, q.categoryId)
      : undefined;

    const conditions: Array<SQL | undefined> = [
      isNull(products.deletedAt),
      searchWhere(productSearchExpr(products), q.q),
      q.isActive === undefined ? undefined : eq(products.isActive, q.isActive),
      categoryIds ? inArray(products.categoryId, categoryIds) : undefined,
      q.inStock === undefined
        ? undefined
        : q.inStock
          ? gt(sql`coalesce(${stocks.onHand}, 0)`, sql`0`)
          : sql`coalesce(${stocks.onHand}, 0) <= 0`,
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
          ? sql`coalesce(${stocks.onHand}, 0)`
          : sort?.field === 'createdAt'
            ? products.createdAt
            : products.code;

    const { page, limit, offset } =
      mode === 'export'
        ? { page: 1, limit: EXPORT_MAX_ROWS, offset: 0 }
        : pageParams(q);

    const rows = await this.joinedQuery(this.db, branchId, defaultBookId)
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
      { header: 'Đơn vị tính', width: 12 },
      { header: 'Giá bán', width: 14 },
      ...(withCost
        ? [
            { header: 'Giá vốn', width: 14 },
            { header: 'Giá nhập cuối', width: 14 },
          ]
        : []),
      { header: 'Tồn kho', width: 12 },
      { header: 'KH đặt', width: 12 },
      { header: 'Tồn nhỏ nhất', width: 14 },
      { header: 'Tồn lớn nhất', width: 14 },
      { header: 'Vị trí', width: 12 },
      { header: 'Trọng lượng', width: 14 },
      { header: 'Mô tả', width: 30 },
      { header: 'Đang kinh doanh', width: 16 },
      { header: 'Được bán trực tiếp', width: 18 },
      { header: 'Hình ảnh (url1,url2...)', width: 40 },
    ];
    const rows = data.map((p): CellValue[] => [
      p.code,
      p.name,
      p.categoryPath ? p.categoryPath.replaceAll(' > ', '>>') : null,
      p.unit,
      num(p.basePrice),
      ...(withCost ? [num(p.costPrice), num(p.lastPurchasePrice)] : []),
      num(p.onHand),
      num(p.reserved),
      num(p.minStock),
      num(p.maxStock),
      p.location,
      num(p.weightG),
      p.description,
      p.isActive ? 1 : 0,
      p.isSellable ? 1 : 0,
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
    const defaultBookId = await this.defaultBookId(this.db);
    const needle = (q ?? '').trim();
    const rows = await this.joinedQuery(this.db, branchId, defaultBookId)
      .where(
        and(
          isNull(products.deletedAt),
          eq(products.isActive, true),
          eq(products.isSellable, true),
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
    return rows.map((r) => {
      const onHand = dec(r.onHand ?? '0');
      return {
        id: r.p.id,
        code: r.p.code,
        name: r.p.name,
        unit: r.p.unit,
        basePrice: r.basePrice === null ? null : dec(r.basePrice).toFixed(),
        available: onHand.minus(dec(r.reserved ?? '0')).toFixed(3),
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
    const id = await this.db
      .transaction(async (tx) => {
        const [row] = await tx
          .insert(products)
          .values({
            code: input.code,
            name: input.name.trim(),
            categoryId: input.categoryId ?? null,
            unit: input.unit?.trim() || 'Cái',
            description: input.description ?? null,
            weightG: input.weightG ?? null,
            isSellable: input.isSellable ?? true,
            createdBy: user.id,
          })
          .returning();
        await this.auditLog.record(tx, {
          action: 'product.create',
          entityType: 'product',
          entityId: row!.id,
          after: auditView(row!),
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
        const patch: Partial<typeof products.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (input.code !== undefined) patch.code = input.code;
        if (input.name !== undefined) patch.name = input.name.trim();
        if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
        if (input.unit !== undefined) patch.unit = input.unit.trim();
        if (input.description !== undefined)
          patch.description = input.description;
        if (input.weightG !== undefined) patch.weightG = input.weightG;
        if (input.isActive !== undefined) patch.isActive = input.isActive;
        if (input.isSellable !== undefined) patch.isSellable = input.isSellable;

        const [after] = await tx
          .update(products)
          .set(patch)
          .where(eq(products.id, id))
          .returning();
        await this.auditLog.record(tx, {
          action: 'product.update',
          entityType: 'product',
          entityId: id,
          before: auditView(before),
          after: auditView(after!),
        });
      })
      .catch(rethrowDuplicateCode);
    return this.get(user, branchId, id);
  }

  // ------------------------------------------------------------------ theo chi nhánh

  /** Chi tiết hàng ở từng chi nhánh người dùng được phép: tồn, giá vốn (theo quyền), min/max, vị trí, giá 7 bảng giá. */
  async branchesOf(user: AuthUser, id: string): Promise<ProductBranchDto[]> {
    await this.findOrThrow(this.db, id);
    const canSeeCost = await this.permissions.has(
      user.role,
      'product.cost.view',
    );
    const allowed = await this.branchAccess.listAllowed(user);
    if (allowed.length === 0) return [];
    const ids = allowed.map((b) => b.id);

    const [stockRows, priceRows, bookRows, reservedRows] = await Promise.all([
      this.db
        .select()
        .from(stocks)
        .where(and(eq(stocks.productId, id), inArray(stocks.branchId, ids))),
      this.db
        .select()
        .from(priceBookItems)
        .where(
          and(
            eq(priceBookItems.productId, id),
            inArray(priceBookItems.branchId, ids),
          ),
        ),
      this.db.select().from(priceBooks).orderBy(priceBooks.sortOrder),
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
      const dto: ProductBranchDto = {
        branchId: b.id,
        branchCode: b.code,
        branchName: b.name,
        onHand: onHand.toFixed(3),
        reserved: reserved.toFixed(3),
        available: onHand.minus(reserved).toFixed(3),
        minStock: s?.minStock ?? null,
        maxStock: s?.maxStock ?? null,
        location: s?.location ?? null,
        prices: bookRows.map((book) => {
          const row = priceRows.find(
            (p) => p.branchId === b.id && p.priceBookId === book.id,
          );
          return {
            priceBookId: book.id,
            priceBookCode: book.code,
            price: row ? dec(row.price).toFixed() : null,
          };
        }),
      };
      if (canSeeCost) {
        dto.costPrice = s?.costPrice ?? '0.0000';
        dto.lastPurchasePrice = s?.lastPurchasePrice ?? null;
      }
      return dto;
    });
  }

  /**
   * Đặt tồn tối thiểu / tối đa / vị trí kho của một chi nhánh. CHỈ ghi các cột này của `stocks`:
   * số tồn và giá vốn chỉ `InventoryService` được thay đổi.
   */
  async setBranchSettings(
    user: AuthUser,
    id: string,
    branchId: string,
    input: SetProductBranchSettingsDto,
  ): Promise<ProductBranchDto> {
    await this.branchAccess.assertAccess(user, branchId);
    await this.findOrThrow(this.db, id);
    const [branch] = await this.db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.isActive, true)));
    if (!branch) {
      throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy chi nhánh');
    }
    if (
      input.minStock === undefined &&
      input.maxStock === undefined &&
      input.location === undefined
    ) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Không có trường nào để cập nhật',
        [{ field: 'minStock', message: 'Gửi ít nhất một trường' }],
      );
    }

    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(stocks)
        .where(and(eq(stocks.branchId, branchId), eq(stocks.productId, id)))
        .for('update');
      const nextMin =
        input.minStock === undefined ? current?.minStock : input.minStock;
      const nextMax =
        input.maxStock === undefined ? current?.maxStock : input.maxStock;
      if (nextMin && nextMax && dec(nextMin).gt(dec(nextMax))) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Tồn tối thiểu không được lớn hơn tồn tối đa',
          [{ field: 'minStock', message: 'Phải nhỏ hơn hoặc bằng tồn tối đa' }],
        );
      }
      const set: Partial<typeof stocks.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.minStock !== undefined)
        set.minStock =
          input.minStock === null ? null : dec(input.minStock).toFixed(3);
      if (input.maxStock !== undefined)
        set.maxStock =
          input.maxStock === null ? null : dec(input.maxStock).toFixed(3);
      if (input.location !== undefined)
        set.location = input.location?.trim() || null;

      await tx
        .insert(stocks)
        .values({ branchId, productId: id, ...set })
        .onConflictDoUpdate({
          target: [stocks.branchId, stocks.productId],
          set,
        });
      await this.auditLog.record(tx, {
        action: 'product.branch_settings',
        entityType: 'product',
        entityId: id,
        branchId,
        before: current
          ? {
              minStock: current.minStock,
              maxStock: current.maxStock,
              location: current.location,
            }
          : null,
        after: {
          minStock: set.minStock ?? current?.minStock ?? null,
          maxStock: set.maxStock ?? current?.maxStock ?? null,
          location: set.location ?? current?.location ?? null,
        },
      });
    });

    const all = await this.branchesOf(user, id);
    return all.find((b) => b.branchId === branchId)!;
  }

  // ------------------------------------------------------------------ thẻ kho

  async stockCard(
    user: AuthUser,
    branchId: string,
    id: string,
    q: StockCardQueryDto,
  ): Promise<StockCardDto> {
    await this.findOrThrow(this.db, id);
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

  /** Truy vấn nền: hàng + tồn + giá Bảng giá chung + số đang giữ, tất cả theo MỘT chi nhánh. */
  private joinedQuery(
    db: DbOrTx,
    branchId: string,
    defaultBookId: string | null,
  ) {
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
        minStock: stocks.minStock,
        maxStock: stocks.maxStock,
        location: stocks.location,
        basePrice: priceBookItems.price,
        reserved: reserved.qty,
      })
      .from(products)
      .leftJoin(
        stocks,
        and(eq(stocks.productId, products.id), eq(stocks.branchId, branchId)),
      )
      .leftJoin(
        priceBookItems,
        and(
          eq(priceBookItems.productId, products.id),
          eq(priceBookItems.branchId, branchId),
          eq(priceBookItems.priceBookId, defaultBookId ?? NIL_UUID),
        ),
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
    const defaultBookId = await this.defaultBookId(db);
    const rows = await this.joinedQuery(db, branchId, defaultBookId).where(
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
    const [images, paths] = await Promise.all([
      this.imagesOf(rows.map((r) => r.p.id)),
      this.categoryPaths(),
    ]);
    return rows.map((r) => {
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
        unit: r.p.unit,
        branchId,
        basePrice: r.basePrice === null ? null : dec(r.basePrice).toFixed(),
        onHand: onHand.toFixed(3),
        reserved: reserved.toFixed(3),
        available: onHand.minus(reserved).toFixed(3),
        onOrder: '0',
        minStock: r.minStock,
        maxStock: r.maxStock,
        location: r.location,
        description: r.p.description,
        weightG: r.p.weightG,
        images: images.get(r.p.id) ?? [],
        isActive: r.p.isActive,
        isSellable: r.p.isSellable,
        createdAt: r.p.createdAt.toISOString(),
        updatedAt: r.p.updatedAt.toISOString(),
      };
      if (canSeeCost) {
        dto.costPrice = r.costPrice ?? '0.0000';
        dto.lastPurchasePrice = r.lastPurchasePrice;
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

  private async defaultBookId(db: DbOrTx): Promise<string | null> {
    const [book] = await db
      .select({ id: priceBooks.id })
      .from(priceBooks)
      .where(eq(priceBooks.isDefault, true));
    return book?.id ?? null;
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
function auditView(p: ProductRow) {
  return {
    code: p.code,
    name: p.name,
    categoryId: p.categoryId,
    unit: p.unit,
    description: p.description,
    weightG: p.weightG,
    isActive: p.isActive,
    isSellable: p.isSellable,
  };
}

function rethrowDuplicateCode(e: unknown): never {
  if (uniqueViolation(e)) {
    throw new AppError(409, 'DUPLICATE_CODE', 'Mã hàng đã tồn tại', [
      { field: 'code', message: 'Mã hàng đã tồn tại' },
    ]);
  }
  throw e;
}

/** 00:00 của ngày `YYYY-MM-DD` theo giờ Việt Nam (UTC+7, không có giờ mùa hè). */
function vnDayStart(day: string, field: string): Date {
  const d = new Date(`${day}T00:00:00${VN_OFFSET}`);
  if (Number.isNaN(d.getTime())) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Ngày không hợp lệ', [
      { field, message: 'Ngày không hợp lệ' },
    ]);
  }
  return d;
}
