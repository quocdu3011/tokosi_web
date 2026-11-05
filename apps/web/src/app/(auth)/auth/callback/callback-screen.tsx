'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { AuthCard } from '@/components/common/auth-card';
import { buttonVariants } from '@/components/ui/button';
import { errorMessage, isApiError } from '@/lib/api';
import type { GoogleSignupRequired } from '@/lib/api/types';
import { googleLogin } from '@/lib/auth/session';
import { useAuthStore } from '@/lib/auth/store';
import { finishGoogleLogin, takeGoogleNext } from '@/lib/auth/supabase';
import { googleErrorMessage, isSignupRequired } from '@/lib/google-auth';

import { safeNext } from '../../login/login-form';
import { SignupForm } from './signup-form';

type State =
  | { kind: 'working' }
  | { kind: 'signup'; info: GoogleSignupRequired }
  | { kind: 'error'; message: string };

/**
 * Trang Google/Supabase đưa người dùng về (`?code=…`): đổi code lấy token Supabase, gửi cho API.
 * `code` dùng được đúng một lần nên chạy một lần duy nhất (chống React Strict Mode chạy đôi).
 */
export function CallbackScreen() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const mustChange = useAuthStore((s) => s.user?.mustChangePassword ?? false);
  const [state, setState] = useState<State>({ kind: 'working' });
  const started = useRef(false);
  const next = useRef('/');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    next.current = safeNext(takeGoogleNext());

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const providerError = params.get('error_description') ?? params.get('error');
    // Xóa `code` khỏi thanh địa chỉ ngay (không để lại trong lịch sử trình duyệt).
    window.history.replaceState(null, '', window.location.pathname);

    void (async () => {
      try {
        if (!code) {
          throw new Error(
            providerError
              ? 'Google không cho phép đăng nhập. Hãy thử lại hoặc dùng tên đăng nhập và mật khẩu.'
              : 'Liên kết đăng nhập không hợp lệ. Hãy đăng nhập lại.',
          );
        }
        const supabaseToken = await finishGoogleLogin(code);
        const res = await googleLogin(supabaseToken);
        if (isSignupRequired(res)) setState({ kind: 'signup', info: res });
        // Đăng nhập thành công: điều hướng do useEffect theo `status` bên dưới đảm nhận.
      } catch (e) {
        setState({
          kind: 'error',
          message: isApiError(e)
            ? googleErrorMessage(e.code, errorMessage(e))
            : e instanceof Error && !code
              ? e.message
              : 'Không hoàn tất được đăng nhập Google. Hãy thử lại.',
        });
      }
    })();
  }, []);

  useEffect(() => {
    if (status === 'authenticated') router.replace(mustChange ? '/change-password' : next.current);
  }, [status, mustChange, router]);

  if (state.kind === 'signup') {
    return (
      <SignupForm info={state.info} onFailed={(message) => setState({ kind: 'error', message })} />
    );
  }

  if (state.kind === 'error') {
    return (
      <AuthCard title="Không đăng nhập được" description={state.message}>
        <Link href="/login" className={buttonVariants({ size: 'lg' })}>
          Về trang đăng nhập
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Đang đăng nhập" description="Đang xác nhận tài khoản Google của bạn…">
      <div className="auth-wait" role="status">
        <span className="spinner" aria-hidden="true" /> Vui lòng chờ
      </div>
    </AuthCard>
  );
}
