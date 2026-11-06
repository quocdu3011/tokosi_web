'use client';

import { PENDING_ROLE, ROLE_LABELS, ROLES } from '@kiot/shared';
import { KeyRound, Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/common/coming-soon';
import { PENDING_LABEL, RoleBadge } from '@/components/common/role-badge';
import { StatusBadge, ACTIVE_STATUS_TONES } from '@/components/common/status-badge';
import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import {
  ColumnPicker,
  FilterSelect,
  TableSearch,
  TableToolbar,
  ToolbarCount,
  ToolbarEnd,
} from '@/components/data-table/table-toolbar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useListState } from '@/hooks/use-list-state';
import { useTablePrefs } from '@/hooks/use-table-prefs';
import { errorMessage } from '@/lib/api';
import type { RoleCode, User } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { formatDateTime } from '@/lib/format';
import { useBranches, useResetPassword, useUserList } from '@/lib/queries/users';
import { sortRows, type SortValue } from '@/lib/table-sort';

import { TemporaryPasswordDialog } from './temporary-password-dialog';
import { UserFormDialog } from './user-form-dialog';

const TABLE_KEY = 'users';
/** Chuỗi rỗng = mọi giá trị (không lọc). */
const INITIAL_FILTERS = { role: '', status: '' };
// Mảng rỗng cố định: tránh tạo mảng mới mỗi lần render làm bảng tính lại dòng.
const EMPTY: User[] = [];

/** GET /users chưa hỗ trợ `sort` (endpoints.md mục 1) nên mọi cột sắp xếp trong trang đang xem. */
const PAGE_SORT: Record<string, (u: User) => SortValue> = {
  code: (u) => u.code,
  name: (u) => u.fullName,
  role: (u) => u.role,
  phone: (u) => u.phone,
  status: (u) => (u.isActive ? 0 : 1),
  lastLogin: (u) => u.lastLoginAt,
  createdAt: (u) => u.createdAt,
};

export function UsersScreen() {
  const me = useAuthStore((s) => s.user);
  const { data: branches = [] } = useBranches();
  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

  // Hộp thoại: tạo/sửa, xác nhận đặt lại mật khẩu, hiện mật khẩu tạm (một lần).
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [tempPassword, setTempPassword] = useState<{ username: string; password: string } | null>(
    null,
  );
  const resetPassword = useResetPassword();

  const columns = useMemo<AppColumnDef<User>[]>(
    () => [
      {
        id: 'code',
        header: 'Mã',
        meta: { label: 'Mã', width: 110, locked: true, sort: 'page' },
        cell: ({ row }) => (
          <button
            type="button"
            className="link-button tabular"
            aria-label={`Sửa ${row.original.username}`}
            onClick={() => setEditing(row.original)}
          >
            {row.original.code}
          </button>
        ),
      },
      {
        id: 'name',
        header: 'Họ tên',
        meta: { label: 'Họ tên', width: 240, locked: true, sort: 'page' },
        cell: ({ row }) => (
          <div className="cell-stack">
            <span className="cell-title">{row.original.fullName}</span>
            <span className="cell-sub">{row.original.username}</span>
          </div>
        ),
      },
      {
        id: 'role',
        header: 'Vai trò',
        meta: { label: 'Vai trò', width: 150, sort: 'page' },
        cell: ({ row }) => <RoleBadge role={row.original.role} />,
      },
      {
        id: 'phone',
        header: 'Số điện thoại',
        meta: { label: 'Số điện thoại', width: 150, sort: 'page' },
        cell: ({ row }) => row.original.phone ?? '',
      },
      {
        id: 'branches',
        header: 'Chi nhánh',
        meta: { label: 'Chi nhánh', width: 220 },
        cell: ({ row }) =>
          row.original.role === 'manager' ? (
            <span className="muted">Tất cả</span>
          ) : (
            <div className="cell-badges">
              {row.original.branchIds.map((id) => (
                <Badge
                  key={id}
                  variant={id === row.original.defaultBranchId ? 'default' : 'secondary'}
                >
                  {branchName.get(id) ?? '—'}
                </Badge>
              ))}
            </div>
          ),
      },
      {
        id: 'status',
        header: 'Trạng thái',
        meta: { label: 'Trạng thái', width: 220, sort: 'page' },
        cell: ({ row }) => (
          <div className="cell-badges">
            <StatusBadge tone={ACTIVE_STATUS_TONES[row.original.isActive ? 'active' : 'inactive']}>
              {row.original.isActive ? 'Hoạt động' : 'Đã khóa'}
            </StatusBadge>
            {row.original.mustChangePassword && (
              <StatusBadge tone="warning">Chờ đổi mật khẩu</StatusBadge>
            )}
          </div>
        ),
      },
      {
        id: 'lastLogin',
        header: 'Đăng nhập gần nhất',
        meta: { label: 'Đăng nhập gần nhất', width: 190, sort: 'page' },
        cell: ({ row }) => (
          <span className="tabular">
            {formatDateTime(row.original.lastLoginAt) || 'Chưa đăng nhập'}
          </span>
        ),
      },
      {
        id: 'createdAt',
        header: 'Ngày tạo',
        meta: { label: 'Ngày tạo', width: 170, hiddenByDefault: true, sort: 'page' },
        cell: ({ row }) => (
          <span className="tabular">{formatDateTime(row.original.createdAt)}</span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Thao tác</span>,
        meta: { label: 'Thao tác', width: 100, locked: true },
        cell: ({ row }) => {
          const isSelf = row.original.id === me?.id;
          return (
            <div className="cell-actions">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Sửa ${row.original.username}`}
                onClick={() => setEditing(row.original)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Đặt lại mật khẩu ${row.original.username}`}
                title={isSelf ? 'Tự đổi mật khẩu ở menu tài khoản' : 'Đặt lại mật khẩu'}
                disabled={isSelf}
                onClick={() => setResetTarget(row.original)}
              >
                <KeyRound />
              </Button>
            </div>
          );
        },
      },
    ],
    [branchName, me?.id],
  );

  const prefs = useTablePrefs(TABLE_KEY, columns);
  const list = useListState({ initialFilters: INITIAL_FILTERS, prefs });
  const { role, status } = list.filters;

  const { data, isLoading, isError, error } = useUserList(
    {
      q: list.debouncedQ || undefined,
      role: role === '' ? undefined : (role as RoleCode),
      isActive: status === '' ? undefined : status === 'active',
      page: list.page,
      limit: list.pageSize,
    },
    { enabled: prefs.isReady },
  );
  const rows = useMemo(
    () => sortRows(data?.data ?? EMPTY, list.sort, PAGE_SORT),
    [data, list.sort],
  );

  return (
    <div className="page">
      <PageHeader
        title="Người dùng"
        description="Tài khoản nhân viên, vai trò và chi nhánh được làm việc."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> Thêm người dùng
          </Button>
        }
      />

      <TableToolbar>
        <TableSearch
          value={list.q}
          onChange={list.setQ}
          placeholder="Tìm mã, tên, tên đăng nhập, SĐT"
          label="Tìm người dùng"
        />
        <FilterSelect
          label="Lọc theo vai trò"
          value={role as string}
          onChange={(v) => list.setFilter('role', v)}
          options={[
            { value: '', label: 'Mọi vai trò' },
            ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
            { value: PENDING_ROLE, label: PENDING_LABEL },
          ]}
        />
        <FilterSelect
          label="Lọc theo trạng thái"
          value={status as string}
          onChange={(v) => list.setFilter('status', v)}
          options={[
            { value: '', label: 'Mọi trạng thái' },
            { value: 'active', label: 'Hoạt động' },
            { value: 'locked', label: 'Đã khóa' },
          ]}
        />
        <ToolbarEnd>
          {data && <ToolbarCount total={data.meta.total} />}
          <ColumnPicker prefs={prefs} />
        </ToolbarEnd>
      </TableToolbar>

      {isError ? (
        <p className="alert alert-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows}
            isLoading={isLoading || !prefs.isReady}
            emptyText="Không có người dùng phù hợp"
            getRowId={(u) => u.id}
            prefs={prefs}
            sort={list.sort}
            onSortChange={list.onSortChange}
            onRowClick={(u) => setEditing(u)}
          />
          <Pagination
            meta={data?.meta}
            onPageChange={list.setPage}
            pageSize={list.pageSize}
            onPageSizeChange={list.onPageSizeChange}
          />
        </>
      )}

      {editing !== null && (
        <UserFormDialog
          user={editing === 'new' ? null : editing}
          branches={branches}
          isSelf={editing !== 'new' && editing.id === me?.id}
          onClose={() => setEditing(null)}
          onCreated={(username, password) => setTempPassword({ username, password })}
        />
      )}

      <AlertDialog open={resetTarget !== null} onOpenChange={(o) => !o && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Đặt lại mật khẩu?</AlertDialogTitle>
            <AlertDialogDescription>
              Tài khoản <b>{resetTarget?.username}</b> sẽ bị đăng xuất khỏi mọi thiết bị và phải đổi
              mật khẩu ở lần đăng nhập tiếp theo. Hệ thống sẽ sinh mật khẩu tạm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const target = resetTarget;
                if (!target) return;
                try {
                  const res = await resetPassword.mutateAsync(target.id);
                  if (res.temporaryPassword) {
                    setTempPassword({ username: target.username, password: res.temporaryPassword });
                  } else toast.success('Đã đặt lại mật khẩu');
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              Đặt lại
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TemporaryPasswordDialog value={tempPassword} onClose={() => setTempPassword(null)} />
    </div>
  );
}
