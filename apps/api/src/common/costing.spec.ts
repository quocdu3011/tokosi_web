import {
  allocateProportionally,
  lineTotal,
  roundMoney,
  roundUnitPrice,
  weightedAverageCost,
} from './costing.js';

describe('làm tròn', () => {
  it('tiền về số nguyên đồng, nửa lên', () => {
    expect(roundMoney('12345.5')).toBe('12346');
    expect(roundMoney('12345.49')).toBe('12345');
    expect(roundMoney('0.4')).toBe('0');
    expect(roundMoney(7)).toBe('7');
  });

  it('đơn giá về 4 chữ số thập phân', () => {
    expect(roundUnitPrice('1179.97')).toBe('1179.9700');
    expect(roundUnitPrice('1.00005')).toBe('1.0001');
    expect(roundUnitPrice(0)).toBe('0.0000');
  });

  it('thành tiền = số lượng × đơn giá, không sai số float', () => {
    expect(lineTotal('2.500', '1179.97')).toBe('2950'); // 2949.925
    expect(lineTotal('3', '0.1')).toBe('0');
    expect(lineTotal('1095', '219967.98')).toBe('240864938'); // 240864938.1 → số thực tế KiotViet
    expect(0.1 + 0.2).not.toBe(0.3); // nhắc lý do không dùng float
  });
});

describe('weightedAverageCost', () => {
  it('bình quân gia quyền theo số lượng', () => {
    expect(weightedAverageCost('10', '1000', '10', '2000')).toBe('1500.0000');
    expect(weightedAverageCost('20', '1300', '40', '1016.675')).toBe(
      '1111.1167',
    );
  });

  it('kho hết hoặc âm thì lấy giá nhập', () => {
    expect(weightedAverageCost('0', '999', '5', '2000')).toBe('2000.0000');
    expect(weightedAverageCost('-3', '999', '5', '2000')).toBe('2000.0000');
  });

  it('nhập số lượng 0 không đổi giá vốn', () => {
    expect(weightedAverageCost('10', '1000', '0', '5000')).toBe('1000.0000');
  });

  it('làm tròn 4 chữ số', () => {
    expect(weightedAverageCost('3', '100', '1', '101')).toBe('100.2500');
    expect(weightedAverageCost('2', '1', '1', '1.0001')).toBe('1.0000'); // 1.0000333
  });
});

describe('allocateProportionally', () => {
  const sum = (xs: string[]) => xs.reduce((a, b) => a + Number(b), 0);

  it('chia theo tỷ lệ và tổng luôn đúng bằng khoản gốc', () => {
    expect(allocateProportionally(1000, [40000, 20000])).toEqual([
      '667',
      '333',
    ]);
    expect(allocateProportionally(100, [1, 1, 1])).toEqual(['34', '33', '33']);
    expect(allocateProportionally(10, [3, 1])).toEqual(['8', '2']);
  });

  it('khoản bằng 0 thì mọi phần bằng 0', () => {
    expect(allocateProportionally(0, [5, 7])).toEqual(['0', '0']);
  });

  it('trọng số đều bằng 0 thì chia đều', () => {
    expect(allocateProportionally(100, [0, 0])).toEqual(['50', '50']);
    expect(allocateProportionally(101, [0, 0])).toEqual(['51', '50']);
  });

  it('một dòng nhận trọn khoản', () => {
    expect(allocateProportionally(123456, [999])).toEqual(['123456']);
    expect(allocateProportionally(5, [])).toEqual([]);
  });

  it('trọng số bằng 0 ở một dòng thì dòng đó không nhận gì', () => {
    expect(allocateProportionally(90, [0, 30, 60])).toEqual(['0', '30', '60']);
  });

  it('từ chối khoản âm / không nguyên / trọng số âm', () => {
    expect(() => allocateProportionally(-1, [1])).toThrow();
    expect(() => allocateProportionally('10.5', [1])).toThrow();
    expect(() => allocateProportionally(10, [1, -1])).toThrow();
  });

  it('tính chất: với 500 trường hợp ngẫu nhiên, tổng các phần luôn bằng khoản gốc và không phần nào âm', () => {
    let seed = 12345;
    const rnd = () =>
      (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 500; i++) {
      const total = Math.floor(rnd() * 1_000_000);
      const n = 1 + Math.floor(rnd() * 8);
      const weights = Array.from({ length: n }, () =>
        Math.floor(rnd() * 100_000),
      );
      const parts = allocateProportionally(total, weights);
      expect(sum(parts)).toBe(total);
      expect(parts.every((p) => Number(p) >= 0)).toBe(true);
    }
  });
});
