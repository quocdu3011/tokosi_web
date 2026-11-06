import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  customers,
  orderItems,
  orders,
  productComponents,
  products,
  stocks,
} from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { CatalogModule } from './catalog.module.js';

/**
 * Loại hàng Combo: gói nhiều hàng hóa thành phần để chọn nhanh. Combo không có tồn/giá vốn riêng:
 * mọi số liệu luôn tính từ hàng thành phần, và không bao giờ có dòng sổ cái kho.
 */
describe('Combo qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  let inv: InventoryService;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [CatalogModule] });
    inv = new InventoryService(t.db);
    await t.makeUser('sale1', 'sales', [t.sg]);

    const rows = await t.db
      .insert(products)
      .values([
        { code: 'A', name: 'Hàng A' },
        { code: 'B', name: 'Hàng B' },
        { code: 'C', name: 'Hàng C (chưa có tồn)' },
      ])
      .returning();
    for (const r of rows) ids[r.code] = r.id;

    // Sài Gòn: A tồn 10 vốn 1000 (nhập cuối 1100); B tồn 7 vốn 500. Hà Nội: không có tồn.
    await inv.applyMovements(t.db, [
      {
        branchId: t.sg,
        productId: ids.A!,
        qtyDelta: '10',
        unitCost: '1000',
        refType: 'adjustment',
      },
      {
        branchId: t.sg,
        productId: ids.B!,
        qtyDelta: '7',
        unitCost: '500',
        refType: 'adjustment',
      },
    ]);
    await t.db
      .update(stocks)
      .set({ lastPurchasePrice: '1100' })
      .where(eq(stocks.productId, ids.A!));
    await t.db
      .update(stocks)
      .set({ lastPurchasePrice: '550' })
      .where(eq(stocks.productId, ids.B!));

    // Đơn nháp giữ 2 cái A tại Sài Gòn
    const [cust] = await t.db
      .insert(customers)
      .values({ code: 'KH-C1', name: 'Khách thử' })
      .returning();
    const [order] = await t.db
      .insert(orders)
      .values({
        code: 'DH-C1',
        branchId: t.sg,
        customerId: cust!.id,
        orderedAt: new Date(),
      })
      .returning();
    await t.db.insert(orderItems).values({
      orderId: order!.id,
      lineNo: 1,
      productId: ids.A!,
      qty: '2',
      unitPrice: '2000',
      lineTotal: '4000',
    });
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it('tạo combo: thành phần được chuẩn hóa theo mã trong CSDL; tồn/giá vốn tính từ thành phần', async () => {
    const api = await t.as('quanly', t.sg);
    const res = await api
      .post('/products')
      .send({
        code: 'CB1',
        name: 'Combo A+B',
        productType: 'combo',
        components: 'a/2, b/3',
      })
      .expect(201);
    ids.CB1 = res.body.id;
    expect(res.body).toMatchObject({
      productType: 'combo',
      components: 'A/2,B/3',
      componentItems: [
        { code: 'A', name: 'Hàng A', qty: 2 },
        { code: 'B', name: 'Hàng B', qty: 3 },
      ],
      // A: ⌊10/2⌋=5; B: ⌊7/3⌋=2 → 2 combo. Đang giữ 2 cái A → A còn 8 → ⌊8/2⌋=4; B còn 2 → min = 2
      onHand: '2.000',
      available: '2.000',
      reserved: '0.000',
      // 2×1000 + 3×500
      costPrice: '3500.0000',
      // 2×1100 + 3×550
      lastPurchasePrice: '3850.0000',
    });
    // combo không có dòng tồn riêng
    expect(
      await t.db.select().from(stocks).where(eq(stocks.productId, ids.CB1!)),
    ).toHaveLength(0);
    const logs = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, ids.CB1!));
    expect(
      logs.find((l) => l.action === 'product.create')!.after,
    ).toMatchObject({ productType: 'combo', components: 'A/2,B/3' });
  });

  it('available của combo trừ phần đang giữ cho đơn nháp: A còn 8 → 4 combo, B → 2 combo', async () => {
    const api = await t.as('quanly', t.sg);
    const res = await api
      .post('/products')
      .send({
        code: 'CB-A',
        name: 'Combo chỉ A',
        productType: 'combo',
        components: 'A/2',
      })
      .expect(201);
    // tồn A=10 → 5 combo; đang giữ 2 → còn 8 → 4 combo
    expect(res.body).toMatchObject({ onHand: '5.000', available: '4.000' });
  });

  it('chi nhánh khác tính riêng: Hà Nội chưa có tồn → 0 combo, giá vốn 0', async () => {
    const api = await t.as('quanly', t.hn);
    const res = await api.get(`/products/${ids.CB1}`).expect(200);
    expect(res.body).toMatchObject({
      onHand: '0.000',
      available: '0.000',
      costPrice: '0.0000',
      lastPurchasePrice: null,
    });
    const branches = (
      await api.get(`/products/${ids.CB1}/branches`).expect(200)
    ).body;
    const sg = branches.find((b: { branchId: string }) => b.branchId === t.sg);
    expect(sg).toMatchObject({
      onHand: '2.000',
      costPrice: '3500.0000',
    });
  });

  it('thiếu quyền xem giá vốn → không thấy giá vốn của combo', async () => {
    const api = await t.as('sale1', t.sg);
    const res = await api.get(`/products/${ids.CB1}`).expect(200);
    expect(res.body).not.toHaveProperty('costPrice');
    expect(res.body).not.toHaveProperty('lastPurchasePrice');
    expect(res.body.onHand).toBe('2.000');
  });

  it('kiểm tra dữ liệu thành phần: bắt buộc với combo, cấm với hàng hóa, mã lạ, lồng combo, lặp mã, số lượng sai', async () => {
    const api = await t.as('quanly', t.sg);
    const field = async (body: object) => {
      const res = await api.post('/products').send(body).expect(400);
      expect(res.body.details[0].field).toBe('components');
      return res.body.message as string;
    };
    await field({ code: 'X1', name: 'X', productType: 'combo' });
    await field({
      code: 'X2',
      name: 'X',
      productType: 'combo',
      components: '',
    });
    await field({ code: 'X3', name: 'X', components: 'A/1' }); // hàng hóa không có thành phần
    expect(
      await field({
        code: 'X4',
        name: 'X',
        productType: 'combo',
        components: 'A/1,ZZZ/2',
      }),
    ).toContain('ZZZ');
    expect(
      await field({
        code: 'X5',
        name: 'X',
        productType: 'combo',
        components: 'CB1/1',
      }),
    ).toContain('combo');
    await field({
      code: 'X6',
      name: 'X',
      productType: 'combo',
      components: 'A/1,a/2',
    });
    for (const bad of ['A', 'A/0', 'A/1.5', 'A/-2', 'A/x', 'A/1,']) {
      await field({
        code: 'X7',
        name: 'X',
        productType: 'combo',
        components: bad,
      });
    }
    expect(
      await t.db.select().from(products).where(eq(products.code, 'X4')),
    ).toHaveLength(0); // lỗi thành phần → không tạo gì
  });

  it('danh sách: lọc theo loại; combo vào bộ lọc còn hàng/hết hàng và sắp theo tồn theo số tính ra', async () => {
    const api = await t.as('quanly', t.sg);
    const combos = (await api.get('/products?productType=combo').expect(200))
      .body;
    expect(combos.data.map((p: { code: string }) => p.code).sort()).toEqual([
      'CB-A',
      'CB1',
    ]);
    const goods = (await api.get('/products?productType=goods').expect(200))
      .body;
    expect(
      goods.data.every(
        (p: { productType: string }) => p.productType === 'goods',
      ),
    ).toBe(true);

    const inStock = (await api.get('/products?inStock=true').expect(200)).body;
    const codes = inStock.data.map((p: { code: string }) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['A', 'B', 'CB1', 'CB-A']));
    expect(codes).not.toContain('C');
    const out = (await api.get('/products?inStock=false').expect(200)).body;
    expect(out.data.map((p: { code: string }) => p.code)).toEqual(['C']);

    const sorted = (await api.get('/products?sort=-onHand').expect(200)).body;
    const onHands = sorted.data.map((p: { onHand: string }) =>
      Number(p.onHand),
    );
    expect(onHands).toEqual([...onHands].sort((x, y) => y - x));
    // ở Hà Nội không có tồn nên không combo nào "còn hàng"
    const hn = await t.as('quanly', t.hn);
    const hnIn = (await hn.get('/products?inStock=true').expect(200)).body;
    expect(hnIn.data).toHaveLength(0);
  });

  it('lookup: combo kèm chuỗi thành phần và số lượng khả dụng tính ra', async () => {
    const api = await t.as('quanly', t.sg);
    const res = (await api.get('/products/lookup?q=cb1').expect(200)).body;
    expect(res[0]).toMatchObject({
      code: 'CB1',
      productType: 'combo',
      components: 'A/2,B/3',
      available: '2.000',
    });
    const goods = (await api.get('/products/lookup?q=hang%20a').expect(200))
      .body;
    expect(goods[0]).toMatchObject({
      code: 'A',
      productType: 'goods',
      components: '',
    });
  });

  it('combo không bao giờ có tồn riêng: ghi sổ kho cho combo bị từ chối (cả một dòng lẫn nhiều dòng), không đổi gì', async () => {
    await expect(
      inv.applyMovement(t.db, {
        branchId: t.sg,
        productId: ids.CB1!,
        qtyDelta: '5',
        unitCost: '100',
        refType: 'adjustment',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(
      inv.applyMovements(t.db, [
        {
          branchId: t.sg,
          productId: ids.A!,
          qtyDelta: '1',
          unitCost: '1000',
          refType: 'adjustment',
        },
        {
          branchId: t.sg,
          productId: ids.CB1!,
          qtyDelta: '1',
          unitCost: '100',
          refType: 'adjustment',
        },
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const [a] = await t.db
      .select()
      .from(stocks)
      .where(eq(stocks.productId, ids.A!));
    expect(a!.onHand).toBe('10.000'); // dòng A đi kèm cũng không được ghi
    expect(
      await t.db.select().from(stocks).where(eq(stocks.productId, ids.CB1!)),
    ).toHaveLength(0);
  });

  it('combo không có thẻ kho', async () => {
    const api = await t.as('quanly', t.sg);
    const card = await api.get(`/products/${ids.CB1}/stock-card`).expect(400);
    expect(card.body.code).toBe('INVALID_STATE');
  });

  it('sửa thành phần: thay toàn bộ, ghi nhật ký trước/sau; gửi thành phần cho hàng hóa → 400', async () => {
    const api = await t.as('quanly', t.sg);
    const res = await api
      .patch(`/products/${ids.CB1}`)
      .send({ components: 'B/1,A/1' })
      .expect(200);
    expect(res.body).toMatchObject({
      components: 'B/1,A/1', // giữ thứ tự nhập
      onHand: '7.000', // A: 10, B: 7 → 7
      costPrice: '1500.0000',
    });
    const logs = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, ids.CB1!));
    const upd = logs.find((l) => l.action === 'product.update')!;
    expect(upd.before).toMatchObject({ components: 'A/2,B/3' });
    expect(upd.after).toMatchObject({ components: 'B/1,A/1' });

    // đổi tên không đụng tới thành phần
    const keep = await api
      .patch(`/products/${ids.CB1}`)
      .send({ name: 'Combo A+B (đổi tên)' })
      .expect(200);
    expect(keep.body.components).toBe('B/1,A/1');

    const bad = await api
      .patch(`/products/${ids.A}`)
      .send({ components: 'B/1' })
      .expect(400);
    expect(bad.body.details[0].field).toBe('components');
    await api
      .patch(`/products/${ids.CB1}`)
      .send({ components: '' })
      .expect(400); // combo không được rỗng
    await api
      .patch(`/products/${ids.CB1}`)
      .send({ components: 'CB-A/1' })
      .expect(400); // không lồng combo
    expect(
      (
        await t.db
          .select()
          .from(productComponents)
          .where(eq(productComponents.comboId, ids.CB1!))
      ).length,
    ).toBe(2); // các lần lỗi không làm mất thành phần
  });

  it('đổi loại hàng: cấm khi đã có giao dịch hoặc đang là thành phần; hàng chưa giao dịch đổi được hai chiều', async () => {
    const api = await t.as('quanly', t.sg);
    // A có tồn (sổ cái) và là thành phần của combo
    const a = await api
      .patch(`/products/${ids.A}`)
      .send({ productType: 'combo', components: 'B/1' })
      .expect(400);
    expect(a.body.code).toBe('INVALID_STATE');
    // C chưa giao dịch nhưng chưa là thành phần → đổi sang combo cần thành phần
    await api
      .patch(`/products/${ids.C}`)
      .send({ productType: 'combo' })
      .expect(400);
    const toCombo = await api
      .patch(`/products/${ids.C}`)
      .send({ productType: 'combo', components: 'B/2' })
      .expect(200);
    expect(toCombo.body).toMatchObject({
      productType: 'combo',
      components: 'B/2',
    });
    // đổi ngược về hàng hóa: thành phần bị bỏ
    const back = await api
      .patch(`/products/${ids.C}`)
      .send({ productType: 'goods' })
      .expect(200);
    expect(back.body).toMatchObject({
      productType: 'goods',
      components: '',
      componentItems: [],
    });
    expect(
      await t.db
        .select()
        .from(productComponents)
        .where(eq(productComponents.comboId, ids.C!)),
    ).toHaveLength(0);
    // combo CB1 đổi sang hàng hóa được (chưa giao dịch) và bị mất thành phần
    const cb = await api
      .post('/products')
      .send({
        code: 'CB-T',
        name: 'Combo tạm',
        productType: 'combo',
        components: 'B/1',
      })
      .expect(201);
    await api
      .patch(`/products/${cb.body.id}`)
      .send({ productType: 'goods' })
      .expect(200);
    // hàng chưa giao dịch nhưng đang là thành phần của một combo → không đổi sang combo được
    const d = await api
      .post('/products')
      .send({ code: 'D1', name: 'Hàng D (chưa giao dịch)' })
      .expect(201);
    await api
      .post('/products')
      .send({
        code: 'CB-D',
        name: 'Combo D',
        productType: 'combo',
        components: 'D1/1',
      })
      .expect(201);
    const dd = await api
      .patch(`/products/${d.body.id}`)
      .send({ productType: 'combo', components: 'A/1' })
      .expect(400);
    expect(dd.body.code).toBe('INVALID_STATE');
    expect(dd.body.message).toContain('thành phần');
    // B đang là thành phần của CB1 → không đổi sang combo được
    const b = await api
      .patch(`/products/${ids.B}`)
      .send({ productType: 'combo', components: 'A/1' })
      .expect(400);
    expect(b.body.code).toBe('INVALID_STATE');
  });

  it('xuất Excel có cột Loại hàng và Hàng thành phần', async () => {
    const api = await t.as('quanly', t.sg);
    const res = await api
      .get('/products?format=xlsx&productType=combo')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const { readSheet } = await import('../../common/excel.js');
    const sheet = await readSheet(res.body as Buffer);
    expect(sheet.headers).toEqual(
      expect.arrayContaining(['loai hang', 'hang thanh phan']),
    );
    const row = sheet.rows.find((r) => r.values['ma hang'] === 'CB1')!;
    expect(row.values['loai hang']).toBe('Combo');
    expect(row.values['hang thanh phan']).toBe('B/1,A/1');
  });
});
