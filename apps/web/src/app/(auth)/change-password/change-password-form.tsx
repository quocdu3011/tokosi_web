'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Field } from '@/components/common/field';
import { FullPageLoader } from '@/components/common/full-page-loader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { changePassword, logout } from '@/lib/auth/session';
import { useAuthStore } from '@/lib/auth/store';
import { applyServerErrors, passwordProblem, PASSWORD_MIN } from '@/lib/forms';

const FIELDS = ['currentPassword', 'newPassword'] as const;

function makeSchema(username: string | null) {
  return z
    .object({
      currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'),
      newPassword: z.string(),
      confirmPassword: z.string(),
    })
    .superRefine((v, ctx) => {
      const problem = passwordProblem(v.newPassword, username);
      if (problem) ctx.addIssue({ code: 'custom', path: ['newPassword'], message: problem });
      else if (v.newPassword === v.currentPassword) {
        ctx.addIssue({
          code: 'custom',
          path: ['newPassword'],
          message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
        });
      }
      if (v.confirmPassword !== v.newPassword) {
        ctx.addIssue({
          code: 'custom',
          path: ['confirmPassword'],
          message: 'Mật khẩu nhập lại không khớp',
        });
      }
    });
}
type FormValues = z.infer<ReturnType<typeof makeSchema>>;

/**
 * Đổi mật khẩu. Bắt buộc khi `mustChangePassword = true` (tài khoản mới / vừa được đặt lại);
 * cũng dùng khi người dùng tự đổi. Đổi xong server thu hồi mọi phiên cũ và cấp phiên mới.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const forced = user?.mustChangePassword ?? false;
  const schema = useMemo(() => makeSchema(user?.username ?? null), [user?.username]);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated' || !user) return <FullPageLoader />;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await changePassword(values.currentPassword, values.newPassword);
      toast.success('Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.');
      router.replace('/');
    } catch (e) {
      applyServerErrors(e, setError, FIELDS);
    }
  });

  const describedBy = (name: keyof FormValues) => (errors[name] ? `${name}-error` : undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Đổi mật khẩu</CardTitle>
        <CardDescription>
          {forced
            ? 'Bạn cần đặt mật khẩu mới trước khi sử dụng hệ thống.'
            : 'Đổi mật khẩu sẽ đăng xuất tài khoản trên mọi thiết bị khác.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {/* Ô ẩn giúp trình quản lý mật khẩu gắn đúng tài khoản */}
          <input type="text" autoComplete="username" value={user.username} readOnly hidden />
          <Field
            id="currentPassword"
            label="Mật khẩu hiện tại"
            error={errors.currentPassword?.message}
          >
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              autoFocus
              aria-invalid={!!errors.currentPassword}
              aria-describedby={describedBy('currentPassword')}
              {...register('currentPassword')}
            />
          </Field>
          <Field
            id="newPassword"
            label="Mật khẩu mới"
            error={errors.newPassword?.message}
            hint={`Ít nhất ${PASSWORD_MIN} ký tự, không chứa tên đăng nhập.`}
          >
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.newPassword}
              aria-describedby={describedBy('newPassword')}
              {...register('newPassword')}
            />
          </Field>
          <Field
            id="confirmPassword"
            label="Nhập lại mật khẩu mới"
            error={errors.confirmPassword?.message}
          >
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirmPassword}
              aria-describedby={describedBy('confirmPassword')}
              {...register('confirmPassword')}
            />
          </Field>
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting && <Loader2 className="animate-spin" />}
            Lưu mật khẩu mới
          </Button>
          {forced ? (
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                await logout(queryClient).catch(() => undefined);
                router.replace('/login');
              }}
            >
              Đăng xuất
            </Button>
          ) : (
            <Button type="button" variant="ghost" asChild>
              <Link href="/">Quay lại</Link>
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
