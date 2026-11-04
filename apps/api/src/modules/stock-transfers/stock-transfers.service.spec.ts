import type { PGlite } from '@electric-sql/pglite';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../db/database.module.js';
import {
  codeSequences,
  customers,
  debtLedger,
  products,
  stockMovements,
  stockTransfers,
  stocks,
  suppliers,
} from '../../db/schema/index.js';
import { runSeed } from '../../db/seed/index.js';
import { createTestDb } from '../../db/test-db.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { StockTransfersService } from './stock-transfers.service.js';

describe('StockTransfersService (CSDL thật trong bộ nhớ)', () => {
  let client: PGlite;
  let db: Database;
  let inv: InventoryService;
  let svc: StockTransfersService;
  let sg: string;
  let hn: string;
  let n = 0;

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
    await runSeed(db, { adminPassword: 'Mat-khau-thu-nghiem-1' });
    inv = new InventoryService(db);
    svc = new StockTransfersService(db, inv);
    const branchRows = await db.query.branches.findMany();
    sg = branchRows.find((b) => b.code === 'SG')!.id;
    hn = branchRows.find((b) => b.code === 'HN')!.id;
  });
  afterAll(async () => {
    await client.close();
  });

  /** Tạo sản phẩm và nạp tồn đầu cho từng chi nhánh: [chi nhánh, số lượng, giá vốn]. */
  const product = async (...stock: Array<[string, string, string]>) => {
    const [p] = await db
      .insert(products)
      .values({ code: `P${++n}`, name: `Hàng ${n}` })
      .returning();
    for (const [branchId, qty, cost] of stock) {
      await inv.applyMovement(db, {
        branchId,
        productId: p!.id,
        qtyDelta: qty,
        unitCost: cost,
        refType: 'adjustment',
      });
    }
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
  const ledgerOf = async (refId: string) =>
    db
      .select()
      .from(debtLedger)
      .where(eq(debtLedger.refId, refId))
      .orderBy(asc(debtLedger.branchId));
  const nextCh = async () =>
    (
      await db
        .select()
        .from(codeSequences)
        .where(eq(codeSequences.prefix, 'CH'))
    )[0]!.nextValue;

  it('bước 1 (gửi): trừ tồn bên gửi theo giá vốn bên gửi, chưa đụng bên nhận, chưa có công nợ', async () => {
    const a = await product([sg, '100', '1000'], [hn, '20', '1300']);
    const b = await product([sg, '50', '2000']);
    const t = await svc.create({
      fromBranchId: sg,
      toBranchId: hn,
      items: [
        { productId: a, qty: '40' },
        { productId: b, qty: '10' },
      ],
      shippingFee: '1000',
    });

    expect(t.status).toBe('in_transit');
    expect(t.code).toMatch(/^CH\d{6}$/);
    expect(t.goodsValue).toBe('60000'); // 40×1000 + 10×2000
    expect(t.shippingFee).toBe('1000');
    expect(t.items.find((i) => i.productId === a)).toMatchObject({
      unitCostSent: '1000.0000',
      shippingShare: '667',
    });
    expect(t.items.find((i) => i.productId === b)).toMatchObject({
      unitCostSent: '2000.0000',
      shippingShare: '333',
    });
    expect(t.items.reduce((s, i) => s + Number(i.shippingShare), 0)).toBe(1000);

    expect((await stockOf(sg, a))?.onHand).toBe('60.000');
    expect((await stockOf(sg, b))?.onHand).toBe('40.000');
    expect((await stockOf(hn, a))?.onHand).toBe('20.000'); // bên nhận chưa đổi
    expect(await stockOf(hn, b)).toBeUndefined();
    expect(await ledgerOf(t.id)).toHaveLength(0);

    const moves = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.refId, t.id));
    expect(moves).toHaveLength(2);
    expect(
      moves.every(
        (m) =>
          m.refType === 'transfer_out' &&
          m.branchId === sg &&
          m.refCode === t.code,
      ),
    ).toBe(true);
  });

  it('bước 2 (nhận): giá nhập kho = giá vốn gửi + phí phân bổ; giá vốn bình quân bên nhận; công nợ đối ứng gồm cả phí', async () => {
    const a = await product([sg, '100', '1000'], [hn, '20', '1300']);
    const b = await product([sg, '50', '2000']);
    const t = await svc.create({
      fromBranchId: sg,
      toBranchId: hn,
      items: [
        { productId: a, qty: '40' },
        { productId: b, qty: '10' },
      ],
      shippingFee: '1000',
      shippingPaidBy: 'sender',
    });
    const received = await svc.receive(t.id);

    expect(received.status).toBe('received');
    expect(received.receivedAt).not.toBeNull();
    expect(received.debtAmount).toBe('61000'); // 60.000 tiền hàng + 1.000 phí (bên gửi ứng)
    expect(
      received.items.find((i) => i.productId === a)?.unitCostReceived,
    ).toBe('1016.6750'); // 1000 + 667/40
    expect(
      received.items.find((i) => i.productId === b)?.unitCostReceived,
    ).toBe('2033.3000'); // 2000 + 333/10

    // HN: có sẵn 20 @1300 + 40 @1016.675 → bình quân gia quyền
    const hnA = await stockOf(hn, a);
    expect(hnA?.onHand).toBe('60.000');
    expect(hnA?.costPrice).toBe('1111.1167');
    // HN chưa có B → giá vốn = giá nhập kho
    expect(await stockOf(hn, b)).toMatchObject({
      onHand: '10.000',
      costPrice: '2033.3000',
    });
    // Bên gửi giữ nguyên sau bước 1
    expect((await stockOf(sg, a))?.onHand).toBe('60.000');

    // Công nợ đối ứng: SG thấy HN là khách nợ, HN thấy SG là nhà cung cấp — tách biệt theo chi nhánh
    const [hnAsCustomer] = await db
      .select()
      .from(customers)
      .where(eq(customers.linkedBranchId, hn));
    const [sgAsSupplier] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.linkedBranchId, sg));
    const ledger = await ledgerOf(t.id);
    expect(ledger).toHaveLength(2);
    const inSg = ledger.find((l) => l.branchId === sg)!;
    const inHn = ledger.find((l) => l.branchId === hn)!;
    expect(inSg).toMatchObject({
      partyType: 'customer',
      partyId: hnAsCustomer!.id,
      amount: '61000',
      entryType: 'transfer',
      refCode: t.code,
    });
    expect(inHn).toMatchObject({
      partyType: 'supplier',
      partyId: sgAsSupplier!.id,
      amount: '61000',
      entryType: 'transfer',
    });

    const inMoves = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.refId, t.id),
          eq(stockMovements.refType, 'transfer_in'),
        ),
      );
    expect(inMoves).toHaveLength(2);
    expect(inMoves.every((m) => m.branchId === hn)).toBe(true);
  });

  it('bên nhận ứng tiền trả xe: giá vốn vẫn gồm phí nhưng công nợ chỉ gồm tiền hàng', async () => {
    const a = await product([sg, '10', '1000']);
    const t = await svc.create({
      fromBranchId: sg,
      toBranchId: hn,
      items: [{ productId: a, qty: '10' }],
      shippingFee: '500',
      shippingPaidBy: 'receiver',
    });
    const r = await svc.receive(t.id);
    expect(r.debtAmount).toBe('10000');
    expect(r.items[0]?.unitCostReceived).toBe('1050.0000'); // 1000 + 500/10
    expect((await stockOf(hn, a))?.costPrice).toBe('1050.0000');
    expect((await ledgerOf(t.id)).every((l) => l.amount === '10000')).toBe(
      true,
    );
  });

  it('không phí vận chuyển: giá nhập = giá vốn gửi', async () => {
    const a = await product([sg, '5', '777.5']);
    const t = await svc.create({
      fromBranchId: sg,
      toBranchId: hn,
      items: [{ productId: a, qty: '5' }],
    });
    expect(t.shippingFee).toBe('0');
    expect(t.items[0]?.shippingShare).toBe('0');
    const r = await svc.receive(t.id);
    expect(r.items[0]?.unitCostReceived).toBe('777.5000');
    expect(r.debtAmount).toBe('3888'); // 5 × 777,5 = 3887,5 → làm tròn
  });

  it('hàng chưa có giá vốn (0): phí vẫn được phân bổ (chia đều) và công nợ chỉ có phí', async () => {
    const a = await product([sg, '4', '0']);
    const b = await product([sg, '6', '0']);
    const t = await svc.create({
      fromBranchId: sg,
      toBranchId: hn,
      items: [
        { productId: a, qty: '4' },
        { productId: b, qty: '6' },
      ],
      shippingFee: '101',
    });
    expect(t.items.map((i) => i.shippingShare).sort()).toEqual(['50', '51']);
    const r = await svc.receive(t.id);
    expect(r.debtAmount).toBe('101');
  });

  it('thiếu tồn: báo STOCK_NOT_ENOUGH, hoàn tác toàn bộ, không tốn mã phiếu', async () => {
    const a = await product([sg, '5', '1000']);
    const b = await product([sg, '1', '1000']);
    const before = await nextCh();
    await expect(
      svc.create({
        fromBranchId: sg,
        toBranchId: hn,
        items: [
          { productId: a, qty: '5' },
          { productId: b, qty: '2' },
        ],
      }),
    ).rejects.toMatchObject({ status: 422, code: 'STOCK_NOT_ENOUGH' });
    expect((await stockOf(sg, a))?.onHand).toBe('5.000'); // dòng đầu cũng được hoàn tác
    expect(await nextCh()).toBe(before);
  });

  it('không nhận hai lần, không nhận phiếu đã hủy, không hủy phiếu đã nhận', async () => {
    const a = await product([sg, '20', '100']);
    const t1 = await svc.create({
      fromBranchId: sg,
      toBranchId: hn,
      items: [{ productId: a, qty: '5' }],
    });
    await svc.receive(t1.id);
    await expect(svc.receive(t1.id)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_STATE',
    });
    await expect(svc.cancel(t1.id, 'nhầm')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    // không ghi công nợ lần hai
    expect(await ledgerOf(t1.id)).toHaveLength(2);

    const t2 = await svc.create({
      fromBranchId: sg,
      toBranchId: hn,
      items: [{ productId: a, qty: '5' }],
    });
    await svc.cancel(t2.id, 'gửi nhầm chi nhánh');
    await expect(svc.receive(t2.id)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('hủy khi đang đi đường: trả hàng về kho bên gửi đúng giá vốn lúc gửi, không công nợ', async () => {
    const a = await product([sg, '60', '1000']);
    const t = await svc.create({
      fromBranchId: sg,
      toBranchId: hn,
      items: [{ productId: a, qty: '10' }],
      shippingFee: '300',
    });
    expect((await stockOf(sg, a))?.onHand).toBe('50.000');
    const c = await svc.cancel(t.id, '  gửi nhầm  ');
    expect(c).toMatchObject({ status: 'cancelled', cancelReason: 'gửi nhầm' });
    expect(await stockOf(sg, a)).toMatchObject({
      onHand: '60.000',
      costPrice: '1000.0000',
    });
    expect(await stockOf(hn, a)).toBeUndefined();
    expect(await ledgerOf(t.id)).toHaveLength(0);
    const moves = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.refId, t.id),
          eq(stockMovements.refType, 'transfer_cancel'),
        ),
      );
    expect(moves).toHaveLength(1);
  });

  it('hủy phải có lý do', async () => {
    const a = await product([sg, '5', '1']);
    const t = await svc.create({
      fromBranchId: sg,
      toBranchId: hn,
      items: [{ productId: a, qty: '1' }],
    });
    await expect(svc.cancel(t.id, '   ')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect((await svc.getById(t.id)).status).toBe('in_transit');
  });

  it('chuyển ngược chiều (HN → SG) dùng đúng đối tác nội bộ của chiều đó', async () => {
    const a = await product([hn, '10', '500']);
    const t = await svc.create({
      fromBranchId: hn,
      toBranchId: sg,
      items: [{ productId: a, qty: '10' }],
    });
    await svc.receive(t.id);
    const [sgAsCustomer] = await db
      .select()
      .from(customers)
      .where(eq(customers.linkedBranchId, sg));
    const [hnAsSupplier] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.linkedBranchId, hn));
    const ledger = await ledgerOf(t.id);
    expect(ledger.find((l) => l.branchId === hn)).toMatchObject({
      partyType: 'customer',
      partyId: sgAsCustomer!.id,
    });
    expect(ledger.find((l) => l.branchId === sg)).toMatchObject({
      partyType: 'supplier',
      partyId: hnAsSupplier!.id,
    });
  });

  it('kiểm tra đầu vào', async () => {
    const a = await product([sg, '10', '10']);
    const base = {
      fromBranchId: sg,
      toBranchId: hn,
      items: [{ productId: a, qty: '1' }],
    };
    const code = (p: Promise<unknown>) =>
      expect(p).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await code(svc.create({ ...base, toBranchId: sg }));
    await code(svc.create({ ...base, items: [] }));
    await code(
      svc.create({
        ...base,
        items: [
          { productId: a, qty: '1' },
          { productId: a, qty: '2' },
        ],
      }),
    );
    await code(svc.create({ ...base, items: [{ productId: a, qty: '0' }] }));
    await code(svc.create({ ...base, items: [{ productId: a, qty: '-1' }] }));
    await code(svc.create({ ...base, items: [{ productId: a, qty: 'abc' }] }));
    await code(
      svc.create({ ...base, items: [{ productId: a, qty: '1.2345' }] }),
    );
    await code(svc.create({ ...base, shippingFee: '12.5' }));
    await code(svc.create({ ...base, shippingFee: '-5' }));
    await expect(
      svc.create({
        ...base,
        items: [
          { productId: '00000000-0000-4000-8000-000000000000', qty: '1' },
        ],
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    await expect(
      svc.create({
        ...base,
        toBranchId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await stockOf(sg, a))?.onHand).toBe('10.000'); // không phiếu nào làm đổi tồn
  });

  it('danh sách lọc theo chi nhánh và trạng thái', async () => {
    const a = await product([sg, '100', '10'], [hn, '100', '10']);
    const t1 = await svc.create({
      fromBranchId: sg,
      toBranchId: hn,
      items: [{ productId: a, qty: '1' }],
    });
    const t2 = await svc.create({
      fromBranchId: hn,
      toBranchId: sg,
      items: [{ productId: a, qty: '1' }],
    });
    await svc.receive(t2.id);

    const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
    expect(ids(await svc.list({ branchIds: [] }))).toEqual([]);
    expect(ids(await svc.list({ branchIds: [sg] }))).toEqual(
      expect.arrayContaining([t1.id, t2.id]),
    );
    expect(
      ids(await svc.list({ branchIds: [hn], status: 'in_transit' })),
    ).toContain(t1.id);
    expect(
      ids(await svc.list({ branchIds: [hn], status: 'in_transit' })),
    ).not.toContain(t2.id);
    expect(ids(await svc.list({ status: 'received' }))).toContain(t2.id);
    const all = await db.select().from(stockTransfers);
    expect((await svc.list()).length).toBe(all.length);
  });
});
