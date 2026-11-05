'use client';

import { ROLE_LABELS, ROLES } from '@kiot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Field } from '@/components/common/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isApiError } from '@/lib/api';
import type { Branch, RoleCode, UpdateUserInput, User } from '@/lib/api/types';
import { applyServerErrors, passwordProblem, PASSWORD_MIN } from '@/lib/forms';
import { useCreateUser, useUpdateUser } from '@/lib/queries/users';

const NONE = 'none';
const FIELDS = [
  'username',
  'fullName',
  'role',
  'phone',
  'branchIds',
  'defaultBranchId',
  'password',
  'isActive',
] as const;

/**
 * Quy tắc theo docs/api/endpoints.md mục 1 (server vẫn kiểm tra lại):
 * - Tên đăng nhập: chữ thường không dấu, số, `.` `_` `-`, 3–32 ký tự; không đổi được sau khi tạo.
 * - SĐT: 10–11 chữ số, bắt đầu 0 hoặc +84 (server chuẩn hóa về 0xxxxxxxxx).
 * - Mọi vai trò trừ Quản lý phải có ít nhất 1 chi nhánh; chi nhánh mặc định phải nằm trong danh sách.
 */
const PHONE_RE = /^(\+84|0)[\d\s.\-()]{8,14}$/;

const schema = z
  .object({
    isNew: z.boolean(),
    username: z.string().trim(),
    fullName: z.string().trim().min(1, 'Nhập họ tên').max(120, 'Họ tên tối đa 120 ký tự'),
    role: z.enum(ROLES, { error: 'Chọn vai trò' }),
    phone: z.string().trim(),
    branchIds: z.array(z.string()),
    defaultBranchId: z.string(),
    isActive: z.boolean(),
    setPassword: z.boolean(),
    password: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.isNew && !/^[a-z0-9._-]{3,32}$/.test(v.username.toLowerCase())) {
      ctx.addIssue({
        code: 'custom',
        path: ['username'],
        message: 'Chỉ dùng chữ không dấu, số, dấu . _ -; dài 3–32 ký tự',
      });
    }
    if (v.phone && (!PHONE_RE.test(v.phone) || !/^\d{10,11}$/.test(normalizeDigits(v.phone)))) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Số điện thoại không hợp lệ' });
    }
    if (v.role !== 'manager' && v.branchIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['branchIds'], message: 'Chọn ít nhất một chi nhánh' });
    }
    if (v.isNew && v.setPassword) {
      const problem = passwordProblem(v.password, v.username);
      if (problem) ctx.addIssue({ code: 'custom', path: ['password'], message: problem });
    }
  });
type FormValues = z.infer<typeof schema>;

/** Đếm chữ số theo cách server chuẩn hóa: +84 → 0, bỏ ký tự phân cách. */
function normalizeDigits(phone: string) {
  const digits = phone.replace(/[^\d+]/g, '');
  return digits.startsWith('+84') ? `0${digits.slice(3)}` : digits;
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function UserFormDialog({
  user,
  branches,
  isSelf,
  onClose,
  onCreated,
}: {
  /** `null` = tạo mới. */
  user: User | null;
  branches: Branch[];
  isSelf: boolean;
  onClose: () => void;
  /** Gọi khi hệ thống sinh mật khẩu tạm cho tài khoản mới. */
  onCreated: (username: string, temporaryPassword: string) => void;
}) {
  const isNew = user === null;
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      isNew,
      username: user?.username ?? '',
      fullName: user?.fullName ?? '',
      // Tài khoản đang chờ cấp quyền (`pending`): để trống để Quản lý chủ động chọn vai trò, không đoán hộ.
      role: (user ? (user.role === 'pending' ? '' : user.role) : 'sales') as RoleCode,
      phone: user?.phone ?? '',
      branchIds: user?.branchIds ?? (branches.length === 1 ? [branches[0]!.id] : []),
      defaultBranchId: user?.defaultBranchId ?? NONE,
      isActive: user?.isActive ?? true,
      setPassword: false,
      password: '',
    },
  });

  const role = useWatch({ control, name: 'role' });
  const branchIds = useWatch({ control, name: 'branchIds' });
  const setPassword = useWatch({ control, name: 'setPassword' });

  const onSubmit = handleSubmit(async (v) => {
    const defaultBranchId =
      v.defaultBranchId !== NONE && v.branchIds.includes(v.defaultBranchId)
        ? v.defaultBranchId
        : null;
    try {
      if (isNew) {
        const created = await createUser.mutateAsync({
          username: v.username.toLowerCase(),
          fullName: v.fullName,
          role: v.role,
          phone: v.phone || undefined,
          branchIds: v.branchIds,
          defaultBranchId: defaultBranchId ?? undefined,
          password: v.setPassword ? v.password : undefined,
        });
        if (created.temporaryPassword) onCreated(created.username, created.temporaryPassword);
        else toast.success(`Đã tạo tài khoản ${created.username}`);
      } else {
        // Chỉ gửi field thay đổi.
        const patch: UpdateUserInput = {};
        if (v.fullName !== user.fullName) patch.fullName = v.fullName;
        if ((v.phone || null) !== user.phone) patch.phone = v.phone || null;
        if (v.role !== user.role) patch.role = v.role;
        if (v.isActive !== user.isActive) patch.isActive = v.isActive;
        const branchesChanged =
          !sameSet(v.branchIds, user.branchIds) || defaultBranchId !== user.defaultBranchId;
        if (Object.keys(patch).length === 0 && !branchesChanged) {
          onClose();
          return;
        }
        await updateUser.mutateAsync({
          id: user.id,
          patch,
          branches: branchesChanged ? { branchIds: v.branchIds, defaultBranchId } : undefined,
        });
        toast.success('Đã lưu thay đổi');
      }
      onClose();
    } catch (e) {
      if (isApiError(e, 'DUPLICATE_USERNAME')) {
        setError('username', { type: 'server', message: e.message });
        return;
      }
      applyServerErrors(e, setError, FIELDS);
    }
  });

  const err = (name: keyof FormValues) => errors[name]?.message as string | undefined;
  // Id có tiền tố riêng: Next.js 16 (cacheComponents) giữ trang trước trong DOM ở trạng thái ẩn,
  // id chung như "username" sẽ trùng với ô của trang đăng nhập.
  const fid = (name: keyof FormValues) => `uf-${name}`;
  const aria = (name: keyof FormValues) => ({
    'aria-invalid': !!errors[name],
    'aria-describedby': errors[name] ? `${fid(name)}-error` : undefined,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="modal-form">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Thêm người dùng' : `Sửa ${user.username}`}</DialogTitle>
          <DialogDescription>
            {isNew
              ? 'Tài khoản mới phải đổi mật khẩu ở lần đăng nhập đầu.'
              : `Mã nhân viên ${user.code}. Tên đăng nhập không đổi được.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="form-grid" noValidate>
          <Field id={fid('username')} label="Tên đăng nhập" error={err('username')}>
            <Input
              id={fid('username')}
              autoComplete="off"
              autoCapitalize="none"
              disabled={!isNew}
              {...aria('username')}
              {...register('username')}
            />
          </Field>
          <Field id={fid('fullName')} label="Họ tên" error={err('fullName')}>
            <Input id={fid('fullName')} {...aria('fullName')} {...register('fullName')} />
          </Field>

          <Field
            id={fid('role')}
            label="Vai trò"
            error={err('role')}
            hint={
              isSelf
                ? 'Không đổi được vai trò của chính mình.'
                : user?.role === 'pending'
                  ? 'Tài khoản đang chờ cấp quyền: chọn vai trò và chi nhánh để cho phép truy cập.'
                  : undefined
            }
          >
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={isSelf}>
                  <SelectTrigger id={fid('role')} {...aria('role')}>
                    <SelectValue placeholder="Chọn vai trò" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field id={fid('phone')} label="Số điện thoại" error={err('phone')}>
            <Input
              id={fid('phone')}
              type="tel"
              inputMode="tel"
              {...aria('phone')}
              {...register('phone')}
            />
          </Field>

          <fieldset className="fieldset span-2">
            <legend>Chi nhánh được làm việc</legend>
            {role === 'manager' ? (
              <p className="field-hint">
                Quản lý làm việc được ở mọi chi nhánh; danh sách dưới đây chỉ để chọn chi nhánh mặc
                định.
              </p>
            ) : null}
            <div className="check-group">
              {branches.map((b) => {
                const checked = branchIds.includes(b.id);
                return (
                  <div key={b.id} className="check-row">
                    <Checkbox
                      id={`uf-branch-${b.id}`}
                      checked={checked}
                      onCheckedChange={(c) =>
                        setValue(
                          'branchIds',
                          c ? [...branchIds, b.id] : branchIds.filter((id) => id !== b.id),
                          { shouldValidate: !!errors.branchIds },
                        )
                      }
                    />
                    <Label htmlFor={`uf-branch-${b.id}`}>{b.name}</Label>
                  </div>
                );
              })}
            </div>
            {err('branchIds') ? (
              <p id={`${fid('branchIds')}-error`} className="field-error" role="alert">
                {err('branchIds')}
              </p>
            ) : null}
          </fieldset>

          <Field
            id={fid('defaultBranchId')}
            label="Chi nhánh mặc định"
            error={err('defaultBranchId')}
          >
            <Controller
              control={control}
              name="defaultBranchId"
              render={({ field }) => (
                <Select
                  value={branchIds.includes(field.value) ? field.value : NONE}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger id={fid('defaultBranchId')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Không đặt</SelectItem>
                    {branches
                      .filter((b) => branchIds.includes(b.id))
                      .map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          {!isNew && (
            <div className="stack-sm align-end">
              <div className="check-row">
                <Controller
                  control={control}
                  name="isActive"
                  render={({ field }) => (
                    <Checkbox
                      id={fid('isActive')}
                      checked={field.value}
                      onCheckedChange={(c) => field.onChange(c === true)}
                      disabled={isSelf}
                    />
                  )}
                />
                <Label htmlFor={fid('isActive')}>Đang hoạt động</Label>
              </div>
              <p className="field-hint">
                {isSelf
                  ? 'Không tự khóa được tài khoản của mình.'
                  : 'Khóa sẽ đăng xuất người dùng ngay lập tức.'}
              </p>
            </div>
          )}

          {isNew && (
            <div className="stack-md span-2">
              <div className="check-row">
                <Controller
                  control={control}
                  name="setPassword"
                  render={({ field }) => (
                    <Checkbox
                      id={fid('setPassword')}
                      checked={field.value}
                      onCheckedChange={(c) => field.onChange(c === true)}
                    />
                  )}
                />
                <Label htmlFor={fid('setPassword')}>
                  Tự đặt mật khẩu (bỏ trống để hệ thống sinh mật khẩu tạm)
                </Label>
              </div>
              {setPassword && (
                <Field
                  id={fid('password')}
                  label="Mật khẩu"
                  error={err('password')}
                  hint={`Ít nhất ${PASSWORD_MIN} ký tự, không chứa tên đăng nhập.`}
                >
                  <Input
                    id={fid('password')}
                    type="password"
                    autoComplete="new-password"
                    {...aria('password')}
                    {...register('password')}
                  />
                </Field>
              )}
            </div>
          )}

          <DialogFooter className="span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <span className="spinner" aria-hidden="true" />}
              {isNew ? 'Tạo tài khoản' : 'Lưu'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
