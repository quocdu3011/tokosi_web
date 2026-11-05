import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeSheet, type CellValue } from '../../common/excel.js';
import {
  importJobs,
  products,
  stockMovements,
  stocks,
} from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { FilesModule } from '../files/files.module.js';
import { ImportsModule } from './imports.module.js';

/**
 * Import thêm (mode=add): CỘNG/TRỪ tồn theo cột "Tồn kho" qua InventoryService, giữ nguyên thông tin của hàng
 * đã có, mã mới được tạo đầy đủ. Dữ liệu trong file là giả lập.
 */
const HEADERS = [
  'Mã hàng',
  'Tên hàng',
  'Nhóm hàng(3 Cấp)',
  'Loại hàng',
  'Hàng thành phần',
  'Đang kinh doanh',
  'Mô tả',
  'Giá vốn',
  'Tồn kho',
];
const row = (o: Partial<Record<string, CellValue>>): CellValue[] =>
  HEADERS.map((h) => o[h] ?? null);
const xlsx = (headers: string[], rows: CellValue[][]) =>
  writeSheet(
    'Sheet1',
    headers.map((header) => ({ header })),
    rows,
  );

describe('Import thêm (mode=add) qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;

  beforeAll(async () => {
    t = await createHttpTestApp({
      imports: [FilesModule, CatalogModule, ImportsModule],
    });
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  const post = async (type: string, buffer: Buffer, query = '') => {
    const api = await t.as('quanly');
    return api.post(`/imports/${type}${query}`).attach('file', buffer, {
      filename: 'nhap.xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  };
  const add = (
    file: Buffer,
    branch: string | null = t.sg,
    dryRun = false,
    extra = '',
  ) =>
    post(
      'products',
      file,
      `?mode=add&dryRun=${dryRun}${branch ? `&branchId=${branch}` : ''}${extra}`,
    );
  const productByCode = async (code: string) =>
    (await t.db.select().from(products).where(eq(products.code, code)))[0];
  const countProducts = async () => (await t.db.select().from(products)).length;
  const stockOf = async (code: string, branchId: string) => {
    const p = await productByCode(code);
    if (!p) return undefined;
    return (
      await t.db
        .select()
        .from(stocks)
        .where(and(eq(stocks.productId, p.id), eq(stocks.branchId, branchId)))
    )[0];
  };
  const movementsOf = async (code: string) => {
    const p = await productByCode(code);
    return p
      ? t.db
          .select()
          .from(stockMovements)
          .where(eq(stockMovements.productId, p.id))
      : [];
  };

  it('chạy thử (dryRun) báo đúng nhưng không tạo hàng, không đổi tồn', async () => {
    const res = await add(
      await xlsx(HEADERS, [
        row({ 'Mã hàng': 'AD0', 'Tên hàng': 'Thử', 'Tồn kho': 5 }),
      ]),
      t.sg,
      true,
    );
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      mode: 'add',
      dryRun: true,
      status: 'completed',
      created: 1,
      updated: 0,
    });
    expect(await productByCode('AD0')).toBeUndefined();
  });

  it('mã mới: tạo hàng và cộng tồn theo Giá vốn trong file, ghi sổ cái loại adjustment', async () => {
    const res = await add(
      await xlsx(HEADERS, [
        row({
          'Mã hàng': 'AD1',
          'Tên hàng': 'Hàng thêm 1',
          'Nhóm hàng(3 Cấp)': 'ADD>>Nhóm A',
          'Tồn kho': 20,
          'Giá vốn': 1000,
        }),
      ]),
    );
    expect(res.body).toMatchObject({
      mode: 'add',
      status: 'completed',
      created: 1,
      updated: 0,
      failed: 0,
    });
    expect(await stockOf('AD1', t.sg)).toMatchObject({
      onHand: '20.000',
      costPrice: '1000.0000',
    });
    expect(await stockOf('AD1', t.hn)).toBeUndefined(); // chi nhánh khác không bị đụng
    const mv = await movementsOf('AD1');
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({
      refType: 'adjustment',
      qtyDelta: '20.000',
      branchId: t.sg,
    });
    expect(mv[0]!.refCode).toMatch(/^IMP-[0-9A-F]{8}$/);
    expect(mv[0]!.refId).toBe(res.body.id);
  });

  it('mã đã có: CỘNG tồn, giá vốn bình quân gia quyền; tên/mô tả/trạng thái trong file KHÔNG ghi đè', async () => {
    const before = await productByCode('AD1');
    const res = await add(
      await xlsx(HEADERS, [
        row({
          'Mã hàng': 'ad1', // không phân biệt hoa thường
          'Tên hàng': 'TÊN KHÁC PHẢI BỊ BỎ QUA',
          'Mô tả': 'mô tả khác',
          'Đang kinh doanh': 0,
          'Tồn kho': 30,
          'Giá vốn': 2000,
        }),
      ]),
    );
    expect(res.body).toMatchObject({
      created: 0,
      updated: 1,
      status: 'completed',
    });
    // (20 × 1000 + 30 × 2000) / 50 = 1600
    expect(await stockOf('AD1', t.sg)).toMatchObject({
      onHand: '50.000',
      costPrice: '1600.0000',
    });
    expect(await productByCode('AD1')).toMatchObject({
      name: 'Hàng thêm 1',
      description: before!.description,
      isActive: true,
    });
  });

  it('chạy lại cùng file CỘNG THÊM lần nữa (không idempotent); thiếu giá vốn thì giữ giá vốn hiện tại', async () => {
    const file = await xlsx(HEADERS, [
      row({ 'Mã hàng': 'AD1', 'Tồn kho': 10 }),
    ]);
    await add(file);
    // không cho phép thì bị chặn (xem test chống nạp lại); cố ý cho phép thì cộng thêm lần nữa
    await add(file, t.sg, false, '&allowDuplicate=true');
    expect(await stockOf('AD1', t.sg)).toMatchObject({
      onHand: '70.000',
      costPrice: '1600.0000',
    });
  });

  it('số âm trừ tồn theo giá vốn hiện tại; trừ quá tồn hoặc hàng mới mà trừ → lỗi dòng, không ghi gì', async () => {
    const ok = await add(
      await xlsx(HEADERS, [
        row({ 'Mã hàng': 'AD1', 'Tồn kho': -20, 'Giá vốn': 99999 }),
      ]),
    );
    expect(ok.body.status).toBe('completed');
    expect(await stockOf('AD1', t.sg)).toMatchObject({
      onHand: '50.000',
      costPrice: '1600.0000', // Giá vốn trong file bị bỏ qua khi trừ
    });
    const movementsBefore = (await movementsOf('AD1')).length;

    const bad = await add(
      await xlsx(HEADERS, [
        row({ 'Mã hàng': 'AD1', 'Tồn kho': -1000 }),
        row({ 'Mã hàng': 'AD-MOI', 'Tên hàng': 'x', 'Tồn kho': -1 }),
        row({ 'Mã hàng': 'AD-OK', 'Tên hàng': 'ok', 'Tồn kho': 5 }),
      ]),
    );
    expect(bad.body.status).toBe('failed');
    expect(bad.body.created).toBe(0);
    expect(bad.body.errors.map((e: { row: number }) => e.row)).toEqual([2, 3]);
    expect(await stockOf('AD1', t.sg)).toMatchObject({ onHand: '50.000' });
    expect((await movementsOf('AD1')).length).toBe(movementsBefore);
    expect(await productByCode('AD-OK')).toBeUndefined(); // "tất cả hoặc không gì cả"
  });

  it('ô tồn trống hoặc 0 thì bỏ qua, không đổi gì', async () => {
    const mv = (await movementsOf('AD1')).length;
    const res = await add(
      await xlsx(HEADERS, [
        row({ 'Mã hàng': 'AD1', 'Tồn kho': 0 }),
        row({ 'Mã hàng': 'AD-TRONG', 'Tên hàng': 'Chỉ tạo hàng' }),
      ]),
    );
    expect(res.body).toMatchObject({
      status: 'completed',
      created: 1,
      updated: 0,
    });
    expect((await movementsOf('AD1')).length).toBe(mv);
    expect(await stockOf('AD-TRONG', t.sg)).toBeUndefined();
  });

  it('lỗi cấu trúc: thiếu chi nhánh, thiếu cột Tồn kho, số lượng sai, combo có tồn, hàng mới thiếu tên', async () => {
    const noBranch = await add(
      await xlsx(HEADERS, [row({ 'Mã hàng': 'AD1', 'Tồn kho': 1 })]),
      null,
    );
    expect(noBranch.body.status).toBe('failed');
    expect(noBranch.body.errors[0].field).toBe('branchId');

    const noCol = await add(
      await xlsx(['Mã hàng', 'Tên hàng'], [['AD1', 'x']]),
    );
    expect(noCol.body.errors[0].field).toBe('Tồn kho');

    const before = await countProducts();
    // Giai đoạn 1: lỗi ngay trên từng dòng (số lượng/giá vốn sai, trùng mã)
    const parseErr = await add(
      await xlsx(HEADERS, [
        row({ 'Mã hàng': 'AD1', 'Tồn kho': 'abc' }),
        row({ 'Mã hàng': 'AD1', 'Tồn kho': 1, 'Giá vốn': -5 }), // trùng mã + giá vốn sai
      ]),
    );
    expect(parseErr.body.status).toBe('failed');
    expect(parseErr.body.errors.map((e: { field: string }) => e.field)).toEqual(
      expect.arrayContaining(['Tồn kho', 'Giá vốn', 'Mã hàng']),
    );

    // Giai đoạn 2: lỗi đối chiếu với dữ liệu hiện có (mã mới thiếu tên, combo có tồn)
    const lookupErr = await add(
      await xlsx(HEADERS, [
        row({ 'Mã hàng': 'AD1B', 'Tồn kho': 1 }), // mã mới thiếu tên
        row({
          'Mã hàng': 'AD-CB',
          'Tên hàng': 'combo',
          'Loại hàng': 'Combo',
          'Hàng thành phần': 'AD1/1',
          'Tồn kho': 3, // combo không có tồn
        }),
      ]),
    );
    expect(lookupErr.body.status).toBe('failed');
    expect(
      lookupErr.body.errors.map((e: { field: string }) => e.field).sort(),
    ).toEqual(['Tên hàng', 'Tồn kho']);
    expect(await countProducts()).toBe(before);
  });

  it('chế độ đè vẫn bỏ qua cột Tồn kho/Giá vốn; mode lạ → 400; GET /imports/:id trả mode', async () => {
    const onHand = (await stockOf('AD1', t.sg))!.onHand;
    const res = await post(
      'products',
      await xlsx(HEADERS, [
        row({ 'Mã hàng': 'AD1', 'Tên hàng': 'Hàng thêm 1', 'Tồn kho': 999 }),
      ]),
      `?dryRun=false&branchId=${t.sg}`,
    );
    expect(res.body.mode).toBe('overwrite');
    expect((await stockOf('AD1', t.sg))!.onHand).toBe(onHand);

    const bad = await post(
      'products',
      await xlsx(HEADERS, [row({ 'Mã hàng': 'AD1', 'Tên hàng': 'x' })]),
      '?mode=xoa',
    );
    expect(bad.status).toBe(400);

    const api = await t.as('quanly');
    const job = await api.get(`/imports/${res.body.id}`);
    expect(job.body.mode).toBe('overwrite');
    const jobs = await t.db.select().from(importJobs);
    expect(jobs.some((j) => j.mode === 'add')).toBe(true);
  });

  // ------------------------------------------------------------------ chống nạp lại cùng file

  it('chống nạp lại: cùng file đã nhập thật vào chi nhánh → 409 IMPORT_DUPLICATE_FILE (cả chạy thử), không đổi tồn', async () => {
    const file = await xlsx(HEADERS, [
      row({
        'Mã hàng': 'DUP1',
        'Tên hàng': 'Hàng dup',
        'Tồn kho': 8,
        'Giá vốn': 100,
      }),
    ]);
    // chạy thử không tính là đã nhập, không chặn lần nhập thật sau đó
    expect((await add(file, t.sg, true)).status).toBe(202);
    const first = await add(file);
    expect(first.body.status).toBe('completed');
    expect(await stockOf('DUP1', t.sg)).toMatchObject({ onHand: '8.000' });

    const again = await add(file);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('IMPORT_DUPLICATE_FILE');
    expect(again.body.details.importId).toBe(first.body.id);
    const dry = await add(file, t.sg, true);
    expect(dry.status).toBe(409);
    expect(await stockOf('DUP1', t.sg)).toMatchObject({ onHand: '8.000' });
    expect(await movementsOf('DUP1')).toHaveLength(1);

    // chi nhánh khác: không coi là trùng
    const other = await add(file, t.hn);
    expect(other.body.status).toBe('completed');
    expect(await stockOf('DUP1', t.hn)).toMatchObject({ onHand: '8.000' });
    // file khác nội dung: được
    const changed = await xlsx(HEADERS, [
      row({ 'Mã hàng': 'DUP1', 'Tồn kho': 1 }),
    ]);
    expect((await add(changed)).body.status).toBe('completed');
    expect(await stockOf('DUP1', t.sg)).toMatchObject({ onHand: '9.000' });
  });

  it('cố ý nhập lại: allowDuplicate=true cộng thêm lần nữa và ghi nhật ký; lần sau vẫn bị chặn nếu thiếu cờ', async () => {
    const file = await xlsx(HEADERS, [
      row({ 'Mã hàng': 'DUP2', 'Tên hàng': 'Hàng dup 2', 'Tồn kho': 3 }),
    ]);
    expect((await add(file)).body.status).toBe('completed');
    const forced = await add(file, t.sg, false, '&allowDuplicate=true');
    expect(forced.body.status).toBe('completed');
    expect(await stockOf('DUP2', t.sg)).toMatchObject({ onHand: '6.000' });
    expect((await add(file)).status).toBe(409);
    const jobs = await t.db
      .select()
      .from(importJobs)
      .where(eq(importJobs.mode, 'add'));
    expect(jobs.filter((j) => j.fileHash !== null).length).toBeGreaterThan(0);
    // lần nhập cưỡng chế không giữ băm (lần nhập gốc vẫn là bản chặn)
    expect(jobs.find((j) => j.id === forced.body.id)!.fileHash).toBeNull();
  });

  it('file lỗi không bị coi là đã nhập: sửa rồi gửi lại được; chế độ overwrite không bị chặn khi gửi lại', async () => {
    const bad = await xlsx(HEADERS, [
      row({ 'Mã hàng': 'DUP3', 'Tồn kho': -5 }), // hàng mới mà trừ → lỗi, không ghi gì
    ]);
    expect((await add(bad)).body.status).toBe('failed');
    expect((await add(bad)).body.status).toBe('failed'); // vẫn là lỗi dòng, không phải 409

    const f = await xlsx(HEADERS, [
      row({ 'Mã hàng': 'DUP4', 'Tên hàng': 'x', 'Tồn kho': 2 }),
    ]);
    for (let i = 0; i < 2; i++) {
      const r = await post(
        'products',
        f,
        `?mode=overwrite&dryRun=false&branchId=${t.sg}`,
      );
      expect(r.status).toBe(202);
    }
  });
});
