import { Decimal } from 'decimal.js';

/**
 * Tính toán giá vốn / tiền bằng số thập phân CHÍNH XÁC (không dùng float).
 * Quy ước: tiền chứng từ là số nguyên đồng; đơn giá và giá vốn có tối đa 4 chữ số thập phân;
 * làm tròn nửa lên (ROUND_HALF_UP).
 */
const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Num = string | number | Decimal;

export const dec = (v: Num): Decimal => new Dec(v);

/** Làm tròn tiền chứng từ về số nguyên đồng, trả về chuỗi ("12346"). */
export function roundMoney(v: Num): string {
  return dec(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
}

/** Làm tròn đơn giá/giá vốn về 4 chữ số thập phân ("1234.5000"). */
export function roundUnitPrice(v: Num): string {
  return dec(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** Thành tiền một dòng = số lượng × đơn giá, làm tròn về đồng. */
export function lineTotal(qty: Num, unitPrice: Num): string {
  return roundMoney(dec(qty).times(dec(unitPrice)));
}

/**
 * Giá vốn bình quân gia quyền sau khi nhập thêm `inQty` với đơn giá `inCost`.
 * Nếu kho đang hết (hoặc âm) thì giá vốn mới = giá nhập.
 */
export function weightedAverageCost(
  onHand: Num,
  currentCost: Num,
  inQty: Num,
  inCost: Num,
): string {
  const qtyNow = dec(onHand);
  const qtyIn = dec(inQty);
  if (qtyIn.lte(0)) return roundUnitPrice(currentCost);
  if (qtyNow.lte(0)) return roundUnitPrice(inCost);
  const total = qtyNow.times(dec(currentCost)).plus(qtyIn.times(dec(inCost)));
  return roundUnitPrice(total.div(qtyNow.plus(qtyIn)));
}

/**
 * Chia một khoản tiền SỐ NGUYÊN theo tỷ lệ `weights` sao cho tổng các phần đúng bằng khoản đó
 * (phương pháp phần dư lớn nhất). Nếu mọi trọng số bằng 0 thì chia đều.
 */
export function allocateProportionally(
  total: Num,
  weights: readonly Num[],
): string[] {
  const amount = dec(total);
  if (!amount.isInteger() || amount.isNegative()) {
    throw new Error('Khoản phân bổ phải là số nguyên đồng không âm');
  }
  if (weights.length === 0) return [];

  let w = weights.map((x) => dec(x));
  if (w.some((x) => x.isNegative())) throw new Error('Trọng số không được âm');
  let sum = w.reduce((a, b) => a.plus(b), dec(0));
  if (sum.isZero()) {
    w = w.map(() => dec(1));
    sum = dec(w.length);
  }

  const exact = w.map((x) => amount.times(x).div(sum));
  const floors = exact.map((x) => x.floor());
  let remainder = amount
    .minus(floors.reduce((a, b) => a.plus(b), dec(0)))
    .toNumber();
  const order = exact
    .map((x, i) => ({ i, frac: x.minus(floors[i] as Decimal) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  const result = floors.map((f) => f.toFixed(0));
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] = dec(result[i] as string)
      .plus(1)
      .toFixed(0);
    remainder -= 1;
  }
  return result;
}
