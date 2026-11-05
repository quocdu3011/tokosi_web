import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  Branch,
  CreateUserInput,
  RoleCode,
  SetUserBranchesInput,
  UpdateUserInput,
  User,
  UserList,
  UserWithPassword,
} from '@/lib/api/types';

/** Truy vấn/thao tác người dùng (`/users…`, quyền `user.manage`) — docs/api/endpoints.md mục 1. */

export interface UserListParams {
  q?: string;
  role?: RoleCode;
  isActive?: boolean;
  page: number;
  limit: number;
}

export const userKeys = {
  all: ['users'] as const,
  list: (p: UserListParams) => ['users', 'list', p] as const,
};

export function useUserList(params: UserListParams) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: ({ signal }) =>
      api.get<UserList>('/users', { query: { ...params }, signal, branchId: null }),
    placeholderData: keepPreviousData,
  });
}

/** Chi nhánh người dùng hiện tại được phép (Quản lý: tất cả) — dùng để gán chi nhánh cho nhân viên. */
export function useBranches() {
  return useQuery({
    queryKey: ['branches'],
    queryFn: ({ signal }) => api.get<Branch[]>('/branches', { signal, branchId: null }),
    staleTime: 5 * 60_000,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      api.post<UserWithPassword>('/users', input, { branchId: null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

/** Sửa thông tin + (nếu đổi) gán lại chi nhánh. Hai lệnh gọi tuần tự; lỗi ở bước nào báo bước đó. */
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      patch: UpdateUserInput;
      branches?: SetUserBranchesInput;
    }) => {
      let user = await api.patch<User>(`/users/${args.id}`, args.patch, { branchId: null });
      if (args.branches) {
        user = await api.put<User>(`/users/${args.id}/branches`, args.branches, {
          branchId: null,
        });
      }
      return user;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ temporaryPassword?: string }>(
        `/users/${id}/reset-password`,
        {},
        { branchId: null },
      ),
  });
}
