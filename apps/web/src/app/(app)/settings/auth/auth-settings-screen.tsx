'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/common/coming-soon';
import { Field } from '@/components/common/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import type { AuthSettings } from '@/lib/api/types';
import { domainsProblem, parseSignupDomains } from '@/lib/google-auth';
import { useAuthSettings, useUpdateAuthSettings } from '@/lib/queries/auth-settings';

/**
 * Cài đặt tự đăng ký bằng Google (mặc định TẮT). Người tự đăng ký có vai trò "Chờ cấp quyền", không
 * truy cập được gì cho tới khi Quản lý gán chi nhánh và vai trò ở màn Người dùng.
 */
export function AuthSettingsScreen() {
  const { data, isLoading, isError, error } = useAuthSettings();

  return (
    <div className="page">
      <PageHeader
        title="Đăng nhập Google"
        description="Cho phép nhân viên tự đăng ký bằng tài khoản Google. Quyền truy cập vẫn do Quản lý cấp."
      />
      {isError ? (
        <p className="alert alert-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : isLoading || !data ? (
        <Skeleton className="skeleton-block" />
      ) : (
        // `key` theo dữ liệu đã lưu: lưu xong form được dựng lại với giá trị mới nhất.
        <SettingsForm
          key={`${data.googleSignupEnabled}|${data.googleSignupDomains.join(',')}`}
          saved={data}
        />
      )}
    </div>
  );
}

function SettingsForm({ saved }: { saved: AuthSettings }) {
  const update = useUpdateAuthSettings();
  const [enabled, setEnabled] = useState(saved.googleSignupEnabled);
  const [text, setText] = useState(saved.googleSignupDomains.join('\n'));
  const [problem, setProblem] = useState<string | null>(null);

  const parsed = parseSignupDomains(text);
  const dirty =
    enabled !== saved.googleSignupEnabled ||
    parsed.domains.join(',') !== saved.googleSignupDomains.join(',') ||
    parsed.invalid.length > 0;

  const submit = async () => {
    const p = domainsProblem(enabled, parsed);
    setProblem(p);
    if (p) return;
    try {
      await update.mutateAsync({
        googleSignupEnabled: enabled,
        googleSignupDomains: parsed.domains,
      });
      toast.success('Đã lưu cài đặt');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="card settings-card">
      <div className="stack-md">
        <div className="check-row">
          <Checkbox
            id="as-enabled"
            checked={enabled}
            onCheckedChange={(c) => setEnabled(c === true)}
          />
          <Label htmlFor="as-enabled">Cho phép tự đăng ký bằng Google</Label>
        </div>
        <p className="field-hint">
          Đang {saved.googleSignupEnabled ? 'BẬT' : 'TẮT'}. Khi tắt, chỉ người đã có tài khoản mới
          đăng nhập được bằng Google; người lạ sẽ thấy thông báo liên hệ Quản lý.
        </p>

        <Field
          id="as-domains"
          label="Tên miền email được tự đăng ký"
          error={problem ?? undefined}
          hint="Mỗi dòng một tên miền, ví dụ congty.vn. Chỉ email thuộc các tên miền này mới tự đăng ký được."
        >
          <textarea
            id="as-domains"
            className="form-input form-textarea"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={!!problem}
            aria-describedby={problem ? 'as-domains-error' : undefined}
          />
        </Field>

        <p className="field-hint">
          Người mới đăng ký có vai trò &quot;Chờ cấp quyền&quot;. Vào{' '}
          <Link href="/settings/users" className="link-button">
            Người dùng
          </Link>{' '}
          (lọc &quot;Chờ cấp quyền&quot;) để gán chi nhánh và vai trò.
        </p>

        <div className="form-actions">
          <Button onClick={() => void submit()} disabled={!dirty || update.isPending}>
            {update.isPending && <span className="spinner" aria-hidden="true" />}
            Lưu cài đặt
          </Button>
        </div>
      </div>
    </div>
  );
}
