'use client';

import { PAGE_SIZE_OPTIONS, type PageSizeOption } from '@kiot/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PageMeta } from '@/lib/api/types';

/**
 * Thanh phân trang theo `meta` của server.
 *
 * `pageSize` + `onPageSizeChange` (tùy chọn, màn cũ không truyền vẫn chạy): hiện ô chọn "Số dòng/trang"
 * (15/50/100 — `PAGE_SIZE_OPTIONS`). Khi người dùng đổi cỡ trang, thanh này gọi `onPageSizeChange(size)` rồi
 * `onPageChange(1)`, nên MÀN HÌNH LUÔN VỀ TRANG 1 dù tự xử lý hay không (`useListState` cũng tự về trang 1;
 * hai lần gọi giống nhau không gây hại). Cỡ trang thật sự dùng để gọi API là `pageSize`, lấy từ `useTablePrefs`.
 */
export function Pagination({
  meta,
  onPageChange,
  pageSize,
  onPageSizeChange,
}: {
  meta: PageMeta | undefined;
  onPageChange: (page: number) => void;
  pageSize?: number;
  onPageSizeChange?: (size: PageSizeOption) => void;
}) {
  const sizeLabelId = useId();
  if (!meta) return null;
  const { page, totalPages, total, limit } = meta;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const size = pageSize ?? limit;
  return (
    <div className="pagination-controls">
      <div className="pagination-info">
        <span className="tabular">
          {from}–{to} / {total.toLocaleString('vi-VN')} dòng
        </span>
        {onPageSizeChange && (
          <div className="pagination-size">
            <span id={sizeLabelId} className="pagination-size-label">
              Số dòng/trang
            </span>
            <Select
              value={String(size)}
              onValueChange={(next) => {
                const nextSize = PAGE_SIZE_OPTIONS.find((option) => String(option) === next);
                if (nextSize === undefined) return;
                onPageSizeChange(nextSize);
                onPageChange(1);
              }}
            >
              <SelectTrigger
                size="sm"
                className="pagination-size-select tabular"
                aria-labelledby={sizeLabelId}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="pagination-buttons">
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
