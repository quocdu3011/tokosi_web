import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSheet, writeSheet, type CellValue } from '../../common/excel.js';
import {
  customerProfiles,
  customerVisits,
  customers,
  debtLedger,
  rolePermissions,
} from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { CustomersModule } from '../customers/customers.module.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { ImportsModule } from './imports.module.js';

/** Tiêu đề đúng như file TKS_Bao_cao_kinh_doanh_customers (dữ liệu bên dưới là giả). */
const HEADERS = [
  'Mã Khách hàng',
  'Tên khách',
  'Sale',
  'Level giá',
  'Khách mới',
  'Tiếp khách lần cuối',
  'Điện thoại',
  'Địa chỉ',
  'Định vị kho',
  'Số lượng kho',
  'Diện tích',
  'Đối thủ',
  'Hình thức bán hàng',
  'Quy mô khách',
  'Các ngày tiếp khách',
  'Ảnh kho',
  'Trạng thái',
  'Ghi chú',
  'Công nợ Hà Nội',
  'Công nợ Sài Gòn',
];
const row = (o: Partial<Record<string, CellValue>>): CellValue[] =>
  HEADERS.map((h) => o[h] ?? null);
const xlsx = (rows: CellValue[][], headers: string[] = HEADERS) =>
  writeSheet(
    'Theo khách hàng',
    headers.map((header) => ({ header })),
    rows,
  );
const bin = (
  r: { on: (e: string, cb: (x: Buffer) => void) => void },
  cb: (e: null, b: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Nhập khách hàng từ Excel (file TKS) qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  let anId: string;

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [CustomersModule, ImportsModule] });
    anId = (await t.makeUser('Sale An', 'sales', [t.sg, t.hn])).id;
    await t.makeUser('Sale Binh', 'sales', [t.sg]);
    await t.makeUser('Sale Trung', 'sales', [t.sg]);
    await t.makeUser('Sale Trúng', 'sales', [t.sg]); // trùng tên khi bỏ dấu
    await t.makeUser('kt1', 'accountant', [t.sg, t.hn]);
    await t.makeUser('kho_x', 'warehouse', [t.sg]);
    await t.makeUser('tro_sg', 'assistant', [t.sg]); // cho thêm import.run bên dưới
    await t.makeUser('sale_imp', 'sales', [t.sg]);
    await t.db.insert(rolePermissions).values([
      { role: 'assistant', permissionCode: 'import.run', scope: 'all' },
      { role: 'sales', permissionCode: 'import.run', scope: 'all' },
      // Kế toán được nhập khách nhưng KHÔNG có quyền ghi công nợ đầu kỳ (customer.debt.opening)
      { role: 'accountant', permissionCode: 'import.run', scope: 'all' },
      { role: 'accountant', permissionCode: 'customer.edit', scope: 'all' },
    ]);
    // Trợ lý được ghi công nợ đầu kỳ (chỉ chi nhánh của mình)
    await t.db.insert(rolePermissions).values({
      role: 'assistant',
      permissionCode: 'customer.debt.opening',
      scope: 'all',
    });
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  /** Gửi file lên; trả về phản hồi (đã chờ). */
  const post = async (
    file: Promise<Buffer> | Buffer | null,
    query = '',
    user = 'quanly',
    type = 'customers',
  ) => {
    const buffer = await file;
    const api = await t.as(user);
    const req = api.post(`/imports/${type}${query}`);
    if (buffer) {
      req.attach('file', buffer, {
        filename: 'khach.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    }
    return req;
  };
  /** Gửi file, kỳ vọng 202 và trả về nội dung lần nhập. */
  const run = async (
    file: Promise<Buffer> | Buffer | null,
    query = '',
    user = 'quanly',
  ) => {
    const r = await post(file, query, user);
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    return r.body;
  };
  const real = '?dryRun=false';
  const count = async () => (await t.db.select().from(customers)).length;
  const find = async (name: string) =>
    (await t.db.select().from(customers).where(eq(customers.name, name)))[0];

  it('file mẫu khách hàng có đúng tiêu đề file TKS', async () => {
    const res = await (await t.as('quanly'))
      .get('/imports/customers/template')
      .buffer()
      .parse(bin as never)
      .expect(200);
    const sheet = await readSheet(res.body as Buffer);
    expect(sheet.headers).toContain('ma khach hang');
    expect(sheet.headers).toContain('cong no ha noi');
    expect(sheet.headers).toContain('cac ngay tiep khach');
    expect(sheet.rows).toHaveLength(1);
  });

  it('chạy thử không ghi gì; nhập thật tạo khách đủ trường, hồ sơ kho, ngày tiếp khách và công nợ đầu kỳ từng chi nhánh', async () => {
    const file = xlsx([
      row({
        'Tên khách': 'HN - Nhập Một',
        Sale: 'Sale An',
        'Level giá': 'Lớn',
        'Khách mới': 'T10/26-Page',
        'Điện thoại': '0901 111 222 / 0988 333 444',
        'Địa chỉ': '1 Đường A',
        'Định vị kho': 'https://maps.example.com/abc',
        'Số lượng kho': 2,
        'Diện tích': '600m2',
        'Đối thủ': 'Siêu thị X',
        'Hình thức bán hàng': 'Bán sàn, FB live',
        'Quy mô khách': 'Chưa có',
        'Tiếp khách lần cuối': '05/11/2026',
        'Các ngày tiếp khách': '19/10/2026, 05/11/2026',
        'Ảnh kho': 'https://example.com/kho.jpg',
        'Trạng thái': ' ',
        'Ghi chú': 'ghi chú gốc',
        'Công nợ Hà Nội': 1500000,
        'Công nợ Sài Gòn': -200000,
      }),
      row({ 'Tên khách': 'SG - Nhập Hai', 'Level giá': 'Vip', 'Khách mới': 'Cũ' }),
      row({ 'Tên khách': 'MN - Nhập Ba', 'Khách mới': 'T3/26', 'Điện thoại': '09 0123 4567 0912345678' }),
      row({ 'Mã Khách hàng': 'KH-IMP-1', 'Tên khách': 'Có mã tay', 'Điện thoại': '+84 933 000 111' }),
    ]);
    const dry = await run(file);
    expect(dry).toMatchObject({ status: 'completed', dryRun: true, created: 4, updated: 0, failed: 0 });
    const before = await count();
    expect(await find('HN - Nhập Một')).toBeUndefined(); // chạy thử không ghi

    const res = await run(file, real);
    expect(res).toMatchObject({ status: 'completed', dryRun: false, created: 4, updated: 0 });
    expect(await count()).toBe(before + 4);

    const one = (await find('HN - Nhập Một'))!;
    expect(one).toMatchObject({
      salesOwnerId: anId,
      priceLevel: 'large',
      newSince: '2026-10-01',
      acquisitionSource: 'Page',
      phone: '0901111222',
      address: '1 Đường A',
      isActive: true, // ô Trạng thái trống = đang hoạt động
    });
    expect(one.code).toMatch(/^KH\d{6}$/);
    expect(one.note).toBe('ghi chú gốc. SĐT khác: 0988333444'); // số thứ hai nối vào ghi chú
    const [profile] = await t.db.select().from(customerProfiles).where(eq(customerProfiles.customerId, one.id));
    expect(profile).toMatchObject({
      warehouseCount: 2,
      warehouseArea: '600m2',
      competitors: 'Siêu thị X',
      salesMethods: ['FB live', 'Bán sàn'],
      scale: null,
      warehousePhotoUrl: 'https://example.com/kho.jpg',
    });
    const visits = await t.db.select().from(customerVisits).where(eq(customerVisits.customerId, one.id));
    expect(visits.map((v) => v.visitedOn).sort()).toEqual(['2026-10-19', '2026-11-05']);
    // công nợ đầu kỳ: tách theo chi nhánh, nhận số âm, đúng nguồn gốc
    const ledger = await t.db.select().from(debtLedger).where(eq(debtLedger.partyId, one.id));
    const byBranch = Object.fromEntries(ledger.map((l) => [l.branchId, l.amount]));
    expect(byBranch).toEqual({ [t.hn]: '1500000', [t.sg]: '-200000' });
    expect(ledger.every((l) => l.entryType === 'opening' && l.refType === 'import' && l.partyType === 'customer')).toBe(true);
    const api = await t.as('quanly', t.hn);
    const detail = (await api.get(`/customers/${one.id}`).expect(200)).body;
    expect(Object.fromEntries(detail.branches.map((b: { branchCode: string; balance: string }) => [b.branchCode, b.balance]))).toEqual({ HN: '1500000', SG: '-200000' });

    // khách cũ, level Vip, không nguồn
    expect(await find('SG - Nhập Hai')).toMatchObject({ priceLevel: 'vip', newSince: null, acquisitionSource: null });
    const three = (await find('MN - Nhập Ba'))!;
    expect(three).toMatchObject({ newSince: '2026-03-01', priceLevel: 'new', phone: '0901234567' });
    expect(three.note).toBe('SĐT khác: 0912345678');
    expect((await find('Có mã tay'))!.code).toBe('KH-IMP-1');
  });

  it('chạy lại cùng file: khách có sẵn có ô công nợ → lỗi (không ghi đầu kỳ hai lần); bỏ cột công nợ thì không tạo trùng, không đổi gì', async () => {
    const before = await count();
    const ledgerBefore = (await t.db.select().from(debtLedger)).length;
    const withDebt = xlsx([row({ 'Tên khách': 'HN - Nhập Một', 'Công nợ Hà Nội': 999 })]);
    const bad = await run(withDebt, real);
    expect(bad.status).toBe('failed');
    expect(bad.errors[0].message).toContain('chỉ ghi khi tạo khách mới');

    const noDebt = xlsx(
      [row({ 'Tên khách': 'HN - Nhập Một', Sale: 'Sale An', 'Level giá': 'Lớn', 'Khách mới': 'T10/26-Page', 'Điện thoại': '0901111222', 'Tiếp khách lần cuối': '05/11/2026' })],
      HEADERS.slice(0, 18),
    );
    const again = await run(noDebt, real);
    expect(again).toMatchObject({ status: 'completed', created: 0, updated: 0 });
    expect(await count()).toBe(before);
    expect((await t.db.select().from(debtLedger)).length).toBe(ledgerBefore);
  });

  it('cập nhật theo mã hoặc tên: ô trống giữ nguyên; "Cũ" xóa tháng khách mới; thêm ngày tiếp khách mới; đổi hồ sơ từng phần', async () => {
    const file = xlsx(
      [
        row({ 'Mã Khách hàng': 'KH-IMP-1', 'Tên khách': 'Có mã tay (đổi tên)', 'Level giá': 'Vừa', 'Khách mới': 'Cũ', 'Địa chỉ': '9 Đường Z', 'Hình thức bán hàng': 'Kho buôn' }),
        row({ 'Tên khách': 'SG - Nhập Hai', 'Các ngày tiếp khách': '01/11/2026' }),
      ],
      HEADERS.slice(0, 18),
    );
    const res = await run(file, real);
    expect(res).toMatchObject({ status: 'completed', created: 0, updated: 2 });
    const a = (await t.db.select().from(customers).where(eq(customers.code, 'KH-IMP-1')))[0]!;
    expect(a).toMatchObject({ name: 'Có mã tay (đổi tên)', priceLevel: 'medium', address: '9 Đường Z', phone: '0933000111', newSince: null });
    const [p] = await t.db.select().from(customerProfiles).where(eq(customerProfiles.customerId, a.id));
    expect(p!.salesMethods).toEqual(['Kho buôn']);
    const hai = (await find('SG - Nhập Hai'))!;
    expect(hai.priceLevel).toBe('vip'); // ô trống giữ nguyên
    expect((await t.db.select().from(customerVisits).where(eq(customerVisits.customerId, hai.id))).map((v) => v.visitedOn)).toEqual(['2026-11-01']);
  });

  it('SĐT trùng khách khác chỉ cảnh báo, vẫn ghi; cảnh báo xem lại được qua GET /imports/:id', async () => {
    const file = xlsx(
      [
        row({ 'Tên khách': 'Trùng SĐT 1', 'Điện thoại': '0977000111' }),
        row({ 'Tên khách': 'Trùng SĐT 2', 'Điện thoại': '0977000111' }),
        row({ 'Tên khách': 'Trùng SĐT 3', 'Điện thoại': '0901111222' }), // trùng khách đã có
      ],
      HEADERS.slice(0, 18),
    );
    const res = await run(file, real);
    expect(res).toMatchObject({ status: 'completed', created: 3, failed: 0 });
    expect(res.warnings).toHaveLength(2);
    expect(res.warnings.map((w: { row: number }) => w.row).sort()).toEqual([3, 4]);
    const job = (await (await t.as('quanly')).get(`/imports/${res.id}`).expect(200)).body;
    expect(job.warnings).toHaveLength(2);
  });

  it('có bất kỳ dòng lỗi nào thì KHÔNG ghi gì; báo đúng dòng và cột', async () => {
    const before = await count();
    const file = xlsx([
      row({ 'Tên khách': 'Dòng tốt' }), // dòng 2
      row({ 'Tên khách': 'Sale lạ', Sale: 'Không Ai Cả' }), // 3
      row({ 'Tên khách': 'Sale trùng tên', Sale: 'Sale Trung' }), // 4 (trùng "Sale Trúng")
      row({ 'Tên khách': 'Level sai', 'Level giá': 'Siêu' }), // 5
      row({ 'Tên khách': 'Khách mới sai', 'Khách mới': 'tháng 6' }), // 6
      row({ 'Tên khách': 'SĐT rác', 'Điện thoại': '12345' }), // 7 (chỉ cảnh báo)
      row({ 'Tên khách': 'Ngày tương lai', 'Các ngày tiếp khách': '01/01/2999' }), // 8
      row({ 'Tên khách': 'Hình thức sai', 'Hình thức bán hàng': 'Bán rong' }), // 9
      row({ 'Mã Khách hàng': 'DUP-1', 'Tên khách': 'Mã trùng A' }), // 10
      row({ 'Mã Khách hàng': 'dup-1', 'Tên khách': 'Mã trùng B' }), // 11
      row({ 'Tên khách': 'Tên lặp' }), // 12
      row({ 'Tên khách': 'tên LẶP' }), // 13
      row({ 'Tên khách': 'Nợ sai', 'Công nợ Hà Nội': 'abc' }), // 14
      row({ 'Tên khách': 'Ảnh sai', 'Ảnh kho': 'khong-phai-link' }), // 15 (chỉ cảnh báo)
      row({ 'Tên khách': 'Trạng thái lạ', 'Trạng thái': 'có thể' }), // 16
      row({ 'Tên khách': 'Số lượng kho sai', 'Số lượng kho': -3 }), // 17
      row({ 'Tên khách': 'Có mã tay (đổi tên)', 'Mã Khách hàng': 'KH-IMP-1', 'Công nợ Sài Gòn': 5 }), // 18 (khách có sẵn + nợ)
    ]);
    const res = await run(file, real);
    expect(res.status).toBe('failed');
    expect(res.created).toBe(0);
    const rows = res.errors.map((e: { row: number }) => e.row).sort((x: number, y: number) => x - y);
    expect(rows).toEqual([3, 4, 5, 6, 8, 9, 11, 13, 14, 16, 17, 18]); // dòng 2, 7, 10, 12, 15 không lỗi
    expect(res.errors.find((e: { row: number }) => e.row === 3).field).toBe('Sale');
    expect(await count()).toBe(before);
  });

  it('cột công nợ của chi nhánh lạ → lỗi; thiếu cột Tên khách → lỗi; chế độ "thêm" bị từ chối', async () => {
    const odd = xlsx([row({ 'Tên khách': 'X' })], [...HEADERS.slice(0, 18), 'Công nợ Đà Nẵng']);
    const r1 = await run(odd, real);
    expect(r1.status).toBe('failed');
    expect(r1.errors[0].field).toBe('cong no da nang');
    const noName = xlsx([['a']], ['Điện thoại']);
    const r2 = await run(noName, real);
    expect(r2.errors[0].message).toContain('Tên khách');
    expect((await post(xlsx([row({ 'Tên khách': 'Y' })]), '?mode=add')).status).toBe(400);
  });

  it('quyền: Kho (không import.run) → 403; người có import.run nhưng chỉ sửa khách của mình → 403; công nợ chỉ ghi chi nhánh được phép', async () => {
    const f = xlsx([row({ 'Tên khách': 'Quyền một' })], HEADERS.slice(0, 18));
    expect((await post(f, real, 'kho_x')).status).toBe(403); // không có import.run
    expect((await post(f, real, 'sale_imp')).status).toBe(403);
    // Trợ lý (sửa tất cả, xem nợ tất cả) chỉ có chi nhánh SG: ghi nợ Hà Nội bị từ chối, ghi nợ Sài Gòn được
    const hn = xlsx([row({ 'Tên khách': 'Nợ HN trái quyền', 'Công nợ Hà Nội': 100 })]);
    const rBad = await run(hn, real, 'tro_sg');
    expect(rBad.status).toBe('failed');
    expect(rBad.errors[0].message).toContain('Bạn không có quyền ghi công nợ đầu kỳ');
    const sg = xlsx([row({ 'Tên khách': 'Nợ SG hợp lệ', 'Công nợ Sài Gòn': 100 })]);
    const rOk = await run(sg, real, 'tro_sg');
    expect(rOk).toMatchObject({ status: 'completed', created: 1 });
  });

  it('thiếu quyền customer.debt.opening: điền cột công nợ → lỗi dòng; bỏ cột công nợ thì nhập được', async () => {
    const withDebt = xlsx([row({ 'Tên khách': 'Kế toán nhập nợ', 'Công nợ Sài Gòn': 100 })]);
    const bad = await run(withDebt, real, 'kt1');
    expect(bad.status).toBe('failed');
    expect(bad.errors[0].message).toContain('customer.debt.opening');
    expect(await find('Kế toán nhập nợ')).toBeUndefined();
    const ok = await run(
      xlsx([row({ 'Tên khách': 'Kế toán nhập thường' })], HEADERS.slice(0, 18)),
      real,
      'kt1',
    );
    expect(ok).toMatchObject({ status: 'completed', created: 1 });
  });

  it('loại nhập nhà cung cấp vẫn chưa hỗ trợ; đối soát sổ cái khớp', async () => {
    const f = xlsx([row({ 'Tên khách': 'Z' })]);
    const r = await post(f, real, 'quanly', 'suppliers');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('IMPORT_TYPE_NOT_SUPPORTED');
    expect((await new ReconciliationService().run(t.db)).ok).toBe(true);
  });
});
