import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../../db/database.module.js';
import { productImages, products } from '../../db/schema/index.js';
import { createTestDb } from '../../db/test-db.js';
import { FileStorage, type StoredFile } from '../files/file-storage.js';
import { OrphanImagesService } from './orphan-images.service.js';

const HOUR = 3600 * 1000;

class StubStorage extends FileStorage {
  files: StoredFile[] = [];
  deleted: string[] = [];
  failFor = new Set<string>();
  put(): Promise<void> {
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    if (this.failFor.has(key)) return Promise.reject(new Error('hỏng'));
    this.deleted.push(key);
    return Promise.resolve();
  }
  publicUrl(key: string): string {
    return key;
  }
  list(prefix: string): Promise<StoredFile[]> {
    return Promise.resolve(this.files.filter((f) => f.key.startsWith(prefix)));
  }
}

describe('OrphanImagesService', () => {
  let client: PGlite;
  let db: Database;
  const storage = new StubStorage();
  const now = new Date('2026-11-06T00:00:00Z');
  const ago = (h: number) => new Date(now.getTime() - h * HOUR);

  beforeAll(async () => {
    ({ client, db } = await createTestDb());
    const [p] = await db
      .insert(products)
      .values({ code: 'GC1', name: 'x' })
      .returning();
    await db.insert(productImages).values([
      {
        productId: p!.id,
        url: 'u1',
        storageKey: 'products/a/dung.png',
        sortOrder: 0,
      },
      {
        productId: p!.id,
        url: 'https://ngoai.test/x.jpg',
        storageKey: null,
        sortOrder: 1,
      }, // ảnh nhập từ Excel
    ]);
    storage.files = [
      { key: 'products/a/dung.png', lastModified: ago(100) }, // còn dòng CSDL → giữ
      { key: 'products/a/mo-coi-cu.png', lastModified: ago(30) }, // mồ côi, cũ → dọn
      { key: 'products/a/mo-coi-moi.png', lastModified: ago(1) }, // mồ côi nhưng mới (có thể đang tải) → giữ
      { key: 'khac/tep-khac.png', lastModified: ago(500) }, // ngoài tiền tố products/ → không đụng
    ];
  });
  afterAll(async () => {
    await client.close();
  });

  it('chỉ coi là mồ côi file cũ hơn ngưỡng, nằm dưới products/ và không còn dòng product_images', async () => {
    const svc = new OrphanImagesService(db, storage);
    expect(await svc.find(24 * HOUR, now)).toEqual([
      'products/a/mo-coi-cu.png',
    ]);
    // hạ ngưỡng xuống 30 phút thì file mới cũng bị tính
    expect((await svc.find(0.5 * HOUR, now)).sort()).toEqual([
      'products/a/mo-coi-cu.png',
      'products/a/mo-coi-moi.png',
    ]);
  });

  it('remove xóa từng file; lỗi ở một file không dừng các file còn lại và được đếm', async () => {
    const svc = new OrphanImagesService(db, storage);
    storage.failFor.add('products/a/hong.png');
    const r = await svc.remove([
      'products/a/mo-coi-cu.png',
      'products/a/hong.png',
      'products/a/khac.png',
    ]);
    expect(r).toEqual({ deleted: 2, failed: 1 });
    expect(storage.deleted).toEqual([
      'products/a/mo-coi-cu.png',
      'products/a/khac.png',
    ]);
  });

  it('kho trống → trả rỗng', async () => {
    const empty = new StubStorage();
    expect(await new OrphanImagesService(db, empty).find(HOUR, now)).toEqual(
      [],
    );
  });
});
