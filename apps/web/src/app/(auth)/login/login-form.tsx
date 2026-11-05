'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AuthCard } from '@/components/common/auth-card';
import { GoogleIcon } from '@/components/common/google-icon';
import { Field } from '@/components/common/field';
import { FullPageLoader } from '@/components/common/full-page-loader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorMessage, isApiError } from '@/lib/api';
import { login } from '@/lib/auth/session';
import { useAuthStore } from '@/lib/auth/store';
import { isGoogleConfigured, startGoogleLogin } from '@/lib/auth/supabase';

const schema = z.object({
  username: z.string().trim().min(1, 'Nhập tên đăng nhập'),
  password: z.string().min(1, 'Nhập mật khẩu'),
});
type FormValues = z.infer<typeof schema>;

/** Chỉ chấp nhận đường dẫn nội bộ cho `?next=` (chặn chuyển hướng ra trang ngoài). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (next.startsWith('/login') || next.startsWith('/change-password')) return '/';
  return next;
}

export function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const status = useAuthStore((s) => s.status);
  const mustChange = useAuthStore((s) => s.user?.mustChangePassword ?? false);
  const [formError, setFormError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const googleEnabled = isGoogleConfigured();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  // Đã đăng nhập (phiên còn) → không ở lại trang đăng nhập.
  useEffect(() => {
    if (status === 'authenticated') router.replace(mustChange ? '/change-password' : next);
  }, [status, mustChange, next, router]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.username, values.password);
      // Điều hướng do useEffect ở trên đảm nhận.
    } catch (e) {
      if (isApiError(e, 'RATE_LIMITED')) {
        const seconds = (e.details as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
        setFormError(
          seconds
            ? `Bạn đã nhập sai quá nhiều lần. Thử lại sau ${Math.ceil(seconds / 60)} phút.`
            : e.message,
        );
      } else {
        setFormError(errorMessage(e));
      }
    }
  });

  const onGoogle = async () => {
    setFormError(null);
    setGoogleBusy(true);
    try {
      await startGoogleLogin(next);
      // Trình duyệt đang chuyển sang Google; giữ nút ở trạng thái bận.
    } catch (e) {
      setGoogleBusy(false);
      setFormError(errorMessage(e));
    }
  };

  if (status === 'loading') return <FullPageLoader />;

  return (
    <AuthCard title="Đăng nhập" description="Hệ thống quản lý bán hàng sỉ Tokosi">
      <form onSubmit={onSubmit} className="auth-form" noValidate>
        <Field id="username" label="Tên đăng nhập" error={errors.username?.message}>
          <Input
            id="username"
            autoComplete="username"
            autoCapitalize="none"
            autoFocus
            aria-invalid={!!errors.username}
            aria-describedby={errors.username ? 'username-error' : undefined}
            {...register('username')}
          />
        </Field>
        <Field id="password" label="Mật khẩu" error={errors.password?.message}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
            {...register('password')}
          />
        </Field>
        {formError ? (
          <p className="alert alert-error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" id="login-submit" disabled={isSubmitting} size="lg">
          {isSubmitting && <span className="spinner" aria-hidden="true" />}
          Đăng nhập
        </Button>
        {googleEnabled && (
          <>
            <div className="auth-divider" role="separator">
              <span>hoặc</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => void onGoogle()}
              disabled={googleBusy || isSubmitting}
            >
              {googleBusy ? <span className="spinner" aria-hidden="true" /> : <GoogleIcon />}
              Đăng nhập bằng Google
            </Button>
          </>
        )}
      </form>
    </AuthCard>
  );
}
