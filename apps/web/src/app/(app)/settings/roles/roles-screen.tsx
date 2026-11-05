'use client';

import { ROLE_LABELS, ROLES } from '@kiot/shared';
import { Check, Loader2, Lock, MoreHorizontal, RotateCcw } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/common/coming-soon';
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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import type { PermissionDef, RoleCode } from '@/lib/api/types';
import {
  usePermissionCatalog,
  useResetRolePermissions,
  useRoles,
  useRolesPermissions,
  useSaveRolePermissions,
} from '@/lib/queries/roles';
import {
  disableGrant,
  enableGrant,
  indexCatalog,
  sameGrants,
  toGrantList,
  toGrantMap,
  type GrantMap,
  type Scope,
} from '@/lib/role-matrix';
import { cn } from '@/lib/utils';

/** Vai trò chỉnh được (Quản lý luôn đủ quyền, chỉ xem). */
const EDITABLE_ROLES = ROLES.filter((r) => r !== 'manager') as RoleCode[];

/**
 * Ma trận phân quyền: hàng = quyền (gom theo phân hệ từ /permissions/catalog), cột = vai trò.
 * Thay đổi được giữ ở bản nháp, bấm "Lưu thay đổi" mới gửi PUT cho từng vai trò bị sửa.
 */
export function RolesScreen() {
  const catalog = usePermissionCatalog();
  const roles = useRoles();
  const roleQueries = useRolesPermissions(EDITABLE_ROLES);
  const save = useSaveRolePermissions();
  const reset = useResetRolePermissions();

  const defs = useMemo(
    () => (catalog.data ? indexCatalog(catalog.data) : new Map<string, PermissionDef>()),
    [catalog.data],
  );

  // Bộ quyền trên server theo vai trò.
  const serverMaps = useMemo(() => {
    const m = new Map<RoleCode, GrantMap>();
    for (const [role, grants] of roleQueries.byRole) m.set(role, toGrantMap(grants));
    return m;
  }, [roleQueries.byRole]);

  const [drafts, setDrafts] = useState<Partial<Record<RoleCode, GrantMap>>>({});
  const [saving, setSaving] = useState(false);
  const [resetRole, setResetRole] = useState<RoleCode | null>(null);

  const current = (role: RoleCode) => drafts[role] ?? serverMaps.get(role);
  const dirtyRoles = EDITABLE_ROLES.filter((r) => {
    const d = drafts[r];
    const s = serverMaps.get(r);
    return d && s && !sameGrants(d, s);
  });

  const labelOf = (code: string) => defs.get(code)?.label ?? code;

  function toggle(role: RoleCode, code: string, on: boolean) {
    const base = current(role);
    if (!base) return;
    if (on) {
      const { next, added } = enableGrant(base, code, 'all', defs);
      if (added.length)
        toast.info(`${ROLE_LABELS[role]}: tự bật thêm ${added.map(labelOf).join(', ')}`);
      setDrafts((d) => ({ ...d, [role]: next }));
    } else {
      const { next, removed } = disableGrant(base, code, defs);
      if (removed.length)
        toast.info(`${ROLE_LABELS[role]}: tắt kèm ${removed.map(labelOf).join(', ')}`);
      setDrafts((d) => ({ ...d, [role]: next }));
    }
  }

  function changeScope(role: RoleCode, code: string, scope: Scope) {
    const base = current(role);
    if (!base) return;
    setDrafts((d) => ({ ...d, [role]: enableGrant(base, code, scope, defs).next }));
  }

  async function saveAll() {
    setSaving(true);
    try {
      for (const role of dirtyRoles) {
        const result = await save.mutateAsync({ role, permissions: toGrantList(drafts[role]!) });
        if (result.autoAdded.length) {
          toast.info(
            `${result.label}: hệ thống tự bật thêm ${result.autoAdded.map(labelOf).join(', ')}`,
          );
        }
        setDrafts((d) => {
          const rest = { ...d };
          delete rest[role];
          return rest;
        });
      }
      toast.success('Đã lưu phân quyền. Thay đổi có hiệu lực ngay.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const isLoading = catalog.isLoading || roleQueries.isLoading;
  const loadError = catalog.error ?? roleQueries.error;
  const userCount = (role: RoleCode) => roles.data?.find((r) => r.role === role)?.userCount;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Phân quyền"
        description="Quyền của từng vai trò. Quản lý luôn có đủ quyền. Thay đổi có hiệu lực ngay cho mọi người dùng thuộc vai trò."
        actions={
          <>
            <Button
              variant="outline"
              disabled={dirtyRoles.length === 0 || saving}
              onClick={() => setDrafts({})}
            >
              Bỏ thay đổi
            </Button>
            <Button disabled={dirtyRoles.length === 0 || saving} onClick={saveAll}>
              {saving && <Loader2 className="animate-spin" />}
              Lưu thay đổi{dirtyRoles.length ? ` (${dirtyRoles.length})` : ''}
            </Button>
          </>
        }
      />

      {loadError ? (
        <p className="text-destructive text-sm" role="alert">
          {errorMessage(loadError)}
        </p>
      ) : isLoading || !catalog.data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="bg-muted sticky left-0 z-10 w-72 px-3 py-2 text-left font-medium">
                  Quyền
                </th>
                {ROLES.map((role) => (
                  <th key={role} className="px-2 py-2 text-center font-medium">
                    <div className="flex items-center justify-center gap-1">
                      <span
                        className={cn(
                          dirtyRoles.includes(role as RoleCode) &&
                            'text-amber-600 dark:text-amber-400',
                        )}
                      >
                        {ROLE_LABELS[role]}
                        {dirtyRoles.includes(role as RoleCode) ? ' *' : ''}
                      </span>
                      {role !== 'manager' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              aria-label={`Tùy chọn ${ROLE_LABELS[role]}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setResetRole(role as RoleCode)}>
                              <RotateCcw /> Khôi phục mặc định
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    {userCount(role as RoleCode) !== undefined && (
                      <div className="text-muted-foreground text-xs font-normal">
                        {userCount(role as RoleCode)} người
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog.data.modules.map((mod) => (
                <Fragment key={mod.key}>
                  <tr className="border-t">
                    <td
                      colSpan={ROLES.length + 1}
                      className="bg-muted/30 px-3 py-1.5 text-xs font-semibold uppercase"
                    >
                      {mod.label}
                    </td>
                  </tr>
                  {mod.permissions.map((perm) => (
                    <tr key={perm.code} className="hover:bg-muted/30 border-t">
                      <td className="bg-background sticky left-0 z-10 px-3 py-2">
                        <div className="font-medium">{perm.label}</div>
                        <div className="text-muted-foreground text-xs">
                          <code>{perm.code}</code>
                          {perm.description ? ` · ${perm.description}` : ''}
                        </div>
                      </td>
                      {ROLES.map((role) => (
                        <td key={role} className="px-2 py-2 text-center align-middle">
                          {role === 'manager' ? (
                            <Check
                              className="text-muted-foreground mx-auto size-4"
                              aria-label="Có quyền"
                            />
                          ) : perm.lockedToAdmin ? (
                            <Lock
                              className="text-muted-foreground mx-auto size-4"
                              aria-label="Chỉ Quản lý"
                            />
                          ) : (
                            <GrantCell
                              perm={perm}
                              scope={current(role as RoleCode)?.get(perm.code) ?? null}
                              roleLabel={ROLE_LABELS[role]}
                              onToggle={(on) => toggle(role as RoleCode, perm.code, on)}
                              onScope={(s) => changeScope(role as RoleCode, perm.code, s)}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={resetRole !== null} onOpenChange={(o) => !o && setResetRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Khôi phục quyền mặc định?</AlertDialogTitle>
            <AlertDialogDescription>
              Quyền của vai trò <b>{resetRole ? ROLE_LABELS[resetRole] : ''}</b> sẽ trở về cấu hình
              mặc định ban đầu và có hiệu lực ngay. Thay đổi chưa lưu của vai trò này sẽ bị bỏ.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const role = resetRole;
                if (!role) return;
                try {
                  await reset.mutateAsync(role);
                  setDrafts((d) => {
                    const rest = { ...d };
                    delete rest[role];
                    return rest;
                  });
                  toast.success(`Đã khôi phục quyền mặc định cho ${ROLE_LABELS[role]}`);
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              Khôi phục
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Một ô của ma trận: bật/tắt quyền; quyền có phạm vi thì chọn Tất cả / Của mình. */
function GrantCell({
  perm,
  scope,
  roleLabel,
  onToggle,
  onScope,
}: {
  perm: PermissionDef;
  scope: Scope | null;
  roleLabel: string;
  onToggle: (on: boolean) => void;
  onScope: (scope: Scope) => void;
}) {
  const on = scope !== null;
  return (
    <div className="flex flex-col items-center gap-1">
      <Checkbox
        checked={on}
        onCheckedChange={(c) => onToggle(c === true)}
        aria-label={`${perm.label} — ${roleLabel}`}
      />
      {perm.scopable && on && (
        <Select value={scope} onValueChange={(v) => onScope(v as Scope)}>
          <SelectTrigger
            size="sm"
            className="h-6 px-1.5 text-xs"
            aria-label={`Phạm vi ${perm.label} — ${roleLabel}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
            <SelectItem value="own">Của mình</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
