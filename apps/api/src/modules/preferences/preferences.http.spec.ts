import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, userTablePrefs, users } from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { PreferencesModule } from './preferences.module.js';

const PREFS = {
  hidden: ['description'],
  order: ['code', 'name', 'onHand'],
  widths: { name: 360 },
  pageSize: 50,
};

describe('Tùy chỉnh bảng theo tài khoản qua HTTP (/me/table-prefs)', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  let aId: string;
  let bId: string;

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [PreferencesModule] });
    aId = (await t.makeUser('nv-a', 'sales', [t.sg])).id;
    bId = (await t.makeUser('nv-b', 'sales', [t.sg])).id;
    await t.makeUser('cho-duyet', 'pending');
  }, 60_000);

  afterAll(async () => {
    await t.close();
  });

  const rowsOf = (userId: string) =>
    t.db.select().from(userTablePrefs).where(eq(userTablePrefs.userId, userId));

  /** Dọn bản ghi giữa các test để mỗi test độc lập. */
  async function clearAll() {
    await t.db.delete(userTablePrefs);
  }

  describe('chưa đăng nhập', () => {
    it.each([
      ['GET', '/api/v1/me/table-prefs'],
      ['PUT', '/api/v1/me/table-prefs/products'],
      ['DELETE', '/api/v1/me/table-prefs/products'],
    ] as const)('%s → 401 UNAUTHENTICATED', async (method, url) => {
      const res = await (method === 'GET'
        ? t.http().get(url)
        : method === 'PUT'
          ? t.http().put(url).send(PREFS)
          : t.http().delete(url));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('lưu và đọc', () => {
    it('danh sách rỗng khi chưa lưu gì', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      const res = await a.get('/me/table-prefs').expect(200);
      expect(res.body).toEqual({ data: {} });
    });

    it('PUT rồi GET: trả lại đúng đối tượng đã lưu, lưu vào jsonb', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      const put = await a
        .put('/me/table-prefs/products')
        .send(PREFS)
        .expect(200);
      expect(put.body).toEqual(PREFS);

      const list = await a.get('/me/table-prefs').expect(200);
      expect(list.body).toEqual({ data: { products: PREFS } });

      const rows = await rowsOf(aId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tableKey).toBe('products');
      expect(rows[0]!.settings).toEqual(PREFS);
    });

    it('nhiều bảng: GET trả mọi bảng đã lưu của mình', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      await a.put('/me/table-prefs/products').send(PREFS).expect(200);
      await a
        .put('/me/table-prefs/purchase-orders')
        .send({ pageSize: 100 })
        .expect(200);
      const res = await a.get('/me/table-prefs').expect(200);
      expect(res.body).toEqual({
        data: { products: PREFS, 'purchase-orders': { pageSize: 100 } },
      });
    });

    it('body rỗng {} hợp lệ: lưu đối tượng rỗng (mọi trường tùy chọn)', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      const put = await a.put('/me/table-prefs/products').send({}).expect(200);
      expect(put.body).toEqual({});
      const list = await a.get('/me/table-prefs').expect(200);
      expect(list.body).toEqual({ data: { products: {} } });
    });

    it('PUT thay thế toàn bộ, KHÔNG gộp với bản cũ', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      await a.put('/me/table-prefs/products').send(PREFS).expect(200);

      const put = await a
        .put('/me/table-prefs/products')
        .send({ pageSize: 100 })
        .expect(200);
      expect(put.body).toEqual({ pageSize: 100 });

      const list = await a.get('/me/table-prefs').expect(200);
      expect(list.body).toEqual({ data: { products: { pageSize: 100 } } });
      const rows = await rowsOf(aId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.settings).toEqual({ pageSize: 100 });
    });

    it('DELETE rồi GET: bảng đó biến mất, bảng khác còn nguyên', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      await a.put('/me/table-prefs/products').send(PREFS).expect(200);
      await a
        .put('/me/table-prefs/suppliers')
        .send({ pageSize: 15 })
        .expect(200);

      await a.delete('/me/table-prefs/products').expect(204);
      const list = await a.get('/me/table-prefs').expect(200);
      expect(list.body).toEqual({ data: { suppliers: { pageSize: 15 } } });
    });

    it('DELETE khi chưa có bản ghi (và xóa hai lần) vẫn 204', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      await a.delete('/me/table-prefs/chua-co').expect(204);
      await a.put('/me/table-prefs/products').send(PREFS).expect(200);
      await a.delete('/me/table-prefs/products').expect(204);
      await a.delete('/me/table-prefs/products').expect(204);
    });

    it('giá trị biên hợp lệ: độ rộng 40 và 1000, 100 cột, id 64 ký tự, khóa bảng 64 ký tự', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      const ids = Array.from({ length: 100 }, (_, i) => `c${i}`);
      const widths = Object.fromEntries(ids.map((id) => [id, 40]));
      widths.c1 = 1000;
      const longId = 'x'.repeat(64);
      const body = {
        hidden: ids,
        order: [longId, ...ids.slice(1)],
        widths,
        pageSize: 15,
      };
      const longKey = 'k'.repeat(64);
      const put = await a.put(`/me/table-prefs/${longKey}`).send(body);
      expect(put.status).toBe(200);
      expect(put.body).toEqual(body);

      // ký tự `:` `_` `-` trong khóa bảng
      await a.put('/me/table-prefs/a:b_c-d').send({ pageSize: 50 }).expect(200);
      await a.put('/me/table-prefs/0abc').send({}).expect(200);
    });

    it('vai trò chưa được cấp quyền nào (pending) vẫn dùng được: chỉ cần đăng nhập', async () => {
      await clearAll();
      const p = await t.as('cho-duyet');
      await p.put('/me/table-prefs/products').send(PREFS).expect(200);
      const list = await p.get('/me/table-prefs').expect(200);
      expect(list.body).toEqual({ data: { products: PREFS } });
    });

    it('không ghi nhật ký thao tác (chỉ là tùy chọn giao diện)', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      const before = (await t.db.select({ n: count() }).from(auditLogs))[0]!.n;
      await a.put('/me/table-prefs/products').send(PREFS).expect(200);
      await a.get('/me/table-prefs').expect(200);
      await a.delete('/me/table-prefs/products').expect(204);
      const after = (await t.db.select({ n: count() }).from(auditLogs))[0]!.n;
      expect(after).toBe(before);
    });
  });

  describe('cô lập giữa các tài khoản', () => {
    it('A không thấy tùy chỉnh của B (kể cả khi cố truyền userId)', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      const b = await t.as('nv-b');
      await b
        .put('/me/table-prefs/products')
        .send({ hidden: ['bi-mat-cua-b'] })
        .expect(200);

      expect((await a.get('/me/table-prefs').expect(200)).body).toEqual({
        data: {},
      });
      // userId trên query/body không có tác dụng: luôn là người đang đăng nhập
      expect(
        (await a.get(`/me/table-prefs?userId=${bId}`).expect(200)).body,
      ).toEqual({ data: {} });
      expect(
        (await b.get('/me/table-prefs').expect(200)).body.data.products,
      ).toEqual({ hidden: ['bi-mat-cua-b'] });
    });

    it('PUT của A cùng tableKey KHÔNG ghi đè bản ghi của B', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      const b = await t.as('nv-b');
      await b
        .put('/me/table-prefs/products')
        .send({ pageSize: 100 })
        .expect(200);
      await a
        .put('/me/table-prefs/products')
        .send({ pageSize: 15 })
        .expect(200);

      expect((await b.get('/me/table-prefs').expect(200)).body).toEqual({
        data: { products: { pageSize: 100 } },
      });
      expect((await a.get('/me/table-prefs').expect(200)).body).toEqual({
        data: { products: { pageSize: 15 } },
      });
      expect(await rowsOf(aId)).toHaveLength(1);
      expect(await rowsOf(bId)).toHaveLength(1);
    });

    it('DELETE của A cùng tableKey KHÔNG xóa bản ghi của B', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      const b = await t.as('nv-b');
      await a
        .put('/me/table-prefs/products')
        .send({ pageSize: 15 })
        .expect(200);
      await b
        .put('/me/table-prefs/products')
        .send({ pageSize: 100 })
        .expect(200);

      await a.delete('/me/table-prefs/products').expect(204);

      expect((await a.get('/me/table-prefs').expect(200)).body).toEqual({
        data: {},
      });
      expect((await b.get('/me/table-prefs').expect(200)).body).toEqual({
        data: { products: { pageSize: 100 } },
      });
      const bRows = await t.db
        .select()
        .from(userTablePrefs)
        .where(
          and(
            eq(userTablePrefs.userId, bId),
            eq(userTablePrefs.tableKey, 'products'),
          ),
        );
      expect(bRows).toHaveLength(1);
    });

    it('Quản lý cũng chỉ thấy của chính mình (không có đường xem của người khác)', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      await a.put('/me/table-prefs/products').send(PREFS).expect(200);
      const admin = await t.as('quanly');
      expect((await admin.get('/me/table-prefs').expect(200)).body).toEqual({
        data: {},
      });
    });

    it('xóa người dùng thì tùy chỉnh của họ đi theo (ON DELETE CASCADE)', async () => {
      await clearAll();
      const c = await t.makeUser('nv-c', 'sales', [t.sg]);
      const cc = await t.as('nv-c');
      await cc.put('/me/table-prefs/products').send(PREFS).expect(200);
      expect(await rowsOf(c.id)).toHaveLength(1);
      await t.db.delete(users).where(eq(users.id, c.id));
      expect(await rowsOf(c.id)).toHaveLength(0);
    });
  });

  describe('kiểm tra dữ liệu vào (400 VALIDATION_ERROR)', () => {
    async function expectInvalid(
      body: unknown,
      key = 'products',
    ): Promise<void> {
      const a = await t.as('nv-a');
      const res = await a.put(`/me/table-prefs/${key}`).send(body as object);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(typeof res.body.message).toBe('string');
      expect(Array.isArray(res.body.details)).toBe(true);
      expect(res.body.requestId).toBeTruthy();
    }

    it.each([
      ['chữ hoa', 'Products'],
      ['bắt đầu bằng gạch ngang', '-products'],
      ['bắt đầu bằng dấu hai chấm', ':products'],
      ['có dấu cách', 'a%20b'],
      ['có dấu tiếng Việt', 'h%C3%A0ng'],
      ['ký tự lạ', 'a.b'],
      ['dài 65 ký tự', 'k'.repeat(65)],
    ])(
      'tableKey sai (%s) → 400 ở cả PUT và DELETE, không tạo bản ghi',
      async (_name, key) => {
        await clearAll();
        const a = await t.as('nv-a');
        const put = await a.put(`/me/table-prefs/${key}`).send(PREFS);
        expect(put.status).toBe(400);
        expect(put.body.code).toBe('VALIDATION_ERROR');
        expect(put.body.details).toEqual([
          expect.objectContaining({ field: 'tableKey' }),
        ]);
        expect(put.body.requestId).toBeTruthy();

        const del = await a.delete(`/me/table-prefs/${key}`);
        expect(del.status).toBe(400);
        expect(del.body.code).toBe('VALIDATION_ERROR');

        expect(await t.db.select().from(userTablePrefs)).toHaveLength(0);
      },
    );

    it.each([20, 0, 200, '50', null, 15.5, true])(
      'pageSize %j không thuộc {15, 50, 100} → 400',
      async (pageSize) => {
        await expectInvalid({ pageSize });
      },
    );

    it.each([39, 1001, 0, -5, 100.5, '200', null, true])(
      'độ rộng cột %j ngoài số nguyên 40..1000 → 400',
      async (width) => {
        await expectInvalid({ widths: { name: width } });
      },
    );

    it('widths không phải đối tượng / quá nhiều cột / id cột quá dài hoặc rỗng → 400', async () => {
      await expectInvalid({ widths: [100] });
      await expectInvalid({ widths: 'rong' });
      await expectInvalid({ widths: null });
      await expectInvalid({
        widths: Object.fromEntries(
          Array.from({ length: 101 }, (_, i) => [`c${i}`, 100]),
        ),
      });
      await expectInvalid({ widths: { ['x'.repeat(65)]: 100 } });
      await expectInvalid({ widths: { '': 100 } });
    });

    it('hidden/order: quá 100 phần tử, id quá dài hoặc rỗng, sai kiểu, null → 400', async () => {
      const tooMany = Array.from({ length: 101 }, (_, i) => `c${i}`);
      for (const field of ['hidden', 'order'] as const) {
        await expectInvalid({ [field]: tooMany });
        await expectInvalid({ [field]: ['x'.repeat(65)] });
        await expectInvalid({ [field]: [''] });
        await expectInvalid({ [field]: [1, 2] });
        await expectInvalid({ [field]: 'name' });
        await expectInvalid({ [field]: null });
      }
    });

    it('trường lạ → 400 (kể cả userId do client tự thêm)', async () => {
      await expectInvalid({ foo: 1 });
      await expectInvalid({ pageSize: 50, userId: bId });
      await expectInvalid({ settings: { pageSize: 50 } });
    });

    it('không lưu gì khi dữ liệu sai', async () => {
      await clearAll();
      await expectInvalid({ pageSize: 20 });
      expect(await t.db.select().from(userTablePrefs)).toHaveLength(0);
    });

    it('PUT sai không làm hỏng bản ghi đã lưu trước đó', async () => {
      await clearAll();
      const a = await t.as('nv-a');
      await a.put('/me/table-prefs/products').send(PREFS).expect(200);
      await expectInvalid({ pageSize: 20 });
      expect((await a.get('/me/table-prefs').expect(200)).body).toEqual({
        data: { products: PREFS },
      });
    });
  });

  describe('người dùng đang bị bắt đổi mật khẩu', () => {
    it('bị chặn 403 PASSWORD_CHANGE_REQUIRED như mọi endpoint nghiệp vụ', async () => {
      await clearAll();
      const d = await t.makeUser('nv-d', 'sales', [t.sg]);
      const dc = await t.as('nv-d'); // lấy token trước khi bật cờ
      await dc.put('/me/table-prefs/products').send(PREFS).expect(200);
      await t.db
        .update(users)
        .set({ mustChangePassword: true })
        .where(eq(users.id, d.id));

      for (const res of [
        await dc.get('/me/table-prefs'),
        await dc.put('/me/table-prefs/products').send(PREFS),
        await dc.delete('/me/table-prefs/products'),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      }
    });
  });
});
