import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLogs,
  categories,
  priceBookItems,
  priceBooks,
  products,
  stocks,
} from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { PricingModule } from './pricing.module.js';

describe('Thiết lập giá qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  const book: Record<string, string> = {};
  const prod: Record<string, string> = {};
  let catA: string;

  const priceOf = async (branchId: string, code: string, bookCode: string) => {
    const [row] = await t.db
      .select()
      .from(priceBookItems)
      .where(
        and(
          eq(priceBookItems.branchId, branchId),
          eq(priceBookItems.productId, prod[code]!),
          eq(priceBookItems.priceBookId, book[bookCode]!),
        ),
      );
    return row ? Number(row.price) : null;
  };
  const setPrice = (
    branchId: string,
    code: string,
    bookCode: string,
    price: string,
  ) =>
    t.db.insert(priceBookItems).values({
      priceBookId: book[bookCode]!,
      branchId,
      productId: prod[code]!,
      price,
    });

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [PricingModule] });
    await t.makeUser('ketoan1', 'accountant', [t.sg, t.hn]);
    await t.makeUser('ketoan_hn', 'accountant', [t.hn]);
    await t.makeUser('sale1', 'sales', [t.sg]);
    await t.makeUser('kho1', 'warehouse', [t.sg, t.hn]);
    await t.makeUser('mkt1', 'marketing', [t.sg]);

    for (const b of await t.db.select().from(priceBooks)) book[b.code] = b.id;
    const [cat] = await t.db
      .insert(categories)
      .values({ name: 'Nhóm A' })
      .returning();
    catA = cat!.id;
    const rows = await t.db
      .insert(products)
      .values([
        { code: 'P1', name: 'Quạt kẹp bàn', categoryId: catA },
        { code: 'P2', name: 'Nồi inox', categoryId: catA },
        { code: 'P3', name: 'Dao thái' },
      ])
      .returning();
    for (const r of rows) prod[r.code] = r.id;

    // Sài Gòn: P1 chung 33.500, lớn 33.000; P2 chung 90.000; Hà Nội: P1 chung 34.500
    await setPrice(t.sg, 'P1', 'CHUNG', '33500');
    await setPrice(t.sg, 'P1', 'LON', '33000');
    await setPrice(t.sg, 'P2', 'CHUNG', '90000');
    await setPrice(t.hn, 'P1', 'CHUNG', '34500');
    await t.db.insert(stocks).values({
      branchId: t.sg,
      productId: prod.P1!,
      costPrice: '21800.5',
    });
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  // ------------------------------------------------------------------ quyền

  it('chưa đăng nhập → 401', async () => {
    await t.http().get('/api/v1/price-books').expect(401);
  });

  it('ma trận quyền: xem cần product.view; sửa giá (lưới, hàng loạt, sao chép, đổi bảng giá) chỉ người có price.edit', async () => {
    const changes = [
      { productId: prod.P1, priceBookId: book.LON, price: '1000' },
    ];
    for (const user of ['sale1', 'kho1', 'mkt1']) {
      const api = await t.as(user, t.sg);
      await api.get('/price-books').expect(200);
      await api.get('/price-books/grid').expect(200);
      for (const res of [
        await api
          .put('/price-books/grid')
          .send({ branchId: t.sg, changes })
          .expect(403),
        await api
          .post('/price-books/bulk-adjust')
          .send({
            branchId: t.sg,
            priceBookId: book.LON,
            mode: 'percent',
            value: '5',
            dryRun: true,
          })
          .expect(403),
        await api
          .post('/price-books/copy-branch')
          .send({ fromBranchId: t.sg, toBranchId: t.hn })
          .expect(403),
        await api
          .patch(`/price-books/${book.LON}`)
          .send({ name: 'X' })
          .expect(403),
      ]) {
        expect(res.body.code).toBe('FORBIDDEN');
      }
    }
    // chưa ai bị đổi giá
    expect(await priceOf(t.sg, 'P1', 'LON')).toBe(33000);
  });

  // ------------------------------------------------------------------ danh sách + lưới

  it('GET /price-books trả đủ 7 bảng giá, Bảng giá chung là mặc định', async () => {
    const api = await t.as('ketoan1');
    const list = (await api.get('/price-books').expect(200)).body as Array<{
      code: string;
      isDefault: boolean;
    }>;
    expect(list).toHaveLength(7);
    expect(list.find((b) => b.isDefault)?.code).toBe('CHUNG');
  });

  it('lưới giá theo ĐÚNG chi nhánh: Sài Gòn và Hà Nội khác nhau; ô chưa có giá là null', async () => {
    const sg = (
      await (await t.as('ketoan1', t.sg)).get('/price-books/grid').expect(200)
    ).body;
    const hn = (
      await (await t.as('ketoan1', t.hn)).get('/price-books/grid').expect(200)
    ).body;
    expect(sg.branchId).toBe(t.sg);
    expect(sg.books).toHaveLength(7);
    const rowSg = sg.data.find((r: { code: string }) => r.code === 'P1');
    const rowHn = hn.data.find((r: { code: string }) => r.code === 'P1');
    expect(rowSg.prices[book.CHUNG!]).toBe('33500');
    expect(rowSg.prices[book.LON!]).toBe('33000');
    expect(rowSg.prices[book.VIP!]).toBeNull();
    expect(rowHn.prices[book.CHUNG!]).toBe('34500');
    expect(rowHn.prices[book.LON!]).toBeNull(); // giá Lớn của Sài Gòn KHÔNG lọt sang Hà Nội
    expect(sg.meta).toMatchObject({ page: 1, limit: 50, total: 3 });
  });

  it('branchId trong query thay cho header; chi nhánh không được phép → 403 BRANCH_FORBIDDEN', async () => {
    const viaQuery = (
      await (
        await t.as('ketoan1')
      )
        .get(`/price-books/grid?branchId=${t.hn}`)
        .expect(200)
    ).body;
    expect(viaQuery.branchId).toBe(t.hn);
    const hnOnly = await t.as('ketoan_hn');
    const res = await hnOnly
      .get(`/price-books/grid?branchId=${t.sg}`)
      .expect(403);
    expect(res.body.code).toBe('BRANCH_FORBIDDEN');
    await hnOnly.get('/price-books/grid').expect(200); // chi nhánh duy nhất nên không cần header
  });

  it('lưới: lọc theo từ khóa không dấu và theo nhóm hàng, phân trang; giá vốn chỉ hiện khi có product.cost.view', async () => {
    const acc = await t.as('ketoan1', t.sg);
    const byQ = (await acc.get('/price-books/grid?q=quat').expect(200)).body;
    expect(byQ.data.map((r: { code: string }) => r.code)).toEqual(['P1']);
    expect(byQ.data[0].costPrice).toBe('21800.5000');
    const byCat = (
      await acc.get(`/price-books/grid?categoryId=${catA}`).expect(200)
    ).body;
    expect(byCat.data.map((r: { code: string }) => r.code)).toEqual([
      'P1',
      'P2',
    ]);
    const paged = (
      await acc.get('/price-books/grid?limit=2&page=2').expect(200)
    ).body;
    expect(paged.data).toHaveLength(1);
    expect(paged.meta).toMatchObject({ total: 3, totalPages: 2 });
    await acc.get('/price-books/grid?limit=201').expect(400);

    const sale = await t.as('sale1', t.sg);
    const noCost = (await sale.get('/price-books/grid').expect(200)).body;
    expect(noCost.data[0]).not.toHaveProperty('costPrice');
  });

  // ------------------------------------------------------------------ lưu lưới

  it('lưu lưới: đặt giá, đổi giá, xóa giá bằng null; chỉ tính ô thực sự đổi; chi nhánh khác không bị đụng', async () => {
    const api = await t.as('ketoan1');
    const res = await api
      .put('/price-books/grid')
      .send({
        branchId: t.sg,
        changes: [
          { productId: prod.P3, priceBookId: book.CHUNG, price: '12000' }, // mới
          { productId: prod.P1, priceBookId: book.CHUNG, price: '34000' }, // đổi
          { productId: prod.P1, priceBookId: book.LON, price: null }, // xóa
          { productId: prod.P2, priceBookId: book.CHUNG, price: '90000' }, // giữ nguyên → không tính
        ],
      })
      .expect(200);
    expect(res.body).toEqual({ updated: 3 });
    expect(await priceOf(t.sg, 'P3', 'CHUNG')).toBe(12000);
    expect(await priceOf(t.sg, 'P1', 'CHUNG')).toBe(34000);
    expect(await priceOf(t.sg, 'P1', 'LON')).toBeNull();
    expect(await priceOf(t.hn, 'P1', 'CHUNG')).toBe(34500); // Hà Nội nguyên vẹn
    expect(await priceOf(t.hn, 'P3', 'CHUNG')).toBeNull();

    const logs = await t.db.select().from(auditLogs);
    const log = logs.find((l) => l.action === 'price.grid_save')!;
    expect(log.branchId).toBe(t.sg);
    expect(log.userId).toBe(await t.userId('ketoan1'));
    expect((log.after as { updated: number }).updated).toBe(3);

    // trả lại như cũ cho các test sau
    await api
      .put('/price-books/grid')
      .send({
        branchId: t.sg,
        changes: [
          { productId: prod.P3, priceBookId: book.CHUNG, price: null },
          { productId: prod.P1, priceBookId: book.CHUNG, price: '33500' },
          { productId: prod.P1, priceBookId: book.LON, price: '33000' },
        ],
      })
      .expect(200);
  });

  it('lưu lưới: giá lẻ/âm/không phải số, ô trùng, sản phẩm hoặc bảng giá không tồn tại, quá 500 ô → 400 và KHÔNG ghi gì', async () => {
    const api = await t.as('ketoan1');
    const send = (changes: unknown[]) =>
      api.put('/price-books/grid').send({ branchId: t.sg, changes });
    const ok = { productId: prod.P3, priceBookId: book.CHUNG, price: '12000' };

    for (const price of ['33000.5', '-1', 'abc', '1e6', ' 5']) {
      const res = await send([ok, { ...ok, productId: prod.P2, price }]).expect(
        400,
      );
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    await send([ok, ok]).expect(400); // ô trùng
    await send([
      ok,
      {
        productId: '00000000-0000-4000-8000-000000000001',
        priceBookId: book.CHUNG,
        price: '1',
      },
    ]).expect(400);
    await send([
      ok,
      { ...ok, priceBookId: '00000000-0000-4000-8000-000000000001' },
    ]).expect(400);
    await send([]).expect(400);
    await send(Array.from({ length: 501 }, () => ({ ...ok }))).expect(400);
    // ô hợp lệ đi cùng ô lỗi không được ghi
    expect(await priceOf(t.sg, 'P3', 'CHUNG')).toBeNull();
  });

  it('lưu lưới: chi nhánh không được phép → 403; chi nhánh không tồn tại → 403/404', async () => {
    const hnOnly = await t.as('ketoan_hn');
    const res = await hnOnly
      .put('/price-books/grid')
      .send({
        branchId: t.sg,
        changes: [{ productId: prod.P3, priceBookId: book.CHUNG, price: '1' }],
      })
      .expect(403);
    expect(res.body.code).toBe('BRANCH_FORBIDDEN');
    expect(await priceOf(t.sg, 'P3', 'CHUNG')).toBeNull();
  });

  // ------------------------------------------------------------------ tăng/giảm hàng loạt

  it('ví dụ số: 33.500 tăng 5% làm tròn 100 → 35.200; xem trước (dryRun) KHÔNG lưu', async () => {
    const api = await t.as('ketoan1');
    const body = {
      branchId: t.sg,
      priceBookId: book.CHUNG,
      mode: 'percent',
      value: '5',
      roundTo: '100',
    };
    const preview = (
      await api
        .post('/price-books/bulk-adjust')
        .send({ ...body, dryRun: true })
        .expect(200)
    ).body;
    expect(preview.dryRun).toBe(true);
    expect(preview.affected).toBe(2);
    const p1 = preview.preview.find((r: { code: string }) => r.code === 'P1');
    expect(p1).toMatchObject({ oldPrice: '33500', newPrice: '35200' }); // 35.175 → 35.200
    const p2 = preview.preview.find((r: { code: string }) => r.code === 'P2');
    expect(p2).toMatchObject({ oldPrice: '90000', newPrice: '94500' });
    // chưa lưu gì
    expect(await priceOf(t.sg, 'P1', 'CHUNG')).toBe(33500);

    const real = (
      await api
        .post('/price-books/bulk-adjust')
        .send({ ...body, dryRun: false })
        .expect(200)
    ).body;
    expect(real.affected).toBe(2);
    expect(await priceOf(t.sg, 'P1', 'CHUNG')).toBe(35200);
    expect(await priceOf(t.sg, 'P2', 'CHUNG')).toBe(94500);
    // Hà Nội và bảng giá khác không bị đụng
    expect(await priceOf(t.hn, 'P1', 'CHUNG')).toBe(34500);
    expect(await priceOf(t.sg, 'P1', 'LON')).toBe(33000);

    const log = (await t.db.select().from(auditLogs)).find(
      (l) => l.action === 'price.bulk_adjust',
    )!;
    expect(log.branchId).toBe(t.sg);
    expect((log.after as { affected: number }).affected).toBe(2);
  });

  it('giảm giá theo số tiền, theo nhóm hàng; giá mới âm thì bỏ qua; luôn ra số nguyên đồng; roundTo mặc định 1', async () => {
    const api = await t.as('ketoan1');
    // nhóm A gồm P1 (35.200) và P2 (94.500); P3 ngoài nhóm không có giá chung
    const res = (
      await api
        .post('/price-books/bulk-adjust')
        .send({
          branchId: t.sg,
          priceBookId: book.CHUNG,
          categoryId: catA,
          mode: 'amount',
          value: '-40000',
          dryRun: false,
        })
        .expect(200)
    ).body;
    expect(res).toMatchObject({ affected: 1, skipped: 1, unchanged: 0 }); // P1 âm → bỏ qua
    expect(await priceOf(t.sg, 'P1', 'CHUNG')).toBe(35200);
    expect(await priceOf(t.sg, 'P2', 'CHUNG')).toBe(54500);

    // phần trăm lẻ: 54.500 giảm 3,3333% = 52.683,4... → làm tròn nguyên đồng
    const frac = (
      await api
        .post('/price-books/bulk-adjust')
        .send({
          branchId: t.sg,
          priceBookId: book.CHUNG,
          mode: 'percent',
          value: '-3.3333',
          dryRun: true,
        })
        .expect(200)
    ).body;
    const p2 = frac.preview.find((r: { code: string }) => r.code === 'P2');
    expect(p2.newPrice).toBe('52683');
    for (const r of frac.preview) expect(r.newPrice).toMatch(/^\d+$/);

    // giá trị 0 → không ô nào đổi
    const zero = (
      await api
        .post('/price-books/bulk-adjust')
        .send({
          branchId: t.sg,
          priceBookId: book.CHUNG,
          mode: 'percent',
          value: '0',
          dryRun: true,
        })
        .expect(200)
    ).body;
    expect(zero).toMatchObject({ affected: 0, unchanged: 2 });
  });

  it('bulk-adjust: dryRun bắt buộc; dữ liệu sai bị từ chối; bảng giá/chi nhánh lạ', async () => {
    const api = await t.as('ketoan1');
    const base = {
      branchId: t.sg,
      priceBookId: book.CHUNG,
      mode: 'percent',
      value: '5',
    };
    await api.post('/price-books/bulk-adjust').send(base).expect(400); // thiếu dryRun
    for (const bad of [
      { value: 'abc' },
      { mode: 'nhan-doi' },
      { roundTo: '0' },
      { roundTo: '1.5' },
    ]) {
      await api
        .post('/price-books/bulk-adjust')
        .send({ ...base, ...bad, dryRun: true })
        .expect(400);
    }
    await api
      .post('/price-books/bulk-adjust')
      .send({
        ...base,
        priceBookId: '00000000-0000-4000-8000-000000000001',
        dryRun: true,
      })
      .expect(404);
    const hnOnly = await t.as('ketoan_hn');
    await hnOnly
      .post('/price-books/bulk-adjust')
      .send({ ...base, dryRun: true })
      .expect(403);
  });

  // ------------------------------------------------------------------ sao chép giữa chi nhánh

  it('copy-branch: overwrite=false chỉ chép ô đích chưa có; overwrite=true ghi đè ô khác giá; đếm đúng', async () => {
    const api = await t.as('ketoan1');
    // Sài Gòn lúc này: P1 chung 35.200, P1 lớn 33.000, P2 chung 54.500; Hà Nội: P1 chung 34.500
    const first = (
      await api
        .post('/price-books/copy-branch')
        .send({ fromBranchId: t.sg, toBranchId: t.hn })
        .expect(200)
    ).body;
    // 3 ô nguồn: P1 lớn và P2 chung là mới; P1 chung đã có ở Hà Nội → bỏ qua
    expect(first).toEqual({ copied: 2, skipped: 1 });
    expect(await priceOf(t.hn, 'P1', 'LON')).toBe(33000);
    expect(await priceOf(t.hn, 'P2', 'CHUNG')).toBe(54500);
    expect(await priceOf(t.hn, 'P1', 'CHUNG')).toBe(34500); // không bị ghi đè

    const over = (
      await api
        .post('/price-books/copy-branch')
        .send({ fromBranchId: t.sg, toBranchId: t.hn, overwrite: true })
        .expect(200)
    ).body;
    // chỉ P1 chung khác giá (34.500 → 35.200); hai ô kia giống nhau nên bỏ qua
    expect(over).toEqual({ copied: 1, skipped: 2 });
    expect(await priceOf(t.hn, 'P1', 'CHUNG')).toBe(35200);

    // chép một bảng giá cụ thể theo hướng ngược lại, không động tới bảng khác
    await t.db.delete(priceBookItems).where(eq(priceBookItems.branchId, t.sg));
    const back = (
      await api
        .post('/price-books/copy-branch')
        .send({ fromBranchId: t.hn, toBranchId: t.sg, priceBookId: book.LON })
        .expect(200)
    ).body;
    expect(back).toEqual({ copied: 1, skipped: 0 });
    expect(await priceOf(t.sg, 'P1', 'LON')).toBe(33000);
    expect(await priceOf(t.sg, 'P1', 'CHUNG')).toBeNull();
  });

  it('copy-branch: hai chi nhánh phải khác nhau; cần quyền ở CẢ hai chi nhánh; bảng giá lạ → 404', async () => {
    const api = await t.as('ketoan1');
    await api
      .post('/price-books/copy-branch')
      .send({ fromBranchId: t.sg, toBranchId: t.sg })
      .expect(400);
    const hnOnly = await t.as('ketoan_hn');
    const res = await hnOnly
      .post('/price-books/copy-branch')
      .send({ fromBranchId: t.sg, toBranchId: t.hn })
      .expect(403);
    expect(res.body.code).toBe('BRANCH_FORBIDDEN');
    await api
      .post('/price-books/copy-branch')
      .send({
        fromBranchId: t.sg,
        toBranchId: t.hn,
        priceBookId: '00000000-0000-4000-8000-000000000001',
      })
      .expect(404);
  });

  // ------------------------------------------------------------------ đổi tên / bật tắt

  it('đổi tên bảng giá; trùng tên → 409; không tắt được Bảng giá chung; tắt bảng khác thì lưới không còn cột đó', async () => {
    const api = await t.as('ketoan1', t.sg);
    const renamed = await api
      .patch(`/price-books/${book.VIP}`)
      .send({ name: 'Khách VIP' })
      .expect(200);
    expect(renamed.body.name).toBe('Khách VIP');
    const dup = await api
      .patch(`/price-books/${book.VIP}`)
      .send({ name: 'lớn' })
      .expect(409);
    expect(dup.body.code).toBe('DUPLICATE_NAME');
    const locked = await api
      .patch(`/price-books/${book.CHUNG}`)
      .send({ isActive: false })
      .expect(400);
    expect(locked.body.code).toBe('INVALID_STATE');

    await api
      .patch(`/price-books/${book.VIP_VAT}`)
      .send({ isActive: false })
      .expect(200);
    const grid = (await api.get('/price-books/grid').expect(200)).body;
    expect(grid.books).toHaveLength(6);
    expect(grid.books.map((b: { id: string }) => b.id)).not.toContain(
      book.VIP_VAT,
    );
    await api
      .patch('/price-books/00000000-0000-4000-8000-000000000001')
      .send({ name: 'x' })
      .expect(404);
  });
});
