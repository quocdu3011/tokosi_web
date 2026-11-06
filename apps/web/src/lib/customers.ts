import type { AuthUser, Customer } from '@/lib/api/types';
import { scopeOf } from '@/lib/permissions';

export function customerAccess(
  user: Pick<AuthUser, 'id' | 'permissions'> | null,
  customer: { salesOwner: { id: string } | null; isInternalBranch: boolean },
) {
  const own = !!user && customer.salesOwner?.id === user.id;
  const allowed = (code: string) => {
    const scope = scopeOf(user, code);
    return scope === 'all' || (scope === 'own' && own);
  };
  return {
    edit: !customer.isInternalBranch && allowed('customer.edit'),
    debt: allowed('debt.view'),
  };
}

export function customerMonth(month: string): string | null {
  return month ? `${month}-01` : null;
}

export function workingCustomerFigures(customer: Customer, branchId: string | null) {
  return customer.branches.find((branch) => branch.branchId === branchId);
}
