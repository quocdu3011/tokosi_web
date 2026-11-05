import { beforeEach, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { updateUser } from './users';

vi.mock('@/lib/api', () => ({ api: { patch: vi.fn(), put: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it('gán chi nhánh trước để duyệt tài khoản pending chưa có chi nhánh', async () => {
  let assigned = false;
  vi.mocked(api.put).mockImplementation(async () => {
    assigned = true;
    return {} as never;
  });
  vi.mocked(api.patch).mockImplementation(async () => {
    if (!assigned) throw new Error('Chưa có chi nhánh');
    return { role: 'sales', branchIds: ['sg'] } as never;
  });
  await expect(
    updateUser({ id: 'u', patch: { role: 'sales' }, branches: { branchIds: ['sg'] } }),
  ).resolves.toMatchObject({ role: 'sales', branchIds: ['sg'] });
});

it('nâng lên Quản lý trước khi bỏ hết chi nhánh', async () => {
  let manager = false;
  vi.mocked(api.patch).mockImplementation(async () => {
    manager = true;
    return {} as never;
  });
  vi.mocked(api.put).mockImplementation(async () => {
    if (!manager) throw new Error('Vai trò nhân viên cần chi nhánh');
    return { role: 'manager', branchIds: [] } as never;
  });
  await expect(
    updateUser({ id: 'u', patch: { role: 'manager' }, branches: { branchIds: [] } }),
  ).resolves.toMatchObject({ role: 'manager', branchIds: [] });
});

it('không đổi vai trò nếu gán chi nhánh thất bại', async () => {
  vi.mocked(api.put).mockRejectedValue(new Error('Chi nhánh không hợp lệ'));
  await expect(
    updateUser({ id: 'u', patch: { role: 'sales' }, branches: { branchIds: ['bad'] } }),
  ).rejects.toThrow('Chi nhánh không hợp lệ');
  expect(api.patch).not.toHaveBeenCalled();
});
