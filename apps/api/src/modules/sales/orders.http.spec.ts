import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeHeader, readSheet } from '../../common/excel.js';
import {
  customerBranchTerms,
  customers,
  debtLedger,
  productComponents,
  products,
  stockMovements,
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
 * Đặt hàng (phiếu tạm). Dữ liệu thử ở Sài Gòn: hàng A tồn 100 (giá vốn 1.000), B tồn 5, C ngưng kinh doanh,
 * COMBO là combo. Khách K1 có hạn mức 100.000 tại SG, K2 không giới hạn, K3 ngưng giao dịch.
 */
describe('Đặt hàng qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  const pid: Record<string, string> = {};
  const cid: Record<string, string> = {};
  let sale1: string;
  let sale2: string;

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [IdempotencyModule, SalesModule] });
    sale1 = (await t.makeUser('sale1', 'sales', [t.sg])).id;
    sale2 = (await t.makeUser('sale2', 'sales', [t.sg])).id;
    await t.makeUser('tro1', 'assistant', [t.sg, t.hn]);
    await t.makeUser('kho1', 'warehouse', [t.sg]);
    const rows = await t.db
      .insert(products)
      .values([
        { code: 'A', name: 'Hàng A' },
        { code: 'B', name: 'Hàng B' },
        { code: 'C', name: 'Hàng C', isActive: false },
        { code: 'COMBO', name: 'Combo', productType: 'combo' },
      ])
      .returning();
    for (const r of rows) pid[r.code] = r.id;
    await t.db
      .insert(productComponents)
      .values({ comboId: pid.COMBO!, componentId: pid.A!, qty: 2 });
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
        { code: 'K1', name: 'Khách Một', phone: '0901000001' },
        { code: 'K2', name: 'Khách Hai' },
        { code: 'K3', name: 'Khách Ngưng', isActive: false },
      ])
      .returning();
    for (const c of cs) cid[c.code] = c.id;
    await t.db
      .insert(customerBranchTerms)
      .values({ customerId: cid.K1!, branchId: t.sg, creditLimit: '100000' });
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  const as = (user: string, branch: string = t.sg): Promise<Api> =>
    t.as(user, branch) as Promise<Api>;
  const create = async (
    user: string,
    body: Record<string, unknown>,
    key: string | null = randomUUID(),
    branch: string = t.sg,
  ) => {
    const req = (await as(user, branch)).post('/orders').send(body);
    if (key) req.set('Idempotency-Key', key);
    return req;
  };
  const onHand = async (code: string) =>
    Number(
      (
        await t.db
          .select({ v: stocks.onHand })
          .from(stocks)
          .where(and(eq(stocks.branchId, t.sg), eq(stocks.productId, pid[code]!)))
      )[0]?.v ?? 0,
    );
  const line = (code: string, qty: string, price: string, discountPerUnit?: string) => ({
    productId: pid[code]!,
    qty,
    price,
    ...(discountPerUnit ? { discountPerUnit } : {}),
  });

  it('tạo phiếu tạm: một mặt hàng lặp 2 dòng, giảm giá dòng + giảm giá phiếu → tiền đúng; người bán mặc định là mình', async () => {
    const res = await create('sale1', {
      customerId: cid.K1,
      discount: '1000',
      ship: { pickupAddress: 'Kho 3', name: 'Anh Nhận', phone: '0909', address: '1 Đường A' },
      items: [line('A', '10', '13100', '500'), line('A', '5', '13100'), line('B', '8', '2000')],
    });
    expect(res.status).toBe(201);
    const o = res.body;
    expect(o).toMatchObject({
      status: 'draft',
      seller: { id: sale1 },
      customer: { code: 'K1', name: 'Khách Một' },
      subtotal: '207500', // 10×12.600 + 5×13.100 + 8×2.000
      discount: '1000',
      total: '206500',
      totalQty: '23.000',
      itemCount: 3,
      ship: { pickupAddress: 'Kho 3', name: 'Anh Nhận', phone: '0909', address: '1 Đường A' },
      invoice: null,
    });
    expect(o.code).toMatch(/^DH\d{6}$/);
    expect(o.items.map((i: { price: string; discountPerUnit: string; unitPrice: string; lineTotal: string }) => [i.price, i.discountPerUnit, i.unitPrice, i.lineTotal])).toEqual([
      ['13100', '500', '12600', '126000'],
      ['13100', '0', '13100', '65500'],
      ['2000', '0', '2000', '16000'],
    ]);
    // có thể bán (không tự trừ chính phiếu này)
    expect(o.items.map((i: { available: string }) => i.available)).toEqual(['100.000', '100.000', '5.000']);
    // cảnh báo mềm: B cần 8 > có thể bán 5; vượt hạn mức 100.000 nếu chốt
    const codes = o.warnings.map((w: { code: string }) => w.code).sort();
    expect(codes).toEqual(['CREDIT_LIMIT_EXCEEDED', 'STOCK_RESERVED']);
    expect(o.warnings.find((w: { code: string }) => w.code === 'STOCK_RESERVED')).toMatchObject({ productCode: 'B', requested: '8.000', available: '5.000' });
    // phiếu tạm không chạm kho, nợ
    expect(await onHand('A')).toBe(100);
    expect((await t.db.select().from(debtLedger)).length).toBe(0);
  });

  it('cảnh báo vượt hạn mức chỉ kèm số tiền khi người xem được công nợ khách: Kho và Sale xem khách của người khác chỉ thấy "vượt", không thấy số', async () => {
    const made = await create('tro1', { customerId: cid.K1, items: [line('A', '10', '13000')] });
    expect(made.status).toBe(201);
    const pick = (b: { warnings: Array<{ code: string }> }) =>
      b.warnings.find((w) => w.code === 'CREDIT_LIMIT_EXCEEDED') as Record<string, unknown>;
    // Trợ lý có debt.view (tất cả) → có số
    expect(pick(made.body)).toMatchObject({ creditLimit: '100000' });
    expect(pick(made.body).balanceAfter).toBeDefined();
    // Kho không có debt.view
    const w0 = pick((await (await as('kho1')).get(`/orders/${made.body.id}`)).body);
    expect(w0).toBeDefined();
    expect(w0).not.toHaveProperty('creditLimit');
    expect(w0).not.toHaveProperty('balanceAfter');
    expect(String(w0.message)).not.toMatch(/\d/);
    // Sale có debt.view "chỉ của mình" nhưng K1 không do sale1 phụ trách
    const mine = await create('sale1', { customerId: cid.K1, items: [line('A', '10', '13000')] });
    const w = pick(mine.body);
    expect(w).toBeDefined();
    expect(w).not.toHaveProperty('balanceAfter');
    expect(String(w.message)).not.toMatch(/\d/);
    // nhả hàng giữ để không ảnh hưởng ca sau
    for (const id of [made.body.id, mine.body.id]) {
      await (await as('quanly')).post(`/orders/${id}/cancel`).send({}).expect(200);
    }
  });

  it('phiếu tạm khác giữ hàng: có thể bán = tồn − hàng giữ cho phiếu tạm khác; hủy thì nhả', async () => {
    const first = (await create('tro1', { customerId: cid.K2, items: [line('A', '60', '13000')] })).body;
    const second = (await create('tro1', { customerId: cid.K2, items: [line('A', '30', '13000')] })).body;
    // 100 − 15 (phiếu ở ca trước) − 60 = 25 < 30
    expect(second.warnings).toHaveLength(1);
    expect(second.warnings[0]).toMatchObject({ code: 'STOCK_RESERVED', available: '25.000' });
    await (await as('tro1')).post(`/orders/${first.id}/cancel`).send({ reason: 'khách bỏ' }).expect(200);
    const again = (await (await as('tro1')).get(`/orders/${second.id}`).expect(200)).body;
    expect(again.warnings).toEqual([]);
    expect(again.items[0].available).toBe('85.000');
  });

  it('kiểm tra dữ liệu: giảm giá > đơn giá, giảm giá phiếu > tổng, giá lẻ, combo, hàng ngưng, khách ngưng/nội bộ, gửi tiền tự tính, thiếu Idempotency-Key', async () => {
    const bad = async (body: Record<string, unknown>, status: number) => {
      const r = await create('tro1', { customerId: cid.K2, ...body });
      expect(r.status, JSON.stringify(r.body)).toBe(status);
      return r.body;
    };
    await bad({ items: [line('A', '1', '1000', '1001')] }, 400);
    await bad({ discount: '5000', items: [line('A', '1', '1000')] }, 400);
    await bad({ items: [line('A', '1', '1000.5')] }, 400);
    await bad({ items: [line('A', '0', '1000')] }, 400);
    await bad({ items: [line('COMBO', '1', '1000')] }, 400);
    expect((await bad({ items: [line('C', '1', '1000')] }, 422)).code).toBe('INVALID_STATE');
    expect((await bad({ items: [{ ...line('A', '1', '1000'), lineTotal: '1' }] }, 400)).code).toBe('VALIDATION_ERROR');
    await bad({ total: '1', items: [line('A', '1', '1000')] }, 400);
    await bad({ items: [] }, 400);
    expect((await create('tro1', { customerId: cid.K3, items: [line('A', '1', '1000')] })).status).toBe(422);
    const internal = (await t.db.select().from(customers).where(eq(customers.code, 'CN-HN')))[0]!;
    expect((await create('tro1', { customerId: internal.id, items: [line('A', '1', '1000')] })).status).toBe(404);
    expect((await create('tro1', { customerId: cid.K2, items: [line('A', '1', '1000')] }, null)).status).toBe(400);
  });

  it('Idempotency-Key: gửi lại cùng khóa trả đúng phiếu cũ, không tạo thêm', async () => {
    const key = randomUUID();
    const a = (await create('tro1', { customerId: cid.K2, items: [line('A', '1', '1000')] }, key)).body;
    const b = await create('tro1', { customerId: cid.K2, items: [line('A', '1', '1000')] }, key);
    expect(b.body.id).toBe(a.id);
  });

  it('phạm vi "chỉ của mình": Sale chỉ thấy/sửa phiếu mình bán; không lập hộ người khác; Trợ lý lập hộ được', async () => {
    const mine = (await create('sale1', { customerId: cid.K2, items: [line('A', '1', '1000')] })).body;
    await (await as('sale2')).get(`/orders/${mine.id}`).expect(404);
    const list2 = (await (await as('sale2')).get('/orders?limit=100').expect(200)).body;
    expect(list2.data.map((o: { id: string }) => o.id)).not.toContain(mine.id);
    const list1 = (await (await as('sale1')).get('/orders?limit=100').expect(200)).body;
    expect(list1.data.every((o: { seller: { id: string } }) => o.seller.id === sale1)).toBe(true);
    const body = { customerId: cid.K2, items: [line('A', '2', '1000')] };
    expect((await (await as('sale2')).patch(`/orders/${mine.id}`).send(body)).status).toBe(403);
    expect((await (await as('sale2')).post(`/orders/${mine.id}/cancel`).send({})).status).toBe(403);
    expect((await create('sale1', { ...body, sellerId: sale2 })).status).toBe(403);
    const helped = await create('tro1', { ...body, sellerId: sale1 });
    expect(helped.status).toBe(201);
    expect(helped.body.seller.id).toBe(sale1);
    // Kho xem được nhưng không lập phiếu
    await (await as('kho1')).get('/orders').expect(200);
    expect((await create('kho1', body)).status).toBe(403);
  });

  it('sửa thay toàn bộ dòng; phiếu đã hủy thì không sửa/hủy được nữa; chi nhánh khác không thấy phiếu', async () => {
    const o = (await create('tro1', { customerId: cid.K2, items: [line('A', '1', '1000'), line('B', '1', '2000')] })).body;
    const upd = await (await as('tro1'))
      .patch(`/orders/${o.id}`)
      .send({ customerId: cid.K1, discount: '500', note: 'đổi', items: [line('B', '3', '2500', '100')] })
      .expect(200);
    expect(upd.body).toMatchObject({ customer: { code: 'K1' }, subtotal: '7200', discount: '500', total: '6700', itemCount: 1, note: 'đổi' });
    await (await as('tro1')).post(`/orders/${o.id}/cancel`).send({}).expect(200);
    const again = await (await as('tro1')).patch(`/orders/${o.id}`).send({ customerId: cid.K1, items: [line('B', '1', '1')] });
    expect(again.status).toBe(422);
    expect((await (await as('tro1')).post(`/orders/${o.id}/cancel`).send({})).status).toBe(422);
    await (await as('tro1', t.hn)).get(`/orders/${o.id}`).expect(404);
  });

  it('danh sách lọc theo trạng thái, khách, tìm không dấu; xuất Excel tiêu đề như file KiotViet', async () => {
    const api = await as('tro1');
    const drafts = (await api.get('/orders?status=draft&limit=100').expect(200)).body;
    expect(drafts.data.every((o: { status: string }) => o.status === 'draft')).toBe(true);
    const byCustomer = (await api.get(`/orders?customerId=${cid.K1}&limit=100`).expect(200)).body;
    expect(byCustomer.data.every((o: { customer: { code: string } }) => o.customer.code === 'K1')).toBe(true);
    const search = (await api.get('/orders?q=khach mot&limit=100').expect(200)).body;
    expect(search.data.length).toBeGreaterThan(0);
    const res = await api.get('/orders?format=xlsx&status=draft').buffer().parse(bin as never).expect(200);
    const sheet = await readSheet(res.body as Buffer);
    expect(sheet.headers.slice(0, 3)).toEqual(['Mã đặt hàng', 'Mã hóa đơn', 'Địa chỉ lấy hàng'].map(normalizeHeader));
    expect(sheet.headers).toContain(normalizeHeader('Giảm giá phiếu đặt'));
    expect(sheet.rows.length).toBeGreaterThan(0);
  });

  it('phiếu tạm không ghi sổ kho/sổ nợ; đối soát khớp', async () => {
    const moves = await t.db.select().from(stockMovements);
    expect(moves.every((m) => m.refType === 'opening')).toBe(true);
    expect((await new ReconciliationService().run(t.db)).ok).toBe(true);
  });
});
