import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  Grant,
  PermissionCatalog,
  RoleCode,
  RolePermissions,
  RoleSummary,
  SetRolePermissionsResult,
} from '@/lib/api/types';
import { reloadMe } from '@/lib/auth/session';

/** Phân quyền theo vai trò (`role.manage`) — docs/api/endpoints.md mục 10. */

export const roleKeys = {
  catalog: ['permissions', 'catalog'] as const,
  roles: ['roles'] as const,
  role: (role: RoleCode) => ['roles', role] as const,
};

export function usePermissionCatalog() {
  return useQuery({
    queryKey: roleKeys.catalog,
    queryFn: ({ signal }) =>
      api.get<PermissionCatalog>('/permissions/catalog', { signal, branchId: null }),
    staleTime: Infinity,
  });
}

export function useRoles() {
  return useQuery({
    queryKey: roleKeys.roles,
    queryFn: ({ signal }) => api.get<RoleSummary[]>('/roles', { signal, branchId: null }),
  });
}

/** Gộp kết quả nhiều truy vấn quyền thành một map theo vai trò (hàm ổn định để TanStack Query ghi nhớ). */
function combineRoles(results: UseQueryResult<RolePermissions>[]) {
  const byRole = new Map<RoleCode, Grant[]>();
  for (const r of results) if (r.data) byRole.set(r.data.role, r.data.permissions);
  return {
    byRole,
    isLoading: results.some((r) => r.isLoading),
    error: results.find((r) => r.error)?.error ?? null,
  };
}

/** Quyền hiện tại của nhiều vai trò cùng lúc (mỗi vai trò một truy vấn). */
export function useRolesPermissions(roles: RoleCode[]) {
  return useQueries({
    queries: roles.map((role) => ({
      queryKey: roleKeys.role(role),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.get<RolePermissions>(`/roles/${role}/permissions`, { signal, branchId: null }),
    })),
    combine: combineRoles,
  });
}

export function useSaveRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ role, permissions }: { role: RoleCode; permissions: Grant[] }) =>
      api.put<SetRolePermissionsResult>(
        `/roles/${role}/permissions`,
        { permissions },
        { branchId: null },
      ),
    onSuccess: (result) => {
      qc.setQueryData(roleKeys.role(result.role), result);
      void qc.invalidateQueries({ queryKey: roleKeys.roles });
      // Quyền có hiệu lực ngay; nếu người đang đăng nhập thuộc vai trò này thì menu đổi theo.
      void reloadMe().catch(() => undefined);
    },
  });
}

export function useResetRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (role: RoleCode) =>
      api.post<RolePermissions>(`/roles/${role}/permissions/reset`, undefined, { branchId: null }),
    onSuccess: (result) => {
      qc.setQueryData(roleKeys.role(result.role), result);
      void qc.invalidateQueries({ queryKey: roleKeys.roles });
      void reloadMe().catch(() => undefined);
    },
  });
}
