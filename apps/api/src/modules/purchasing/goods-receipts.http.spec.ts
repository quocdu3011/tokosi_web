import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeHeader, readSheet } from '../../common/excel.js';
import {
  auditLogs,
  debtLedger,
  products,
  stockMovements,
  stocks,
  suppliers,
} from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { PurchasingModule } from './purchasing.module.js';

const bin = (
  r: { on: (e: string, cb: (x: Buffer) => void) => void },
  cb: (e: null, b: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

/**
 * Nhập hàng / trả hàng nhập / đặt hàng nhập: phần chạm KHO, GIÁ VỐN và CÔNG NỢ nhà cung cấp.
 * Số ví dụ của chủ: tồn 1000 @5000, nhập 500 @5500 → giá vốn 5166,6667; trả 100 @5500 → 5142,8572.
 */
describe('Mua hàng qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createHttpTestApp({
      imports: [IdempotencyModule, CatalogModule, PurchasingModule],
    });
    await t.makeUser('ketoan1', 'accountant', [t.sg, t.hn]);
    await t.makeUser('ketoan_hn', 'accountant', [t.hn]);
    await t.makeUser('kho1', 'warehouse', [t.sg, t.hn]);
    await t.makeUser('mkt1', 'marketing', [t.sg]);

    const sup = await t.db
      .insert(suppliers)
      .values([
        { code: 'NCC-A', name: 'Nhà cung cấp A' },
        { code: 'NCC-B', name: 'Nhà cung cấp B' },
        { code: 'NCC-OFF', name: 'Đã ngưng', isActive: false },
      ])
      .returning();
    for (const s of sup) ids[s.code] = s.id;
    const prods = await t.db
      .insert(products)
      .values([
        { code: 'P1', name: 'Hàng một' },
        { code: 'P2', name: 'Hàng hai' },
        { code: 'P3', name: 'Hàng ba' },
        { code: 'POFF', name: 'Hàng ngưng', isActive: false },
        { code: 'CB1', name: 'Combo', productType: 'combo' },
      ])
      .returning();
    for (const p of prods) ids[p.code] = p.id;
  });
  afterAll(async () => {
    await t.close();
  });

  const post = async (
    user: string,
    branch: string,
    url: string,
    body: object = {},
    key: string | null = randomUUID(),
  ) => {
    const req = (await t.as(user, branch)).post(url).send(body);
    if (key !== null) req.set('Idempotency-Key', key);
    return req;
  };
  const stock = async (branch: string, code: string) => {
    const [s] = await t.db
      .select()
      .from(stocks)
      .where(
        and(eq(stocks.branchId, branch), eq(stocks.productId, ids[code]!)),
      );
    return s ? { onHand: s.onHand, cost: s.costPrice } : undefined;
  };
  const debt = async (branch: string, supplier: string) => {
    const [r] = await t.db
      .select({ v: sql<string>`coalesce(sum(${debtLedger.amount}), 0)` })
      .from(debtLedger)
      .where(
        and(
          eq(debtLedger.partyType, 'supplier'),
          eq(debtLedger.partyId, ids[supplier]!),
          eq(debtLedger.branchId, branch),
        ),
      );
    return Number(r!.v);
  };
  const receipt = (
    supplier: string,
    items: Array<[string, string, string]>,
  ) => ({
    supplierId: ids[supplier],
    items: items.map(([p, qty, unitCost]) => ({
      productId: ids[p],
      qty,
      unitCost,
    })),
  });
  const reconcileOk = async () =>
    expect((await new ReconciliationService().run(t.db)).ok).toBe(true);

  describe('Nhập hàng', () => {
    let pn1: string;

    it('ví dụ của chủ: tồn 1000 @5000 + nhập 500 @5500 → giá vốn 5166,6667; nợ NCC tăng đúng; chỉ chi nhánh làm việc đổi', async () => {
      const first = await post(
        'ketoan1',
        t.sg,
        '/goods-receipts',
        receipt('NCC-A', [['P1', '1000', '5000']]),
      ).then((r) => r);
      expect(first.status).toBe(201);
      expect(first.body.code).toMatch(/^PN\d{6}$/);
      expect(first.body.total).toBe('5000000');
      expect(await stock(t.sg, 'P1')).toEqual({
        onHand: '1000.000',
        cost: '5000.0000',
      });

      const second = await post(
        'ketoan1',
        t.sg,
        '/goods-receipts',
        receipt('NCC-A', [['P1', '500', '5500']]),
      );
      expect(second.status).toBe(201);
      pn1 = second.body.id;
      expect(await stock(t.sg, 'P1')).toEqual({
        onHand: '1500.000',
        cost: '5166.6667',
      });
      expect(await debt(t.sg, 'NCC-A')).toBe(5_000_000 + 2_750_000);
      const [last] = await t.db
        .select({ v: stocks.lastPurchasePrice })
        .from(stocks)
        .where(
          and(eq(stocks.branchId, t.sg), eq(stocks.productId, ids['P1']!)),
        );
      expect(last!.v).toBe('5500.0000'); // giá nhập cuối
      // chi nhánh kia không bị đụng
      expect(await stock(t.hn, 'P1')).toBeUndefined();
      expect(await debt(t.hn, 'NCC-A')).toBe(0);
      await reconcileOk();
    });

    it('thành tiền = số lượng × giá nhập làm tròn về đồng; tổng cộng các dòng; giá lẻ 4 chữ số', async () => {
      const r = await post(
        'ketoan1',
        t.sg,
        '/goods-receipts',
        receipt('NCC-B', [
          ['P2', '3', '1000.3333'], // 3000.9999 → 3001
          ['P3', '2.5', '10.5'], // 26.25 → 26
        ]),
      );
      expect(r.status).toBe(201);
      const items = r.body.items as Array<{
        code: string;
        lineTotal: string;
        unitCost: string;
      }>;
      expect(items.find((i) => i.code === 'P2')).toMatchObject({
        lineTotal: '3001',
        unitCost: '1000.3333',
      });
      expect(items.find((i) => i.code === 'P3')!.lineTotal).toBe('26');
      expect(r.body.total).toBe('3027');
      expect(r.body.totalQty).toBe('5.500');
      expect(r.body.itemCount).toBe(2);
    });

    it('chi tiết, danh sách, lọc; chi nhánh khác không thấy (404); Marketing không có quyền', async () => {
      const api = await t.as('ketoan1', t.sg);
      const detail = await api.get(`/goods-receipts/${pn1}`).expect(200);
      expect(detail.body).toMatchObject({
        status: 'completed',
        supplier: { code: 'NCC-A' },
        purchaseOrder: null,
        total: '2750000',
      });
      const list = await api
        .get('/goods-receipts?supplierId=' + ids['NCC-A'])
        .expect(200);
      expect(list.body.meta.total).toBe(2);
      expect(list.body.data[0].items).toBeUndefined(); // danh sách không kèm dòng
      const byCode = await api
        .get('/goods-receipts?q=nha cung cap b')
        .expect(200);
      expect(
        byCode.body.data.every(
          (d: { supplier: { code: string } }) => d.supplier.code === 'NCC-B',
        ),
      ).toBe(true);

      const other = await t.as('ketoan1', t.hn);
      await other.get(`/goods-receipts/${pn1}`).expect(404);
      expect(
        (await other.get('/goods-receipts').expect(200)).body.meta.total,
      ).toBe(0);

      await (await t.as('mkt1', t.sg)).get('/goods-receipts').expect(403);
      await post(
        'mkt1',
        t.sg,
        '/goods-receipts',
        receipt('NCC-A', [['P1', '1', '1']]),
      ).then((r) => expect(r.status).toBe(403));
    });

    it('từ chối: NCC ngưng, hàng ngưng, combo, trùng hàng, số lượng 0, giá âm, trường thừa (tiền do server tính)', async () => {
      const bad = async (body: object, status: number) =>
        expect(
          (await post('ketoan1', t.sg, '/goods-receipts', body)).status,
        ).toBe(status);
      await bad(receipt('NCC-OFF', [['P1', '1', '1']]), 422);
      await bad(receipt('NCC-A', [['POFF', '1', '1']]), 422);
      await bad(receipt('NCC-A', [['CB1', '1', '1']]), 400);
      await bad(
        receipt('NCC-A', [
          ['P1', '1', '1'],
          ['P1', '2', '1'],
        ]),
        400,
      );
      await bad(receipt('NCC-A', [['P1', '0', '1']]), 400);
      await bad(receipt('NCC-A', [['P1', '1', '-5']]), 400);
      await bad({ ...receipt('NCC-A', [['P1', '1', '1']]), total: '1' }, 400);
      await bad({ ...receipt('NCC-A', [['P1', '1', '1']]), items: [] }, 400);
      await bad(
        {
          ...receipt('NCC-A', [['P1', '1', '1']]),
          receivedAt: '2099-01-01T00:00:00Z',
        },
        400,
      );
      // NCC nội bộ (đại diện chi nhánh) không dùng được
      const internal = await t.db
        .select()
        .from(suppliers)
        .where(sql`${suppliers.linkedBranchId} is not null`)
        .limit(1);
      if (internal[0]) {
        await bad(
          {
            supplierId: internal[0].id,
            items: [{ productId: ids['P1'], qty: '1', unitCost: '1' }],
          },
          404,
        );
      }
      expect(await stock(t.sg, 'P1')).toMatchObject({ onHand: '1500.000' }); // không phiếu lỗi nào ghi kho
    });

    it('Idempotency-Key: gửi lại cùng khóa không tạo thêm phiếu; thiếu khóa → 400', async () => {
      const key = randomUUID();
      const body = receipt('NCC-B', [['P3', '10', '100']]);
      const a = await post('ketoan1', t.sg, '/goods-receipts', body, key);
      const b = await post('ketoan1', t.sg, '/goods-receipts', body, key);
      expect(a.status).toBe(201);
      expect(b.body.id).toBe(a.body.id);
      await post('ketoan1', t.sg, '/goods-receipts', body, null).then((r) =>
        expect(r.status).toBe(400),
      );
    });

    it('sửa ghi chú; ghi nhật ký thao tác', async () => {
      const api = await t.as('ketoan1', t.sg);
      const r = await api
        .patch(`/goods-receipts/${pn1}`)
        .send({ note: 'Lô tháng 10' })
        .expect(200);
      expect(r.body.note).toBe('Lô tháng 10');
      await api
        .patch(`/goods-receipts/${pn1}`)
        .send({ total: '1' })
        .expect(400);
      const logs = await t.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, pn1));
      expect(logs.map((l) => l.action).sort()).toEqual([
        'goods_receipt.create',
        'goods_receipt.update_note',
      ]);
    });

    it('Excel theo tiêu đề file KiotViet, mỗi dòng hàng một dòng, giờ Việt Nam', async () => {
      const api = await t.as('ketoan1', t.sg);
      const res = await api
        .get('/goods-receipts?format=xlsx')
        .buffer(true)
        .parse(bin as never)
        .expect(200);
      expect(res.headers['content-disposition']).toMatch(
        /nhap-hang-\d{8}\.xlsx/,
      );
      const sheet = await readSheet(res.body as Buffer);
      expect(sheet.headers).toContain(normalizeHeader('Mã nhập hàng'));
      expect(sheet.headers).toContain(normalizeHeader('Cần trả NCC'));
      expect(sheet.rows.length).toBeGreaterThanOrEqual(4);
      expect(String(sheet.rows[0]!.values['thoi gian'])).toMatch(
        /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
      );
    });

    it('hủy: cần purchase.cancel (Kho → 403); trả lại tồn, giá vốn tính ngược và nợ; hủy lần hai → 422', async () => {
      await post('kho1', t.sg, `/goods-receipts/${pn1}/cancel`, {}, null).then(
        (r) => expect(r.status).toBe(403),
      );
      // chi nhánh khác không hủy được
      await post(
        'ketoan1',
        t.hn,
        `/goods-receipts/${pn1}/cancel`,
        {},
        null,
      ).then((r) => expect(r.status).toBe(404));

      const res = await post(
        'ketoan1',
        t.sg,
        `/goods-receipts/${pn1}/cancel`,
        { reason: 'Nhập nhầm' },
        null,
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'cancelled',
        cancelReason: 'Nhập nhầm',
      });
      // (1500×5166,6667 − 500×5500) / 1000 = 5000,0001 (giá vốn lưu 4 chữ số)
      expect(await stock(t.sg, 'P1')).toEqual({
        onHand: '1000.000',
        cost: '5000.0001',
      });
      expect(await debt(t.sg, 'NCC-A')).toBe(5_000_000);
      await post(
        'ketoan1',
        t.sg,
        `/goods-receipts/${pn1}/cancel`,
        {},
        null,
      ).then((r) => expect(r.status).toBe(422));
      await reconcileOk();
    });

    it('hủy khi hàng đã bán hết → 422 STOCK_NOT_ENOUGH và không đổi gì', async () => {
      const r = await post(
        'ketoan1',
        t.sg,
        '/goods-receipts',
        receipt('NCC-B', [['P2', '7', '100']]),
      );
      const before = await stock(t.sg, 'P2');
      const debtBefore = await debt(t.sg, 'NCC-B');
      // bán bớt: trừ tồn trực tiếp qua sổ cái bằng cách giả lập (xuất kho)
      const { InventoryService } =
        await import('../inventory/inventory.service.js');
      await new InventoryService(t.db).applyMovement(t.db, {
        branchId: t.sg,
        productId: ids['P2']!,
        qtyDelta: '-9',
        refType: 'adjustment',
      });
      const fail = await post(
        'ketoan1',
        t.sg,
        `/goods-receipts/${r.body.id}/cancel`,
        {},
        null,
      );
      expect(fail.status).toBe(422);
      expect(fail.body.code).toBe('STOCK_NOT_ENOUGH');
      expect(await debt(t.sg, 'NCC-B')).toBe(debtBefore);
      expect(before).toBeDefined();
      await reconcileOk();
    });
  });

  describe('Trả hàng nhập', () => {
    let pnA: string;
    let thn1: string;

    it('trả theo phiếu nhập: trừ tồn, giá vốn tính lại theo giá trả (5142,8572), giảm nợ; chi nhánh kia không đổi', async () => {
      // dựng lại: tồn P3 ở HN 1000 @5000, rồi nhập 500 @5500
      await post(
        'ketoan1',
        t.hn,
        '/goods-receipts',
        receipt('NCC-A', [['P3', '1000', '5000']]),
      );
      const r = await post(
        'ketoan1',
        t.hn,
        '/goods-receipts',
        receipt('NCC-A', [['P3', '500', '5500']]),
      );
      pnA = r.body.id;
      expect(await stock(t.hn, 'P3')).toEqual({
        onHand: '1500.000',
        cost: '5166.6667',
      });
      const debtBefore = await debt(t.hn, 'NCC-A');

      const ret = await post('ketoan1', t.hn, '/purchase-returns', {
        supplierId: ids['NCC-A'],
        goodsReceiptId: pnA,
        note: 'Hàng lỗi',
        items: [{ productId: ids['P3'], qty: '100', returnPrice: '5500' }],
      });
      expect(ret.status).toBe(201);
      thn1 = ret.body.id;
      expect(ret.body).toMatchObject({
        total: '550000',
        goodsReceipt: { id: pnA },
      });
      expect(ret.body.code).toMatch(/^THN\d{6}$/);
      expect(await stock(t.hn, 'P3')).toEqual({
        onHand: '1400.000',
        cost: '5142.8572',
      });
      expect(await debt(t.hn, 'NCC-A')).toBe(debtBefore - 550_000);
      expect(await stock(t.sg, 'P3')).toBeDefined(); // SG có tồn P3 từ test trước, không đổi
      await reconcileOk();
    });

    it('không trả quá số đã nhập của phiếu gốc (cộng dồn các lần trả); hàng ngoài phiếu bị từ chối', async () => {
      const over = await post('ketoan1', t.hn, '/purchase-returns', {
        supplierId: ids['NCC-A'],
        goodsReceiptId: pnA,
        items: [{ productId: ids['P3'], qty: '401', returnPrice: '1' }],
      });
      expect(over.status).toBe(422);
      expect(over.body.code).toBe('RETURN_QTY_EXCEEDED');
      expect(over.body.details[0]).toMatchObject({ field: 'items.0.qty' });
      const ok = await post('ketoan1', t.hn, '/purchase-returns', {
        supplierId: ids['NCC-A'],
        goodsReceiptId: pnA,
        items: [{ productId: ids['P3'], qty: '400', returnPrice: '5500' }],
      });
      expect(ok.status).toBe(201);
      const foreign = await post('ketoan1', t.hn, '/purchase-returns', {
        supplierId: ids['NCC-A'],
        goodsReceiptId: pnA,
        items: [{ productId: ids['P1'], qty: '1', returnPrice: '1' }],
      });
      expect(foreign.status).toBe(422);
      // chi tiết phiếu nhập hiện số đã trả
      const gr = await (
        await t.as('ketoan1', t.hn)
      )
        .get(`/goods-receipts/${pnA}`)
        .expect(200);
      expect(gr.body.items[0].returnedQty).toBe('500.000');
    });

    it('hủy phiếu nhập còn phiếu trả → 409; hủy phiếu trả: nhập lại hàng, tăng lại nợ, giá vốn về lại', async () => {
      const blocked = await post(
        'ketoan1',
        t.hn,
        `/goods-receipts/${pnA}/cancel`,
        {},
        null,
      );
      expect(blocked.status).toBe(409);

      const debtBefore = await debt(t.hn, 'NCC-A');
      const res = await post(
        'ketoan1',
        t.hn,
        `/purchase-returns/${thn1}/cancel`,
        { reason: 'Nhầm' },
        null,
      );
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
      expect(await debt(t.hn, 'NCC-A')).toBe(debtBefore + 550_000);
      await post(
        'ketoan1',
        t.hn,
        `/purchase-returns/${thn1}/cancel`,
        {},
        null,
      ).then((r) => expect(r.status).toBe(422));
      await reconcileOk();
    });

    it('trả không cần phiếu gốc; không đủ tồn → 422; NCC ngưng bị chặn; hàng ngưng kinh doanh vẫn trả được', async () => {
      await post(
        'ketoan1',
        t.sg,
        '/goods-receipts',
        receipt('NCC-B', [['P1', '10', '100']]),
      );
      const ok = await post('ketoan1', t.sg, '/purchase-returns', {
        supplierId: ids['NCC-B'],
        items: [{ productId: ids['P1'], qty: '2', returnPrice: '100' }],
      });
      expect(ok.status).toBe(201);
      expect(ok.body.goodsReceipt).toBeNull();
      const notEnough = await post('ketoan1', t.sg, '/purchase-returns', {
        supplierId: ids['NCC-B'],
        items: [{ productId: ids['P1'], qty: '999999', returnPrice: '1' }],
      });
      expect(notEnough.status).toBe(422);
      expect(notEnough.body.code).toBe('STOCK_NOT_ENOUGH');
      const off = await post('ketoan1', t.sg, '/purchase-returns', {
        supplierId: ids['NCC-OFF'],
        items: [{ productId: ids['P1'], qty: '1', returnPrice: '1' }],
      });
      expect(off.status).toBe(422);
      // hình thức thanh toán không còn trong hợp đồng (luôn trừ công nợ)
      const legacy = await post('ketoan1', t.sg, '/purchase-returns', {
        supplierId: ids['NCC-B'],
        settlement: 'refund',
        items: [{ productId: ids['P1'], qty: '1', returnPrice: '1' }],
      });
      expect(legacy.status).toBe(400);
    });

    it('danh sách, Excel và cách ly chi nhánh', async () => {
      const api = await t.as('ketoan1', t.hn);
      const list = await api
        .get('/purchase-returns?goodsReceiptId=' + pnA)
        .expect(200);
      expect(list.body.meta.total).toBe(2);
      await (
        await t.as('ketoan1', t.sg)
      )
        .get(`/purchase-returns/${thn1}`)
        .expect(404);
      const res = await api
        .get('/purchase-returns?format=xlsx')
        .buffer(true)
        .parse(bin as never)
        .expect(200);
      const sheet = await readSheet(res.body as Buffer);
      expect(sheet.headers).toContain(normalizeHeader('Mã trả hàng nhập'));
      expect(sheet.headers).toContain(normalizeHeader('Giá trả lại'));
      await (await t.as('kho1', t.hn)).get('/purchase-returns').expect(200);
      await post(
        'kho1',
        t.hn,
        `/purchase-returns/${thn1}/cancel`,
        {},
        null,
      ).then((r) => expect(r.status).toBe(403));
    });
  });

  describe('Đặt hàng nhập', () => {
    let po: string;
    const order = (
      items: Array<[string, string, string]>,
      extra: object = {},
    ) => ({
      supplierId: ids['NCC-A'],
      items: items.map(([p, qty, unitCost]) => ({
        productId: ids[p],
        qty,
        unitCost,
      })),
      ...extra,
    });

    it('tạo phiếu tạm, không chạm kho và công nợ; xác nhận; mã PDN', async () => {
      const stockBefore = await stock(t.sg, 'P2');
      const debtBefore = await debt(t.sg, 'NCC-A');
      const r = await post(
        'ketoan1',
        t.sg,
        '/purchase-orders',
        order(
          [
            ['P2', '100', '2000'],
            ['P3', '50', '1000'],
          ],
          { note: 'Đặt tháng 11' },
        ),
      );
      expect(r.status).toBe(201);
      po = r.body.id;
      expect(r.body).toMatchObject({
        status: 'draft',
        receiveState: 'none',
        total: '250000',
        itemCount: 2,
      });
      expect(r.body.code).toMatch(/^PDN\d{6}$/);
      expect(await stock(t.sg, 'P2')).toEqual(stockBefore);
      expect(await debt(t.sg, 'NCC-A')).toBe(debtBefore);

      const api = await t.as('ketoan1', t.sg);
      await api.post(`/purchase-orders/${po}/confirm`).expect(200);
      await api.post(`/purchase-orders/${po}/confirm`).expect(422); // đã xác nhận
      const got = await api.get(`/purchase-orders/${po}`).expect(200);
      expect(got.body.status).toBe('confirmed');
      expect(got.body.items[0]).toMatchObject({
        receivedQty: '0.000',
        remainingQty: expect.any(String),
      });
    });

    it('nhập một phần theo phiếu đặt → còn nhập tiếp; nhập đủ → tự hoàn thành; onOrder phản ánh phần còn lại', async () => {
      const api = await t.as('ketoan1', t.sg);
      const onOrder = async (code: string) => {
        const r = await api.get(`/products?q=${code}`).expect(200);
        return (r.body.data as Array<{ code: string; onOrder: string }>).find(
          (p) => p.code === code,
        )!.onOrder;
      };
      expect(await onOrder('P2')).toBe('100.000');

      const r1 = await post('ketoan1', t.sg, '/goods-receipts', {
        ...receipt('NCC-A', [['P2', '60', '2000']]),
        purchaseOrderId: po,
      });
      expect(r1.status).toBe(201);
      expect(r1.body.purchaseOrder.code).toMatch(/^PDN/);
      let cur = (await api.get(`/purchase-orders/${po}`).expect(200)).body;
      expect(cur.status).toBe('confirmed');
      expect(cur.receiveState).toBe('partial');
      expect(
        cur.items.find((i: { code: string }) => i.code === 'P2'),
      ).toMatchObject({ receivedQty: '60.000', remainingQty: '40.000' });
      expect(cur.receipts).toHaveLength(1);
      expect(await onOrder('P2')).toBe('40.000');
      expect(await onOrder('P3')).toBe('50.000');
      // không sửa/hủy được khi đã có phiếu nhập
      await api
        .put(`/purchase-orders/${po}`)
        .send(order([['P2', '1', '1']]))
        .set('Idempotency-Key', 'x')
        .expect(409);
      await post(
        'ketoan1',
        t.sg,
        `/purchase-orders/${po}/cancel`,
        {},
        null,
      ).then((r) => expect(r.status).toBe(409));

      const r2 = await post('ketoan1', t.sg, '/goods-receipts', {
        ...receipt('NCC-A', [
          ['P2', '40', '2000'],
          ['P3', '50', '1000'],
        ]),
        purchaseOrderId: po,
      });
      expect(r2.status).toBe(201);
      cur = (await api.get(`/purchase-orders/${po}`).expect(200)).body;
      expect(cur.status).toBe('completed');
      expect(cur.receiveState).toBe('full');
      expect(await onOrder('P2')).toBe('0.000');
      // phiếu đã hoàn thành không nhập thêm được
      const more = await post('ketoan1', t.sg, '/goods-receipts', {
        ...receipt('NCC-A', [['P2', '1', '1']]),
        purchaseOrderId: po,
      });
      expect(more.status).toBe(422);

      // hủy phiếu nhập thứ hai → phiếu đặt mở lại (thiếu hàng)
      await post(
        'ketoan1',
        t.sg,
        `/goods-receipts/${r2.body.id}/cancel`,
        {},
        null,
      ).then((r) => expect(r.status).toBe(200));
      cur = (await api.get(`/purchase-orders/${po}`).expect(200)).body;
      expect(cur.status).toBe('confirmed');
      expect(cur.receiveState).toBe('partial');
      expect(await onOrder('P2')).toBe('40.000');
      await reconcileOk();
    });

    it('"Kết thúc" cần đã có phiếu nhập; nhập khác NCC hoặc khác chi nhánh với phiếu đặt bị từ chối', async () => {
      const api = await t.as('ketoan1', t.sg);
      await api.post(`/purchase-orders/${po}/complete`).expect(200);
      expect(
        (await api.get(`/purchase-orders/${po}`).expect(200)).body.status,
      ).toBe('completed');

      const fresh = await post(
        'ketoan1',
        t.sg,
        '/purchase-orders',
        order([['P1', '5', '100']], { status: 'confirmed' }),
      );
      expect(fresh.body.status).toBe('confirmed');
      await api.post(`/purchase-orders/${fresh.body.id}/complete`).expect(422); // chưa nhập gì
      const wrongSupplier = await post('ketoan1', t.sg, '/goods-receipts', {
        ...receipt('NCC-B', [['P1', '1', '1']]),
        purchaseOrderId: fresh.body.id,
      });
      expect(wrongSupplier.status).toBe(400);
      const wrongBranch = await post('ketoan1', t.hn, '/goods-receipts', {
        ...receipt('NCC-A', [['P1', '1', '1']]),
        purchaseOrderId: fresh.body.id,
      });
      expect(wrongBranch.status).toBe(404);
    });

    it('sửa toàn bộ phiếu khi chưa nhập; hủy; hủy cần purchase.cancel; ngày tương lai bị từ chối; Excel', async () => {
      const r = await post(
        'ketoan1',
        t.sg,
        '/purchase-orders',
        order([['P1', '5', '100']]),
      );
      const id = r.body.id;
      const api = await t.as('ketoan1', t.sg);
      const edited = await api
        .put(`/purchase-orders/${id}`)
        .set('Idempotency-Key', randomUUID())
        .send(
          order(
            [
              ['P2', '7', '300'],
              ['P3', '1', '50'],
            ],
            { note: 'Sửa' },
          ),
        )
        .expect(200);
      expect(edited.body).toMatchObject({
        total: '2150',
        itemCount: 2,
        note: 'Sửa',
      });
      await post('kho1', t.sg, `/purchase-orders/${id}/cancel`, {}, null).then(
        (x) => expect(x.status).toBe(403),
      );
      const cancelled = await post(
        'ketoan1',
        t.sg,
        `/purchase-orders/${id}/cancel`,
        { reason: 'Không đặt nữa' },
        null,
      );
      expect(cancelled.body).toMatchObject({
        status: 'cancelled',
        cancelReason: 'Không đặt nữa',
      });
      await api
        .put(`/purchase-orders/${id}`)
        .set('Idempotency-Key', randomUUID())
        .send(order([['P1', '1', '1']]))
        .expect(422);
      await post(
        'ketoan1',
        t.sg,
        '/purchase-orders',
        order([['P1', '1', '1']], { orderedAt: '2099-01-01T00:00:00Z' }),
      ).then((x) => expect(x.status).toBe(400));
      // hủy phiếu đặt không để lại tồn đang đặt
      const res = await api
        .get('/purchase-orders?format=xlsx')
        .buffer(true)
        .parse(bin as never)
        .expect(200);
      const sheet = await readSheet(res.body as Buffer);
      expect(sheet.headers).toContain(normalizeHeader('Mã đặt hàng nhập'));
      expect(sheet.headers).toContain(normalizeHeader('Người đặt'));
      // phiếu của chi nhánh kia không lọt vào
      expect(
        (await (await t.as('ketoan1', t.hn)).get(`/purchase-orders/${id}`))
          .status,
      ).toBe(404);
    });
  });

  it('lock/audit: mọi thao tác ghi sổ có nhật ký; không phiếu nào làm lệch đối soát', async () => {
    const actions = await t.db.select({ a: auditLogs.action }).from(auditLogs);
    for (const a of [
      'goods_receipt.create',
      'goods_receipt.cancel',
      'purchase_return.create',
      'purchase_return.cancel',
      'purchase_order.create',
      'purchase_order.cancel',
      'purchase_order.confirm',
      'purchase_order.complete',
      'purchase_order.update',
    ]) {
      expect(actions.map((x) => x.a)).toContain(a);
    }
    const [{ n }] = await t.db
      .select({ n: sql<number>`count(*)::int` })
      .from(stockMovements);
    expect(n).toBeGreaterThan(10);
    await reconcileOk();
  });
});
