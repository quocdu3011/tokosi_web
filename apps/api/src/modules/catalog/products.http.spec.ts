import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  categories,
  customers,
  orderItems,
  orders,
  priceBookItems,
  priceBooks,
  products,
  stocks,
} from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { CatalogModule } from './catalog.module.js';

describe('Hàng hóa qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  let inv: InventoryService;
  let bookId: string;
  let catBep: string;
  let catDao: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [CatalogModule] });
    inv = new InventoryService(t.db);
    await t.makeUser('sale1', 'sales', [t.sg]);
    await t.makeUser('sale_hn', 'sales', [t.hn]);
    await t.makeUser('kho1', 'warehouse', [t.sg, t.hn]);
    await t.makeUser('ketoan1', 'accountant', [t.sg, t.hn]);
    await t.makeUser('mkt1', 'marketing', [t.sg]);

    const [chung] = await t.db
      .select()
      .from(priceBooks)
      .where(eq(priceBooks.isDefault, true));
    bookId = chung!.id;

    const [bep] = await t.db
      .insert(categories)
      .values({ name: 'NHÀ BẾP' })
      .returning();
    catBep = bep!.id;
    const [dao] = await t.db
      .insert(categories)
      .values({ name: 'Dao kéo', parentId: catBep })
      .returning();
    catDao = dao!.id;

    // 4 hàng: A,B ở nhóm con; C ở nhóm cha; D chưa có nhóm
    const rows = await t.db
      .insert(products)
      .values([
        { code: 'QKBSP', name: 'Quạt kẹp bàn Super', categoryId: catDao },
        { code: 'DAO01', name: 'Dao thái rau', categoryId: catDao },
        { code: 'NOI01', name: 'Nồi inox 24cm', categoryId: catBep },
        { code: 'LOA01', name: 'Loa mini', isActive: false },
      ])
      .returning();
    for (const r of rows) ids[r.code] = r.id;

    // Tồn Sài Gòn: QKBSP 515 (vốn 21800,5), DAO01 0; Hà Nội: QKBSP 40 (vốn 22000)
    await inv.applyMovements(t.db, [
      {
        branchId: t.sg,
        productId: ids.QKBSP!,
        qtyDelta: '515',
        unitCost: '21800.5',
        refType: 'adjustment',
      },
      {
        branchId: t.hn,
        productId: ids.QKBSP!,
        qtyDelta: '40',
        unitCost: '22000',
        refType: 'adjustment',
      },
      {
        branchId: t.sg,
        productId: ids.NOI01!,
        qtyDelta: '7',
        unitCost: '90000',
        refType: 'adjustment',
      },
    ]);
    // Giá Bảng giá chung: mỗi chi nhánh một giá
    await t.db.insert(priceBookItems).values([
      {
        priceBookId: bookId,
        branchId: t.sg,
        productId: ids.QKBSP!,
        price: '33500',
      },
      {
        priceBookId: bookId,
        branchId: t.hn,
        productId: ids.QKBSP!,
        price: '34500',
      },
    ]);
    // Một đơn nháp giữ 40 cái QKBSP tại Sài Gòn
    const [cust] = await t.db
      .insert(customers)
      .values({ code: 'KH-T1', name: 'Khách thử' })
      .returning();
    const [order] = await t.db
      .insert(orders)
      .values({
        code: 'DH-T1',
        branchId: t.sg,
        customerId: cust!.id,
        priceBookId: bookId,
        orderedAt: new Date(),
      })
      .returning();
    await t.db.insert(orderItems).values({
      orderId: order!.id,
      lineNo: 1,
      productId: ids.QKBSP!,
      qty: '40',
      listPrice: '33500',
      unitPrice: '33500',
      lineTotal: '1340000',
    });
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  // ------------------------------------------------------------------ danh sách

  it('chưa đăng nhập → 401; thiếu X-Branch-Id với người có nhiều chi nhánh → 400 BRANCH_REQUIRED', async () => {
    await t.http().get('/api/v1/products').expect(401);
    const kho = await t.as('kho1');
    const res = await kho.get('/products').expect(400);
    expect(res.body.code).toBe('BRANCH_REQUIRED');
  });

  it('các trường giá/tồn tính theo ĐÚNG chi nhánh làm việc (Sài Gòn khác Hà Nội), có reserved/available', async () => {
    const sg = await t.as('quanly', t.sg);
    const hn = await t.as('quanly', t.hn);
    const a = (await sg.get(`/products/${ids.QKBSP}`).expect(200)).body;
    expect(a).toMatchObject({
      code: 'QKBSP',
      branchId: t.sg,
      basePrice: '33500',
      onHand: '515.000',
      reserved: '40.000',
      available: '475.000',
      onOrder: '0',
      costPrice: '21800.5000',
      categoryPath: 'NHÀ BẾP > Dao kéo',
      images: [],
    });
    const b = (await hn.get(`/products/${ids.QKBSP}`).expect(200)).body;
    expect(b).toMatchObject({
      branchId: t.hn,
      basePrice: '34500',
      onHand: '40.000',
      reserved: '0.000',
      available: '40.000',
      costPrice: '22000.0000',
    });
  });

  it('thiếu product.cost.view → vắng mặt hẳn costPrice và lastPurchasePrice (không phải null)', async () => {
    const sale = await t.as('sale1', t.sg);
    const res = await sale.get(`/products/${ids.QKBSP}`).expect(200);
    expect(res.body).not.toHaveProperty('costPrice');
    expect(res.body).not.toHaveProperty('lastPurchasePrice');
    expect(res.body.basePrice).toBe('33500');
    const list = await sale.get('/products').expect(200);
    for (const p of list.body.data) {
      expect(p).not.toHaveProperty('costPrice');
    }
    // Kế toán có product.cost.view
    const ketoan = await t.as('ketoan1', t.sg);
    const withCost = await ketoan.get(`/products/${ids.QKBSP}`).expect(200);
    expect(withCost.body.costPrice).toBe('21800.5000');
  });

  it('cô lập chi nhánh: nhân viên chỉ có Hà Nội không xem được dữ liệu Sài Gòn (403 BRANCH_FORBIDDEN)', async () => {
    const hnOnly = await t.as('sale_hn', t.sg);
    const res = await hnOnly.get('/products').expect(403);
    expect(res.body.code).toBe('BRANCH_FORBIDDEN');
    const ok = await t.as('sale_hn');
    const own = await ok.get(`/products/${ids.QKBSP}`).expect(200);
    expect(own.body.branchId).toBe(t.hn);
    expect(own.body.onHand).toBe('40.000');
  });

  it('lọc: tìm không dấu theo mã/tên, nhóm hàng gồm cả nhóm con, isActive, inStock', async () => {
    const api = await t.as('quanly', t.sg);
    const codes = (r: { body: { data: Array<{ code: string }> } }) =>
      r.body.data.map((p) => p.code).sort();

    expect(codes(await api.get('/products?q=quat kep').expect(200))).toEqual([
      'QKBSP',
    ]);
    expect(codes(await api.get('/products?q=qkbsp').expect(200))).toEqual([
      'QKBSP',
    ]);
    expect(codes(await api.get('/products?q=noi%20inox').expect(200))).toEqual([
      'NOI01',
    ]);

    // nhóm cha gồm cả hàng của nhóm con
    expect(
      codes(await api.get(`/products?categoryId=${catBep}`).expect(200)),
    ).toEqual(['DAO01', 'NOI01', 'QKBSP']);
    expect(
      codes(await api.get(`/products?categoryId=${catDao}`).expect(200)),
    ).toEqual(['DAO01', 'QKBSP']);

    expect(
      codes(await api.get('/products?isActive=false').expect(200)),
    ).toEqual(['LOA01']);
    expect(codes(await api.get('/products?isActive=true').expect(200))).toEqual(
      ['DAO01', 'NOI01', 'QKBSP'],
    );

    // còn tồn TẠI CHI NHÁNH làm việc: Sài Gòn có QKBSP và NOI01
    expect(codes(await api.get('/products?inStock=true').expect(200))).toEqual([
      'NOI01',
      'QKBSP',
    ]);
    expect(codes(await api.get('/products?inStock=false').expect(200))).toEqual(
      ['DAO01', 'LOA01'],
    );
  });

  it('phân trang và sắp xếp; sort lạ bị bỏ qua (không lỗi, không lộ cột khác)', async () => {
    const api = await t.as('quanly', t.sg);
    const p1 = (await api.get('/products?limit=2&page=1').expect(200)).body;
    expect(p1.meta).toEqual({ page: 1, limit: 2, total: 4, totalPages: 2 });
    expect(p1.data.map((p: { code: string }) => p.code)).toEqual([
      'DAO01',
      'LOA01',
    ]);
    const p2 = (await api.get('/products?limit=2&page=2').expect(200)).body;
    expect(p2.data.map((p: { code: string }) => p.code)).toEqual([
      'NOI01',
      'QKBSP',
    ]);

    const byStock = (await api.get('/products?sort=-onHand').expect(200)).body;
    expect(byStock.data[0].code).toBe('QKBSP');
    const byName = (await api.get('/products?sort=name').expect(200)).body;
    expect(byName.data[0].name).toBe('Dao thái rau');
    await api.get('/products?sort=passwordHash').expect(200);
    await api.get('/products?limit=500').expect(400);
  });

  it('lookup: tối đa 20 dòng, chỉ hàng đang bán, mã khớp hoàn toàn lên đầu', async () => {
    const api = await t.as('quanly', t.sg);
    const all = (await api.get('/products/lookup').expect(200)).body;
    expect(all.map((p: { code: string }) => p.code)).toEqual([
      'DAO01',
      'NOI01',
      'QKBSP',
    ]); // LOA01 đã ngưng
    const one = (await api.get('/products/lookup?q=dao01').expect(200)).body;
    expect(one[0]).toMatchObject({
      code: 'DAO01',
      unit: 'Cái',
      basePrice: null,
      available: '0.000',
      imageUrl: null,
    });
    const q = (await api.get('/products/lookup?q=quat').expect(200)).body[0];
    expect(q).toMatchObject({
      code: 'QKBSP',
      basePrice: '33500',
      available: '475.000',
    });
  });

  // ------------------------------------------------------------------ tạo / sửa

  it('ma trận quyền tạo/sửa: Sale, Marketing, Kế toán không có product.edit → 403; Kho có', async () => {
    const body = { code: 'NEW01', name: 'Hàng mới' };
    for (const user of ['sale1', 'mkt1', 'ketoan1']) {
      const api = await t.as(user, t.sg);
      const res = await api.post('/products').send(body).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    const kho = await t.as('kho1', t.sg);
    const created = await kho.post('/products').send(body).expect(201);
    expect(created.body).toMatchObject({
      code: 'NEW01',
      name: 'Hàng mới',
      unit: 'Cái',
      isActive: true,
      isSellable: true,
      onHand: '0.000',
      basePrice: null,
    });
    ids.NEW01 = created.body.id;
  });

  it('kiểm tra dữ liệu: mã sai dạng, trùng (kể cả khác hoa thường), nhóm không tồn tại, thiếu tên', async () => {
    const api = await t.as('quanly', t.sg);
    const bad = await api
      .post('/products')
      .send({ code: 'co dau cach', name: 'X' })
      .expect(400);
    expect(bad.body.details[0].field).toBe('code');
    await api
      .post('/products')
      .send({ code: 'x'.repeat(31), name: 'X' })
      .expect(400);
    await api.post('/products').send({ code: 'OK1', name: '' }).expect(400);

    const dup = await api
      .post('/products')
      .send({ code: 'qkbsp', name: 'Trùng mã khác hoa thường' })
      .expect(409);
    expect(dup.body.code).toBe('DUPLICATE_CODE');
    expect(dup.body.details[0].field).toBe('code');

    const noCat = await api
      .post('/products')
      .send({
        code: 'OK2',
        name: 'X',
        categoryId: '00000000-0000-4000-8000-000000000001',
      })
      .expect(400);
    expect(noCat.body.details[0].field).toBe('categoryId');
    expect(
      await t.db.select().from(products).where(eq(products.code, 'OK2')),
    ).toHaveLength(0);
  });

  it('sửa tên/nhóm/đơn vị; ngưng bán; nhật ký ghi trước/sau và requestId', async () => {
    const api = await t.as('quanly', t.sg);
    const res = await api
      .patch(`/products/${ids.NEW01}`)
      .set('X-Request-Id', 'sua-hang-0001')
      .send({
        name: 'Hàng mới đổi tên',
        categoryId: catBep,
        unit: 'Hộp',
        isActive: false,
      })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'Hàng mới đổi tên',
      unit: 'Hộp',
      isActive: false,
      categoryPath: 'NHÀ BẾP',
    });
    const logs = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, ids.NEW01!));
    const upd = logs.find((l) => l.action === 'product.update')!;
    expect(upd.requestId).toBe('sua-hang-0001');
    expect(upd.before).toMatchObject({ name: 'Hàng mới', isActive: true });
    expect(upd.after).toMatchObject({
      name: 'Hàng mới đổi tên',
      isActive: false,
    });
    await api
      .patch('/products/00000000-0000-4000-8000-000000000001')
      .send({ name: 'x' })
      .expect(404);
  });

  it('mã hàng: đổi được khi chưa có giao dịch; đã có giao dịch (tồn/chứng từ) → 400 INVALID_STATE', async () => {
    const api = await t.as('quanly', t.sg);
    const renamed = await api
      .patch(`/products/${ids.NEW01}`)
      .send({ code: 'NEW01B' })
      .expect(200);
    expect(renamed.body.code).toBe('NEW01B');

    const locked = await api
      .patch(`/products/${ids.QKBSP}`)
      .send({ code: 'QKBSP2' })
      .expect(400);
    expect(locked.body.code).toBe('INVALID_STATE');
    // chỉ có dòng trong đơn nháp (chưa có sổ cái kho) cũng đủ để khóa mã
    await inv.applyMovements(t.db, [
      {
        branchId: t.sg,
        productId: ids.DAO01!,
        qtyDelta: '3',
        refType: 'adjustment',
      },
    ]);
    await api
      .patch(`/products/${ids.DAO01}`)
      .send({ code: 'DAO01X' })
      .expect(400);
    // đổi sang mã đã có → 409
    await api
      .patch(`/products/${ids.NEW01}`)
      .send({ code: 'noi01' })
      .expect(409);
  });

  it('người chỉ có product.content.edit (Marketing) chỉ sửa được mô tả; trường khác → 403 kèm danh sách trường', async () => {
    const mkt = await t.as('mkt1', t.sg);
    const ok = await mkt
      .patch(`/products/${ids.DAO01}`)
      .send({ description: 'Dao thép không gỉ' })
      .expect(200);
    expect(ok.body.description).toBe('Dao thép không gỉ');
    const denied = await mkt
      .patch(`/products/${ids.DAO01}`)
      .send({ description: 'x', name: 'Đổi tên trái phép' })
      .expect(403);
    expect(denied.body.details.fields).toEqual(['name']);
    const still = await t.db
      .select()
      .from(products)
      .where(eq(products.id, ids.DAO01!));
    expect(still[0]?.name).toBe('Dao thái rau');
    // Sale không có cả hai quyền
    const sale = await t.as('sale1', t.sg);
    await sale
      .patch(`/products/${ids.DAO01}`)
      .send({ description: 'x' })
      .expect(403);
  });

  // ------------------------------------------------------------------ theo chi nhánh

  it('GET /products/:id/branches: chỉ các chi nhánh được phép, kèm giá 7 bảng giá và giá vốn theo quyền', async () => {
    const all = (
      await (
        await t.as('ketoan1')
      )
        .get(`/products/${ids.QKBSP}/branches`)
        .expect(200)
    ).body as Array<
      Record<string, unknown> & { branchCode: string; prices: unknown[] }
    >;
    expect(all.map((b) => b.branchCode)).toEqual(['HN', 'SG']);
    const sg = all.find((b) => b.branchCode === 'SG')!;
    expect(sg).toMatchObject({
      onHand: '515.000',
      reserved: '40.000',
      available: '475.000',
      costPrice: '21800.5000',
    });
    expect(sg.prices).toHaveLength(7);
    expect(
      (
        sg.prices as Array<{ priceBookCode: string; price: string | null }>
      ).find((p) => p.priceBookCode === 'CHUNG')?.price,
    ).toBe('33500');

    // nhân viên chỉ có Hà Nội chỉ thấy Hà Nội, không có giá vốn
    const hnOnly = (
      await (
        await t.as('sale_hn')
      )
        .get(`/products/${ids.QKBSP}/branches`)
        .expect(200)
    ).body as Array<Record<string, unknown>>;
    expect(hnOnly).toHaveLength(1);
    expect(hnOnly[0]).toMatchObject({ branchCode: 'HN', onHand: '40.000' });
    expect(hnOnly[0]).not.toHaveProperty('costPrice');
  });

  it('PUT /products/:id/branches/:branchId: đặt min/max/vị trí, KHÔNG đụng tồn và giá vốn; ràng buộc min <= max', async () => {
    const api = await t.as('kho1');
    const res = await api
      .put(`/products/${ids.QKBSP}/branches/${t.sg}`)
      .send({ minStock: '10', maxStock: '2000', location: ' Kệ A1 ' })
      .expect(200);
    expect(res.body).toMatchObject({
      minStock: '10.000',
      maxStock: '2000.000',
      location: 'Kệ A1',
      onHand: '515.000',
    });
    const [row] = await t.db
      .select()
      .from(stocks)
      .where(eq(stocks.productId, ids.QKBSP!));
    expect(row).toBeDefined();
    const sgRow = (
      await t.db.select().from(stocks).where(eq(stocks.productId, ids.QKBSP!))
    ).find((s) => s.branchId === t.sg)!;
    expect(sgRow.onHand).toBe('515.000');
    expect(sgRow.costPrice).toBe('21800.5000');

    const bad = await api
      .put(`/products/${ids.QKBSP}/branches/${t.sg}`)
      .send({ minStock: '3000' })
      .expect(400);
    expect(bad.body.details[0].field).toBe('minStock');
    await api
      .put(`/products/${ids.QKBSP}/branches/${t.sg}`)
      .send({ minStock: '-1' })
      .expect(400);
    await api
      .put(`/products/${ids.QKBSP}/branches/${t.sg}`)
      .send({})
      .expect(400);

    // xóa bằng null; hàng chưa có dòng tồn ở chi nhánh → tạo dòng mới với tồn 0
    const cleared = await api
      .put(`/products/${ids.QKBSP}/branches/${t.sg}`)
      .send({ minStock: null, location: null })
      .expect(200);
    expect(cleared.body).toMatchObject({
      minStock: null,
      maxStock: '2000.000',
      location: null,
    });
    const fresh = await api
      .put(`/products/${ids.LOA01}/branches/${t.hn}`)
      .send({ location: 'Kho 2' })
      .expect(200);
    expect(fresh.body).toMatchObject({ onHand: '0.000', location: 'Kho 2' });
  });

  it('PUT theo chi nhánh: thiếu product.edit → 403; không được phép chi nhánh đó → 403 BRANCH_FORBIDDEN; chi nhánh lạ → 403/404', async () => {
    const sale = await t.as('sale1');
    await sale
      .put(`/products/${ids.QKBSP}/branches/${t.sg}`)
      .send({ location: 'x' })
      .expect(403);
    // Kho có cả hai chi nhánh nên thử bằng người chỉ có Sài Gòn và quyền sửa: dùng Quản lý tạm gán ít chi nhánh là không cần;
    // thay vào đó tạo người dùng kho chỉ có Hà Nội
    await t.makeUser('kho_hn', 'warehouse', [t.hn]);
    const khoHn = await t.as('kho_hn');
    const res = await khoHn
      .put(`/products/${ids.QKBSP}/branches/${t.sg}`)
      .send({ location: 'x' })
      .expect(403);
    expect(res.body.code).toBe('BRANCH_FORBIDDEN');
  });

  // ------------------------------------------------------------------ thẻ kho

  it('thẻ kho: tồn đầu kỳ, số dư cộng dồn, ngày theo giờ Việt Nam, giá vốn theo quyền', async () => {
    // Dựng sổ cái riêng cho một hàng mới: 3 dòng ở 3 thời điểm xác định (giờ UTC)
    const [p] = await t.db
      .insert(products)
      .values({ code: 'CARD1', name: 'Hàng thẻ kho' })
      .returning();
    await inv.applyMovement(t.db, {
      branchId: t.sg,
      productId: p!.id,
      qtyDelta: '100',
      unitCost: '1000',
      refType: 'goods_receipt',
      refCode: 'PN-T1',
      occurredAt: new Date('2026-10-31T16:30:00Z'), // 23:30 ngày 31/10 giờ VN
    });
    await inv.applyMovement(t.db, {
      branchId: t.sg,
      productId: p!.id,
      qtyDelta: '-30',
      refType: 'invoice',
      refCode: 'HD-T1',
      occurredAt: new Date('2026-11-01T17:00:00Z'), // 00:00 ngày 02/11 giờ VN
    });
    await inv.applyMovement(t.db, {
      branchId: t.sg,
      productId: p!.id,
      qtyDelta: '-20',
      refType: 'invoice',
      refCode: 'HD-T2',
      occurredAt: new Date('2026-11-02T03:00:00Z'), // 10:00 ngày 02/11 giờ VN
    });

    const api = await t.as('quanly', t.sg);
    const card = (
      await api
        .get(`/products/${p!.id}/stock-card?from=2026-11-01&to=2026-11-02`)
        .expect(200)
    ).body;
    // 23:30 ngày 31/10 VN thuộc TRƯỚC kỳ → tồn đầu kỳ 100; hai dòng ngày 02/11 VN thuộc trong kỳ
    expect(card.openingQty).toBe('100.000');
    expect(
      card.movements.map(
        (m: { refCode: string; qtyDelta: string; balance: string }) => [
          m.refCode,
          m.qtyDelta,
          m.balance,
        ],
      ),
    ).toEqual([
      ['HD-T1', '-30.000', '70.000'],
      ['HD-T2', '-20.000', '50.000'],
    ]);
    expect(card.closingQty).toBe('50.000');
    expect(card.movements[0].unitCost).toBe('1000.0000');

    // không giới hạn ngày: thấy cả 3 dòng, tồn đầu kỳ 0
    const full = (await api.get(`/products/${p!.id}/stock-card`).expect(200))
      .body;
    expect(full.openingQty).toBe('0.000');
    expect(full.movements).toHaveLength(3);
    expect(full.closingQty).toBe('50.000');

    // chi nhánh khác không có dòng nào
    const hn = await t.as('quanly', t.hn);
    const empty = (await hn.get(`/products/${p!.id}/stock-card`).expect(200))
      .body;
    expect(empty.movements).toEqual([]);
    expect(empty.closingQty).toBe('0.000');

    // thiếu quyền xem giá vốn → không có unitCost
    const sale = await t.as('sale1', t.sg);
    const noCost = (await sale.get(`/products/${p!.id}/stock-card`).expect(200))
      .body;
    expect(noCost.movements[0]).not.toHaveProperty('unitCost');

    await api
      .get(`/products/${p!.id}/stock-card?from=2026-11-05&to=2026-11-01`)
      .expect(400);
    await api.get(`/products/${p!.id}/stock-card?from=hôm-qua`).expect(400);
    await api
      .get('/products/00000000-0000-4000-8000-000000000001/stock-card')
      .expect(404);
  });
  it('id hoặc branchId sai dạng → 400 VALIDATION_ERROR với details theo đúng tên tham số', async () => {
    const api = await t.as('quanly', t.sg);
    const a = await api.get('/products/khong-phai-uuid').expect(400);
    expect(a.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'id' }],
    });
    const b = await api
      .put(`/products/${ids.QKBSP}/branches/abc`)
      .send({ location: 'x' })
      .expect(400);
    expect(b.body.details[0].field).toBe('branchId');
  });
});
