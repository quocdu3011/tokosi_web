'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { AuthCard, AuthLayoutFrame } from '@/components/common/auth-card';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { logout, reloadMe } from '@/lib/auth/session';
import { useAuthStore } from '@/lib/auth/store';

/**
 * Màn cho tài khoản vai trò `pending` (vừa tự đăng ký bằng Google): chưa có quyền hay chi nhánh nào
 * nên mọi API nghiệp vụ trả 403. Quản lý gán chi nhánh và vai trò thì "Kiểm tra lại" sẽ vào được hệ thống.
 */
export function PendingScreen() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);

  const recheck = async () => {
    setChecking(true);
    try {
      const me = await reloadMe();
      if (me.role === 'pending') toast.message('Tài khoản vẫn đang chờ Quản lý cấp quyền');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <AuthLayoutFrame>
      <AuthCard
        title="Đang chờ cấp quyền"
        description={`Xin chào ${user?.fullName ?? ''}. Tài khoản của bạn đã được tạo nhưng chưa có quyền truy cập. Hãy báo Quản lý gán chi nhánh và vai trò cho tài khoản ${user?.username ?? ''}.`}
      >
        <div className="auth-form">
          <Button size="lg" onClick={() => void recheck()} disabled={checking}>
            {checking && <span className="spinner" aria-hidden="true" />}
            Kiểm tra lại
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => void logout(queryClient).catch(() => undefined)}
          >
            Đăng xuất
          </Button>
        </div>
      </AuthCard>
    </AuthLayoutFrame>
  );
}
