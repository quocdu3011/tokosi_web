import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSheet, writeSheet, type CellValue } from '../../common/excel.js';
import {
  categories,
  importJobs,
  productImages,
  products,
  stocks,
} from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { FilesModule } from '../files/files.module.js';
import { ImportsModule } from './imports.module.js';

/** Tiêu đề đúng như file xuất từ KiotViet (dữ liệu bên dưới là giả). */
const KV_HEADERS = [
  'Loại hàng',
  'Nhóm hàng(3 Cấp)',
  'Mã hàng',
  'Tên hàng',
  'Giá bán',
  'Giá vốn',
  'Tồn kho',
  'Tồn nhỏ nhất',
  'Tồn lớn nhất',
  'Hình ảnh (url1,url2...)',
  'Hàng thành phần',
  'Đang kinh doanh',
  'Mô tả',
  'Vị trí',
];
const kvRow = (o: Partial<Record<string, CellValue>>): CellValue[] =>
  KV_HEADERS.map((h) => o[h] ?? null);
const xlsx = (headers: string[], rows: CellValue[][]) =>
  writeSheet(
    'Sheet1',
    headers.map((header) => ({ header })),
    rows,
  );

describe('Nhập/xuất Excel qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;

  beforeAll(async () => {
    t = await createHttpTestApp({
      imports: [FilesModule, CatalogModule, ImportsModule],
    });
    await t.makeUser('kho1', 'warehouse', [t.sg, t.hn]);
    await t.makeUser('ketoan1', 'accountant', [t.sg, t.hn]);
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  const post = async (
    type: string,
    buffer: Buffer | null,
    query = '',
    user = 'quanly',
  ) => {
    const api = await t.as(user);
    const req = api.post(`/imports/${type}${query}`);
    if (buffer) {
      req.attach('file', buffer, {
        filename: 'nhap.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    }
    return req;
  };
  const productByCode = async (code: string) =>
    (await t.db.select().from(products).where(eq(products.code, code)))[0];
  const countProducts = async () => (await t.db.select().from(products)).length;

  // ------------------------------------------------------------------ quyền, loại, file

  it('chỉ người có import.run (mặc định chỉ Quản lý) được nhập; chưa đăng nhập → 401', async () => {
    const file = await xlsx(KV_HEADERS, [
      kvRow({ 'Mã hàng': 'X1', 'Tên hàng': 'x' }),
    ]);
    await t.http().post('/api/v1/imports/products').expect(401);
    for (const user of ['kho1', 'ketoan1']) {
      const res = await post('products', file, '', user);
      expect(res.status).toBe(403);
    }
    expect(await countProducts()).toBe(0);
  });

  it('loại không hỗ trợ / không tồn tại / thiếu file / file không phải xlsx', async () => {
    const file = await xlsx(KV_HEADERS, [
      kvRow({ 'Mã hàng': 'X1', 'Tên hàng': 'x' }),
    ]);
    const cust = await post('customers', file);
    expect(cust.status).toBe(400);
    expect(cust.body.code).toBe('IMPORT_TYPE_NOT_SUPPORTED');
    expect((await post('khong-co', file)).status).toBe(404);
    expect((await post('products', null)).status).toBe(400);
    const junk = await post('products', Buffer.from('không phải file excel'));
    expect(junk.status).toBe(400);
    expect(junk.body.code).toBe('VALIDATION_ERROR');
    expect(await countProducts()).toBe(0);
  });

  it('file mẫu tải về là xlsx đọc được, tiêu đề đúng', async () => {
    const api = await t.as('quanly');
    const res = await api
      .get('/imports/products/template')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain(
      'mau-nhap-products.xlsx',
    );
    const sheet = await readSheet(res.body as Buffer);
    expect(sheet.headers).toContain('ma hang');
    expect(sheet.headers).not.toContain('gia ban'); // hệ thống không còn giá bán
  });

  // ------------------------------------------------------------------ nhập hàng hóa

  it('mặc định là chạy thử (dryRun): báo đúng số lượng nhưng KHÔNG ghi gì', async () => {
    const file = await xlsx(KV_HEADERS, [
      kvRow({ 'Mã hàng': 'A1', 'Tên hàng': 'Hàng 1', 'Giá bán': 33500 }),
      kvRow({ 'Mã hàng': 'A2', 'Tên hàng': 'Hàng 2' }),
    ]);
    const res = await post('products', file, `?branchId=${t.sg}`);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      type: 'products',
      status: 'completed',
      dryRun: true,
      total: 2,
      created: 2,
      updated: 0,
      failed: 0,
      errors: [],
    });
    expect(await countProducts()).toBe(0);
    expect(await t.db.select().from(categories)).toHaveLength(0);
    // vẫn có bản ghi lần nhập để xem lại
    const again = await (
      await t.as('quanly')
    )
      .get(`/imports/${res.body.id}`)
      .expect(200);
    expect(again.body.created).toBe(2);
  });

  it('nhập thật theo cột KiotViet: tạo nhóm hàng, hàng, min/max/vị trí, ảnh URL ngoài', async () => {
    const file = await xlsx(KV_HEADERS, [
      kvRow({
        'Loại hàng': 'Hàng hóa',
        'Nhóm hàng(3 Cấp)': 'NHÀ BẾP>>Dao kéo',
        'Mã hàng': 'DAO01',
        'Tên hàng': 'Dao thái rau',
        'Giá bán': 33500,
        'Giá vốn': 21800.5, // phải bị bỏ qua
        'Tồn kho': 515, // phải bị bỏ qua
        'Tồn nhỏ nhất': 10,
        'Tồn lớn nhất': 2000,
        'Hình ảnh (url1,url2...)':
          'https://cdn.example.test/a.jpg,https://cdn.example.test/b.jpg',
        'Đang kinh doanh': 1,
        'Vị trí': 'Kệ A1',
      }),
      kvRow({
        'Nhóm hàng(3 Cấp)': 'NHÀ BẾP>>Nồi chảo',
        'Mã hàng': 'NOI01',
        'Tên hàng': 'Nồi inox 24cm',
        'Giá bán': 90000,
        'Đang kinh doanh': 0,
      }),
      kvRow({
        'Nhóm hàng(3 Cấp)': 'ORDER RIÊNG',
        'Mã hàng': 'ORD01',
        'Tên hàng': 'Hàng order',
      }),
    ]);
    const res = await post('products', file, `?dryRun=false&branchId=${t.sg}`);
    expect(res.body).toMatchObject({
      status: 'completed',
      dryRun: false,
      total: 3,
      created: 3,
      updated: 0,
      failed: 0,
    });

    const dao = (await productByCode('DAO01'))!;
    expect(dao).toMatchObject({
      name: 'Dao thái rau',
      productType: 'goods',
      isActive: true,
    });
    expect((await productByCode('NOI01'))!.isActive).toBe(false);

    // nhóm hàng: NHÀ BẾP (gốc) > Dao kéo, Nồi chảo; ORDER RIÊNG (gốc)
    const cats = await t.db.select().from(categories);
    expect(cats.map((c) => c.name).sort()).toEqual([
      'Dao kéo',
      'NHÀ BẾP',
      'Nồi chảo',
      'ORDER RIÊNG',
    ]);
    const bep = cats.find((c) => c.name === 'NHÀ BẾP')!;
    expect(cats.find((c) => c.name === 'Dao kéo')!.parentId).toBe(bep.id);
    expect(dao.categoryId).toBe(cats.find((c) => c.name === 'Dao kéo')!.id);

    // min/max/vị trí ghi vào stocks của Sài Gòn; tồn kho và giá vốn KHÔNG bị đụng
    const st = (await t.db.select().from(stocks)).find(
      (s) => s.productId === dao.id,
    )!;
    expect(st).toMatchObject({ branchId: t.sg, location: 'Kệ A1' });
    expect(Number(st.minStock)).toBe(10);
    expect(Number(st.maxStock)).toBe(2000);
    expect(Number(st.onHand)).toBe(0);
    expect(Number(st.costPrice)).toBe(0);

    // ảnh là URL ngoài, không có storage_key
    const imgs = await t.db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, dao.id));
    expect(imgs.map((i) => [i.url, i.storageKey, i.sortOrder])).toEqual([
      ['https://cdn.example.test/a.jpg', null, 0],
      ['https://cdn.example.test/b.jpg', null, 1],
    ]);

    // nhật ký có ghi lần nhập thật
    const jobs = await t.db.select().from(importJobs);
    expect(jobs.some((j) => !j.dryRun && j.status === 'completed')).toBe(true);
  });

  it('chạy lại CÙNG file: không tạo trùng, không có gì đổi (created 0, updated 0), ảnh không nhân đôi', async () => {
    const before = await countProducts();
    const file = await xlsx(KV_HEADERS, [
      kvRow({
        'Nhóm hàng(3 Cấp)': 'NHÀ BẾP>>Dao kéo',
        'Mã hàng': 'DAO01',
        'Tên hàng': 'Dao thái rau',
        'Giá bán': 33500,
        'Tồn nhỏ nhất': 10,
        'Tồn lớn nhất': 2000,
        'Hình ảnh (url1,url2...)':
          'https://cdn.example.test/a.jpg,https://cdn.example.test/b.jpg',
        'Đang kinh doanh': 1,
        'Vị trí': 'Kệ A1',
      }),
    ]);
    const res = await post('products', file, `?dryRun=false&branchId=${t.sg}`);
    expect(res.body).toMatchObject({
      status: 'completed',
      created: 0,
      updated: 0,
      failed: 0,
    });
    expect(await countProducts()).toBe(before);
    const dao = (await productByCode('DAO01'))!;
    expect(
      await t.db
        .select()
        .from(productImages)
        .where(eq(productImages.productId, dao.id)),
    ).toHaveLength(2);
    expect(await t.db.select().from(categories)).toHaveLength(4);
  });

  it('cập nhật theo mã KHÔNG phân biệt hoa thường; chỉ tính hàng thật sự thay đổi; ô trống giữ nguyên', async () => {
    const file = await xlsx(KV_HEADERS, [
      kvRow({
        'Mã hàng': 'dao01',
        'Tên hàng': 'Dao thái rau (mới)',
        'Giá bán': 36000,
      }),
      kvRow({
        'Mã hàng': 'NOI01',
        'Tên hàng': 'Nồi inox 24cm',
        'Giá bán': 90000,
        'Đang kinh doanh': 0,
      }), // giữ nguyên
    ]);
    const before = await countProducts();
    const res = await post('products', file, `?dryRun=false&branchId=${t.sg}`);
    expect(res.body).toMatchObject({ created: 0, updated: 1, failed: 0 });
    expect(await countProducts()).toBe(before); // không sinh "dao01" thứ hai
    const dao = (await productByCode('DAO01'))!;
    expect(dao.name).toBe('Dao thái rau (mới)');
    // ô trống không xóa dữ liệu cũ
    const st = (await t.db.select().from(stocks)).find(
      (s) => s.productId === dao.id,
    )!;
    expect(st.location).toBe('Kệ A1');
    expect(Number(st.minStock)).toBe(10);
  });

  it('có dòng lỗi → KHÔNG ghi gì (kể cả các dòng tốt), liệt kê lỗi từng dòng với số dòng trong file', async () => {
    const before = await countProducts();
    const file = await xlsx(KV_HEADERS, [
      kvRow({ 'Mã hàng': 'OK01', 'Tên hàng': 'Hàng tốt' }), // dòng 2
      kvRow({ 'Mã hàng': 'co dau cach', 'Tên hàng': 'Mã sai' }), // dòng 3
      kvRow({ 'Mã hàng': 'OK01', 'Tên hàng': 'Trùng mã trong file' }), // dòng 4
      kvRow({
        'Mã hàng': 'OK02',
        'Tên hàng': 'Cột giá bị bỏ qua',
        'Giá bán': 1.5,
      }), // dòng 5: hợp lệ
      kvRow({ 'Mã hàng': 'OK03', 'Tên hàng': '' }), // dòng 6
      kvRow({
        'Mã hàng': 'OK04',
        'Tên hàng': 'Cờ sai',
        'Đang kinh doanh': 'có thể',
      }), // dòng 7
      kvRow({
        'Mã hàng': 'OK05',
        'Tên hàng': 'Min > max',
        'Tồn nhỏ nhất': 50,
        'Tồn lớn nhất': 5,
      }), // dòng 8
      kvRow({
        'Mã hàng': 'OK06',
        'Tên hàng': 'Ảnh sai',
        'Hình ảnh (url1,url2...)': 'javascript:alert(1)',
      }), // dòng 9
    ]);
    const res = await post('products', file, `?dryRun=false&branchId=${t.sg}`);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      status: 'failed',
      created: 0,
      updated: 0,
      failed: 6,
    });
    const byRow = new Map<number, string>(
      res.body.errors.map((e: { row: number; message: string }) => [
        e.row,
        e.message,
      ]),
    );
    expect([...byRow.keys()].sort((a, b) => a - b)).toEqual([3, 4, 6, 7, 8, 9]);
    expect(byRow.get(4)).toContain('dòng 2');
    expect(await countProducts()).toBe(before);
    expect(await productByCode('OK01')).toBeUndefined();
  });

  it('lỗi phát hiện SAU khi đã bắt đầu ghi (mã thuộc hàng đã xóa) → hoàn tác cả nhóm hàng vừa tạo, không để lại gì', async () => {
    await t.db
      .insert(products)
      .values({ code: 'DAXOA', name: 'Hàng đã xóa', deletedAt: new Date() });
    const cats = (await t.db.select().from(categories)).length;
    const file = await xlsx(KV_HEADERS, [
      kvRow({
        'Nhóm hàng(3 Cấp)': 'NHÓM MỚI>>CON MỚI',
        'Mã hàng': 'MOI01',
        'Tên hàng': 'Hàng mới',
      }),
      kvRow({ 'Mã hàng': 'daxoa', 'Tên hàng': 'Trùng hàng đã xóa' }),
    ]);
    const res = await post('products', file, `?dryRun=false&branchId=${t.sg}`);
    expect(res.body.status).toBe('failed');
    expect(res.body.errors[0].row).toBe(3);
    expect((await t.db.select().from(categories)).length).toBe(cats); // nhóm vừa tạo đã được hoàn tác
    expect(await productByCode('MOI01')).toBeUndefined();
  });

  it('thiếu cột bắt buộc / có cột tồn tối thiểu nhưng không chọn chi nhánh → báo lỗi ở dòng 1, không ghi gì', async () => {
    const noName = await post(
      'products',
      await xlsx(['Mã hàng'], [['Z1']]),
      '?dryRun=false',
    );
    expect(noName.body.status).toBe('failed');
    expect(noName.body.errors[0]).toMatchObject({ row: 1 });

    const needBranch = await post(
      'products',
      await xlsx(['Mã hàng', 'Tên hàng', 'Vị trí'], [['Z2', 'x', 'Kệ A']]),
      '?dryRun=false',
    );
    expect(needBranch.body.status).toBe('failed');
    expect(needBranch.body.errors[0].field).toBe('branchId');

    // không có cột phụ thuộc chi nhánh thì không cần chi nhánh
    const ok = await post(
      'products',
      await xlsx(['Mã hàng', 'Tên hàng'], [['Z3', 'x']]),
      '?dryRun=false',
    );
    expect(ok.body).toMatchObject({ status: 'completed', created: 1 });
    expect(await productByCode('Z2')).toBeUndefined();
  });

  it('chi nhánh không tồn tại / không được phép → 403', async () => {
    const res = await post(
      'products',
      await xlsx(['Mã hàng', 'Tên hàng'], [['Z9', 'x']]),
      '?branchId=00000000-0000-4000-8000-000000000001',
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('BRANCH_FORBIDDEN');
  });

  // ------------------------------------------------------------------ xuất rồi nhập lại

  it('xuất Excel danh sách hàng hóa theo bộ lọc; nhập lại chính file đó cho kết quả 0 thay đổi', async () => {
    const api = await t.as('quanly', t.sg);
    const bin = (
      r: { on: (e: string, cb: (x: Buffer) => void) => void },
      cb: (e: null, b: Buffer) => void,
    ) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    };
    const res = await api
      .get('/products?format=xlsx&q=dao')
      .buffer(true)
      .parse(bin as never);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toMatch(/hang-hoa-\d{8}\.xlsx/);
    const sheet = await readSheet(res.body as Buffer);
    expect(sheet.rows).toHaveLength(1); // theo bộ lọc q=dao
    expect(sheet.rows[0]!.values['ma hang']).toBe('DAO01');
    expect(sheet.headers).toContain('gia von'); // Quản lý có quyền xem giá vốn
    expect(sheet.rows[0]!.values['nhom hang(3 cap)']).toBe('NHÀ BẾP>>Dao kéo');

    // nhập lại đúng file vừa xuất (chạy thật nhưng không có gì đổi)
    const again = await post(
      'products',
      res.body as Buffer,
      `?dryRun=false&branchId=${t.sg}`,
    );
    expect(again.body).toMatchObject({
      status: 'completed',
      created: 0,
      updated: 0,
      failed: 0,
    });
  });

  it('xuất Excel: người thiếu product.cost.view KHÔNG thấy cột giá vốn', async () => {
    await t.makeUser('sale1', 'sales', [t.sg]);
    const api = await t.as('sale1', t.sg);
    const res = await api
      .get('/products?format=xlsx')
      .buffer(true)
      .parse(((
        r: { on: (e: string, cb: (x: Buffer) => void) => void },
        cb: (e: null, b: Buffer) => void,
      ) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      }) as never);
    expect(res.status).toBe(200);
    const sheet = await readSheet(res.body as Buffer);
    expect(sheet.headers).not.toContain('gia von');
    expect(sheet.headers).not.toContain('gia nhap cuoi');
  });

  // ------------------------------------------------------------------ combo

  it('nhập combo: thành phần là hàng trong file (dù đứng sau) hoặc hàng đã có; chạy lại không đổi; đổi số lượng thì cập nhật', async () => {
    const rows = (qty: number) => [
      kvRow({
        'Loại hàng': 'Combo - Đóng gói',
        'Mã hàng': 'CBN1',
        'Tên hàng': 'Combo nhập 1',
        'Giá bán': 100000,
        'Hàng thành phần': `gn1/${qty},DAO01/1`,
      }),
      // loại trống nhưng có hàng thành phần → suy ra là combo
      kvRow({
        'Mã hàng': 'CBN2',
        'Tên hàng': 'Combo nhập 2',
        'Hàng thành phần': 'GN2/3',
      }),
      kvRow({ 'Mã hàng': 'GN1', 'Tên hàng': 'Hàng nhập 1' }),
      kvRow({ 'Mã hàng': 'GN2', 'Tên hàng': 'Hàng nhập 2' }),
    ];
    const first = await post(
      'products',
      await xlsx(KV_HEADERS, rows(2)),
      `?dryRun=false&branchId=${t.sg}`,
    );
    expect(first.body).toMatchObject({
      status: 'completed',
      created: 4,
      failed: 0,
    });
    const comps = async (code: string) => {
      const api = await t.as('quanly');
      const list = (await api.get(`/products?q=${code}`).expect(200)).body.data;
      return list.find((p: { code: string }) => p.code === code);
    };
    expect(await comps('CBN1')).toMatchObject({
      productType: 'combo',
      components: 'GN1/2,DAO01/1',
    });
    expect(await comps('CBN2')).toMatchObject({
      productType: 'combo',
      components: 'GN2/3',
    });
    expect(await comps('GN1')).toMatchObject({
      productType: 'goods',
      components: '',
    });

    const same = await post(
      'products',
      await xlsx(KV_HEADERS, rows(2)),
      `?dryRun=false&branchId=${t.sg}`,
    );
    expect(same.body).toMatchObject({ created: 0, updated: 0, failed: 0 });

    const changed = await post(
      'products',
      await xlsx(KV_HEADERS, rows(5)),
      `?dryRun=false&branchId=${t.sg}`,
    );
    expect(changed.body).toMatchObject({ created: 0, updated: 1, failed: 0 });
    expect((await comps('CBN1')).components).toBe('GN1/5,DAO01/1');
  });

  it('nhập combo sai (kiểm tra từng dòng): báo lỗi từng dòng và không ghi gì', async () => {
    const before = await countProducts();
    const file = await xlsx(KV_HEADERS, [
      kvRow({ 'Mã hàng': 'E1', 'Tên hàng': 'x', 'Loại hàng': 'Combo' }), // thiếu thành phần
      kvRow({
        'Mã hàng': 'E4',
        'Tên hàng': 'x',
        'Loại hàng': 'Hàng hóa',
        'Hàng thành phần': 'GN1/1',
      }),
      kvRow({
        'Mã hàng': 'E5',
        'Tên hàng': 'x',
        'Loại hàng': 'Combo',
        'Hàng thành phần': 'GN1/0',
      }),
      kvRow({ 'Mã hàng': 'E6', 'Tên hàng': 'x', 'Loại hàng': 'Dịch vụ' }),
      kvRow({
        'Mã hàng': 'E7',
        'Tên hàng': 'x',
        'Loại hàng': 'Combo',
        'Hàng thành phần': 'GN1/1',
        'Tồn nhỏ nhất': 5, // combo không có tồn tối thiểu
      }),
    ]);
    const res = await post('products', file, `?dryRun=false&branchId=${t.sg}`);
    expect(res.body.status).toBe('failed');
    const rowsWithError = new Set(
      res.body.errors.map((e: { row: number }) => e.row),
    );
    expect([...rowsWithError].sort((a, b) => Number(a) - Number(b))).toEqual([
      2, 3, 4, 5, 6,
    ]);
    expect(await countProducts()).toBe(before);
  });

  it('nhập combo sai (đối chiếu với dữ liệu): mã lạ, thành phần là combo, đổi loại hàng có sẵn → báo lỗi, không ghi gì', async () => {
    const before = await countProducts();
    const file = await xlsx(KV_HEADERS, [
      kvRow({
        'Mã hàng': 'E2',
        'Tên hàng': 'x',
        'Loại hàng': 'Combo',
        'Hàng thành phần': 'KHONGCO/1',
      }),
      kvRow({
        'Mã hàng': 'E3',
        'Tên hàng': 'x',
        'Loại hàng': 'Combo',
        'Hàng thành phần': 'CBN1/1', // thành phần là combo
      }),
      kvRow({
        'Mã hàng': 'GN1',
        'Tên hàng': 'Hàng nhập 1',
        'Loại hàng': 'Combo', // hàng có sẵn là hàng hóa, không đổi loại qua Excel
        'Hàng thành phần': 'GN2/1',
      }),
    ]);
    const res = await post('products', file, `?dryRun=false&branchId=${t.sg}`);
    expect(res.body.status).toBe('failed');
    const rowsWithError = new Set(
      res.body.errors.map((e: { row: number }) => e.row),
    );
    expect([...rowsWithError].sort((a, b) => Number(a) - Number(b))).toEqual([
      2, 3, 4,
    ]);
    expect(await countProducts()).toBe(before);
    expect((await productByCode('GN1'))!.productType).toBe('goods');
  });
});
