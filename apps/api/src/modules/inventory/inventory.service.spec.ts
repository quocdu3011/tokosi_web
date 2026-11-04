import type { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/database.module.js';
import {
  branches,
  products,
  stockMovements,
  stocks,
} from '../../db/schema/index.js';
import { createTestDb } from '../../db/test-db.js';
import { InventoryService } from './inventory.service.js';

describe('InventoryService (CSDL thật trong bộ nhớ)', () => {
  let client: PGlite;
  let db: Database;
  let inv: InventoryService;
  let sg: string;
  let hn: string;
  let n = 0;

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
    inv = new InventoryService(db);
    const rows = await db
      .insert(branches)
      .values([
        { code: 'SG', name: 'Sài Gòn', isDefault: true },
        { code: 'HN', name: 'Hà Nội' },
      ])
      .returning();
    sg = rows.find((b) => b.code === 'SG')!.id;
    hn = rows.find((b) => b.code === 'HN')!.id;
  });
  afterAll(async () => {
    await client.close();
  });

  const newProduct = async () => {
    const [p] = await db
      .insert(products)
      .values({ code: `P${++n}`, name: `Hàng ${n}` })
      .returning();
    return p!.id;
  };
  const stockOf = async (branchId: string, productId: string) =>
    (
      await db
        .select()
        .from(stocks)
        .where(
          and(eq(stocks.branchId, branchId), eq(stocks.productId, productId)),
        )
    )[0];

  it('nhập: cộng tồn, đặt giá vốn, ghi sổ cái', async () => {
    const p = await newProduct();
    const r = await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '100',
      unitCost: '1000',
      refType: 'adjustment',
      refCode: 'T1',
    });
    expect(r).toEqual({
      onHand: '100.000',
      costPrice: '1000.0000',
      movementCost: '1000.0000',
    });
    const moves = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.productId, p));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      qtyDelta: '100.000',
      unitCost: '1000.0000',
      refCode: 'T1',
      branchId: sg,
    });
  });

  it('nhập lần hai: giá vốn bình quân gia quyền', async () => {
    const p = await newProduct();
    await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '100',
      unitCost: '1000',
      refType: 'adjustment',
    });
    const r = await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '100',
      unitCost: '2000',
      refType: 'adjustment',
    });
    expect(r.costPrice).toBe('1500.0000');
    expect(r.onHand).toBe('200.000');
  });

  it('xuất: trừ tồn, tính theo giá vốn hiện tại, không đổi giá vốn', async () => {
    const p = await newProduct();
    await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '10',
      unitCost: '1234.5',
      refType: 'adjustment',
    });
    const r = await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '-4',
      refType: 'invoice',
    });
    expect(r).toEqual({
      onHand: '6.000',
      costPrice: '1234.5000',
      movementCost: '1234.5000',
    });
  });

  it('không cho tồn âm: báo STOCK_NOT_ENOUGH và giữ nguyên dữ liệu', async () => {
    const p = await newProduct();
    await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '5',
      unitCost: '100',
      refType: 'adjustment',
    });
    await expect(
      inv.applyMovement(db, {
        branchId: sg,
        productId: p,
        qtyDelta: '-5.001',
        refType: 'invoice',
      }),
    ).rejects.toMatchObject({ status: 422, code: 'STOCK_NOT_ENOUGH' });
    expect((await stockOf(sg, p))?.onHand).toBe('5.000');
    const moves = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.productId, p));
    expect(moves).toHaveLength(1);
  });

  it('xuất hết rồi vẫn giữ giá vốn; nhập lại thì lấy giá nhập mới', async () => {
    const p = await newProduct();
    await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '5',
      unitCost: '100',
      refType: 'adjustment',
    });
    await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '-5',
      refType: 'invoice',
    });
    expect((await stockOf(sg, p))?.costPrice).toBe('100.0000');
    const r = await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '2',
      unitCost: '300',
      refType: 'adjustment',
    });
    expect(r.costPrice).toBe('300.0000');
  });

  it('mỗi chi nhánh có tồn và giá vốn riêng', async () => {
    const p = await newProduct();
    await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '10',
      unitCost: '1000',
      refType: 'adjustment',
    });
    await inv.applyMovement(db, {
      branchId: hn,
      productId: p,
      qtyDelta: '10',
      unitCost: '1400',
      refType: 'adjustment',
    });
    expect((await stockOf(sg, p))?.costPrice).toBe('1000.0000');
    expect((await stockOf(hn, p))?.costPrice).toBe('1400.0000');
    // xuất ở HN không đụng SG
    await inv.applyMovement(db, {
      branchId: hn,
      productId: p,
      qtyDelta: '-10',
      refType: 'invoice',
    });
    expect((await stockOf(sg, p))?.onHand).toBe('10.000');
    await expect(
      inv.applyMovement(db, {
        branchId: hn,
        productId: p,
        qtyDelta: '-1',
        refType: 'invoice',
      }),
    ).rejects.toMatchObject({ code: 'STOCK_NOT_ENOUGH' });
  });

  it('chỉ ghi giá nhập cuối khi được yêu cầu (nhập từ nhà cung cấp)', async () => {
    const p = await newProduct();
    await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '1',
      unitCost: '500',
      refType: 'transfer_in',
    });
    expect((await stockOf(sg, p))?.lastPurchasePrice).toBeNull();
    await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '1',
      unitCost: '600',
      refType: 'goods_receipt',
      setLastPurchasePrice: true,
    });
    expect((await stockOf(sg, p))?.lastPurchasePrice).toBe('600.0000');
  });

  it('số lượng 0 bị từ chối', async () => {
    const p = await newProduct();
    await expect(
      inv.applyMovement(db, {
        branchId: sg,
        productId: p,
        qtyDelta: '0',
        refType: 'adjustment',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('chạy trong transaction: lỗi giữa chừng thì hoàn tác toàn bộ', async () => {
    const p = await newProduct();
    await inv.applyMovement(db, {
      branchId: sg,
      productId: p,
      qtyDelta: '10',
      unitCost: '100',
      refType: 'adjustment',
    });
    await expect(
      db.transaction(async (tx) => {
        await inv.applyMovement(tx, {
          branchId: sg,
          productId: p,
          qtyDelta: '-4',
          refType: 'invoice',
        });
        throw new Error('hủy');
      }),
    ).rejects.toThrow('hủy');
    expect((await stockOf(sg, p))?.onHand).toBe('10.000');
    const moves = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.productId, p));
    expect(moves).toHaveLength(1);
  });
});
