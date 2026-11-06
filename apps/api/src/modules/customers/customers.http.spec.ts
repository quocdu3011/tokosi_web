import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeHeader, readSheet } from '../../common/excel.js';
import { auditLogs, customers, debtLedger } from '../../db/schema/index.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { CustomersModule } from './customers.module.js';

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
 * Khách hàng: xem được mọi khách; sửa/công nợ theo phạm vi; mọi số tiền RIÊNG từng chi nhánh.
 * Vai trò thử: quanly (Quản lý), sale1/sale2 (Sale: customer.edit + debt.view chỉ của mình), tro1 (Trợ lý: sửa tất cả,
 * xem nợ tất cả), ketoan1 (Kế toán: xem + nợ, không sửa), mkt1/kho1 (chỉ xem khách, không thấy nợ).
 */
describe('Khách hàng qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  let sale1Id: string;
  let sale2Id: string;

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [CustomersModule] });
    await t.makeUser('sale1', 'sales', [t.sg, t.hn]);
    await t.makeUser('sale2', 'sales', [t.sg]);
    await t.makeUser('tro1', 'assistant', [t.sg, t.hn]);
    await t.makeUser('ketoan1', 'accountant', [t.sg, t.hn]);
    await t.makeUser('ketoan_sg', 'accountant', [t.sg]);
    await t.makeUser('mkt1', 'marketing', [t.sg]);
    await t.makeUser('kho1', 'warehouse', [t.sg]);
    sale1Id = await t.userId('sale1');
    sale2Id = await t.userId('sale2');
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  const as = (user: string, branch?: string): Promise<Api> =>
    t.as(user, branch) as Promise<Api>;
  const mk = async (
    who: string,
    body: Record<string, unknown>,
    branch: string = t.sg,
  ) => (await (await as(who, branch)).post('/customers').send(body)).body;

  // ------------------------------------------------------------------ quyền

  it('chưa đăng nhập → 401; ai có customer.view cũng xem được khách của người khác; không có customer.edit thì không tạo/sửa', async () => {
    await t.http().get('/api/v1/customers').expect(401);
    const a = await mk('sale1', { name: 'Khách của Sale 1', phone: '0901000001' });
    expect(a.salesOwner.id).toBe(sale1Id);
    // Sale 2 xem được khách của Sale 1
    const seen = await (await as('sale2', t.sg)).get(`/customers/${a.id}`).expect(200);
    expect(seen.body.name).toBe('Khách của Sale 1');
    const list = await (await as('sale2', t.sg)).get('/customers').expect(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(a.id);
    // Kho/Marketing xem được nhưng không tạo/sửa được
    await (await as('mkt1', t.sg)).get('/customers').expect(200);
    await (await as('kho1', t.sg))
      .post('/customers')
      .send({ name: 'X' })
      .expect(403);
    await (await as('ketoan1', t.sg))
      .patch(`/customers/${a.id}`)
      .send({ name: 'Y' })
      .expect(403);
  });

  it('Sale (customer.edit chỉ của mình): khách tạo ra luôn do mình phụ trách; không tạo hộ người khác, không sửa/chuyển khách của người khác', async () => {
    const own = await mk('sale1', { name: 'Của sale1 (tự gán)' });
    expect(own.salesOwner.id).toBe(sale1Id);
    const other = await (await as('sale1', t.sg))
      .post('/customers')
      .send({ name: 'Hộ người khác', salesOwnerId: sale2Id })
      .expect(403);
    expect(other.body.code).toBe('FORBIDDEN');
    // sửa khách của chính mình được, sửa khách của sale2 thì không
    await (await as('sale1', t.sg))
      .patch(`/customers/${own.id}`)
      .send({ address: '12 Đường A' })
      .expect(200);
    const b = await mk('sale2', { name: 'Của sale2' });
    await (await as('sale1', t.sg))
      .patch(`/customers/${b.id}`)
      .send({ address: 'x' })
      .expect(403);
    // không chuyển khách của mình cho người khác
    await (await as('sale1', t.sg))
      .patch(`/customers/${own.id}`)
      .send({ salesOwnerId: sale2Id })
      .expect(403);
    // Trợ lý (sửa tất cả) chuyển được
    const moved = await (await as('tro1', t.sg))
      .patch(`/customers/${own.id}`)
      .send({ salesOwnerId: sale2Id })
      .expect(200);
    expect(moved.body.salesOwner.id).toBe(sale2Id);
  });

  it('nhân viên phụ trách phải là người dùng đang hoạt động', async () => {
    const r = await (await as('tro1', t.sg))
      .post('/customers')
      .send({ name: 'Sai NV', salesOwnerId: '00000000-0000-4000-8000-000000000999' })
      .expect(400);
    expect(r.body.code).toBe('VALIDATION_ERROR');
  });

  // ------------------------------------------------------------------ mã, SĐT

  it('mã: tự cấp KH…, nhập tay trùng (kể cả khác hoa thường) → 409, mã tay chiếm đúng số kế tiếp thì tự cấp bỏ qua', async () => {
    const manual = await mk('tro1', { name: 'Mã tay', code: 'KH000001' });
    expect(manual.code).toBe('KH000001');
    const auto = await mk('tro1', { name: 'Mã tự cấp' });
    expect(auto.code).toMatch(/^KH\d{6}$/);
    expect(auto.code).not.toBe('KH000001');
    const dup = await (await as('tro1', t.sg))
      .post('/customers')
      .send({ name: 'Trùng mã', code: 'kh000001' })
      .expect(409);
    expect(dup.body.code).toBe('DUPLICATE_CODE');
  });

  it('SĐT: chuẩn hóa; sai định dạng → 400; trùng khách khác vẫn lưu và trả cảnh báo DUPLICATE_PHONE', async () => {
    const a = await mk('tro1', { name: 'SĐT A', phone: '+84 912.345.678' });
    expect(a.phone).toBe('0912345678');
    expect(a.warnings).toBeUndefined();
    const bad = await (await as('tro1', t.sg))
      .post('/customers')
      .send({ name: 'SĐT sai', phone: '12345' })
      .expect(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    const b = await mk('tro1', { name: 'SĐT B', phone: '0912 345 678' });
    expect(b.phone).toBe('0912345678');
    expect(b.warnings[0]).toMatchObject({ code: 'DUPLICATE_PHONE' });
    expect(b.warnings[0].customers.map((c: { id: string }) => c.id)).toEqual([a.id]);
    const detail = await (await as('mkt1', t.sg)).get(`/customers/${a.id}`).expect(200);
    expect(detail.body.warnings[0].customers[0].id).toBe(b.id);
  });

  // ------------------------------------------------------------------ khách nội bộ

  it('khách hệ thống đại diện chi nhánh: ẩn khỏi danh sách/tìm nhanh, không xem chi tiết hoặc sửa được', async () => {
    const internal = (
      await t.db.select().from(customers).where(eq(customers.code, 'CN-HN'))
    )[0]!;
    const list = await (await as('tro1', t.sg)).get('/customers?limit=100').expect(200);
    expect(list.body.data.map((c: { code: string }) => c.code)).not.toContain('CN-HN');
    const withInternal = await (await as('tro1', t.sg))
      .get('/customers?includeInternal=true&limit=100')
      .expect(200);
    expect(withInternal.body.data.map((c: { code: string }) => c.code)).toContain('CN-HN');
    const lk = await (await as('tro1', t.sg)).get('/customers/lookup?q=CN-HN').expect(200);
    expect(lk.body).toEqual([]);
    await (await as('tro1', t.sg)).get(`/customers/${internal.id}`).expect(404);
    await (await as('tro1', t.sg))
      .patch(`/customers/${internal.id}`)
      .send({ name: 'Đổi tên' })
      .expect(404);
  });

  // ------------------------------------------------------------------ công nợ theo chi nhánh

  it('công nợ: tách biệt từng chi nhánh (không cộng gộp); thấy theo debt.view; Sale chỉ thấy nợ khách của mình', async () => {
    const c = await mk('sale1', { name: 'Có nợ hai chi nhánh' });
    await t.db.insert(debtLedger).values([
      { branchId: t.sg, partyType: 'customer', partyId: c.id, entryType: 'opening', amount: '1000000', occurredAt: new Date('2026-09-01') },
      { branchId: t.sg, partyType: 'customer', partyId: c.id, entryType: 'payment', amount: '-250000', occurredAt: new Date('2026-10-01') },
      { branchId: t.hn, partyType: 'customer', partyId: c.id, entryType: 'opening', amount: '-200000', occurredAt: new Date('2026-09-01') },
    ]);
    const fig = (body: { branches: Array<{ branchCode: string; balance?: string }> }) =>
      Object.fromEntries(body.branches.map((b) => [b.branchCode, b.balance]));
    // Kế toán (debt.view tất cả): chi tiết có cả hai chi nhánh, tách biệt (và âm được)
    const ketoan = await (await as('ketoan1', t.sg)).get(`/customers/${c.id}`).expect(200);
    expect(fig(ketoan.body)).toEqual({ HN: '-200000', SG: '750000' });
    // danh sách: chỉ chi nhánh làm việc
    const lst = await (await as('ketoan1', t.hn)).get('/customers?q=hai chi nhanh').expect(200);
    expect(fig(lst.body.data[0])).toEqual({ HN: '-200000' });
    // Marketing/Kho: không thấy nợ, hạn mức
    const mkt = await (await as('mkt1', t.sg)).get(`/customers/${c.id}`).expect(200);
    for (const b of mkt.body.branches) {
      expect(b).not.toHaveProperty('balance');
      expect(b).not.toHaveProperty('creditLimit');
    }
    // Sale 1 (debt.view của mình) thấy nợ khách của mình; Sale 2 thì không
    const own = await (await as('sale1', t.sg)).get(`/customers/${c.id}`).expect(200);
    expect(fig(own.body).SG).toBe('750000');
    const notOwn = await (await as('sale2', t.sg)).get(`/customers/${c.id}`).expect(200);
    expect(notOwn.body.branches[0]).not.toHaveProperty('balance');
    // lọc hasDebt
    await (await as('mkt1', t.sg)).get('/customers?hasDebt=true').expect(403);
    const debtors = await (await as('ketoan1', t.sg)).get('/customers?hasDebt=true&limit=100').expect(200);
    expect(debtors.body.data.map((x: { id: string }) => x.id)).toContain(c.id);
    const hnDebtors = await (await as('ketoan1', t.hn)).get('/customers?hasDebt=true&limit=100').expect(200);
    expect(hnDebtors.body.data.map((x: { id: string }) => x.id)).not.toContain(c.id); // HN: −200.000 không phải nợ
    // Sale 2 lọc hasDebt: chỉ trong khách của mình → không lộ khách của Sale 1
    const s2 = await (await as('sale2', t.sg)).get('/customers?hasDebt=true&limit=100').expect(200);
    expect(s2.body.data.map((x: { id: string }) => x.id)).not.toContain(c.id);
  });

  it('sổ công nợ khách: số dư đầu kỳ/cuối kỳ theo chi nhánh làm việc; người không được xem nợ khách đó → 403', async () => {
    const c = await mk('sale1', { name: 'Sổ nợ' });
    await t.db.insert(debtLedger).values([
      { branchId: t.sg, partyType: 'customer', partyId: c.id, entryType: 'opening', amount: '500000', occurredAt: new Date('2026-09-01') },
      { branchId: t.sg, partyType: 'customer', partyId: c.id, entryType: 'invoice', amount: '300000', occurredAt: new Date('2026-10-10') },
      { branchId: t.hn, partyType: 'customer', partyId: c.id, entryType: 'invoice', amount: '999000', occurredAt: new Date('2026-10-10') },
    ]);
    const res = await (await as('ketoan1', t.sg)).get(`/customers/${c.id}/ledger?from=2026-10-01`).expect(200);
    expect(res.body).toMatchObject({ branchId: t.sg, openingBalance: '500000', closingBalance: '800000' });
    expect(res.body.entries).toHaveLength(1);
    const hn = await (await as('ketoan1', t.hn)).get(`/customers/${c.id}/ledger`).expect(200);
    expect(hn.body.closingBalance).toBe('999000');
    await (await as('mkt1', t.sg)).get(`/customers/${c.id}/ledger`).expect(403);
    await (await as('sale2', t.sg)).get(`/customers/${c.id}/ledger`).expect(403);
    await (await as('sale1', t.sg)).get(`/customers/${c.id}/ledger`).expect(200);
  });

  it('hạn mức/kỳ hạn theo chi nhánh: đặt, đọc lại, hạn mức còn lại ở tìm nhanh, xóa; kiểm tra quyền và chi nhánh', async () => {
    const c = await mk('sale1', { name: 'Hạn mức' });
    await t.db.insert(debtLedger).values({
      branchId: t.sg, partyType: 'customer', partyId: c.id, entryType: 'opening', amount: '4000000', occurredAt: new Date(),
    });
    const put = await (await as('tro1', t.sg))
      .put(`/customers/${c.id}/branches/${t.sg}/terms`)
      .send({ creditLimit: '10000000', paymentTermDays: 15 })
      .expect(200);
    expect(put.body).toEqual({ branchId: t.sg, creditLimit: '10000000', paymentTermDays: 15 });
    const d = await (await as('tro1', t.sg)).get(`/customers/${c.id}`).expect(200);
    const sg = d.body.branches.find((b: { branchCode: string }) => b.branchCode === 'SG');
    const hn = d.body.branches.find((b: { branchCode: string }) => b.branchCode === 'HN');
    expect(sg).toMatchObject({ creditLimit: '10000000', paymentTermDays: 15, balance: '4000000' });
    expect(hn).toMatchObject({ creditLimit: null, paymentTermDays: null }); // chi nhánh khác không bị ảnh hưởng
    const lk = await (await as('tro1', t.sg)).get('/customers/lookup?q=han muc').expect(200);
    expect(lk.body[0]).toMatchObject({ balance: '4000000', creditLimit: '10000000', creditAvailable: '6000000' });
    // quyền: Marketing (không customer.edit), Kế toán (không customer.edit), Sale 2 (khách của người khác)
    for (const who of ['mkt1', 'ketoan1', 'sale2']) {
      await (await as(who, t.sg))
        .put(`/customers/${c.id}/branches/${t.sg}/terms`)
        .send({ creditLimit: '1', paymentTermDays: null })
        .expect(403);
    }
    // chi nhánh ngoài quyền
    const hnTry = await (await as('tro1', t.sg))
      .put(`/customers/${c.id}/branches/${t.hn}/terms`)
      .send({ creditLimit: '5', paymentTermDays: null })
      .expect(200); // Trợ lý có cả HN
    expect(hnTry.body.branchId).toBe(t.hn);
    // Sale 1 là chủ khách nhưng không có HN? (có cả hai) → tạo user chỉ SG để thử
    await t.makeUser('tro_sg', 'assistant', [t.sg]);
    const forb = await (await as('tro_sg', t.sg))
      .put(`/customers/${c.id}/branches/${t.hn}/terms`)
      .send({ creditLimit: '5', paymentTermDays: null })
      .expect(403);
    expect(forb.body.code).toBe('BRANCH_FORBIDDEN');
    await (await as('tro1', t.sg))
      .put(`/customers/${c.id}/branches/${t.sg}/terms`)
      .send({ creditLimit: '-5', paymentTermDays: null })
      .expect(400);
    // xóa
    await (await as('tro1', t.sg))
      .put(`/customers/${c.id}/branches/${t.sg}/terms`)
      .send({ creditLimit: null, paymentTermDays: null })
      .expect(200);
    const after = await (await as('tro1', t.sg)).get(`/customers/${c.id}`).expect(200);
    expect(after.body.branches.find((b: { branchCode: string }) => b.branchCode === 'SG').creditLimit).toBeNull();
  });

  // ------------------------------------------------------------------ lịch tiếp khách

  it('ngày tiếp khách: chỉ người có quyền ghi (Quản lý) thêm/xóa; Sale xem được nhưng không đổi được; không trùng ngày, không tương lai', async () => {
    const c = await mk('sale1', { name: 'Tiếp khách' });
    await (await as('sale1', t.sg)).post(`/customers/${c.id}/visits`).send({ visitedOn: '2026-11-02' }).expect(403);
    await (await as('tro1', t.sg)).post(`/customers/${c.id}/visits`).send({ visitedOn: '2026-11-02' }).expect(403);
    const v1 = await (await as('quanly', t.sg)).post(`/customers/${c.id}/visits`).send({ visitedOn: '2026-11-02', note: 'Đến kho' }).expect(201);
    expect(v1.body).toMatchObject({ visitedOn: '2026-11-02', note: 'Đến kho' });
    const dup = await (await as('quanly', t.sg)).post(`/customers/${c.id}/visits`).send({ visitedOn: '2026-11-02' }).expect(409);
    expect(dup.body.code).toBe('DUPLICATE_VISIT');
    await (await as('quanly', t.sg)).post(`/customers/${c.id}/visits`).send({ visitedOn: '2999-01-01' }).expect(400);
    await (await as('quanly', t.sg)).post(`/customers/${c.id}/visits`).send({ visitedOn: '2026-02-30' }).expect(400);
    await (await as('quanly', t.sg)).post(`/customers/${c.id}/visits`).send({ visitedOn: '2026-10-19' }).expect(201);
    const list = await (await as('sale2', t.sg)).get(`/customers/${c.id}/visits`).expect(200);
    expect(list.body.map((v: { visitedOn: string }) => v.visitedOn)).toEqual(['2026-11-02', '2026-10-19']);
    const d = await (await as('sale2', t.sg)).get(`/customers/${c.id}`).expect(200);
    expect(d.body.lastVisitedOn).toBe('2026-11-02');
    await (await as('sale1', t.sg)).delete(`/customers/${c.id}/visits/${v1.body.id}`).expect(403);
    await (await as('quanly', t.sg)).delete(`/customers/${c.id}/visits/${v1.body.id}`).expect(204);
    await (await as('quanly', t.sg)).delete(`/customers/${c.id}/visits/${v1.body.id}`).expect(404);
    const logs = await t.db.select().from(auditLogs).where(eq(auditLogs.entityId, c.id));
    expect(logs.map((l) => l.action)).toEqual(
      expect.arrayContaining(['customer.visit.add', 'customer.visit.remove']),
    );
  });

  // ------------------------------------------------------------------ hồ sơ kho

  it('hồ sơ kho: tạo kèm hồ sơ, sửa từng phần, xóa; kiểm tra giá trị', async () => {
    const c = await mk('tro1', {
      name: 'Có kho',
      priceLevel: 'large',
      newSince: '2026-10-01',
      acquisitionSource: 'Page',
      profile: {
        warehouseCount: 2,
        warehouseArea: '600m2',
        salesMethods: ['FB live', 'Bán sàn', 'FB live'],
        warehousePhotoUrl: 'https://example.com/kho.jpg',
      },
    });
    expect(c).toMatchObject({ priceLevel: 'large', newSince: '2026-10-01', acquisitionSource: 'Page' });
    expect(c.profile).toMatchObject({
      warehouseCount: 2,
      warehouseArea: '600m2',
      salesMethods: ['FB live', 'Bán sàn'], // bỏ trùng, theo thứ tự chuẩn
      competitors: null,
      scale: null,
    });
    const p = await (await as('tro1', t.sg))
      .patch(`/customers/${c.id}`)
      .send({ profile: { competitors: 'Siêu thị A', warehouseCount: null } })
      .expect(200);
    expect(p.body.profile).toMatchObject({ warehouseCount: null, competitors: 'Siêu thị A', warehouseArea: '600m2' });
    for (const bad of [
      { salesMethods: ['Không có'] },
      { warehousePhotoUrl: 'khong-phai-url' },
      { warehouseCount: -1 },
    ]) {
      await (await as('tro1', t.sg)).patch(`/customers/${c.id}`).send({ profile: bad }).expect(400);
    }
    await (await as('tro1', t.sg)).patch(`/customers/${c.id}`).send({ priceLevel: 'khong-co' }).expect(400);
    await (await as('tro1', t.sg)).patch(`/customers/${c.id}`).send({ newSince: '2026-10-15' }).expect(400); // chỉ nhận ngày đầu tháng
    const gone = await (await as('tro1', t.sg)).patch(`/customers/${c.id}`).send({ profile: null }).expect(200);
    expect(gone.body.profile).toBeNull();
  });

  // ------------------------------------------------------------------ danh sách, tìm kiếm, xuất Excel

  it('lọc theo Level giá/nguồn/tháng khách mới, tìm không dấu, sắp xếp; client gửi trường lạ bị từ chối', async () => {
    await mk('tro1', { name: 'Lọc Một', priceLevel: 'vip', newSince: '2026-03-01', acquisitionSource: 'Page' });
    await mk('tro1', { name: 'Lọc Hai', priceLevel: 'vip', newSince: '2026-08-01' });
    await mk('tro1', { name: 'Lọc Ba', priceLevel: 'medium' });
    const api = await as('mkt1', t.sg);
    const names = (b: { data: Array<{ name: string }> }) => b.data.map((c) => c.name);
    expect(names((await api.get('/customers?priceLevel=vip&q=loc').expect(200)).body)).toEqual(['Lọc Một', 'Lọc Hai']);
    expect(names((await api.get('/customers?q=loc&acquisitionSource=page').expect(200)).body)).toEqual(['Lọc Một']);
    expect(names((await api.get('/customers?q=loc&newSinceFrom=2026-05&newSinceTo=2026-09').expect(200)).body)).toEqual(['Lọc Hai']);
    expect(names((await api.get('/customers?q=loc&sort=-name').expect(200)).body)).toEqual(['Lọc Một', 'Lọc Hai', 'Lọc Ba']);
    await api.get('/customers?newSinceFrom=2026-13').expect(400);
    await (await as('tro1', t.sg)).post('/customers').send({ name: 'X', balance: '5' }).expect(400);
  });

  it('xuất Excel: tiêu đề đúng như file TKS, Khách mới ghi "T10/26-Page", không có cột công nợ', async () => {
    await mk('tro1', { name: 'Xuất Excel', newSince: '2026-10-01', acquisitionSource: 'Page', priceLevel: 'large', phone: '0988777666', profile: { salesMethods: ['Kho buôn', 'Sang tay'] } });
    const res = await (await as('ketoan1', t.sg))
      .get('/customers?format=xlsx&q=xuat excel')
      .buffer()
      .parse(bin as never)
      .expect(200);
    const sheet = await readSheet(res.body as Buffer);
    expect(sheet.headers).toEqual(
      [
        'Mã Khách hàng', 'Tên khách', 'Sale', 'Level giá', 'Khách mới', 'Tiếp khách lần cuối', 'Điện thoại', 'Địa chỉ',
        'Định vị kho', 'Số lượng kho', 'Diện tích', 'Đối thủ', 'Hình thức bán hàng', 'Quy mô khách', 'Các ngày tiếp khách',
        'Ảnh kho', 'Trạng thái', 'Ghi chú',
      ].map(normalizeHeader),
    );
    expect(sheet.rows).toHaveLength(1);
    const row = sheet.rows[0]!.values;
    expect(row['khach moi']).toBe('T10/26-Page');
    expect(row['level gia']).toBe('Lớn');
    expect(row['hinh thuc ban hang']).toBe('Kho buôn, Sang tay');
  });

  it('tìm nhanh: tối đa 20 khách đang hoạt động', async () => {
    for (let i = 0; i < 22; i++) await mk('tro1', { name: `Nhanh ${String(i).padStart(2, '0')}` });
    const off = await mk('tro1', { name: 'Nhanh tắt' });
    await (await as('tro1', t.sg)).patch(`/customers/${off.id}`).send({ isActive: false }).expect(200);
    const lk = await (await as('mkt1', t.sg)).get('/customers/lookup?q=nhanh').expect(200);
    expect(lk.body).toHaveLength(20);
    expect(lk.body.map((c: { name: string }) => c.name)).not.toContain('Nhanh tắt');
    expect(lk.body[0]).not.toHaveProperty('balance'); // Marketing không thấy nợ
  });

  it('kết thúc: nhật ký ghi tạo/sửa; đối soát sổ cái khớp', async () => {
    const actions = (await t.db.select().from(auditLogs)).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['customer.create', 'customer.update', 'customer.terms']));
    expect((await new ReconciliationService().run(t.db)).ok).toBe(true);
  });
});
