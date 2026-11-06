import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { runImport } from './imports';

vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

it('nhập khách theo mẫu TKS, không cho gửi chế độ cộng tồn', async () => {
  const args = {
    type: 'customers' as const,
    mode: 'overwrite' as const,
    file: new File(['test'], 'customers.xlsx'),
    branchId: 'hn',
    dryRun: true,
  };
  await runImport(args);
  expect(api.post).toHaveBeenCalledWith('/imports/customers', expect.any(FormData), {
    query: { dryRun: true, branchId: 'hn', mode: 'overwrite', allowDuplicate: false },
  });
  await expect(runImport({ ...args, mode: 'add' })).rejects.toThrow();
});

it('chặn file trùng theo mặc định và chỉ cho phép khi xác nhận rõ ràng', async () => {
  const args = {
    type: 'products' as const,
    mode: 'add' as const,
    file: new File(['test'], 'test.xlsx'),
    branchId: 'sg',
    dryRun: true,
  };
  await runImport(args);
  expect(api.post).toHaveBeenLastCalledWith('/imports/products', expect.any(FormData), {
    query: { dryRun: true, branchId: 'sg', mode: 'add', allowDuplicate: false },
  });
  await runImport({ ...args, allowDuplicate: true });
  expect(api.post).toHaveBeenLastCalledWith('/imports/products', expect.any(FormData), {
    query: { dryRun: true, branchId: 'sg', mode: 'add', allowDuplicate: true },
  });
});
