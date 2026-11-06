import {
  buildCategoryPaths,
  formatCost,
  formatQty,
  mapProducts,
  type KvProduct,
} from './mapper.js';

const cats = [
  { categoryId: 1, categoryName: ' NHÀ BẾP ' },
  { categoryId: 2, categoryName: 'Dao kéo', parentId: 1 },
  { categoryId: 3, categoryName: 'Dao thái', parentId: 2 },
  { categoryId: 4, categoryName: 'Quá sâu', parentId: 3 },
  { categoryId: 9, categoryName: 'Vòng A', parentId: 10 },
  { categoryId: 10, categoryName: 'Vòng B', parentId: 9 },
];
const ctx = { branchId: 7, categoryPaths: buildCategoryPaths(cats) };
const goods = (over: Partial<KvProduct> = {}): KvProduct => ({
  code: 'SP001',
  name: 'Dao',
  fullName: 'Dao (T24)',
  type: 2,
  categoryId: 2,
  isActive: true,
  inventories: [{ branchId: 7, onHand: 10, cost: 1500.5 }],
  ...over,
});

describe('đường dẫn nhóm hàng', () => {
  it('ghép từ gốc, bỏ khoảng trắng thừa', () => {
    expect(ctx.categoryPaths.get(3)).toEqual(['NHÀ BẾP', 'Dao kéo', 'Dao thái']);
  });
  it('không treo khi cha-con lặp vòng', () => {
    expect(ctx.categoryPaths.get(9)!.length).toBeLessThanOrEqual(2);
  });
});

describe('định dạng số', () => {
  it('số lượng tối đa 3 chữ số thập phân, không đuôi 0', () => {
    expect(formatQty(50)).toBe('50');
    expect(formatQty(2123.6)).toBe('2123.6');
    expect(formatQty(592.722)).toBe('592.722');
    expect(formatQty(0.1 + 0.2)).toBe('0.3');
  });
  it('giá vốn tối đa 4 chữ số thập phân, không dùng ký hiệu khoa học', () => {
    expect(formatCost(403.19)).toBe('403.19');
    expect(formatCost(0)).toBe('0');
    expect(formatCost(40293642)).toBe('40293642');
    expect(formatCost(10.00004999)).toBe('10');
  });
});

describe('mapProducts', () => {
  it('dùng tên có quy cách, nhóm đầy đủ, tồn và giá vốn của đúng chi nhánh', () => {
    const r = mapProducts(
      [
        goods({
          inventories: [
            { branchId: 99, onHand: 5, cost: 1 },
            { branchId: 7, onHand: 10, cost: 1500.5 },
          ],
        }),
      ],
      ctx,
    );
    expect(r.skipped).toEqual([]);
    expect(r.rows[0]).toEqual([
      'SP001',
      'Dao (T24)',
      'NHÀ BẾP>>Dao kéo',
      'Hàng hóa',
      '10',
      '1500.5',
      null,
      1,
      null,
    ]);
  });

  it('tồn 0 hoặc không có chi nhánh: không nhập tồn, không giá vốn', () => {
    const r = mapProducts(
      [
        goods({ code: 'A', inventories: [{ branchId: 7, onHand: 0, cost: 9 }] }),
        goods({ code: 'B', inventories: [] }),
        goods({ code: 'C', inventories: null }),
      ],
      ctx,
    );
    for (const row of r.rows) expect([row[4], row[5]]).toEqual([null, null]);
  });

  it('tồn âm không được nhập và được đếm', () => {
    const r = mapProducts(
      [goods({ inventories: [{ branchId: 7, onHand: -3, cost: 5 }] })],
      ctx,
    );
    expect(r.rows[0]![4]).toBeNull();
    expect(r.negativeStock).toBe(1);
  });

  it('hàng có tồn mà giá vốn 0/thiếu vẫn nhập với giá vốn 0', () => {
    const r = mapProducts(
      [goods({ inventories: [{ branchId: 7, onHand: 4, cost: 0 }] })],
      ctx,
    );
    expect([r.rows[0]![4], r.rows[0]![5]]).toEqual(['4', '0']);
  });

  it('bỏ qua và liệt kê, không sửa mã: mã sai quy tắc, không phải hàng hóa, trùng không phân biệt hoa thường', () => {
    const r = mapProducts(
      [
        goods({ code: 'MUA VỎ' }),
        goods({ code: 'COMBO1', type: 1 }),
        goods({ code: 'DV1', type: 3 }),
        goods({ code: 'abc' }),
        goods({ code: 'ABC' }),
      ],
      ctx,
    );
    expect(r.rows.map((x) => x[0])).toEqual(['abc']);
    expect(r.skipped).toEqual([
      { code: 'MUA VỎ', reason: 'ma-khong-hop-le' },
      { code: 'COMBO1', reason: 'khong-phai-hang-hoa' },
      { code: 'DV1', reason: 'khong-phai-hang-hoa' },
      { code: 'ABC', reason: 'ma-trung' },
    ]);
  });

  it('bỏ qua tên quá dài và nhóm quá 3 cấp', () => {
    const r = mapProducts(
      [
        goods({ code: 'L', fullName: 'x'.repeat(256) }),
        goods({ code: 'D', categoryId: 4 }),
      ],
      ctx,
    );
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'ten-qua-dai',
      'nhom-qua-3-cap',
    ]);
  });

  it('ngừng kinh doanh → 0; ảnh trùng gộp, tối đa 10 ảnh', () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://x/${i}.jpg`);
    const r = mapProducts(
      [goods({ isActive: false, images: [urls[0]!, urls[0]!, ...urls] })],
      ctx,
    );
    expect(r.rows[0]![7]).toBe(0);
    expect(String(r.rows[0]![8]).split(',')).toHaveLength(10);
    expect(r.imagesTrimmed).toBe(1);
  });
});
