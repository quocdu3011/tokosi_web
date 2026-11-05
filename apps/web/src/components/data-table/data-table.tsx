'use client';

import { tableFeatures, useTable, type ColumnDef, type RowData } from '@tanstack/react-table';

import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Bảng dữ liệu dùng chung (TanStack Table v9). Phân trang/lọc/sắp xếp do server làm
 * (docs/api/README.md mục 4) nên bảng chỉ dựng dòng/cột từ trang dữ liệu hiện tại.
 */
const features = tableFeatures({});
export type AppColumnDef<TData extends RowData> = ColumnDef<typeof features, TData, unknown>;

export function DataTable<TData extends RowData>({
  columns,
  data,
  isLoading,
  emptyText = 'Không có dữ liệu',
  getRowId,
}: {
  columns: AppColumnDef<TData>[];
  data: TData[];
  isLoading?: boolean;
  emptyText?: string;
  getRowId?: (row: TData) => string;
}) {
  const table = useTable({ features, columns, data, getRowId });

  return (
    <div className="data-table-frame">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isLoading && data.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={`sk-${i}`}>
                {columns.map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="skeleton-line" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="data-table-empty">
                {emptyText}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
