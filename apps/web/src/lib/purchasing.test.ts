import { describe, expect, it } from 'vitest';
import {
  buildPurchaseInput,
  decimalAdd,
  decimalSubtract,
  expandProduct,
  mergePurchaseRows,
  purchaseActions,
} from './purchasing';

describe('dòng mua hàng', () => {
  it('gộp hàng lặp chính xác và giữ đơn giá đã nhập, không đổi dữ liệu cũ', () => {
    const original = [{ productId: 'p', code: 'P', name: 'P', qty: '0.1', unitCost: '123.4567' }];
    expect(mergePurchaseRows(original, [{ ...original[0]!, qty: '0.2', unitCost: '0' }])).toEqual([
      { ...original[0], qty: '0.3' },
    ]);
    expect(original[0]!.qty).toBe('0.1');
  });
  it('cộng trừ thập phân chính xác, không đổi qua số thực', () => {
    expect(decimalAdd('9007199254740993.001', '0.009')).toBe('9007199254740993.01');
    expect(decimalSubtract('10.125', '0.126')).toBe('9.999');
  });
  it('tách combo thành hàng thật và giữ chính xác số lượng', () => {
    expect(
      expandProduct(
        {
          productType: 'combo',
          componentItems: [{ productId: 'a', code: 'A', name: 'A', qty: 3 }],
        },
        '0.125',
      ),
    ).toEqual([{ productId: 'a', code: 'A', name: 'A', qty: '0.375', unitCost: '0' }]);
  });
  it('phiếu trả gửi returnPrice, không gửi unitCost/tổng tiền/giảm giá', () => {
    expect(
      buildPurchaseInput('returns', {
        supplierId: 's',
        note: '',
        date: '',
        referenceId: 'r',
        status: 'draft',
        items: [{ productId: 'p', code: 'P', name: 'P', qty: '2.5', unitCost: '1234.5000' }],
      }),
    ).toEqual({
      supplierId: 's',
      note: '',
      goodsReceiptId: 'r',
      items: [{ productId: 'p', qty: '2.5', returnPrice: '1234.5000' }],
    });
  });
});

describe('thao tác phiếu đặt', () => {
  it('khóa sửa và hủy sau khi đã nhập một phần; cho kết thúc', () => {
    expect(
      purchaseActions('orders', { status: 'confirmed', receipts: [{ id: 'r', code: 'PN1' }] }),
    ).toEqual({ edit: false, confirm: false, complete: true, cancel: false });
  });
  it('phiếu đã hủy không có thao tác ghi', () => {
    expect(purchaseActions('receipts', { status: 'cancelled' })).toEqual({
      edit: false,
      confirm: false,
      complete: false,
      cancel: false,
    });
  });
});
