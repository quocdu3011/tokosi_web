'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { PageMeta } from '@/lib/api/types';

/** Thanh phân trang theo `meta` của server. */
export function Pagination({
  meta,
  onPageChange,
}: {
  meta: PageMeta | undefined;
  onPageChange: (page: number) => void;
}) {
  if (!meta) return null;
  const { page, totalPages, total, limit } = meta;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="tabular">
        {from}–{to} / {total.toLocaleString('vi-VN')} dòng
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Trang trước"
        >
          <ChevronLeft />
        </Button>
        <span className="tabular">
          Trang {page} / {Math.max(totalPages, 1)}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Trang sau"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
