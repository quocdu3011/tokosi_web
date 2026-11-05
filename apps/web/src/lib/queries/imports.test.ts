import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { runImport } from './imports';

vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());

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
