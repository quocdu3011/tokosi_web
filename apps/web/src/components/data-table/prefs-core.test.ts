import { DEFAULT_PAGE_SIZE, TABLE_PREFS_LIMITS, type TablePrefs } from '@kiot/shared';
import { describe, expect, it } from 'vitest';

import type { ColumnSpec } from './column-meta';
import {
  LEGACY_STORAGE_KEYS,
  MIN_COLUMN_WIDTH,
  mergePrefs,
  pruneLegacyPrefs,
  readLegacyPrefs,
  samePrefs,
  sanitizePrefs,
  sanitizeTables,
  withHidden,
  withOrder,
  withPageSize,
  withWidth,
  withoutWidth,
} from './prefs-core';

function spec(id: string, extra: Partial<ColumnSpec> = {}): ColumnSpec {
  return { id, label: id, width: 160, hiddenByDefault: false, locked: false, ...extra };
}

// code (khóa) | name | cost | stock | note (ẩn mặc định) | actions (khóa)
const SPECS: ColumnSpec[] = [
  spec('code', { locked: true, width: 120 }),
  spec('name', { width: 320 }),
  spec('cost', { width: 140 }),
  spec('stock', { width: 110 }),
  spec('note', { hiddenByDefault: true, width: 280 }),
  spec('actions', { locked: true, width: 80 }),
];

describe('mergePrefs', () => {
  it('chưa lưu gì: thứ tự mặc định, ẩn theo hiddenByDefault, độ rộng mặc định, 15 dòng/trang', () => {
    const merged = mergePrefs(SPECS, undefined);
    expect(merged.order).toEqual(['code', 'name', 'cost', 'stock', 'note', 'actions']);
    expect([...merged.hidden]).toEqual(['note']);
    expect(merged.widths).toEqual({
      code: 120,
      name: 320,
      cost: 140,
      stock: 110,
      note: 280,
      actions: 80,
    });
    expect(merged.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(DEFAULT_PAGE_SIZE).toBe(15);
  });

  it('áp thứ tự đã lưu cho cột đổi chỗ được; cột khóa vẫn đứng đúng ô mặc định', () => {
    const merged = mergePrefs(SPECS, { order: ['stock', 'cost', 'name', 'note'] });
    expect(merged.order).toEqual(['code', 'stock', 'cost', 'name', 'note', 'actions']);
  });

  it('thứ tự đã lưu cố đặt cột khóa sai chỗ: bị bỏ qua', () => {
    const merged = mergePrefs(SPECS, {
      order: ['actions', 'name', 'code', 'cost', 'stock', 'note'],
    });
    expect(merged.order[0]).toBe('code');
    expect(merged.order.at(-1)).toBe('actions');
    expect(merged.order.slice(1, -1)).toEqual(['name', 'cost', 'stock', 'note']);
  });

  it('bỏ cột lạ khỏi thứ tự, độ rộng và danh sách ẩn', () => {
    const merged = mergePrefs(SPECS, {
      order: ['gone', 'cost', 'name', 'note'],
      hidden: ['gone', 'stock'],
      widths: { gone: 300, name: 400 },
    });
    expect(merged.order).not.toContain('gone');
    expect([...merged.hidden]).toEqual(['stock']);
    expect(Object.keys(merged.widths)).not.toContain('gone');
    expect(merged.widths.name).toBe(400);
  });

  it('cột mới (chưa có trong thứ tự đã lưu) được nối vào CUỐI các cột đổi chỗ được, theo thứ tự mặc định', () => {
    const merged = mergePrefs(SPECS, { order: ['stock', 'name'] });
    // cost, note chưa có trong bản lưu -> sau stock, name theo thứ tự mặc định.
    expect(merged.order).toEqual(['code', 'stock', 'name', 'cost', 'note', 'actions']);
  });

  it('cột khóa không bao giờ bị ẩn, kể cả khi bản lưu ghi ẩn', () => {
    const merged = mergePrefs(SPECS, { hidden: ['code', 'actions', 'name'] });
    expect([...merged.hidden]).toEqual(['name']);
  });

  it('đã lưu hidden thì dùng đúng tập đó (không lấy hiddenByDefault); [] = hiện hết', () => {
    expect([...mergePrefs(SPECS, { hidden: [] }).hidden]).toEqual([]);
    expect([...mergePrefs(SPECS, { hidden: ['cost'] }).hidden]).toEqual(['cost']);
  });

  it('cột mới có hiddenByDefault vẫn ẩn dù người dùng đã lưu hidden (cột chưa có trong order đã lưu)', () => {
    const specs = [...SPECS, spec('extra', { hiddenByDefault: true })];
    const merged = mergePrefs(specs, {
      hidden: ['cost'],
      order: ['name', 'cost', 'stock', 'note'],
    });
    expect(merged.hidden.has('extra')).toBe(true);
    // Nhưng cột người dùng đã bật (có trong order, không trong hidden) thì hiện.
    expect(merged.hidden.has('note')).toBe(false);
  });

  it('kẹp độ rộng theo giới hạn của server; làm tròn; giá trị hỏng về mặc định', () => {
    const { minColumnWidth, maxColumnWidth } = TABLE_PREFS_LIMITS;
    const merged = mergePrefs(SPECS, {
      widths: {
        name: 5,
        cost: 99999,
        stock: 200.6,
        note: Number.NaN,
      },
    });
    expect(merged.widths.name).toBe(minColumnWidth);
    expect(merged.widths.cost).toBe(maxColumnWidth);
    expect(merged.widths.stock).toBe(201);
    expect(merged.widths.note).toBe(280);
  });

  it('pageSize ngoài 15/50/100 về 15; hợp lệ thì giữ', () => {
    expect(mergePrefs(SPECS, { pageSize: 50 }).pageSize).toBe(50);
    expect(mergePrefs(SPECS, { pageSize: 100 }).pageSize).toBe(100);
    expect(mergePrefs(SPECS, { pageSize: 20 as never }).pageSize).toBe(15);
    expect(mergePrefs(SPECS, { pageSize: '50' as never }).pageSize).toBe(15);
  });

  it('không có cột nào: kết quả rỗng nhưng hợp lệ', () => {
    const merged = mergePrefs([], { order: ['a'], hidden: ['a'], widths: { a: 100 } });
    expect(merged.order).toEqual([]);
    expect(merged.hidden.size).toBe(0);
    expect(merged.widths).toEqual({});
  });
});

describe('withHidden', () => {
  it('ghi rõ toàn bộ tập ẩn (gồm mặc định) khi người dùng đổi một cột', () => {
    const next = withHidden(SPECS, undefined, 'cost', true);
    expect(next.hidden).toEqual(['cost', 'note']);
    expect(withHidden(SPECS, next, 'note', false).hidden).toEqual(['cost']);
  });

  it('cột khóa hoặc không tồn tại: không đổi', () => {
    const saved: TablePrefs = { pageSize: 50 };
    expect(withHidden(SPECS, saved, 'code', true)).toBe(saved);
    expect(withHidden(SPECS, saved, 'nope', true)).toBe(saved);
  });

  it('giữ các trường khác và id cột hiện không có trên màn', () => {
    const next = withHidden(
      SPECS,
      { pageSize: 50, hidden: ['costPrice-vang-quyen'] },
      'stock',
      true,
    );
    expect(next.pageSize).toBe(50);
    expect(next.hidden).toEqual(['stock', 'costPrice-vang-quyen']);
  });
});

describe('withOrder', () => {
  it('đổi chỗ các cột đang hiện, cột đang ẩn và cột khóa giữ nguyên ô', () => {
    // Đang ẩn "note" (mặc định). Danh sách hiện: code, name, cost, stock, actions.
    const next = withOrder(SPECS, undefined, ['code', 'stock', 'name', 'cost', 'actions']);
    expect(next.order).toEqual(['code', 'stock', 'name', 'cost', 'note', 'actions']);
  });

  it('cột ẩn nằm giữa vẫn đứng yên khi hai cột hai bên đổi chỗ', () => {
    const next = withOrder(SPECS, { hidden: ['cost'] }, ['stock', 'name']);
    expect(next.order).toEqual(['code', 'stock', 'cost', 'name', 'note', 'actions']);
  });

  it('nhận toàn bộ cột kể cả cột khóa nhưng cột khóa không dịch chuyển', () => {
    const next = withOrder(SPECS, undefined, ['actions', 'note', 'stock', 'cost', 'name', 'code']);
    expect(next.order?.[0]).toBe('code');
    expect(next.order?.at(-1)).toBe('actions');
    expect(next.order).toEqual(['code', 'note', 'stock', 'cost', 'name', 'actions']);
  });

  it('id lạ hoặc trùng bị bỏ qua', () => {
    const next = withOrder(SPECS, undefined, ['stock', 'zzz', 'stock', 'name']);
    expect(next.order).toEqual(['code', 'stock', 'cost', 'name', 'note', 'actions']);
  });

  it('kết quả đưa lại qua mergePrefs cho đúng thứ tự mong muốn', () => {
    const next = withOrder(SPECS, undefined, ['name', 'cost', 'stock', 'note'].reverse());
    expect(mergePrefs(SPECS, next).order).toEqual(next.order);
  });
});

describe('withWidth / withoutWidth / withPageSize', () => {
  it('đặt độ rộng, kẹp tối thiểu khi kéo (64) và tối đa (1000), làm tròn', () => {
    expect(withWidth(undefined, 'name', 250.4).widths).toEqual({ name: 250 });
    expect(withWidth(undefined, 'name', 10).widths).toEqual({ name: MIN_COLUMN_WIDTH });
    expect(withWidth(undefined, 'name', 5000).widths).toEqual({ name: 1000 });
    expect(withWidth({ widths: { a: 100 } }, 'b', 200).widths).toEqual({ a: 100, b: 200 });
  });

  it('bỏ qua giá trị không phải số hữu hạn', () => {
    const saved = { widths: { a: 100 } };
    expect(withWidth(saved, 'a', Number.NaN)).toBe(saved);
  });

  it('đặt lại độ rộng một cột; hết cột nào thì bỏ khóa widths', () => {
    const saved: TablePrefs = { widths: { a: 100, b: 200 }, pageSize: 50 };
    expect(withoutWidth(saved, 'a')).toEqual({ widths: { b: 200 }, pageSize: 50 });
    expect(withoutWidth({ widths: { a: 100 }, pageSize: 50 }, 'a')).toEqual({ pageSize: 50 });
    expect(withoutWidth(saved, 'zzz')).toBe(saved);
  });

  it('không sửa tại chỗ bản ghi cũ', () => {
    const saved: TablePrefs = { widths: { a: 100 } };
    withWidth(saved, 'a', 300);
    withoutWidth(saved, 'a');
    expect(saved).toEqual({ widths: { a: 100 } });
  });

  it('đặt số dòng mỗi trang: chỉ nhận 15/50/100', () => {
    expect(withPageSize(undefined, 50)).toEqual({ pageSize: 50 });
    expect(withPageSize({ pageSize: 50 }, 20)).toEqual({ pageSize: 50 });
    expect(withPageSize({ hidden: ['a'] }, 100)).toEqual({ hidden: ['a'], pageSize: 100 });
  });
});

describe('sanitizePrefs / sanitizeTables', () => {
  it('giữ trường đúng kiểu, bỏ trường sai kiểu/trường lạ', () => {
    expect(
      sanitizePrefs({
        hidden: ['a', 7, '', 'a'],
        order: 'sai',
        widths: { a: 100.2, b: 'x', c: 5 },
        pageSize: 50,
        extra: 1,
      }),
    ).toEqual({ hidden: ['a'], widths: { a: 100, c: 40 }, pageSize: 50 });
  });

  it('không phải đối tượng → undefined; pageSize sai bị bỏ', () => {
    expect(sanitizePrefs(null)).toBeUndefined();
    expect(sanitizePrefs([])).toBeUndefined();
    expect(sanitizePrefs({ pageSize: 20 })).toEqual({});
  });

  it('bản đồ: bỏ khóa bảng sai mẫu và bản ghi hỏng', () => {
    expect(
      sanitizeTables({
        products: { pageSize: 100 },
        'Bad Key': { pageSize: 50 },
        broken: 'x',
      }),
    ).toEqual({ products: { pageSize: 100 } });
    expect(sanitizeTables(undefined)).toEqual({});
  });

  it('samePrefs so sánh theo nội dung', () => {
    expect(samePrefs({ pageSize: 50 }, { pageSize: 50 })).toBe(true);
    expect(samePrefs(undefined, null)).toBe(true);
    expect(samePrefs({ pageSize: 50 }, { pageSize: 15 })).toBe(false);
  });
});

describe('khóa localStorage cũ -> bảng mới', () => {
  const store = (entries: Record<string, string>) => (key: string) => entries[key] ?? null;

  it('ánh xạ đủ các màn hiện có', () => {
    expect(Object.keys(LEGACY_STORAGE_KEYS).sort()).toEqual([
      'goods-receipts',
      'products',
      'purchase-orders',
      'purchase-returns',
      'suppliers',
      'users',
    ]);
    expect(LEGACY_STORAGE_KEYS.products).toEqual({
      hidden: 'cols:products',
      widths: 'table:products',
    });
    expect(LEGACY_STORAGE_KEYS.users).toEqual({ hidden: 'cols:users' });
    expect(LEGACY_STORAGE_KEYS.suppliers).toEqual({
      hidden: 'table:suppliers:hidden',
      widths: 'table:suppliers',
    });
    // `kind` của màn mua hàng là orders | receipts | returns; khóa bảng mới của receipts là goods-receipts.
    expect(LEGACY_STORAGE_KEYS['goods-receipts']).toEqual({
      hidden: 'table:purchase-receipts:hidden',
      widths: 'table:purchase-receipts',
    });
  });

  it('đọc cột ẩn + độ rộng cũ', () => {
    const read = readLegacyPrefs(
      'products',
      store({
        'cols:products': JSON.stringify(['description', 'createdAt']),
        'table:products': JSON.stringify({ code: 120, name: 400.4 }),
      }),
    );
    expect(read).toEqual({
      prefs: { hidden: ['description', 'createdAt'], widths: { code: 120, name: 400 } },
      keys: ['cols:products', 'table:products'],
    });
  });

  it('chỉ có một trong hai khóa vẫn đọc được; không có khóa nào → null; bảng lạ → null', () => {
    expect(readLegacyPrefs('users', store({ 'cols:users': JSON.stringify(['phone']) }))).toEqual({
      prefs: { hidden: ['phone'] },
      keys: ['cols:users'],
    });
    expect(readLegacyPrefs('products', store({}))).toBeNull();
    expect(readLegacyPrefs('khong-co', store({ 'cols:products': '[]' }))).toBeNull();
  });

  it('dữ liệu cũ hỏng: vẫn báo khóa để dọn, nội dung rỗng', () => {
    const read = readLegacyPrefs(
      'products',
      store({ 'cols:products': '{hỏng', 'table:products': '"x"' }),
    );
    expect(read).toEqual({ prefs: {}, keys: ['cols:products', 'table:products'] });
  });

  it('pruneLegacyPrefs chỉ giữ phần người dùng thật sự đổi', () => {
    const legacy: TablePrefs = {
      hidden: ['note', 'ghost', 'code'],
      widths: { name: 320, cost: 200, ghost: 300 },
    };
    // note là ẩn mặc định; ghost không còn; code bị khóa -> tập ẩn thật = {note} = mặc định -> bỏ.
    expect(pruneLegacyPrefs(legacy, SPECS)).toEqual({ widths: { cost: 200 } });
  });

  it('pruneLegacyPrefs: tập ẩn khác mặc định thì giữ; không còn gì khác mặc định thì null', () => {
    expect(pruneLegacyPrefs({ hidden: ['note', 'stock'] }, SPECS)).toEqual({
      hidden: ['note', 'stock'],
    });
    expect(pruneLegacyPrefs({ hidden: ['note'], widths: { name: 320 } }, SPECS)).toBeNull();
    expect(pruneLegacyPrefs({}, SPECS)).toBeNull();
  });
});
