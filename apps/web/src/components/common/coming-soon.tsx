import { Construction } from 'lucide-react';

/**
 * Trang trống cho phân hệ mà backend CHƯA có API. Theo quyết định đã chốt:
 * phần nào backend chưa có thì frontend để trống, không dùng dữ liệu giả.
 */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} />
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-24 text-center">
        <Construction className="text-muted-foreground size-10" />
        <h2 className="text-lg font-semibold">Chức năng đang được xây dựng</h2>
        <p className="text-muted-foreground max-w-md text-sm">
          Màn hình này sẽ được bổ sung khi hệ thống sẵn sàng.
        </p>
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
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
