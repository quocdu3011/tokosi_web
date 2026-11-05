import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { categories, products } from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { CatalogModule } from './catalog.module.js';

describe('Nhóm hàng qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [CatalogModule] });
    await t.makeUser('sale1', 'sales', [t.sg]);
    await t.makeUser('kho1', 'warehouse', [t.sg]);
    await t.makeUser('mkt1', 'marketing', [t.sg]);
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  const create = async (status: number, name: string, parentId?: string) => {
    const api = await t.as('quanly');
    return api
      .post('/categories')
      .send({ name, ...(parentId ? { parentId } : {}) })
      .expect(status);
  };
  const idOf = async (name: string, parentId?: string) =>
    (await create(201, name, parentId)).body.id as string;

  it('chưa đăng nhập → 401', async () => {
    await t.http().get('/api/v1/categories').expect(401);
  });

  it('ma trận quyền: xem cần product.view; tạo/sửa/xóa cần product.edit', async () => {
    // Sale và Marketing xem được nhưng không sửa được; Kho (có product.edit) sửa được
    for (const user of ['sale1', 'mkt1']) {
      const api = await t.as(user);
      await api.get('/categories').expect(200);
      const denied = await api
        .post('/categories')
        .send({ name: 'Không được' })
        .expect(403);
      expect(denied.body.code).toBe('FORBIDDEN');
    }
    const kho = await t.as('kho1');
    await kho.post('/categories').send({ name: 'Do kho tạo' }).expect(201);
  });

  it('tạo nhóm gốc và nhóm con; cây trả về đúng cấu trúc và sắp theo thứ tự tạo', async () => {
    const bep = await idOf('NHÀ BẾP');
    const dao = await idOf('Dao kéo', bep);
    await idOf('Nồi chảo', bep);
    const api = await t.as('quanly');
    const tree = (await api.get('/categories').expect(200)).body as Array<{
      id: string;
      name: string;
      children: Array<{ id: string; name: string; parentId: string }>;
    }>;
    const node = tree.find((n) => n.id === bep)!;
    expect(node.children.map((c) => c.name)).toEqual(['Dao kéo', 'Nồi chảo']);
    expect(node.children[0]).toMatchObject({ id: dao, parentId: bep });
  });

  it('tên không trùng trong cùng nhóm cha (không phân biệt hoa thường và dấu), nhưng khác nhóm cha thì được', async () => {
    const a = await idOf('Đồ gia dụng');
    const b = await idOf('Đồ điện');
    await idOf('Phụ kiện', a);
    const dup = await create(409, 'PHU KIEN', a);
    expect(dup.body.code).toBe('DUPLICATE_NAME');
    expect(dup.body.details[0].field).toBe('name');
    await create(201, 'phụ kiện', b);
    // nhóm gốc cũng không trùng
    await create(409, 'do gia dung');
  });

  it('tối đa 3 cấp; chuyển nhóm làm vượt 3 cấp bị từ chối', async () => {
    const l1 = await idOf('Cấp 1');
    const l2 = await idOf('Cấp 2', l1);
    const l3 = await idOf('Cấp 3', l2);
    const tooDeep = await create(400, 'Cấp 4', l3);
    expect(tooDeep.body.details[0].field).toBe('parentId');

    // nhóm có con đem xuống dưới nhóm cấp 2 sẽ thành 4 cấp
    const other = await idOf('Nhóm khác');
    await idOf('Con của nhóm khác', other);
    const api = await t.as('quanly');
    await api.patch(`/categories/${other}`).send({ parentId: l2 }).expect(400);
  });

  it('không chuyển nhóm vào chính nó hoặc nhóm con của nó (chặn vòng lặp)', async () => {
    const a = await idOf('Vòng A');
    const b = await idOf('Vòng B', a);
    const api = await t.as('quanly');
    const self = await api
      .patch(`/categories/${a}`)
      .send({ parentId: a })
      .expect(400);
    expect(self.body.code).toBe('INVALID_STATE');
    await api.patch(`/categories/${a}`).send({ parentId: b }).expect(400);
    // chuyển ra gốc bằng null thì được
    const moved = await api
      .patch(`/categories/${b}`)
      .send({ parentId: null })
      .expect(200);
    expect(moved.body.parentId).toBeNull();
  });

  it('đổi tên; đổi sang tên đã có trong nhóm → 409; nhóm không tồn tại → 404', async () => {
    const p = await idOf('Cha đổi tên');
    const x = await idOf('Tên X', p);
    await idOf('Tên Y', p);
    const api = await t.as('quanly');
    const ok = await api
      .patch(`/categories/${x}`)
      .send({ name: 'Tên Z' })
      .expect(200);
    expect(ok.body.name).toBe('Tên Z');
    await api.patch(`/categories/${x}`).send({ name: 'tên y' }).expect(409);
    await api
      .patch('/categories/00000000-0000-4000-8000-000000000001')
      .send({ name: 'x' })
      .expect(404);
  });

  it('productCount của nhóm cha cộng dồn nhóm con và không đếm hàng đã xóa mềm', async () => {
    const cha = await idOf('Đếm hàng');
    const con = await idOf('Con đếm hàng', cha);
    await t.db.insert(products).values([
      { code: 'CNT1', name: 'Hàng 1', categoryId: con },
      { code: 'CNT2', name: 'Hàng 2', categoryId: con },
      { code: 'CNT3', name: 'Hàng 3', categoryId: cha },
      {
        code: 'CNT4',
        name: 'Hàng đã xóa',
        categoryId: con,
        deletedAt: new Date(),
      },
    ]);
    const api = await t.as('quanly');
    const tree = (await api.get('/categories').expect(200)).body as Array<{
      id: string;
      productCount: number;
      children: Array<{ id: string; productCount: number }>;
    }>;
    const node = tree.find((n) => n.id === cha)!;
    expect(node.productCount).toBe(3);
    expect(node.children[0]!.productCount).toBe(2);
  });

  it('xóa: chỉ khi không còn nhóm con và không còn hàng; xóa mềm nên tên dùng lại được', async () => {
    const cha = await idOf('Xóa cha');
    const con = await idOf('Xóa con', cha);
    const api = await t.as('quanly');

    const hasChild = await api.delete(`/categories/${cha}`).expect(400);
    expect(hasChild.body.code).toBe('INVALID_STATE');

    await t.db
      .insert(products)
      .values({ code: 'DEL1', name: 'H', categoryId: con });
    const hasProduct = await api.delete(`/categories/${con}`).expect(400);
    expect(hasProduct.body.details.productCount).toBe(1);

    await t.db
      .update(products)
      .set({ deletedAt: new Date() })
      .where(eq(products.code, 'DEL1'));
    // hàng đã xóa mềm không chặn
    await api.delete(`/categories/${con}`).expect(204);
    await api.delete(`/categories/${cha}`).expect(204);
    const [row] = await t.db
      .select()
      .from(categories)
      .where(eq(categories.id, con));
    expect(row?.deletedAt).not.toBeNull();
    // đã xóa mềm → tạo lại cùng tên được
    await idOf('Xóa con');
    await api.delete(`/categories/${con}`).expect(404);
  });

  it('kiểm tra dữ liệu: tên rỗng/quá dài, parentId sai dạng hoặc không tồn tại', async () => {
    const api = await t.as('quanly');
    await api.post('/categories').send({ name: '' }).expect(400);
    await api
      .post('/categories')
      .send({ name: 'x'.repeat(101) })
      .expect(400);
    await api
      .post('/categories')
      .send({ name: 'Ok', parentId: 'abc' })
      .expect(400);
    const missing = await api
      .post('/categories')
      .send({ name: 'Ok', parentId: '00000000-0000-4000-8000-000000000001' })
      .expect(400);
    expect(missing.body.details[0].field).toBe('parentId');
  });

  it('thay đổi được ghi nhật ký kèm người thao tác', async () => {
    const id = await idOf('Có nhật ký');
    const rows = await t.db.query.auditLogs.findMany({
      where: (l, { and, eq: e }) =>
        and(e(l.entityType, 'category'), e(l.entityId, id)),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'category.create',
      userId: await t.userId('quanly'),
    });
  });
});
