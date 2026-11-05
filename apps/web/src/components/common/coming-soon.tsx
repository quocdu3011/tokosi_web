import { Construction } from 'lucide-react';

/**
 * Trang trống cho phân hệ mà backend CHƯA có API. Theo quyết định đã chốt:
 * phần nào backend chưa có thì frontend để trống, không dùng dữ liệu giả.
 */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="page">
      <PageHeader title={title} />
      <div className="empty-state">
        <Construction aria-hidden="true" />
        <h2>Chức năng đang được xây dựng</h2>
        <p>Màn hình này sẽ được bổ sung khi hệ thống sẵn sàng.</p>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-sub">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
