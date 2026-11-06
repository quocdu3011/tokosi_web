import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';
import { saveCustomer } from './customers';

beforeEach(() => useAuthStore.getState().setAccessToken('test-token'));
afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().clear();
  useBranchStore.getState().setBranchId(null);
});

it('tạo khách gửi tên, tháng, hồ sơ và đúng chi nhánh đã chọn', async () => {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          id: 'new-customer',
          warnings: [{ code: 'DUPLICATE_PHONE', message: 'Trùng số điện thoại' }],
        }),
        { status: 201 },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  useBranchStore.getState().setBranchId('branch-new');
  const input = {
    name: 'Cửa hàng A',
    phone: '0901234567',
    newSince: '2026-11-01',
    profile: { warehouseCount: 2, warehouseArea: '600m2' },
  };
  const result = await saveCustomer({ input }, 'branch-original');
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toMatch(/\/customers$/);
  expect(init!.method).toBe('POST');
  expect(init!.headers).toMatchObject({
    'X-Branch-Id': 'branch-original',
    Authorization: 'Bearer test-token',
  });
  expect(JSON.parse(init!.body as string)).toEqual(input);
  expect(result.warnings?.[0]?.code).toBe('DUPLICATE_PHONE');
});

it('sửa khách dùng PATCH, gửi null để xóa và giữ lỗi chi tiết từ BE', async () => {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          code: 'VALIDATION_ERROR',
          message: 'Số điện thoại không hợp lệ',
          details: [{ field: 'phone', message: 'Sai định dạng' }],
        }),
        { status: 400 },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    saveCustomer({ id: 'customer-id', input: { newSince: null, phone: 'invalid' } }, 'hn'),
  ).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
    details: [{ field: 'phone', message: 'Sai định dạng' }],
  });
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toMatch(/\/customers\/customer-id$/);
  expect(init!.method).toBe('PATCH');
  expect(JSON.parse(init!.body as string)).toEqual({ newSince: null, phone: 'invalid' });
});
