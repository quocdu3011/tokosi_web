import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../common/app-error.js';
import { productImages, products } from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { FileStorage } from '../files/file-storage.js';
import { FilesModule } from '../files/files.module.js';
import { CatalogModule } from './catalog.module.js';

/** Kho file giả trong bộ nhớ, có thể bắt lỗi tại lần ghi thứ N. */
class MemoryStorage extends FileStorage {
  objects = new Map<string, Buffer>();
  deleted: string[] = [];
  putCount = 0;
  failOnPut: number | null = null;
  failDelete = false;
  put(key: string, body: Buffer): Promise<void> {
    this.putCount++;
    if (this.failOnPut === this.putCount) {
      return Promise.reject(new AppError(502, 'STORAGE_ERROR', 'Kho file lỗi'));
    }
    this.objects.set(key, body);
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    if (this.failDelete) return Promise.reject(new Error('kho file hỏng'));
    this.deleted.push(key);
    this.objects.delete(key);
    return Promise.resolve();
  }
  publicUrl(key: string): string {
    return `https://files.test/product-images/${key}`;
  }
  list(prefix: string) {
    return Promise.resolve(
      [...this.objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key, lastModified: new Date() })),
    );
  }
  reset() {
    this.objects.clear();
    this.deleted = [];
    this.putCount = 0;
    this.failOnPut = null;
    this.failDelete = false;
  }
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('du lieu anh png'),
]);
const JPG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('du lieu anh jpg'),
]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

describe('Ảnh hàng hóa qua HTTP (kho file giả)', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  const storage = new MemoryStorage();
  let productId: string;
  let otherProductId: string;

  beforeAll(async () => {
    t = await createHttpTestApp({
      imports: [FilesModule, CatalogModule],
      overrides: [[FileStorage, storage]],
    });
    await t.makeUser('sale1', 'sales', [t.sg]);
    await t.makeUser('kho1', 'warehouse', [t.sg]);
    await t.makeUser('mkt1', 'marketing', [t.sg]);
    const rows = await t.db
      .insert(products)
      .values([
        { code: 'IMG1', name: 'Hàng có ảnh' },
        { code: 'IMG2', name: 'Hàng khác' },
      ])
      .returning();
    productId = rows[0]!.id;
    otherProductId = rows[1]!.id;
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  const dbImages = (id: string) =>
    t.db.select().from(productImages).where(eq(productImages.productId, id));
  const upload = async (
    user: string,
    id: string,
    files: Array<{ data: Buffer; name: string; type?: string }>,
  ) => {
    const api = await t.as(user, t.sg);
    const req = api.post(`/products/${id}/images`);
    for (const f of files) {
      req.attach('files', f.data, {
        filename: f.name,
        contentType: f.type ?? 'image/png',
      });
    }
    return req;
  };

  it('chưa đăng nhập → 401; Sale (chỉ xem) → 403; Marketing (content.edit) và Kho (product.edit) được phép', async () => {
    await t.http().post(`/api/v1/products/${productId}/images`).expect(401);
    const res = await upload('sale1', productId, [
      { data: PNG, name: 'a.png' },
    ]);
    expect(res.status).toBe(403);
    expect(storage.objects.size).toBe(0);

    storage.reset();
    const mkt = await upload('mkt1', productId, [{ data: PNG, name: 'a.png' }]);
    expect(mkt.status).toBe(201);
    const kho = await upload('kho1', productId, [
      { data: JPG, name: 'b.jpg', type: 'image/jpeg' },
    ]);
    expect(kho.status).toBe(201);
    // dọn cho các test sau
    for (const i of await dbImages(productId)) {
      await (
        await t.as('quanly', t.sg)
      )
        .delete(`/products/${productId}/images/${i.id}`)
        .expect(204);
    }
    storage.reset();
  });

  it('tải NHIỀU ảnh một lần: lưu từng ảnh với URL riêng, thứ tự nối tiếp, khóa theo mã hàng', async () => {
    const res = await upload('quanly', productId, [
      { data: PNG, name: 'a.png' },
      { data: JPG, name: 'b.jpg', type: 'image/jpeg' },
      { data: PNG, name: 'c.png' },
    ]);
    expect(res.status).toBe(201);
    const imgs = res.body as Array<{
      id: string;
      url: string;
      sortOrder: number;
    }>;
    expect(imgs.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
    expect(new Set(imgs.map((i) => i.url)).size).toBe(3); // mỗi ảnh một URL riêng
    for (const i of imgs) {
      expect(i.url).toMatch(
        new RegExp(
          `^https://files\\.test/product-images/products/${productId}/[0-9a-f-]{36}\\.(png|jpg)$`,
        ),
      );
    }
    expect(storage.objects.size).toBe(3);
    const rows = await dbImages(productId);
    expect(rows.every((r) => r.storageKey !== null)).toBe(true);
    // hàng khác không bị ảnh hưởng
    expect(await dbImages(otherProductId)).toHaveLength(0);

    // GET /products/:id cũng trả ảnh theo thứ tự
    const detail = await (
      await t.as('quanly', t.sg)
    )
      .get(`/products/${productId}`)
      .expect(200);
    expect(detail.body.images.map((i: { url: string }) => i.url)).toEqual(
      imgs.map((i) => i.url),
    );
    // thêm lần nữa: sortOrder nối tiếp
    const more = await upload('quanly', productId, [
      { data: PNG, name: 'd.png' },
    ]);
    expect(more.body.map((i: { sortOrder: number }) => i.sortOrder)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it('định dạng kiểm tra theo NỘI DUNG: file HTML giả đuôi .png và Content-Type image/png bị từ chối', async () => {
    storage.reset();
    const before = (await dbImages(productId)).length;
    const res = await upload('quanly', productId, [
      { data: HTML, name: 'anh.png', type: 'image/png' },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('files[0]');
    expect(res.body.details[0].message).toContain('anh.png');
    expect(storage.objects.size).toBe(0);
    expect((await dbImages(productId)).length).toBe(before);
  });

  it('tất cả hoặc không gì cả: một ảnh lỗi trong lô thì không lưu ảnh nào', async () => {
    storage.reset();
    const before = (await dbImages(productId)).length;
    const res = await upload('quanly', productId, [
      { data: PNG, name: 'tot1.png' },
      { data: HTML, name: 'hong.png' },
      { data: JPG, name: 'tot2.jpg', type: 'image/jpeg' },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('files[1]');
    expect(storage.putCount).toBe(0); // kiểm tra hết TRƯỚC khi tải lên
    expect((await dbImages(productId)).length).toBe(before);
  });

  it('kho file lỗi giữa chừng → 502 STORAGE_ERROR, dọn các file đã tải của lô đó, không ghi CSDL', async () => {
    storage.reset();
    const before = (await dbImages(productId)).length;
    storage.failOnPut = 2;
    const res = await upload('quanly', productId, [
      { data: PNG, name: '1.png' },
      { data: PNG, name: '2.png' },
      { data: PNG, name: '3.png' },
    ]);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('STORAGE_ERROR');
    expect(storage.objects.size).toBe(0); // file đầu đã tải được dọn lại
    expect((await dbImages(productId)).length).toBe(before);
  });

  it('giới hạn: ảnh trên 5 MB → 413; quá 10 ảnh mỗi hàng → 400; không chọn ảnh → 400; hàng không tồn tại → 404', async () => {
    storage.reset();
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const tooBig = await upload('quanly', productId, [
      { data: big, name: 'to.png' },
    ]);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.code).toBe('PAYLOAD_TOO_LARGE');

    const have = (await dbImages(productId)).length;
    const room = 10 - have;
    const files = Array.from({ length: room + 1 }, (_, i) => ({
      data: PNG,
      name: `n${i}.png`,
    }));
    const over = await upload('quanly', productId, files);
    expect(over.status).toBe(400);
    expect(over.body.details[0].field).toBe('files');
    expect((await dbImages(productId)).length).toBe(have);

    const none = await (
      await t.as('quanly', t.sg)
    ).post(`/products/${productId}/images`);
    expect(none.status).toBe(400);
    const missing = await upload(
      'quanly',
      '00000000-0000-4000-8000-000000000001',
      [{ data: PNG, name: 'x.png' }],
    );
    expect(missing.status).toBe(404);
    expect(storage.putCount).toBe(0);
  });

  it('sắp lại thứ tự: phải đúng tập ảnh hiện có; ảnh đầu là ảnh đại diện', async () => {
    const api = await t.as('quanly', t.sg);
    const ids = (await dbImages(productId))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => i.id);
    const reversed = [...ids].reverse();
    const ok = await api
      .put(`/products/${productId}/images/order`)
      .send({ imageIds: reversed })
      .expect(200);
    expect(ok.body.map((i: { id: string }) => i.id)).toEqual(reversed);
    const detail = await api.get(`/products/${productId}`).expect(200);
    expect(detail.body.images[0].id).toBe(reversed[0]);

    for (const bad of [
      reversed.slice(1), // thiếu một ảnh
      [...reversed, reversed[0]], // trùng
      [...reversed.slice(1), '00000000-0000-4000-8000-000000000001'], // id lạ
    ]) {
      const res = await api
        .put(`/products/${productId}/images/order`)
        .send({ imageIds: bad });
      expect(res.status).toBe(400);
    }
    await api
      .put(`/products/${productId}/images/order`)
      .send({ imageIds: ['abc'] })
      .expect(400);
    // thứ tự không đổi sau các lần lỗi
    const still = await api.get(`/products/${productId}/images`).expect(200);
    expect(still.body.map((i: { id: string }) => i.id)).toEqual(reversed);
  });

  it('xóa ảnh: gỡ khỏi CSDL và xóa file trên kho; ảnh của hàng khác không xóa được (404)', async () => {
    const api = await t.as('quanly', t.sg);
    storage.reset();
    const [img] = await dbImages(productId);
    storage.objects.set(img!.storageKey!, PNG);
    await api
      .delete(`/products/${otherProductId}/images/${img!.id}`)
      .expect(404);
    expect(storage.deleted).toEqual([]);
    await api.delete(`/products/${productId}/images/${img!.id}`).expect(204);
    expect(storage.deleted).toEqual([img!.storageKey]);
    expect((await dbImages(productId)).some((i) => i.id === img!.id)).toBe(
      false,
    );
    await api.delete(`/products/${productId}/images/${img!.id}`).expect(404);
  });

  it('ảnh nhập từ Excel (URL ngoài, không có storageKey) chỉ bị gỡ khỏi hàng, KHÔNG gọi kho file', async () => {
    storage.reset();
    const [ext] = await t.db
      .insert(productImages)
      .values({
        productId: otherProductId,
        url: 'https://cdn.kiotviet.test/a.jpg',
        sortOrder: 0,
      })
      .returning();
    const api = await t.as('quanly', t.sg);
    await api
      .delete(`/products/${otherProductId}/images/${ext!.id}`)
      .expect(204);
    expect(storage.deleted).toEqual([]);
    expect(await dbImages(otherProductId)).toHaveLength(0);
  });

  it('xóa file trên kho thất bại KHÔNG làm hỏng yêu cầu (file mồ côi vô hại hơn)', async () => {
    const api = await t.as('quanly', t.sg);
    const [img] = await dbImages(productId);
    storage.failDelete = true;
    await api.delete(`/products/${productId}/images/${img!.id}`).expect(204);
    storage.failDelete = false;
    expect((await dbImages(productId)).some((i) => i.id === img!.id)).toBe(
      false,
    );
  });
});

describe('Ảnh khi CHƯA cấu hình kho file', () => {
  it('tải ảnh báo 503 STORAGE_NOT_CONFIGURED rõ ràng và không ghi gì vào CSDL', async () => {
    const t = await createHttpTestApp({
      imports: [FilesModule, CatalogModule],
    });
    try {
      const [p] = await t.db
        .insert(products)
        .values({ code: 'NOCFG', name: 'x' })
        .returning();
      const api = await t.as('quanly', t.sg);
      const res = await api
        .post(`/products/${p!.id}/images`)
        .attach('files', PNG, { filename: 'a.png', contentType: 'image/png' });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('STORAGE_NOT_CONFIGURED');
      expect(
        await t.db
          .select()
          .from(productImages)
          .where(eq(productImages.productId, p!.id)),
      ).toHaveLength(0);
    } finally {
      await t.close();
    }
  }, 60_000);
});
