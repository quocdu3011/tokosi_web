import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-muted-foreground text-sm font-medium">404</p>
      <h1 className="text-2xl font-semibold">Không tìm thấy trang</h1>
      <p className="text-muted-foreground text-sm">Đường dẫn không tồn tại hoặc đã bị thay đổi.</p>
      <Button asChild className="mt-2">
        <Link href="/">Về trang chủ</Link>
      </Button>
    </div>
  );
}
