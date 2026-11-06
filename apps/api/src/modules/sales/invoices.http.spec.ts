import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeHeader, readSheet } from '../../common/excel.js';
import {
  cashAccounts,
  cashTransactions,
  customerBranchTerms,
  customers,
  debtLedger,
  invoices,
  products,
  salesReturns,
  stocks,
} from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { SalesModule } from './sales.module.js';

type Api = Awaited<
  ReturnType<Awaited<ReturnType<typeof createHttpTestApp>>['as']>
>;
const bin = (
  r: { on: (e: string, cb: (x: Buffer) => void) => void },
  cb: (e: null, b: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

/**
 * Hóa đơn bán. Hàng A tồn 100 (giá vốn 1.000) và B tồn 5 (giá vốn 500) ở Sài Gòn. Khách K1 có hạn mức 100.000 tại SG,
 * K2 không giới hạn. Quỹ: tiền mặt và ngân hàng của từng chi nhánh (do seed tạo).
 */
describe('Hóa đơn qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  const pid: Record<string, string> = {};
  const cid: Record<string, string> = {};
  let cashSg: string;
  let bankSg: string;
  let cashHn: string;
  let sale1: string;

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [IdempotencyModule, SalesModule] });
    sale1 = (await t.makeUser('sale1', 'sales', [t.sg])).id;
    await t.makeUser('sale2', 'sales', [t.sg]);
    await t.makeUser('tro1', 'assistant', [t.sg, t.hn]);
    await t.makeUser('ketoan1', 'accountant', [t.sg, t.hn]);
    const rows = await t.db
      .insert(products)
      .values([
        { code: 'A', name: 'Hàng A' },
        { code: 'B', name: 'Hàng B' },
      ])
      .returning();
    for (const r of rows) pid[r.code] = r.id;
    const inv = new InventoryService(t.db);
    await t.db.transaction((tx) =>
      inv.applyMovements(tx, [
        { branchId: t.sg, productId: pid.A!, qtyDelta: '100', unitCost: '1000', refType: 'opening' },
        { branchId: t.sg, productId: pid.B!, qtyDelta: '5', unitCost: '500', refType: 'opening' },
      ]),
    );
    const cs = await t.db
      .insert(customers)
      .values([
        { code: 'K1', name: 'Khách Một' },
        { code: 'K2', name: 'Khách Hai' },
      ])
      .returning();
    for (const c of cs) cid[c.code] = c.id;
    await t.db
      .insert(customerBranchTerms)
      .values({ customerId: cid.K1!, branchId: t.sg, creditLimit: '100000' });
    const accs = await t.db.select().from(cashAccounts);
    const find = (branchId: string, type: 'cash' | 'bank') =>
      accs.find((a) => a.branchId === branchId && a.type === type)!.id;
    cashSg = find(t.sg, 'cash');
    bankSg = find(t.sg, 'bank');
    cashHn = find(t.hn, 'cash');
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  const as = (user: string, branch: string = t.sg): Promise<Api> =>
    t.as(user, branch) as Promise<Api>;
  const idem = async (
    user: string,
    url: string,
    body: Record<string, unknown>,
    key: string | null = randomUUID(),
    branch: string = t.sg,
  ) => {
    const req = (await as(user, branch)).post(url).send(body);
    if (key) req.set('Idempotency-Key', key);
    return req;
  };
  const line = (code: string, qty: string, price: string, discountPerUnit?: string) => ({
    productId: pid[code]!,
    qty,
    price,
    ...(discountPerUnit ? { discountPerUnit } : {}),
  });
  const onHand = async (code: string) =>
    Number(
      (
        await t.db
          .select({ v: stocks.onHand })
          .from(stocks)
          .where(and(eq(stocks.branchId, t.sg), eq(stocks.productId, pid[code]!)))
      )[0]?.v ?? 0,
    );
  const debtOf = async (customer: string, branch: string = t.sg) =>
    Number(
      (
        await t.db
          .select({ v: sql<string>`coalesce(sum(${debtLedger.amount}), 0)` })
          .from(debtLedger)
          .where(
            and(
              eq(debtLedger.partyType, 'customer'),
              eq(debtLedger.partyId, cid[customer]!),
              eq(debtLedger.branchId, branch),
            ),
          )
      )[0]!.v,
    );
  const counts = async () => ({
    invoices: (await t.db.select().from(invoices)).length,
    cash: (await t.db.select().from(cashTransactions)).length,
    debt: (await t.db.select().from(debtLedger)).length,
  });

  it('tạo hóa đơn trực tiếp: trừ kho theo giá vốn, ghi nợ, ghi phiếu thu tiền mặt + chuyển khoản; tiền đúng', async () => {
    const res = await idem('tro1', '/invoices', {
      customerId: cid.K2,
      discount: '1000',
      note: 'bán lẻ',
      items: [line('A', '10', '13100', '500'), line('A', '5', '13100')],
      payments: [
        { method: 'cash', accountId: cashSg, amount: '100000' },
        { method: 'bank', accountId: bankSg, amount: '50000' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inv = res.body;
    expect(inv).toMatchObject({
      status: 'completed',
      customer: { code: 'K2' },
      subtotal: '191500', // 10×12.600 + 5×13.100
      discount: '1000',
      total: '190500',
      paid: '150000',
      debt: '40500',
      totalQty: '15.000',
      itemCount: 2,
      note: 'bán lẻ',
      order: null,
    });
    expect(inv.code).toMatch(/^HD\d{6}$/);
    expect(inv.payments.map((p: { method: string; amount: string }) => [p.method, p.amount])).toEqual([
      ['cash', '100000'],
      ['bank', '50000'],
    ]);
    expect(inv.payments[0].cashCode).toMatch(/^TT\d{6}$/);
    // Quản lý (có product.cost.view) thấy giá vốn lúc bán và lãi gộp: 190.500 − 15 × 1.000
    const detail = (await (await as('quanly')).get(`/invoices/${inv.id}`).expect(200)).body;
    expect(detail.items.map((i: { unitCost: string }) => i.unitCost)).toEqual(['1000.0000', '1000.0000']);
    expect(detail.grossProfit).toBe('175500');
    // kho, nợ, quỹ
    expect(await onHand('A')).toBe(85);
    expect(await debtOf('K2')).toBe(40500);
    const cash = await t.db.select().from(cashTransactions).where(eq(cashTransactions.refId, inv.id));
    expect(cash).toHaveLength(2);
    expect(cash.every((c) => c.direction === 'in' && c.status === 'completed' && c.partyId === cid.K2)).toBe(true);
  });

  it('người không có product.cost.view không thấy giá vốn và lãi gộp', async () => {
    const list = (await (await as('tro1')).get('/invoices?limit=100').expect(200)).body;
    const id = list.data[0].id;
    const d = (await (await as('tro1')).get(`/invoices/${id}`).expect(200)).body;
    for (const it of d.items) expect(it).not.toHaveProperty('unitCost');
    expect(d).not.toHaveProperty('grossProfit');
  });

  it('thiếu tồn thực tế → 422 STOCK_NOT_ENOUGH và KHÔNG ghi gì (kho, nợ, quỹ, hóa đơn)', async () => {
    const before = await counts();
    const res = await idem('tro1', '/invoices', {
      customerId: cid.K2,
      items: [line('A', '1', '13000'), line('B', '6', '2000')],
      payments: [{ method: 'cash', accountId: cashSg, amount: '1000' }],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('STOCK_NOT_ENOUGH');
    expect(await counts()).toEqual(before);
    expect(await onHand('A')).toBe(85);
    expect(await onHand('B')).toBe(5);
  });

  it('kiểm tra thanh toán: vượt khách cần trả, quỹ chi nhánh khác, sai loại quỹ, quỹ không tồn tại, số tiền 0/lẻ → 400 và không ghi gì', async () => {
    const before = await counts();
    const base = { customerId: cid.K2, items: [line('A', '1', '13000')] };
    const bad = async (payments: unknown[]) => {
      const r = await idem('tro1', '/invoices', { ...base, payments });
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      return r.body;
    };
    await bad([{ method: 'cash', accountId: cashSg, amount: '13001' }]);
    await bad([{ method: 'cash', accountId: cashHn, amount: '1000' }]);
    await bad([{ method: 'bank', accountId: cashSg, amount: '1000' }]);
    await bad([{ method: 'cash', accountId: randomUUID(), amount: '1000' }]);
    await bad([{ method: 'cash', accountId: cashSg, amount: '0' }]);
    await bad([{ method: 'cash', accountId: cashSg, amount: '10.5' }]);
    expect(await counts()).toEqual(before);
  });

  it('kiểm tra dữ liệu: khách ngưng/nội bộ, combo/hàng ngưng, gửi tiền tự tính, thiếu Idempotency-Key', async () => {
    const internal = (await t.db.select().from(customers).where(eq(customers.code, 'CN-HN')))[0]!;
    expect((await idem('tro1', '/invoices', { customerId: internal.id, items: [line('A', '1', '1000')] })).status).toBe(404);
    expect((await idem('tro1', '/invoices', { customerId: cid.K2, total: '1', items: [line('A', '1', '1000')] })).status).toBe(400);
    expect((await idem('tro1', '/invoices', { customerId: cid.K2, items: [line('A', '1', '1000', '2000')] })).status).toBe(400);
    expect((await idem('tro1', '/invoices', { customerId: cid.K2, items: [line('A', '1', '1000')] }, null)).status).toBe(400);
  });

  it('Idempotency-Key: gửi lại cùng khóa không trừ kho/ghi nợ lần nữa', async () => {
    const key = randomUUID();
    const body = { customerId: cid.K2, items: [line('A', '2', '13000')] };
    const a = (await idem('tro1', '/invoices', body, key)).body;
    const stockAfterFirst = await onHand('A');
    const b = await idem('tro1', '/invoices', body, key);
    expect(b.body.id).toBe(a.id);
    expect(await onHand('A')).toBe(stockAfterFirst);
  });

  it('cảnh báo mềm: vượt hạn mức và vượt "có thể bán" (hàng đang giữ cho phiếu tạm) vẫn lập được hóa đơn', async () => {
    // K1 hạn mức 100.000: hóa đơn 150.000 ghi nợ toàn bộ → vượt
    const over = await idem('tro1', '/invoices', { customerId: cid.K1, items: [line('A', '10', '15000')] });
    expect(over.status).toBe(201);
    expect(over.body.warnings.map((w: { code: string }) => w.code)).toEqual(['CREDIT_LIMIT_EXCEEDED']);
    expect(over.body.warnings[0]).toMatchObject({ creditLimit: '100000', balanceAfter: '150000' });
    // phiếu tạm giữ gần hết A, rồi bán thẳng 10 (tồn thực tế còn đủ) → cảnh báo STOCK_RESERVED
    const have = await onHand('A');
    const draft = await idem('tro1', '/orders', { customerId: cid.K2, items: [line('A', String(have - 5), '1000')] });
    expect(draft.status).toBe(201);
    const res = await idem('tro1', '/invoices', { customerId: cid.K2, items: [line('A', '10', '13000')] });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0]).toMatchObject({ code: 'STOCK_RESERVED', productCode: 'A', available: '5.000' });
    await (await as('tro1')).post(`/orders/${draft.body.id}/cancel`).send({}).expect(200);
  });

  it('xuất hóa đơn từ phiếu tạm: lấy đúng dòng/giảm giá; phiếu → hoàn thành; xuất lần hai → 422; hủy → phiếu về phiếu tạm và xuất lại được', async () => {
    const order = (
      await idem('tro1', '/orders', {
        customerId: cid.K2,
        sellerId: sale1,
        discount: '500',
        items: [line('A', '4', '13100', '100'), line('A', '1', '13100'), line('B', '2', '2000')],
      })
    ).body;
    expect(order.total).toBe('68600'); // 4×13.000 + 13.100 + 2×2.000 − 500
    const stockBefore = await onHand('A');
    const debtBefore = await debtOf('K2');
    const res = await idem('tro1', `/orders/${order.id}/invoice`, {
      payments: [{ method: 'cash', accountId: cashSg, amount: '9100' }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inv = res.body;
    expect(inv).toMatchObject({
      order: { id: order.id, code: order.code },
      seller: { id: sale1 },
      total: '68600',
      paid: '9100',
      debt: '59500',
      itemCount: 3,
    });
    expect(inv.items.map((i: { qty: string; unitPrice: string }) => [i.qty, i.unitPrice])).toEqual([
      ['4.000', '13000'],
      ['1.000', '13100'],
      ['2.000', '2000'],
    ]);
    const after = (await (await as('tro1')).get(`/orders/${order.id}`).expect(200)).body;
    expect(after.status).toBe('completed');
    expect(after.invoice).toMatchObject({ id: inv.id, code: inv.code });
    expect(await onHand('A')).toBe(stockBefore - 5);
    expect(await debtOf('K2')).toBe(debtBefore + 59500);
    // xuất lần hai (khóa khác) và sửa phiếu đã hoàn thành → 422
    expect((await idem('tro1', `/orders/${order.id}/invoice`, {})).status).toBe(422);
    expect((await (await as('tro1')).patch(`/orders/${order.id}`).send({ customerId: cid.K2, items: [line('A', '1', '1')] })).status).toBe(422);

    // Hủy: kho, nợ đảo; phiếu thu hủy; phiếu quay về phiếu tạm
    const cancel = await (await as('ketoan1')).post(`/invoices/${inv.id}/cancel`).send({ reason: 'nhập nhầm' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(cancel.body).toMatchObject({ status: 'cancelled', cancelReason: 'nhập nhầm' });
    expect(await onHand('A')).toBe(stockBefore);
    expect(await debtOf('K2')).toBe(debtBefore);
    const cash = await t.db.select().from(cashTransactions).where(eq(cashTransactions.refId, inv.id));
    expect(cash.map((c) => c.status)).toEqual(['cancelled']);
    const reopened = (await (await as('tro1')).get(`/orders/${order.id}`).expect(200)).body;
    expect(reopened.status).toBe('draft');
    expect(reopened.invoice).toBeNull();
    const again = await idem('tro1', `/orders/${order.id}/invoice`, {});
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.order.id).toBe(order.id);
    expect(await onHand('A')).toBe(stockBefore - 5);
  });

  it('hủy hóa đơn: bắt buộc lý do; chỉ người có invoice.cancel; hủy hai lần → 422; còn phiếu trả hàng → 409', async () => {
    const inv = (await idem('tro1', '/invoices', { customerId: cid.K2, items: [line('A', '1', '13000')] })).body;
    expect((await (await as('ketoan1')).post(`/invoices/${inv.id}/cancel`).send({})).status).toBe(400);
    expect((await (await as('tro1')).post(`/invoices/${inv.id}/cancel`).send({ reason: 'x' })).status).toBe(403);
    // giả lập phiếu trả hàng đã hoàn tất gắn hóa đơn (API trả hàng làm ở lát sau)
    const [ret] = await t.db
      .insert(salesReturns)
      .values({ code: 'TH-T1', branchId: t.sg, customerId: cid.K2, invoiceId: inv.id, returnedAt: new Date(), total: '1000' })
      .returning();
    const blocked = await (await as('ketoan1')).post(`/invoices/${inv.id}/cancel`).send({ reason: 'x' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('INVALID_STATE');
    await t.db.update(salesReturns).set({ status: 'cancelled' }).where(eq(salesReturns.id, ret!.id));
    const stockBefore = await onHand('A');
    await (await as('ketoan1')).post(`/invoices/${inv.id}/cancel`).send({ reason: 'ok' }).expect(200);
    expect(await onHand('A')).toBe(stockBefore + 1);
    expect((await (await as('ketoan1')).post(`/invoices/${inv.id}/cancel`).send({ reason: 'lại' })).status).toBe(422);
  });

  it('phạm vi "chỉ của mình": Sale chỉ thấy hóa đơn mình bán, không lập hộ người khác, không xuất hóa đơn cho phiếu của người khác', async () => {
    const mine = (await idem('sale1', '/invoices', { customerId: cid.K2, items: [line('A', '1', '13000')] })).body;
    expect(mine.seller.id).toBe(sale1);
    await (await as('sale2')).get(`/invoices/${mine.id}`).expect(404);
    const list2 = (await (await as('sale2')).get('/invoices?limit=100').expect(200)).body;
    expect(list2.data).toEqual([]);
    const list1 = (await (await as('sale1')).get('/invoices?limit=100').expect(200)).body;
    expect(list1.data.every((i: { seller: { id: string } }) => i.seller.id === sale1)).toBe(true);
    expect((await (await as('sale2')).patch(`/invoices/${mine.id}`).send({ note: 'x' })).status).toBe(403);
    expect((await idem('sale1', '/invoices', { customerId: cid.K2, sellerId: (await t.userId('sale2')), items: [line('A', '1', '13000')] })).status).toBe(403);
    const order = (await idem('tro1', '/orders', { customerId: cid.K2, sellerId: await t.userId('sale2'), items: [line('A', '1', '13000')] })).body;
    expect((await idem('sale1', `/orders/${order.id}/invoice`, {})).status).toBe(403);
    expect((await idem('tro1', `/orders/${order.id}/invoice`, {})).status).toBe(201);
  });

  it('chi nhánh khác không thấy hóa đơn; sửa ghi chú; lọc còn nợ và tìm không dấu; xuất Excel đúng tiêu đề file KiotViet', async () => {
    const inv = (await idem('tro1', '/invoices', { customerId: cid.K2, note: 'a', items: [line('B', '1', '2000')] })).body;
    await (await as('tro1', t.hn)).get(`/invoices/${inv.id}`).expect(404);
    const upd = await (await as('tro1')).patch(`/invoices/${inv.id}`).send({ note: 'đã sửa' }).expect(200);
    expect(upd.body.note).toBe('đã sửa');
    const api = await as('tro1');
    const debtors = (await api.get('/invoices?hasDebt=true&limit=100').expect(200)).body;
    expect(debtors.data.length).toBeGreaterThan(0);
    expect(debtors.data.every((i: { debt: string; status: string }) => Number(i.debt) > 0 && i.status === 'completed')).toBe(true);
    const paidFull = (await idem('tro1', '/invoices', { customerId: cid.K2, items: [line('B', '1', '2000')], payments: [{ method: 'cash', accountId: cashSg, amount: '2000' }] })).body;
    const none = (await api.get('/invoices?hasDebt=false&limit=100').expect(200)).body;
    expect(none.data.map((i: { id: string }) => i.id)).toContain(paidFull.id);
    expect((await api.get('/invoices?q=khach hai&limit=100').expect(200)).body.data.length).toBeGreaterThan(0);
    const res = await api.get('/invoices?format=xlsx').buffer().parse(bin as never).expect(200);
    const sheet = await readSheet(res.body as Buffer);
    expect(sheet.headers.slice(0, 3)).toEqual(['Chi nhánh', 'Mã hóa đơn', 'Thời gian'].map(normalizeHeader));
    expect(sheet.headers).toContain(normalizeHeader('Khách đã trả'));
    expect(sheet.rows.length).toBeGreaterThan(0);
  });

  it('quyền: Kế toán (không invoice.create) không lập hóa đơn; đối soát sổ cái khớp, mỗi hóa đơn hoàn tất nợ = cần trả − đã thu', async () => {
    expect((await idem('ketoan1', '/invoices', { customerId: cid.K2, items: [line('B', '1', '2000')] })).status).toBe(403);
    expect((await new ReconciliationService().run(t.db)).ok).toBe(true);
    const completed = await t.db.select().from(invoices).where(eq(invoices.status, 'completed'));
    const expected = completed
      .filter((i) => i.customerId === cid.K2)
      .reduce((s, i) => s + Number(i.total) - Number(i.paidTotal), 0);
    expect(await debtOf('K2')).toBe(expected);
  });
});
