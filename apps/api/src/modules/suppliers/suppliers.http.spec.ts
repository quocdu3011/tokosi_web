import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSheet } from '../../common/excel.js';
import {
  auditLogs,
  debtLedger,
  goodsReceipts,
  purchaseReturns,
  supplierBranchHistory,
  suppliers,
} from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { SuppliersModule } from './suppliers.module.js';

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
 * Nhà cung cấp: MỌI số tiền (nợ, tổng mua, tổng mua trừ trả hàng) là riêng từng chi nhánh, không cộng gộp.
 * Dữ liệu thử — NCC000001: Sài Gòn lịch sử 10.000.000/9.000.000, nhập 5.000.000, trả 500.000, nợ 4.000.000;
 * Hà Nội lịch sử 3.000.000/3.000.000, nhập 2.000.000, nợ 2.000.000.
 */
describe('Nhà cung cấp qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [SuppliersModule] });
    await t.makeUser('ketoan1', 'accountant', [t.sg, t.hn]);
    await t.makeUser('ketoan_sg', 'accountant', [t.sg]);
    await t.makeUser('kho1', 'warehouse', [t.sg, t.hn]);
    await t.makeUser('mkt1', 'marketing', [t.sg]);

    const rows = await t.db
      .insert(suppliers)
      .values([
        {
          code: 'NCC000001',
          name: 'Công ty Bao Bì Á Châu',
          groupName: 'Bao bì',
        },
        { code: 'NCC000002', name: 'Anh Tuấn', groupName: 'Lái xe' },
        { code: 'NCC000003', name: 'Cửa hàng Đồ Gốm', isActive: false },
      ])
      .returning();
    for (const r of rows) ids[r.code] = r.id;

    await t.db.insert(supplierBranchHistory).values([
      {
        supplierId: ids.NCC000001!,
        branchId: t.sg,
        purchaseTotal: '10000000',
        purchaseNet: '9000000',
      },
      {
        supplierId: ids.NCC000001!,
        branchId: t.hn,
        purchaseTotal: '3000000',
        purchaseNet: '3000000',
      },
    ]);
    await t.db.insert(goodsReceipts).values([
      {
        code: 'PN-T1',
        branchId: t.sg,
        supplierId: ids.NCC000001!,
        receivedAt: new Date(),
        total: '5000000',
      },
      {
        code: 'PN-T2',
        branchId: t.hn,
        supplierId: ids.NCC000001!,
        receivedAt: new Date(),
        total: '2000000',
      },
      {
        code: 'PN-T3',
        branchId: t.sg,
        supplierId: ids.NCC000001!,
        status: 'cancelled', // phiếu đã hủy không được tính
        receivedAt: new Date(),
        total: '999000',
      },
    ]);
    await t.db.insert(purchaseReturns).values({
      code: 'THN-T1',
      branchId: t.sg,
      supplierId: ids.NCC000001!,
      returnedAt: new Date(),
      total: '500000',
    });
    const ledger = (
      branchId: string,
      amount: string,
      entryType: 'opening' | 'invoice',
    ) => ({
      branchId,
      partyType: 'supplier' as const,
      partyId: ids.NCC000001!,
      entryType,
      amount,
      occurredAt: new Date(),
    });
    await t.db
      .insert(debtLedger)
      .values([
        ledger(t.sg, '1500000', 'opening'),
        ledger(t.sg, '2500000', 'invoice'),
        ledger(t.hn, '2000000', 'invoice'),
      ]);
    // NCC000002: trả dư (nợ âm −300.000) ở SG nhưng còn nợ +100.000 ở HN — cộng gộp sẽ ra −200.000 (sai)
    await t.db.insert(debtLedger).values([
      {
        branchId: t.sg,
        partyType: 'supplier',
        partyId: ids.NCC000002!,
        entryType: 'adjustment',
        amount: '-300000',
        occurredAt: new Date(),
      },
      {
        branchId: t.hn,
        partyType: 'supplier',
        partyId: ids.NCC000002!,
        entryType: 'invoice',
        amount: '100000',
        occurredAt: new Date(),
      },
    ]);
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  const as = (user: string, branch?: string): Promise<Api> =>
    t.as(user, branch) as Promise<Api>;
  const codes = (body: { data: Array<{ code: string }> }) =>
    body.data.map((s) => s.code);

  // ------------------------------------------------------------------ quyền, chi nhánh

  it('chưa đăng nhập → 401; Marketing (không có purchase.view) → 403; Kho xem được nhưng KHÔNG thấy nợ', async () => {
    await t.http().get('/api/v1/suppliers').expect(401);
    await (await as('mkt1', t.sg)).get('/suppliers').expect(403);
    const kho = await (await as('kho1', t.sg)).get('/suppliers').expect(200);
    for (const s of kho.body.data) expect(s).not.toHaveProperty('balance');
    const detail = await (
      await as('kho1', t.sg)
    )
      .get(`/suppliers/${ids.NCC000001}`)
      .expect(200);
    expect(detail.body).not.toHaveProperty('balance');
    expect(detail.body.totalPurchase).toBe('15000000'); // thống kê mua vẫn xem được
    const perBranch = await (
      await as('kho1')
    )
      .get(`/suppliers/${ids.NCC000001}/branches`)
      .expect(200);
    for (const b of perBranch.body) expect(b).not.toHaveProperty('balance');
  });

  it('thiếu X-Branch-Id với người có nhiều chi nhánh → 400 BRANCH_REQUIRED; chi nhánh không được phép → 403', async () => {
    const r = await (await as('ketoan1')).get('/suppliers').expect(400);
    expect(r.body.code).toBe('BRANCH_REQUIRED');
    await (await as('ketoan_sg', t.hn)).get('/suppliers').expect(403);
  });

  // ------------------------------------------------------------------ danh sách

  it('danh sách: không có nhà cung cấp hệ thống (chi nhánh); tiền tính RIÊNG cho chi nhánh làm việc', async () => {
    const api = await as('ketoan1', t.sg);
    const res = (await api.get('/suppliers').expect(200)).body;
    expect(codes(res)).toEqual(['NCC000001', 'NCC000002', 'NCC000003']); // không có CN-SG, CN-HN
    const a = res.data.find((s: { code: string }) => s.code === 'NCC000001');
    expect(a).toMatchObject({
      name: 'Công ty Bao Bì Á Châu',
      groupName: 'Bao bì',
      isActive: true,
      branchId: t.sg,
      // Sài Gòn: lịch sử 10.000.000 + nhập 5.000.000 (phiếu hủy và phiếu Hà Nội không tính)
      totalPurchase: '15000000',
      // 9.000.000 + 5.000.000 − trả 500.000
      netPurchase: '13500000',
      balance: '4000000',
    });
    const b = res.data.find((s: { code: string }) => s.code === 'NCC000002');
    expect(b).toMatchObject({
      totalPurchase: '0',
      netPurchase: '0',
      balance: '-300000',
    });
    expect(res.meta).toMatchObject({ page: 1, total: 3 });

    // Hà Nội: bộ số hoàn toàn khác, không cộng gộp với Sài Gòn
    const hn = (await (await as('ketoan1', t.hn)).get('/suppliers').expect(200))
      .body;
    expect(
      hn.data.find((s: { code: string }) => s.code === 'NCC000001'),
    ).toMatchObject({
      branchId: t.hn,
      totalPurchase: '5000000', // 3.000.000 + 2.000.000
      netPurchase: '5000000',
      balance: '2000000',
    });
    expect(
      hn.data.find((s: { code: string }) => s.code === 'NCC000002'),
    ).toMatchObject({ balance: '100000' });
  });

  it('lọc: tìm không dấu theo tên/nhóm, nhóm, trạng thái, nợ (theo chi nhánh làm việc); hasDebt cần debt.view', async () => {
    const api = await as('ketoan1', t.sg);
    expect(
      codes((await api.get('/suppliers?q=bao%20bi').expect(200)).body),
    ).toEqual(['NCC000001']);
    expect(
      codes((await api.get('/suppliers?q=lai%20xe').expect(200)).body),
    ).toEqual(['NCC000002']); // tìm trong nhóm
    expect(
      codes((await api.get('/suppliers?groupName=LAI%20XE').expect(200)).body),
    ).toEqual(['NCC000002']);
    expect(
      codes((await api.get('/suppliers?isActive=false').expect(200)).body),
    ).toEqual(['NCC000003']);
    expect(
      codes((await api.get('/suppliers?hasDebt=true').expect(200)).body),
    ).toEqual(['NCC000001']);
    // nợ âm (trả dư) và không nợ đều là "không nợ"
    expect(
      codes((await api.get('/suppliers?hasDebt=false').expect(200)).body),
    ).toEqual(['NCC000002', 'NCC000003']);
    // nợ được xét RIÊNG theo chi nhánh: NCC000002 trả dư ở Sài Gòn nhưng còn nợ ở Hà Nội
    const hn = await as('ketoan1', t.hn);
    expect(
      codes((await hn.get('/suppliers?hasDebt=true').expect(200)).body),
    ).toEqual(['NCC000001', 'NCC000002']);
    const denied = await (
      await as('kho1', t.sg)
    )
      .get('/suppliers?hasDebt=true')
      .expect(403);
    expect(denied.body.details.permission).toBe('debt.view');
  });

  it('phân trang và sắp xếp; sort lạ bị bỏ qua', async () => {
    const api = await as('ketoan1', t.sg);
    const p1 = (await api.get('/suppliers?limit=2&sort=-code').expect(200))
      .body;
    expect(codes(p1)).toEqual(['NCC000003', 'NCC000002']);
    expect(p1.meta).toMatchObject({ total: 3, totalPages: 2 });
    const p2 = (
      await api.get('/suppliers?limit=2&page=2&sort=-code').expect(200)
    ).body;
    expect(codes(p2)).toEqual(['NCC000001']);
    await api.get('/suppliers?sort=passwordHash').expect(200);
  });

  it('xuất Excel theo chi nhánh làm việc: có cột nợ khi có debt.view, không có khi thiếu', async () => {
    const get = async (user: string, branch: string) => {
      const res = await (
        await as(user, branch)
      )
        .get('/suppliers?format=xlsx')
        .buffer(true)
        .parse(bin as never);
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(
        /nha-cung-cap-\d{8}\.xlsx/,
      );
      return readSheet(res.body as Buffer);
    };
    const full = await get('ketoan1', t.sg);
    expect(full.headers).toEqual(
      expect.arrayContaining([
        'ma nha cung cap',
        'ten nha cung cap',
        'no can tra hien tai',
        'tong mua',
        'tong mua tru tra hang',
      ]),
    );
    const row = full.rows.find(
      (r) => r.values['ma nha cung cap'] === 'NCC000001',
    )!;
    expect(row.values['no can tra hien tai']).toBe(4000000);
    expect(row.values['tong mua']).toBe(15000000);
    const hn = await get('ketoan1', t.hn);
    expect(
      hn.rows.find((r) => r.values['ma nha cung cap'] === 'NCC000001')!.values[
        'tong mua'
      ],
    ).toBe(5000000);
    // Ngày tạo hiển thị giờ Việt Nam dạng dd/MM/yyyy HH:mm (không phải ISO UTC)
    expect(row.values['ngay tao']).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    const limited = await get('kho1', t.sg);
    expect(limited.headers).not.toContain('no can tra hien tai');
  });

  // ------------------------------------------------------------------ chi tiết

  it('chi tiết theo chi nhánh làm việc; /branches liệt kê từng chi nhánh được phép, không cộng gộp', async () => {
    const api = await as('ketoan1', t.sg);
    const d = (await api.get(`/suppliers/${ids.NCC000001}`).expect(200)).body;
    expect(d).toMatchObject({
      branchId: t.sg,
      balance: '4000000',
      totalPurchase: '15000000',
    });
    expect(d).not.toHaveProperty('balances');

    const all = (
      await api.get(`/suppliers/${ids.NCC000001}/branches`).expect(200)
    ).body;
    expect(all).toEqual([
      expect.objectContaining({
        branchCode: 'HN',
        totalPurchase: '5000000',
        netPurchase: '5000000',
        balance: '2000000',
      }),
      expect.objectContaining({
        branchCode: 'SG',
        totalPurchase: '15000000',
        netPurchase: '13500000',
        balance: '4000000',
      }),
    ]);
    // người chỉ có Sài Gòn chỉ thấy dòng Sài Gòn
    const sgOnly = (
      await (
        await as('ketoan_sg')
      )
        .get(`/suppliers/${ids.NCC000001}/branches`)
        .expect(200)
    ).body;
    expect(sgOnly).toHaveLength(1);
    expect(sgOnly[0]).toMatchObject({ branchCode: 'SG', balance: '4000000' });
  });

  it('id sai dạng → 400; id lạ → 404; nhà cung cấp hệ thống → 404 (cả sửa)', async () => {
    const api = await as('ketoan1', t.sg);
    expect(
      (await api.get('/suppliers/abc').expect(400)).body.details[0].field,
    ).toBe('id');
    await api
      .get('/suppliers/00000000-0000-4000-8000-000000000001')
      .expect(404);
    await api
      .get('/suppliers/00000000-0000-4000-8000-000000000001/branches')
      .expect(404);
    const [internal] = await t.db
      .select()
      .from(suppliers)
      .where(eq(suppliers.code, 'CN-SG'));
    await api.get(`/suppliers/${internal!.id}`).expect(404);
    await api.get(`/suppliers/${internal!.id}/branches`).expect(404);
    await api
      .patch(`/suppliers/${internal!.id}`)
      .send({ name: 'x' })
      .expect(404);
  });

  // ------------------------------------------------------------------ sổ công nợ

  describe('sổ công nợ GET /suppliers/:id/ledger', () => {
    let led: string;
    beforeAll(async () => {
      const [s] = await t.db
        .insert(suppliers)
        .values({ code: 'NCC-LEDGER', name: 'Nhà cung cấp thử sổ' })
        .returning();
      led = s!.id;
      const row = (
        branchId: string,
        entryType: 'opening' | 'invoice' | 'payment',
        amount: string,
        at: string,
        refCode: string | null = null,
      ) => ({
        branchId,
        partyType: 'supplier' as const,
        partyId: led,
        entryType,
        amount,
        occurredAt: new Date(at),
        refCode,
      });
      await t.db.insert(debtLedger).values([
        row(t.sg, 'opening', '1000000', '2026-10-30T03:00:00Z'),
        // 23:30 ngày 02/11 giờ Việt Nam (= 16:30 UTC) → thuộc ngày 02/11
        row(t.sg, 'invoice', '500000', '2026-11-02T16:30:00Z', 'PN000001'),
        // 00:30 ngày 03/11 giờ Việt Nam (= 17:30 UTC ngày 02/11) → thuộc ngày 03/11
        row(t.sg, 'payment', '-200000', '2026-11-02T17:30:00Z', 'CTM000001'),
        row(t.sg, 'invoice', '100000', '2026-11-10T03:00:00Z', 'PN000002'),
        // Hà Nội có sổ riêng, không lẫn vào Sài Gòn
        row(t.hn, 'invoice', '999', '2026-11-02T03:00:00Z'),
      ]);
    });
    const ledger = async (query = '', branch = t.sg) =>
      (
        await (
          await as('ketoan1', branch)
        )
          .get(`/suppliers/${led}/ledger${query}`)
          .expect(200)
      ).body;

    it('không khoảng ngày: số dư đầu 0, số dư cộng dồn từng dòng, đúng thứ tự thời gian', async () => {
      const l = await ledger();
      expect(l).toMatchObject({
        branchId: t.sg,
        openingBalance: '0',
        closingBalance: '1400000',
      });
      expect(
        l.entries.map(
          (e: { entryType: string; amount: string; balance: string }) => [
            e.entryType,
            e.amount,
            e.balance,
          ],
        ),
      ).toEqual([
        ['opening', '1000000', '1000000'],
        ['invoice', '500000', '1500000'],
        ['payment', '-200000', '1300000'],
        ['invoice', '100000', '1400000'],
      ]);
      expect(l.entries[1]).toMatchObject({
        refCode: 'PN000001',
        occurredAt: '2026-11-02T16:30:00.000Z',
      });
    });

    it('mỗi chi nhánh một sổ riêng', async () => {
      const hn = await ledger('', t.hn);
      expect(hn).toMatchObject({
        branchId: t.hn,
        closingBalance: '999',
      });
      expect(hn.entries).toHaveLength(1);
    });

    it('khoảng ngày tính theo giờ Việt Nam: số dư đầu kỳ gồm mọi dòng trước `from`', async () => {
      // from 03/11: dòng 23:30 ngày 02/11 (giờ VN) nằm trước, dòng 00:30 ngày 03/11 nằm trong
      const a = await ledger('?from=2026-11-03');
      expect(a.openingBalance).toBe('1500000');
      expect(a.entries.map((e: { refCode: string }) => e.refCode)).toEqual([
        'CTM000001',
        'PN000002',
      ]);
      expect(a.closingBalance).toBe('1400000');
      // đúng một ngày 02/11
      const b = await ledger('?from=2026-11-02&to=2026-11-02');
      expect(b.openingBalance).toBe('1000000');
      expect(b.entries).toHaveLength(1);
      expect(b.closingBalance).toBe('1500000');
      // chỉ `to`: số dư đầu 0, hai đầu đều tính cả ngày
      const c = await ledger('?to=2026-11-03');
      expect(c.openingBalance).toBe('0');
      expect(c.entries).toHaveLength(3);
      expect(c.closingBalance).toBe('1300000');
      // khoảng không có dòng nào: số dư đầu = số dư cuối
      const d = await ledger('?from=2026-11-04&to=2026-11-09');
      expect(d).toMatchObject({
        openingBalance: '1300000',
        closingBalance: '1300000',
      });
      expect(d.entries).toEqual([]);
    });

    it('ngày không có thật (31/02, tháng 13…) → 400, không bị đổi sang ngày khác', async () => {
      const api = await as('ketoan1', t.sg);
      for (const bad of ['2026-02-31', '2026-04-31', '2026-13-01']) {
        const r = await api
          .get(`/suppliers/${led}/ledger?from=${bad}`)
          .expect(400);
        expect(r.body.details[0].field).toBe('from');
        await api.get(`/suppliers/${led}/ledger?to=${bad}`).expect(400);
      }
    });

    it('quyền và dữ liệu: cần cả purchase.view và debt.view; ngày sai → 400; id lạ/nội bộ → 404; thiếu chi nhánh → 400', async () => {
      await (
        await as('kho1', t.sg)
      )
        .get(`/suppliers/${led}/ledger`)
        .expect(403); // Kho không có debt.view
      await (
        await as('mkt1', t.sg)
      )
        .get(`/suppliers/${led}/ledger`)
        .expect(403);
      const api = await as('ketoan1', t.sg);
      for (const bad of ['?from=2026-13-45', '?from=abc', '?to=2026-1-1']) {
        await api.get(`/suppliers/${led}/ledger${bad}`).expect(400);
      }
      const range = await api
        .get(`/suppliers/${led}/ledger?from=2026-11-05&to=2026-11-01`)
        .expect(400);
      expect(range.body.details[0].field).toBe('to');
      await api
        .get('/suppliers/00000000-0000-4000-8000-000000000001/ledger')
        .expect(404);
      const [internal] = await t.db
        .select()
        .from(suppliers)
        .where(eq(suppliers.code, 'CN-SG'));
      await api.get(`/suppliers/${internal!.id}/ledger`).expect(404);
      const noBranch = await (
        await as('ketoan1')
      )
        .get(`/suppliers/${led}/ledger`)
        .expect(400);
      expect(noBranch.body.code).toBe('BRANCH_REQUIRED');
    });
  });

  // ------------------------------------------------------------------ tạo / sửa

  it('tạo: tự cấp mã NCC000056…; mã tự nhập; trùng (kể cả khác hoa thường) → 409; kiểm tra dữ liệu; nhóm rỗng → null', async () => {
    const kho = await as('kho1', t.sg); // Kho có purchase.edit
    const a = await kho
      .post('/suppliers')
      .send({ name: '  Công ty Mới  ', groupName: '  Hàng gia dụng ' })
      .expect(201);
    expect(a.body).toMatchObject({
      code: 'NCC000056',
      name: 'Công ty Mới',
      groupName: 'Hàng gia dụng',
      isActive: true,
      totalPurchase: '0',
      branchId: t.sg,
    });
    expect(a.body.createdByName).toBeTruthy();
    ids.NEW = a.body.id;
    const b = await kho
      .post('/suppliers')
      .send({ name: 'B', groupName: '   ' })
      .expect(201);
    expect(b.body).toMatchObject({ code: 'NCC000057', groupName: null });

    const c = await kho
      .post('/suppliers')
      .send({ code: 'ncc-tay-1', name: 'C' })
      .expect(201);
    expect(c.body.code).toBe('ncc-tay-1');
    const dup = await kho
      .post('/suppliers')
      .send({ code: 'NCC-TAY-1', name: 'D' })
      .expect(409);
    expect(dup.body).toMatchObject({ code: 'DUPLICATE_CODE' });
    expect(dup.body.details[0].field).toBe('code');
    // lỗi trùng không làm hổng số tự cấp
    const e = await kho.post('/suppliers').send({ name: 'E' }).expect(201);
    expect(e.body.code).toBe('NCC000058');

    await kho.post('/suppliers').send({ name: '' }).expect(400);
    await kho
      .post('/suppliers')
      .send({ name: 'x', code: 'co dau cach' })
      .expect(400);
    await kho
      .post('/suppliers')
      .send({ name: 'x'.repeat(256) })
      .expect(400);
    await kho.post('/suppliers').send({ name: 'x', phone: '0901' }).expect(400); // trường đã bỏ bị từ chối
  });

  it('mã tự nhập trùng đúng số kế tiếp KHÔNG làm hỏng việc tự cấp: bỏ qua mã đã có, lần sau cấp tiếp', async () => {
    const kho = await as('kho1', t.sg);
    // sau test trước, mã tự cấp gần nhất là NCC000058 → số kế tiếp là NCC000059
    const taken = await kho
      .post('/suppliers')
      .send({ code: 'NCC000059', name: 'Nhập tay đúng số kế tiếp' })
      .expect(201);
    expect(taken.body.code).toBe('NCC000059');
    // cả khi mã bị chiếm khác hoa thường
    await kho
      .post('/suppliers')
      .send({ code: 'ncc000060', name: 'Nhập tay chữ thường' })
      .expect(201);
    const auto = await kho
      .post('/suppliers')
      .send({ name: 'Tự cấp' })
      .expect(201);
    expect(auto.body.code).toBe('NCC000061'); // bỏ qua 059, 060
    const next = await kho
      .post('/suppliers')
      .send({ name: 'Tự cấp 2' })
      .expect(201);
    expect(next.body.code).toBe('NCC000062');
  });

  it('mã khác hoa thường bị chặn cả ở CSDL (chỉ mục duy nhất trên lower(code))', async () => {
    await t.db.insert(suppliers).values({ code: 'Abc-DB', name: 'x' });
    await expect(
      t.db.insert(suppliers).values({ code: 'ABC-db', name: 'y' }),
    ).rejects.toThrow();
  });

  it('ma trận quyền tạo/sửa: Marketing → 403; Kế toán/Kho được', async () => {
    const mkt = await as('mkt1', t.sg);
    await mkt.post('/suppliers').send({ name: 'x' }).expect(403);
    await mkt.patch(`/suppliers/${ids.NEW}`).send({ name: 'x' }).expect(403);
    await (
      await as('ketoan1', t.sg)
    )
      .patch(`/suppliers/${ids.NEW}`)
      .send({ name: 'Công ty Mới 2' })
      .expect(200);
  });

  it('sửa: tên, nhóm (null xóa nhóm), ngưng/mở lại; mã không đổi được; nhật ký trước/sau', async () => {
    const api = await as('ketoan1', t.sg);
    const res = await api
      .patch(`/suppliers/${ids.NEW}`)
      .set('X-Request-Id', 'sua-ncc-0001')
      .send({ name: 'Tên mới', groupName: null, isActive: false })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'Tên mới',
      groupName: null,
      isActive: false,
    });
    expect(
      codes((await api.get('/suppliers?isActive=false').expect(200)).body),
    ).toContain('NCC000056');

    const back = await api
      .patch(`/suppliers/${ids.NEW}`)
      .send({ isActive: true })
      .expect(200);
    expect(back.body.isActive).toBe(true);

    await api
      .patch(`/suppliers/${ids.NEW}`)
      .send({ code: 'DOI-MA' })
      .expect(400); // không có trường code
    expect(
      (
        await t.db.select().from(suppliers).where(eq(suppliers.id, ids.NEW!))
      )[0]!.code,
    ).toBe('NCC000056');

    const logs = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, ids.NEW!));
    const upd = logs.find(
      (l) => l.action === 'supplier.update' && l.requestId === 'sua-ncc-0001',
    )!;
    expect(upd.before).toMatchObject({
      name: 'Công ty Mới 2',
      groupName: 'Hàng gia dụng',
      isActive: true,
    });
    expect(upd.after).toMatchObject({
      name: 'Tên mới',
      groupName: null,
      isActive: false,
    });
    expect(logs.some((l) => l.action === 'supplier.create')).toBe(true);
  });
});
