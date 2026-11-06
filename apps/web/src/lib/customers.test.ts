import { expect, it } from 'vitest';
import { customerAccess, customerMonth, workingCustomerFigures } from './customers';
import type { Customer } from '@/lib/api/types';

it('quyền own chỉ cho sửa/xem nợ khách do mình phụ trách', () => {
  const user = {
    id: 'me',
    permissions: [
      { code: 'customer.edit', scope: 'own' as const },
      { code: 'debt.view', scope: 'own' as const },
    ],
  };
  expect(customerAccess(user, { salesOwner: { id: 'other' }, isInternalBranch: false })).toEqual({
    edit: false,
    debt: false,
  });
  expect(customerAccess(user, { salesOwner: { id: 'me' }, isInternalBranch: false })).toEqual({
    edit: true,
    debt: true,
  });
  expect(customerAccess(user, { salesOwner: { id: 'me' }, isInternalBranch: true }).edit).toBe(
    false,
  );
});

it('gửi tháng khách mới đúng ngày đầu tháng, trống để xóa', () => {
  expect(customerMonth('2026-11')).toBe('2026-11-01');
  expect(customerMonth('')).toBeNull();
});

it('không lấy số dư chi nhánh khác hoặc thay số bị ẩn thành 0', () => {
  const customer = {
    branches: [{ branchId: 'hn', balance: '999999999999999' }, { branchId: 'sg' }],
  } as Customer;
  expect(workingCustomerFigures(customer, 'hn')?.balance).toBe('999999999999999');
  expect(workingCustomerFigures(customer, 'sg')?.balance).toBeUndefined();
  expect(workingCustomerFigures(customer, 'other')).toBeUndefined();
});

it('không có quyền thì không sửa/xem nợ; quyền all áp dụng mọi khách', () => {
  const customer = { salesOwner: null, isInternalBranch: false };
  expect(customerAccess(null, customer)).toEqual({ edit: false, debt: false });
  expect(
    customerAccess(
      {
        id: 'me',
        permissions: [
          { code: 'customer.edit', scope: 'all' },
          { code: 'debt.view', scope: 'all' },
        ],
      },
      customer,
    ),
  ).toEqual({ edit: true, debt: true });
});
