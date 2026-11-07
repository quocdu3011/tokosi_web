import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeHeader, readSheet } from '../../common/excel.js';
import {
  cashAccounts,
  customers,
  debtLedger,
  products,
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
 * Trả hàng bán. Sài Gòn: A tồn 100 (giá vốn 1.000), B tồn 50 (500), C tồn 3 (300). Khách K1/K2.
 * Hóa đơn gốc (tro1, K2): A 10 + A 5 (hai dòng cùng mặt hàng) giá 13.000 và B 4 giá 2.000 = 203.000, thu tiền mặt 20.000.
 */
describe('Trả hàng bán qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  const pid: Record<string, string> = {};
  const cid: Record<string, string> = {};
  let cashSg: string;
  let sale1: string;
  let invoiceId: string;

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [IdempotencyModule, SalesModule] });
    sale1 = (await t.makeUser('sale1', 'sales', [t.sg])).id;
    await t.makeUser('tro1', 'assistant', [t.sg, t.hn]);
    await t.makeUser('ketoan1', 'accountant', [t.sg, t.hn]);
    const rows = await t.db
      .insert(products)
      .values([
        { code: 'A', name: 'Hàng A' },
        { code: 'B', name: 'Hàng B' },
        { code: 'C', name: 'Hàng C' },
      ])
      .returning();
    for (const r of rows) pid[r.code] = r.id;
    const inv = new InventoryService(t.db);
    await t.db.transaction((tx) =>
      inv.applyMovements(tx, [
        { branchId: t.sg, productId: pid.A!, qtyDelta: '100', unitCost: '1000', refType: 'opening' },
        { branchId: t.sg, productId: pid.B!, qtyDelta: '50', unitCost: '500', refType: 'opening' },
        { branchId: t.sg, productId: pid.C!, qtyDelta: '3', unitCost: '300', refType: 'opening' },
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
    cashSg = (await t.db.select().from(cashAccounts)).find(
      (a) => a.branchId === t.sg && a.type === 'cash',
    )!.id;
    invoiceId = (
      await idem('tro1', '/invoices', {
        customerId: cid.K2,
        items: [line('A', '10', '13000'), line('A', '5', '13000'), line('B', '4', '2000')],
        payments: [{ method: 'cash', accountId: cashSg, amount: '20000' }],
      })
    ).body.id;
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
  const line = (code: string, qty: string, price: string) => ({
    productId: pid[code]!,
    qty,
    price,
  });
  const ret = (code: string, qty: string, returnPrice: string, extra: Record<string, unknown> = {}) => ({
    productId: pid[code]!,
    qty,
    returnPrice,
    ...extra,
  });
  const stockRow = async (code: string) =>
    (
      await t.db
        .select()
        .from(stocks)
        .where(and(eq(stocks.branchId, t.sg), eq(stocks.productId, pid[code]!)))
    )[0]!;
  const onHand = async (code: string) => Number((await stockRow(code)).onHand);
  const debtOf = async (customer: string) =>
    Number(
      (
        await t.db
          .select({ v: sql<string>`coalesce(sum(${debtLedger.amount}), 0)` })
          .from(debtLedger)
          .where(
            and(
              eq(debtLedger.partyType, 'customer'),
              eq(debtLedger.partyId, cid[customer]!),
              eq(debtLedger.branchId, t.sg),
            ),
          )
      )[0]!.v,
    );
  let firstReturn: { id: string; code: string };

  it('trả theo hóa đơn: nhập lại kho KHÔNG đổi giá vốn, dòng không nhập kho không đổi tồn, nợ giảm đúng tổng; lãi gộp chỉ cho người có quyền xem giá vốn', async () => {
    expect(await onHand('A')).toBe(85);
    expect(await debtOf('K2')).toBe(183000);
    const costBefore = (await stockRow('A')).costPrice;
    const res = await idem('tro1', '/sales-returns', {
      customerId: cid.K2,
      invoiceId,
      note: 'khách trả bớt',
      items: [
        ret('A', '6', '13000', { restockPrice: '12000', note: 'lô nhỏ' }),
        ret('B', '2', '2000', { restock: false }),
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    firstReturn = res.body;
    expect(res.body).toMatchObject({
      status: 'completed',
      customer: { code: 'K2' },
      invoice: { id: invoiceId },
      total: '82000', // 6 × 13.000 + 2 × 2.000
      totalQty: '8.000',
      itemCount: 2,
      note: 'khách trả bớt',
    });
    expect(res.body.code).toMatch(/^TH\d{6}$/);
    expect(res.body.items).toMatchObject([
      { code: 'A', qty: '6.000', returnPrice: '13000', restockPrice: '12000', restock: true, lineTotal: '78000', note: 'lô nhỏ' },
      { code: 'B', qty: '2.000', returnPrice: '2000', restockPrice: null, restock: false, lineTotal: '4000' },
    ]);
    expect(res.body).not.toHaveProperty('priceDifference'); // Trợ lý không có product.cost.view
    expect(await onHand('A')).toBe(91);
    expect(await onHand('B')).toBe(46); // không nhập kho
    expect((await stockRow('A')).costPrice).toBe(costBefore); // giá vốn bình quân giữ nguyên
    expect(await debtOf('K2')).toBe(101000);
    const detail = (await (await as('quanly')).get(`/sales-returns/${res.body.id}`).expect(200)).body;
    expect(detail.priceDifference).toBe('6000'); // (13.000 − 12.000) × 6, chỉ dòng nhập kho
  });

  it('trả vượt số đã bán của hóa đơn (cộng các dòng cùng mặt hàng, trừ phần đã trả) hoặc hàng không có trong hóa đơn → 422 RETURN_QTY_EXCEEDED, không ghi gì', async () => {
    const before = { a: await onHand('A'), debt: await debtOf('K2') };
    const res = await idem('tro1', '/sales-returns', {
      customerId: cid.K2,
      invoiceId,
      items: [ret('A', '10', '13000'), ret('B', '1', '2000'), ret('C', '1', '300')],
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RETURN_QTY_EXCEEDED');
    expect(res.body.details.map((d: { field: string }) => d.field)).toEqual(['items.0.qty', 'items.2.qty']);
    expect(await onHand('A')).toBe(before.a);
    expect(await debtOf('K2')).toBe(before.debt);
    // đúng phần còn lại (A 9) thì được
    expect((await idem('tro1', '/sales-returns', { customerId: cid.K2, invoiceId, items: [ret('A', '9', '13000')] })).status).toBe(201);
    expect((await idem('tro1', '/sales-returns', { customerId: cid.K2, invoiceId, items: [ret('A', '0.001', '13000')] })).status).toBe(422);
  });

  it('trả không tham chiếu hóa đơn được; hóa đơn khác khách → 400; hóa đơn chi nhánh khác → 404', async () => {
    const debtBefore = await debtOf('K1');
    const stockBefore = await onHand('A');
    const free = await idem('tro1', '/sales-returns', { customerId: cid.K1, items: [ret('A', '2', '13000')] });
    expect(free.status).toBe(201);
    expect(free.body.invoice).toBeNull();
    expect(await onHand('A')).toBe(stockBefore + 2);
    expect(await debtOf('K1')).toBe(debtBefore - 26000);
    expect((await idem('tro1', '/sales-returns', { customerId: cid.K1, invoiceId, items: [ret('B', '1', '2000')] })).status).toBe(400);
    expect((await idem('tro1', '/sales-returns', { customerId: cid.K2, invoiceId, items: [ret('B', '1', '2000')] }, randomUUID(), t.hn)).status).toBe(404);
  });

  it('kiểm tra dữ liệu: giá lẻ, số lượng 0, giá nhập lại sai, gửi tổng tự tính, không có dòng, thiếu Idempotency-Key, khách nội bộ', async () => {
    const bad = async (items: unknown[], extra: Record<string, unknown> = {}, status = 400) => {
      const r = await idem('tro1', '/sales-returns', { customerId: cid.K1, items, ...extra });
      expect(r.status, JSON.stringify(r.body)).toBe(status);
    };
    await bad([ret('A', '1', '1000.5')]);
    await bad([ret('A', '0', '1000')]);
    await bad([ret('A', '1', '1000', { restockPrice: '-1' })]);
    await bad([ret('A', '1', '1000')], { total: '1' });
    await bad([]);
    const internal = (await t.db.select().from(customers).where(eq(customers.code, 'CN-HN')))[0]!;
    await bad([ret('A', '1', '1000')], { customerId: internal.id }, 404);
    expect((await idem('tro1', '/sales-returns', { customerId: cid.K1, items: [ret('A', '1', '1000')] }, null)).status).toBe(400);
  });

  it('Idempotency-Key: gửi lại cùng khóa không nhập kho/giảm nợ lần nữa', async () => {
    const key = randomUUID();
    const body = { customerId: cid.K1, items: [ret('B', '1', '2000')] };
    const a = (await idem('tro1', '/sales-returns', body, key)).body;
    const stockAfter = await onHand('B');
    const b = await idem('tro1', '/sales-returns', body, key);
    expect(b.body.id).toBe(a.id);
    expect(await onHand('B')).toBe(stockAfter);
  });

  it('phạm vi "chỉ của mình": Sale chỉ trả cho hóa đơn mình bán, thấy phiếu trả của hóa đơn mình', async () => {
    const mineInv = (await idem('sale1', '/invoices', { customerId: cid.K1, items: [line('B', '3', '2000')] })).body;
    // không có hóa đơn / hóa đơn của người khác → 403
    expect((await idem('sale1', '/sales-returns', { customerId: cid.K1, items: [ret('B', '1', '2000')] })).status).toBe(403);
    expect((await idem('sale1', '/sales-returns', { customerId: cid.K2, invoiceId, items: [ret('B', '1', '2000')] })).status).toBe(403);
    const ok = await idem('sale1', '/sales-returns', { customerId: cid.K1, invoiceId: mineInv.id, items: [ret('B', '1', '2000')] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.seller.id).toBe(sale1);
    const mine = (await (await as('sale1')).get('/sales-returns?limit=100').expect(200)).body;
    expect(mine.data.map((r: { id: string }) => r.id)).toEqual([ok.body.id]);
    await (await as('sale1')).get(`/sales-returns/${firstReturn.id}`).expect(404);
    expect((await (await as('sale1')).patch(`/sales-returns/${firstReturn.id}`).send({ note: 'x' })).status).toBe(403);
    expect((await (await as('sale1')).patch(`/sales-returns/${ok.body.id}`).send({ note: 'ghi chú mới' })).status).toBe(200);
  });

  it('hủy phiếu trả: chỉ người có return.cancel; trừ lại tồn đã nhập, cộng lại nợ; hủy hai lần → 422; sau đó mới hủy được hóa đơn gốc', async () => {
    const inv = (await idem('tro1', '/invoices', { customerId: cid.K2, items: [line('A', '4', '13000')] })).body;
    const r = (await idem('tro1', '/sales-returns', { customerId: cid.K2, invoiceId: inv.id, items: [ret('A', '3', '13000')] })).body;
    const stock = await onHand('A');
    const debt = await debtOf('K2');
    expect((await (await as('tro1')).post(`/sales-returns/${r.id}/cancel`).send({ reason: 'x' })).status).toBe(403);
    // hóa đơn còn phiếu trả → không hủy được
    expect((await (await as('ketoan1')).post(`/invoices/${inv.id}/cancel`).send({ reason: 'x' })).status).toBe(409);
    const cancel = await (await as('ketoan1')).post(`/sales-returns/${r.id}/cancel`).send({ reason: 'nhầm' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(cancel.body).toMatchObject({ status: 'cancelled', cancelReason: 'nhầm' });
    expect(await onHand('A')).toBe(stock - 3);
    expect(await debtOf('K2')).toBe(debt + 39000);
    expect((await (await as('ketoan1')).post(`/sales-returns/${r.id}/cancel`).send({})).status).toBe(422);
    // phần đã hủy không còn tính là "đã trả": trả lại đủ 4 được
    expect((await idem('tro1', '/sales-returns', { customerId: cid.K2, invoiceId: inv.id, items: [ret('A', '4', '13000')] })).status).toBe(201);
  });

  it('hủy phiếu trả khi hàng đã nhập lại bị bán hết → 422 STOCK_NOT_ENOUGH và không đổi gì', async () => {
    const inv = (await idem('tro1', '/invoices', { customerId: cid.K2, items: [line('C', '3', '900')] })).body;
    expect(await onHand('C')).toBe(0);
    const r = (await idem('tro1', '/sales-returns', { customerId: cid.K2, invoiceId: inv.id, items: [ret('C', '3', '900')] })).body;
    expect(await onHand('C')).toBe(3);
    await idem('tro1', '/invoices', { customerId: cid.K1, items: [line('C', '3', '900')] }); // bán hết lại
    expect(await onHand('C')).toBe(0);
    const debt = await debtOf('K2');
    const res = await (await as('ketoan1')).post(`/sales-returns/${r.id}/cancel`).send({});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('STOCK_NOT_ENOUGH');
    expect(await onHand('C')).toBe(0);
    expect(await debtOf('K2')).toBe(debt);
    const still = (await (await as('ketoan1')).get(`/sales-returns/${r.id}`).expect(200)).body;
    expect(still.status).toBe('completed');
  });

  it('hóa đơn đã hủy → không trả hàng được; danh sách lọc theo hóa đơn/trạng thái; Excel đúng tiêu đề file KiotViet; chi nhánh khác không thấy', async () => {
    const inv = (await idem('tro1', '/invoices', { customerId: cid.K1, items: [line('B', '1', '2000')] })).body;
    await (await as('ketoan1')).post(`/invoices/${inv.id}/cancel`).send({ reason: 'x' }).expect(200);
    expect((await idem('tro1', '/sales-returns', { customerId: cid.K1, invoiceId: inv.id, items: [ret('B', '1', '2000')] })).status).toBe(422);
    const api = await as('tro1');
    const byInvoice = (await api.get(`/sales-returns?invoiceId=${invoiceId}&limit=100`).expect(200)).body;
    expect(byInvoice.data.length).toBe(2);
    expect(byInvoice.data.every((r: { invoice: { id: string } }) => r.invoice.id === invoiceId)).toBe(true);
    const cancelled = (await api.get('/sales-returns?status=cancelled&limit=100').expect(200)).body;
    expect(cancelled.data.length).toBeGreaterThan(0);
    expect((await api.get('/sales-returns?q=khach hai&limit=100').expect(200)).body.data.length).toBeGreaterThan(0);
    await (await as('tro1', t.hn)).get(`/sales-returns/${firstReturn.id}`).expect(404);
    const res = await api.get('/sales-returns?format=xlsx').buffer().parse(bin as never).expect(200);
    const sheet = await readSheet(res.body as Buffer);
    expect(sheet.headers.slice(0, 3)).toEqual(['Chi nhánh', 'Mã trả hàng', 'Thời gian'].map(normalizeHeader));
    expect(sheet.headers).toContain(normalizeHeader('Giá nhập lại'));
    expect(sheet.headers).toContain(normalizeHeader('Cần trả khách'));
    expect(sheet.rows.length).toBeGreaterThan(0);
  });

  it('đối soát sổ cái khớp; công nợ khách = hóa đơn hoàn tất − đã thu − phiếu trả hoàn tất', async () => {
    expect((await new ReconciliationService().run(t.db)).ok).toBe(true);
    const all = (await (await as('quanly')).get('/invoices?limit=100&customerId=' + cid.K2).expect(200)).body.data;
    const returns = (await (await as('quanly')).get('/sales-returns?limit=100&customerId=' + cid.K2).expect(200)).body.data;
    const owed = all
      .filter((i: { status: string }) => i.status === 'completed')
      .reduce((s: number, i: { total: string; paid: string }) => s + Number(i.total) - Number(i.paid), 0);
    const back = returns
      .filter((r: { status: string }) => r.status === 'completed')
      .reduce((s: number, r: { total: string }) => s + Number(r.total), 0);
    expect(await debtOf('K2')).toBe(owed - back);
  });

  it('giá trả không vượt giá bán thực (đã trừ giảm giá phiếu chia theo tỷ lệ) → 422 RETURN_PRICE_EXCEEDED, không ghi gì', async () => {
    const [k3] = await t.db.insert(customers).values({ code: 'K3', name: 'Khách Ba' }).returning();
    cid.K3 = k3!.id;
    // B 4 × 1.000 + A 2 × 3.000 = 10.000, giảm phiếu 1.000 → B thực 900/cái, A thực 2.700/cái
    const made = await idem('tro1', '/invoices', {
      customerId: cid.K3,
      discount: '1000',
      items: [line('B', '4', '1000'), line('A', '2', '3000')],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.total).toBe('9000');
    const debtBefore = await debtOf('K3');
    const stockBefore = await onHand('B');
    const bad = await idem('tro1', '/sales-returns', {
      customerId: cid.K3,
      invoiceId: made.body.id,
      items: [ret('B', '4', '1000'), ret('A', '2', '2700')],
    });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('RETURN_PRICE_EXCEEDED');
    expect(bad.body.details.map((d: { field: string }) => d.field)).toEqual(['items.0.returnPrice']);
    expect(await debtOf('K3')).toBe(debtBefore);
    expect(await onHand('B')).toBe(stockBefore);
    // trả đúng giá thực thì được, và nợ về đúng 0 (không âm)
    const ok = await idem('tro1', '/sales-returns', {
      customerId: cid.K3,
      invoiceId: made.body.id,
      items: [ret('B', '4', '900'), ret('A', '2', '2700')],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await debtOf('K3')).toBe(0);
    expect((await new ReconciliationService().run(t.db)).ok).toBe(true);
  });
});
