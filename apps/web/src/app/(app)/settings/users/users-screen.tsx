'use client';

import { ROLE_LABELS, ROLES } from '@kiot/shared';
import { KeyRound, Pencil, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/common/coming-soon';
import { RoleBadge } from '@/components/common/role-badge';
import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { errorMessage } from '@/lib/api';
import type { RoleCode, User } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { formatDateTime } from '@/lib/format';
import { useBranches, useResetPassword, useUserList } from '@/lib/queries/users';

import { TemporaryPasswordDialog } from './temporary-password-dialog';
import { UserFormDialog } from './user-form-dialog';

const ALL = 'all';
const PAGE_SIZE = 20;

export function UsersScreen() {
  const me = useAuthStore((s) => s.user);
  const [q, setQ] = useState('');
  const [role, setRole] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const debouncedQ = useDebouncedValue(q.trim());

  const { data, isLoading, isError, error } = useUserList({
    q: debouncedQ || undefined,
    role: role === ALL ? undefined : (role as RoleCode),
    isActive: status === ALL ? undefined : status === 'active',
    page,
    limit: PAGE_SIZE,
  });
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
        cell: ({ row }) => <span className="tabular">{row.original.code}</span>,
      },
      {
        id: 'name',
        header: 'Họ tên',
        cell: ({ row }) => (
          <div className="cell-stack">
            <span className="cell-title">{row.original.fullName}</span>
            <span className="cell-sub">{row.original.username}</span>
          </div>
        ),
      },
      { id: 'role', header: 'Vai trò', cell: ({ row }) => <RoleBadge role={row.original.role} /> },
      { id: 'phone', header: 'Số điện thoại', cell: ({ row }) => row.original.phone ?? '' },
      {
        id: 'branches',
        header: 'Chi nhánh',
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
        cell: ({ row }) => (
          <div className="cell-badges">
            {row.original.isActive ? (
              <Badge variant="success">Hoạt động</Badge>
            ) : (
              <Badge variant="destructive">Đã khóa</Badge>
            )}
            {row.original.mustChangePassword && <Badge variant="warning">Chờ đổi mật khẩu</Badge>}
          </div>
        ),
      },
      {
        id: 'lastLogin',
        header: 'Đăng nhập gần nhất',
        cell: ({ row }) => (
          <span className="tabular">
            {formatDateTime(row.original.lastLoginAt) || 'Chưa đăng nhập'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Thao tác</span>,
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

  const resetFilters = (fn: () => void) => {
    fn();
    setPage(1);
  };

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

      <div className="toolbar">
        <div className="toolbar-search">
          <Search aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => resetFilters(() => setQ(e.target.value))}
            placeholder="Tìm mã, tên, tên đăng nhập, SĐT"
            aria-label="Tìm người dùng"
          />
        </div>
        <Select value={role} onValueChange={(v) => resetFilters(() => setRole(v))}>
          <SelectTrigger aria-label="Lọc theo vai trò" className="toolbar-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Mọi vai trò</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => resetFilters(() => setStatus(v))}>
          <SelectTrigger aria-label="Lọc theo trạng thái" className="toolbar-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Mọi trạng thái</SelectItem>
            <SelectItem value="active">Hoạt động</SelectItem>
            <SelectItem value="locked">Đã khóa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <p className="alert alert-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={data?.data ?? EMPTY}
            isLoading={isLoading}
            emptyText="Không có người dùng phù hợp"
            getRowId={(u) => u.id}
          />
          <Pagination meta={data?.meta} onPageChange={setPage} />
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

// Mảng rỗng cố định: tránh tạo mảng mới mỗi lần render làm bảng tính lại dòng.
const EMPTY: User[] = [];
