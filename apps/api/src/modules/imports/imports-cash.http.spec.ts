import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSheet, writeSheet, type CellValue } from '../../common/excel.js';
import {
  cashAccounts,
  cashTransactions,
  debtLedger,
  rolePermissions,
} from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { CashModule } from '../cash/cash.module.js';
import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { ImportsModule } from './imports.module.js';

/** Tiêu đề đúng như file SoQuy của KiotViet (dữ liệu bên dưới là giả). */
const HEADERS = ['Mã phiếu', 'Thời gian', 'Loại thu chi', 'Người nộp/nhận', 'Giá trị'];
const xlsx = (rows: CellValue[][], headers: string[] = HEADERS) =>
  writeSheet(
    'Sổ quỹ',
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

/** Một file hợp lệ: quỹ đầu kỳ 1.000.000 + thu 7.000.000 − chi 3.250.000 = tồn 4.750.000. */
const goodRows = (): CellValue[][] => [
  ['TT019400', '03/11/2026 09:15', 'Phiếu thu Tiền khách trả', 'Khách A', 5000000],
  ['TT019401', '03/11/2026 10:00', 'Phiếu thu Tiền khách trả', 'Khách B', 2000000],
  ['CTM002400', '03/11/2026 11:00', 'Phiếu chi CÔNG NỢ', 'NCC A', -3000000],
  ['CTM002401', '03/11/2026 12:00', 'Phiếu chi Xăng xe 51D 123.45 (Tài xế A)', 'Tài xế A', -200000],
  ['CTM002402', '03/11/2026 13:00', 'Phiếu chi Loại chưa biết', null, -50000],
  [null, null, null, 'Quỹ đầu kỳ', 1000000],
  [null, null, null, 'Tổng thu', 7000000],
  [null, null, null, 'Tổng chi', -3250000],
  [null, null, null, 'Tồn quỹ', 4750000],
];

describe('Nhập Sổ quỹ từ Excel (file SoQuy) qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  let cashSg: string;
  let bankSg: string;

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [IdempotencyModule, CashModule, ImportsModule] });
    await t.makeUser('ketoan1', 'accountant', [t.sg, t.hn]);
    await t.makeUser('tro1', 'assistant', [t.sg]);
    await t.db.insert(rolePermissions).values([
      { role: 'accountant', permissionCode: 'import.run', scope: 'all' },
      { role: 'assistant', permissionCode: 'import.run', scope: 'all' }, // có import.run nhưng KHÔNG có cash.manage
    ]);
    const acc = await t.db.select().from(cashAccounts);
    cashSg = acc.find((a) => a.branchId === t.sg && a.type === 'cash')!.id;
    bankSg = acc.find((a) => a.branchId === t.sg && a.type === 'bank')!.id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  const post = async (
    file: Promise<Buffer> | Buffer | null,
    query = '',
    user = 'quanly',
  ) => {
    const buffer = await file;
    const req = (await t.as(user)).post(`/imports/cash-transactions${query}`);
    if (buffer) {
      req.attach('file', buffer, {
        filename: 'soquy.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    }
    return req;
  };
  const run = async (file: Promise<Buffer> | Buffer, query: string, user = 'quanly') => {
    const r = await post(file, query, user);
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    return r.body;
  };
  const real = `?dryRun=false&branchId=`;
  const txCount = async () => (await t.db.select().from(cashTransactions)).length;
  const balance = async (id: string) =>
    Number(
      (
        (await (await t.as('quanly', t.sg)).get('/cash-accounts').expect(200)).body.data as Array<{
          id: string;
          balance: string;
        }>
      ).find((a) => a.id === id)!.balance,
    );

  it('file mẫu có đúng tiêu đề file SoQuy', async () => {
    const res = await (await t.as('quanly'))
      .get('/imports/cash-transactions/template')
      .buffer()
      .parse(bin as never)
      .expect(200);
    const sheet = await readSheet(res.body as Buffer);
    expect(sheet.headers).toEqual(['ma phieu', 'thoi gian', 'loai thu chi', 'nguoi nop/nhan', 'gia tri']);
  });

  it('thiếu chi nhánh, thiếu quyền quản lý quỹ, có mode=add → bị từ chối', async () => {
    expect((await post(xlsx(goodRows()), '?dryRun=false')).status).toBe(400); // thiếu branchId
    const noPerm = await post(xlsx(goodRows()), `${real}${t.sg}`, 'tro1');
    expect(noPerm.status).toBe(403);
    expect((await post(xlsx(goodRows()), `${real}${t.sg}&mode=add`)).status).toBe(400);
    expect(await txCount()).toBe(0);
  });

  it('chạy thử không ghi gì; nhập thật ghi phiếu đúng mã/danh mục, đặt quỹ đầu kỳ, tồn quỹ khớp dòng tổng kết', async () => {
    const dry = await run(xlsx(goodRows()), `?branchId=${t.sg}`);
    expect(dry).toMatchObject({ dryRun: true, status: 'completed', created: 5, updated: 1, failed: 0 });
    expect(await txCount()).toBe(0);
    // dòng "Loại chưa biết" chỉ cảnh báo
    expect(dry.warnings).toHaveLength(1);
    expect(dry.warnings[0]).toMatchObject({ row: 6, field: 'Loại thu chi' });

    const done = await run(xlsx(goodRows()), `${real}${t.sg}`);
    expect(done).toMatchObject({ dryRun: false, status: 'completed', created: 5, updated: 1 });
    const rows = await t.db.select().from(cashTransactions);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.refType === 'import' && r.status === 'completed' && r.accountId === cashSg)).toBe(true);
    const api = await t.as('quanly', t.sg);
    const list = (await api.get('/cash-transactions?limit=100').expect(200)).body;
    const by = (code: string) => list.data.find((d: { code: string }) => d.code === code);
    expect(by('TT019400')).toMatchObject({ direction: 'in', amount: '5000000', category: { code: 'customer_payment' }, partyName: 'Khách A' });
    expect(by('CTM002400')).toMatchObject({ direction: 'out', amount: '3000000', category: { code: 'supplier_payment' } });
    expect(by('CTM002401')).toMatchObject({ category: { code: 'fuel' }, vehicleRef: '51D 123.45' });
    expect(by('CTM002402')).toMatchObject({ category: { code: 'other_out' }, note: 'Phiếu chi Loại chưa biết' });
    // giờ trong file là giờ Việt Nam: 09:15 → 02:15 UTC
    expect(by('TT019400').occurredAt).toBe('2026-11-03T02:15:00.000Z');
    // quỹ đầu kỳ đặt theo file, tồn quỹ khớp dòng "Tồn quỹ"
    expect(await balance(cashSg)).toBe(4750000);
    expect(list.summary).toMatchObject({ totalIn: '7000000', totalOut: '3250000' });
    // KHÔNG đụng công nợ, KHÔNG cấn trừ hóa đơn
    expect((await t.db.select().from(debtLedger)).length).toBe(0);
    // bộ đếm mã được nâng: phiếu tự cấp kế tiếp không trùng mã trong file
    const otherIn = (await api.get('/cash-categories?direction=in').expect(200)).body.data.find(
      (c: { code: string }) => c.code === 'other_in',
    ).id;
    const next = await (await t.as('ketoan1', t.sg))
      .post('/cash-transactions')
      .set('Idempotency-Key', randomUUID())
      .send({ direction: 'in', amount: '1000', accountId: cashSg, categoryId: otherIn });
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    expect(next.body.code).toBe('TT019402');
    expect((await new ReconciliationService().run(t.db)).ok).toBe(true);
  });

  it('nhập lại cùng file: lỗi trùng mã, không ghi gì', async () => {
    const before = await txCount();
    const r = await run(xlsx(goodRows()), `${real}${t.sg}`);
    expect(r.status).toBe('failed');
    expect(r.errors.some((e: { message: string }) => /đã có trong hệ thống/.test(e.message))).toBe(true);
    expect(await txCount()).toBe(before);
  });

  it('quỹ đã có phiếu: giữ quỹ đầu kỳ, chỉ cảnh báo; chọn quỹ khác chi nhánh → lỗi', async () => {
    const other: CellValue[][] = [
      ['TT019500', '04/11/2026 09:00', 'Phiếu thu Tiền khách trả', 'Khách C', 100000],
      [null, null, null, 'Quỹ đầu kỳ', 999],
      [null, null, null, 'Tồn quỹ', 12345],
    ];
    const r = await run(xlsx(other), `${real}${t.sg}&accountId=${cashSg}`);
    expect(r).toMatchObject({ status: 'completed', created: 1, updated: 0 });
    expect(r.warnings.map((w: { field: string }) => w.field).sort()).toEqual(['Quỹ đầu kỳ', 'Tồn quỹ']);
    expect(await balance(cashSg)).toBe(4750000 + 1000 + 100000);
    // quỹ của chi nhánh khác
    const hnAccount = (await t.db.select().from(cashAccounts)).find((a) => a.branchId === t.hn)!;
    const bad = await run(xlsx([['TT019501', '04/11/2026 09:00', 'Phiếu thu Tiền khách trả', null, 1000]]), `${real}${t.sg}&accountId=${hnAccount.id}`);
    expect(bad.status).toBe('failed');
  });

  it('lỗi dữ liệu: tổng thu/tồn quỹ lệch, thiếu mã, trùng mã trong file, giá trị 0 hoặc lẻ, ngày sai → không ghi gì', async () => {
    const before = await txCount();
    const cases: Array<{ rows: CellValue[][]; field: string }> = [
      { field: 'Tổng thu', rows: [['TT019600', '05/11/2026 09:00', 'Phiếu thu Tiền khách trả', null, 1000], [null, null, null, 'Tổng thu', 999]] },
      { field: 'Tồn quỹ', rows: [['TT019601', '05/11/2026 09:00', 'Phiếu thu Tiền khách trả', null, 1000], [null, null, null, 'Quỹ đầu kỳ', 0], [null, null, null, 'Tồn quỹ', 5]] },
      { field: 'Mã phiếu', rows: [[null, '05/11/2026 09:00', 'Phiếu thu Tiền khách trả', 'Ai đó', 1000]] },
      { field: 'Mã phiếu', rows: [['TT019602', '05/11/2026 09:00', 'Phiếu thu Tiền khách trả', null, 1000], ['tt019602', '05/11/2026 09:01', 'Phiếu thu Tiền khách trả', null, 1000]] },
      { field: 'Giá trị', rows: [['TT019603', '05/11/2026 09:00', 'Phiếu thu Tiền khách trả', null, 0]] },
      { field: 'Giá trị', rows: [['TT019604', '05/11/2026 09:00', 'Phiếu thu Tiền khách trả', null, 10.5]] },
      { field: 'Thời gian', rows: [['TT019605', '31/02/2026 09:00', 'Phiếu thu Tiền khách trả', null, 1000]] },
      { field: 'Thời gian', rows: [['TT019606', '01/01/2099 09:00', 'Phiếu thu Tiền khách trả', null, 1000]] },
    ];
    for (const c of cases) {
      const r = await run(xlsx(c.rows), `${real}${t.sg}&accountId=${bankSg}`);
      expect(r.status, c.field).toBe('failed');
      expect(r.errors.map((e: { field: string }) => e.field), c.field).toContain(c.field);
    }
    expect(await txCount()).toBe(before);
    // thiếu cột bắt buộc
    const noCol = await run(xlsx([['TT019607', '05/11/2026 09:00', 1000]], ['Mã phiếu', 'Thời gian', 'Giá trị']), `${real}${t.sg}`);
    expect(noCol.status).toBe('failed');
    expect(noCol.errors[0].field).toBe('Loại thu chi');
    expect(await balance(bankSg)).toBe(0);
    expect((await t.db.select().from(cashAccounts).where(eq(cashAccounts.id, bankSg)))[0]!.openingBalance).toBe('0');
  });
});
