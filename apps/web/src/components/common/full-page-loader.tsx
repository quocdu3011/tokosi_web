import { Loader2 } from 'lucide-react';

export function FullPageLoader({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="text-muted-foreground flex min-h-svh items-center justify-center gap-2 text-sm">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}
