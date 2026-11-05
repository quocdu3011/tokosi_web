import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="auth-layout">
      <span className="auth-blob auth-blob-1" aria-hidden="true" />
      <span className="auth-blob auth-blob-2" aria-hidden="true" />
      <section className="auth-card error-card" data-theme="light">
        <p className="error-code" aria-hidden="true">
          404
        </p>
        <h1 className="auth-title">Không tìm thấy trang</h1>
        <p className="auth-sub">Đường dẫn không tồn tại hoặc đã bị thay đổi.</p>
        <Link href="/" className={buttonVariants()}>
          Về trang chủ
        </Link>
      </section>
    </div>
  );
}
