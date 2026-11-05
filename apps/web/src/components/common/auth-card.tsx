import Image from 'next/image';

import { ThemeToggle } from '@/components/layout/theme-toggle';

/**
 * Khung thẻ xác thực (MASTER 5.10). Thẻ luôn hiển thị sáng nhờ `data-theme="light"` đặt lên chính thẻ,
 * nền trang vẫn theo chế độ người dùng chọn.
 */
export function AuthLayoutFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-layout">
      <span className="auth-blob auth-blob-1" aria-hidden="true" />
      <span className="auth-blob auth-blob-2" aria-hidden="true" />
      <div className="auth-theme">
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="auth-card" data-theme="light">
      <div className="auth-brand">
        <span className="brand-mark">
          <Image src="/logo.jpg" alt="Tokosi" width={56} height={56} priority />
        </span>
        <h1 className="auth-title">{title}</h1>
        {description ? <p className="auth-sub">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
