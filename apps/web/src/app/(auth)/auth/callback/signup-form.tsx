'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { AuthCard } from '@/components/common/auth-card';
import { Field } from '@/components/common/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isApiError } from '@/lib/api';
import type { GoogleSignupRequired } from '@/lib/api/types';
import { googleSignup } from '@/lib/auth/session';
import { applyServerErrors, passwordProblem, phoneProblem, usernameProblem } from '@/lib/forms';
import { googleErrorMessage } from '@/lib/google-auth';

const FIELDS = ['username', 'password', 'fullName', 'phone'] as const;

const schema = z
  .object({
    fullName: z.string().trim().min(1, 'Nhập họ tên').max(100, 'Họ tên quá dài'),
    username: z.string().trim(),
    password: z.string(),
    phone: z.string().trim().min(1, 'Nhập số điện thoại'),
  })
  .superRefine((v, ctx) => {
    const u = usernameProblem(v.username);
    if (u) ctx.addIssue({ code: 'custom', path: ['username'], message: u });
    const p = passwordProblem(v.password, v.username);
    if (p) ctx.addIssue({ code: 'custom', path: ['password'], message: p });
    const ph = phoneProblem(v.phone);
    if (ph) ctx.addIssue({ code: 'custom', path: ['phone'], message: ph });
  });
type FormValues = z.infer<typeof schema>;

/**
 * Hoàn tất tự đăng ký từ Google. `signupToken` chỉ sống 15 phút và chỉ nằm trong state của trang;
 * lỗi nhập liệu vẫn dùng lại được token, còn token hết hạn thì báo đăng nhập Google lại.
 * Tài khoản mới có vai trò "Chờ cấp quyền" cho tới khi Quản lý gán chi nhánh và vai trò.
 */
export function SignupForm({
  info,
  onFailed,
}: {
  info: GoogleSignupRequired;
  onFailed: (message: string) => void;
}) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: info.suggestedName, username: '', password: '', phone: '' },
  });

  const onSubmit = handleSubmit(async (v) => {
    try {
      await googleSignup({
        signupToken: info.signupToken,
        username: v.username.toLowerCase(),
        password: v.password,
        fullName: v.fullName,
        phone: v.phone,
      });
      // Điều hướng do trang callback đảm nhận khi trạng thái đăng nhập đổi.
    } catch (e) {
      if (isApiError(e, 'DUPLICATE_USERNAME')) {
        setError('username', { type: 'server', message: e.message });
        return;
      }
      if (
        isApiError(e) &&
        [
          'SIGNUP_TOKEN_INVALID',
          'GOOGLE_ALREADY_REGISTERED',
          'SIGNUP_DISABLED',
          'SIGNUP_LIMIT',
        ].includes(e.code)
      ) {
        onFailed(googleErrorMessage(e.code, e.message));
        return;
      }
      applyServerErrors(e, setError, FIELDS);
    }
  });

  const err = (name: keyof FormValues) => errors[name]?.message;
  const aria = (name: keyof FormValues) => ({
    'aria-invalid': !!errors[name],
    'aria-describedby': errors[name] ? `gs-${name}-error` : undefined,
  });

  return (
    <AuthCard
      title="Hoàn tất đăng ký"
      description={`Tài khoản Google ${info.email} chưa có trong hệ thống. Điền thông tin để đăng ký; Quản lý sẽ cấp quyền sau.`}
    >
      <form onSubmit={onSubmit} className="auth-form" noValidate>
        <Field id="gs-email" label="Email Google">
          <Input id="gs-email" value={info.email} readOnly disabled />
        </Field>
        <Field id="gs-fullName" label="Họ tên" error={err('fullName')}>
          <Input
            id="gs-fullName"
            autoComplete="name"
            {...aria('fullName')}
            {...register('fullName')}
          />
        </Field>
        <Field
          id="gs-username"
          label="Tên đăng nhập"
          error={err('username')}
          hint="Chữ không dấu, số, dấu . _ -; dài 3–32 ký tự. Dùng khi đăng nhập bằng mật khẩu."
        >
          <Input
            id="gs-username"
            autoComplete="username"
            autoCapitalize="none"
            {...aria('username')}
            {...register('username')}
          />
        </Field>
        <Field
          id="gs-password"
          label="Mật khẩu"
          error={err('password')}
          hint="Ít nhất 10 ký tự, không chứa tên đăng nhập."
        >
          <Input
            id="gs-password"
            type="password"
            autoComplete="new-password"
            {...aria('password')}
            {...register('password')}
          />
        </Field>
        <Field id="gs-phone" label="Số điện thoại" error={err('phone')}>
          <Input
            id="gs-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            {...aria('phone')}
            {...register('phone')}
          />
        </Field>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting && <span className="spinner" aria-hidden="true" />}
          Đăng ký
        </Button>
      </form>
    </AuthCard>
  );
}
