import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';
import type { PurchaseDraft } from '@/lib/purchasing';
import { createPurchase } from './purchasing';

const draft: PurchaseDraft = {
  supplierId: 'supplier-test',
  referenceId: 'order-test',
  status: 'draft',
  date: '2026-11-06T10:30',
  note: 'Dữ liệu kiểm thử',
  items: [
    {
      productId: 'product-test',
      code: 'P1',
      name: 'Hàng mẫu',
      qty: '1.125',
      unitCost: '999999999999.1234',
    },
  ],
};
beforeEach(() => {
  useAuthStore.getState().setAccessToken('test-token');
});
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
});

it('gửi đúng chi nhánh đã chốt, khóa chống trùng, đơn giá chuỗi và thời gian UTC', async () => {
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ id: 'receipt-test' }), { status: 201 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  useBranchStore.getState().setBranchId('branch-new');
  await createPurchase('receipts', draft, 'same-request-key', 'branch-original');
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toMatch(/\/goods-receipts$/);
  expect(init!.headers).toMatchObject({
    'X-Branch-Id': 'branch-original',
    'Idempotency-Key': 'same-request-key',
  });
  expect(JSON.parse(init!.body as string)).toEqual({
    supplierId: 'supplier-test',
    purchaseOrderId: 'order-test',
    note: 'Dữ liệu kiểm thử',
    receivedAt: '2026-11-06T03:30:00.000Z',
    items: [{ productId: 'product-test', qty: '1.125', unitCost: '999999999999.1234' }],
  });
});

it('thử lại cùng yêu cầu sau lỗi mạng giữ nguyên khóa chống trùng', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('Network lost'))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'order-test' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(createPurchase('orders', draft, 'stable-key', 'branch-test')).rejects.toMatchObject({
    code: 'NETWORK_ERROR',
  });
  await expect(createPurchase('orders', draft, 'stable-key', 'branch-test')).resolves.toMatchObject(
    { id: 'order-test' },
  );
  const headers = fetchMock.mock.calls.map(([, init]) => init!.headers as Record<string, string>);
  expect(headers[0]!['Idempotency-Key']).toBe(headers[1]!['Idempotency-Key']);
});

it('giữ lỗi trả quá số đã nhập của BE để form hiển thị', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: 'RETURN_QTY_EXCEEDED',
            message: 'Số lượng trả vượt số đã nhập',
            details: [{ field: 'items.0.qty', message: 'Chỉ còn 1 sản phẩm' }],
          }),
          { status: 422 },
        ),
    ),
  );
  await expect(createPurchase('returns', draft, 'return-key', 'branch-test')).rejects.toMatchObject(
    {
      code: 'RETURN_QTY_EXCEEDED',
      details: [{ field: 'items.0.qty', message: 'Chỉ còn 1 sản phẩm' }],
    },
  );
});
