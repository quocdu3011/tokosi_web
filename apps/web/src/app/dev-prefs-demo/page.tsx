'use client';

// TẠM THỜI – chỉ để kiểm thử thủ công DataTable + useTablePrefs. XÓA trước khi báo xong.
import { useEffect, useMemo, useState } from 'react';

import { DataTable, type AppColumnDef } from '@/components/data-table/data-table';
import { Pagination } from '@/components/data-table/pagination';
import {
  ColumnPicker,
  FilterSelect,
  TableSearch,
  TableToolbar,
  ToolbarCount,
  ToolbarEnd,
} from '@/components/data-table/table-toolbar';
import { StatusBadge } from '@/components/common/status-badge';
import { useListState } from '@/hooks/use-list-state';
import { useTablePrefs } from '@/hooks/use-table-prefs';
import { useAuthStore } from '@/lib/auth/store';

interface Row {
  id: string;
  code: string;
  name: string;
  cost: number;
  stock: number;
  note: string;
}
const ROWS: Row[] = Array.from({ length: 130 }, (_, i) => ({
  id: String(i + 1),
  code: `SP${String(i + 1).padStart(4, '0')}`,
  name: `Hàng hóa mẫu số ${i + 1}`,
  cost: 1000 * (i + 1),
  stock: (i * 7) % 50,
  note: i % 3 === 0 ? 'Ghi chú dài một chút để thử xuống dòng' : '',
}));

declare global {
  interface Window {
    __demoServer?: Record<string, unknown>;
    __demoLog?: string[];
    __demoFailPut?: boolean;
    __demoInstalled?: boolean;
  }
}

function installFakeServer() {
  const original = window.fetch;
  window.__demoServer ??= JSON.parse(sessionStorage.getItem('demoServer') ?? '{}');
  window.__demoLog ??= [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const log = (s: string) => window.__demoLog?.push(`${new Date().toISOString().slice(14, 23)} ${s}`);
    if (url.includes('/auth/refresh')) return json({ accessToken: 'demo', expiresIn: 900 });
    if (url.includes('/auth/me'))
      return json({
        id: 'demo-user',
        code: 'NV0001',
        username: 'demo',
        fullName: 'Demo',
        role: 'manager',
        mustChangePassword: false,
        permissions: [],
        defaultBranchId: 'hn',
        branches: [{ id: 'hn', name: 'Hà Nội', code: 'HN' }],
      });
    if (url.includes('/me/table-prefs')) {
      await new Promise((r) => setTimeout(r, 250));
      const key = decodeURIComponent(url.split('/me/table-prefs/')[1] ?? '').split('?')[0];
      if (method === 'GET') {
        log('GET ' + (new Error().stack ?? '').split(/\r?\n/).slice(2, 14).map((l) => l.trim().slice(0, 70)).join(' | '));
        return json({ data: window.__demoServer });
      }
      if (method === 'PUT') {
        if (window.__demoFailPut) {
          log(`PUT ${key} -> 500`);
          return json({ code: 'INTERNAL', message: 'lỗi' }, 500);
        }
        const body = JSON.parse(String(init?.body));
        window.__demoServer![key!] = body;
        sessionStorage.setItem('demoServer', JSON.stringify(window.__demoServer));
        log(`PUT ${key} ${JSON.stringify(body)}`);
        return json(body);
      }
      if (method === 'DELETE') {
        delete window.__demoServer![key!];
        sessionStorage.setItem('demoServer', JSON.stringify(window.__demoServer));
        log(`DELETE ${key}`);
        return new Response(null, { status: 204 });
      }
    }
    return original(input, init);
  };
  return () => {
    window.fetch = original;
  };
}

// Cài server giả NGAY khi module được nạp (trước khi AppProviders chạy bootstrapSession).
if (typeof window !== 'undefined' && !window.__demoInstalled) {
  window.__demoInstalled = true;
  installFakeServer();
}

export default function DemoPage() {
  const userId = useAuthStore((s) => s.user?.id);
  if (!userId) return <p style={{ padding: 24 }}>Đang chuẩn bị…</p>;
  return <Demo />;
}

function Demo() {
  const columns = useMemo<AppColumnDef<Row>[]>(
    () => [
      {
        id: 'code',
        header: 'Mã hàng',
        meta: { label: 'Mã hàng', width: 120, locked: true, sort: 'server' },
        cell: ({ row }) => <span className="tabular">{row.original.code}</span>,
      },
      {
        id: 'name',
        header: 'Tên hàng',
        meta: { label: 'Tên hàng', width: 280, sort: 'server' },
        cell: ({ row }) => row.original.name,
      },
      {
        id: 'cost',
        header: () => <span className="num">Giá vốn</span>,
        meta: { label: 'Giá vốn', width: 140, sort: 'page' },
        cell: ({ row }) => <span className="num">{row.original.cost.toLocaleString('vi-VN')}</span>,
      },
      {
        id: 'stock',
        header: () => <span className="num">Tồn kho</span>,
        meta: { label: 'Tồn kho', width: 110, sort: 'server' },
        cell: ({ row }) => <span className="num">{row.original.stock}</span>,
      },
      {
        id: 'status',
        header: 'Trạng thái',
        meta: { label: 'Trạng thái', width: 180 },
        cell: ({ row }) => (
          <StatusBadge tone={row.original.stock > 10 ? 'success' : 'warning'}>
            {row.original.stock > 10 ? 'Còn hàng' : 'Sắp hết'}
          </StatusBadge>
        ),
      },
      {
        id: 'note',
        header: 'Ghi chú',
        meta: { label: 'Ghi chú', width: 260, hiddenByDefault: true },
        cell: ({ row }) => row.original.note,
      },
      {
        id: 'actions',
        header: '',
        meta: { label: 'Thao tác', width: 90, locked: true },
        cell: () => <button className="link-button">Sửa</button>,
      },
    ],
    [],
  );
  const prefs = useTablePrefs('demo-products', columns);
  const list = useListState({ initialFilters: { status: '' }, prefs });
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    const t = setInterval(() => setLog([...(window.__demoLog ?? [])]), 300);
    return () => clearInterval(t);
  }, []);

  const total = ROWS.length;
  const start = (list.page - 1) * list.pageSize;
  const rows = ROWS.slice(start, start + list.pageSize);
  const meta = {
    page: list.page,
    limit: list.pageSize,
    total,
    totalPages: Math.ceil(total / list.pageSize),
  };

  return (
    <div className="page" style={{ padding: 24 }}>
      <h1 className="page-title">Demo tùy chỉnh bảng</h1>
      <TableToolbar>
        <TableSearch value={list.q} onChange={list.setQ} placeholder="Tìm…" label="Tìm" />
        <FilterSelect
          label="Trạng thái"
          value={list.filters.status}
          onChange={(v) => list.setFilter('status', v)}
          options={[
            { value: '', label: 'Mọi trạng thái' },
            { value: 'a', label: 'Còn hàng' },
          ]}
        />
        <ToolbarEnd>
          <ToolbarCount total={total} />
          <ColumnPicker prefs={prefs} />
        </ToolbarEnd>
      </TableToolbar>
      <DataTable
        columns={columns}
        data={rows}
        prefs={prefs}
        getRowId={(r) => r.id}
        sort={list.sort}
        onSortChange={list.onSortChange}
        onRowClick={() => undefined}
      />
      <Pagination
        meta={meta}
        onPageChange={list.setPage}
        pageSize={list.pageSize}
        onPageSizeChange={list.onPageSizeChange}
      />
      <pre id="demo-log" style={{ fontSize: 12 }}>
        {`ready=${prefs.isReady} custom=${prefs.isCustomized} page=${list.page} size=${list.pageSize} sort=${JSON.stringify(list.sort)}\norder=${prefs.order.join(',')}\nhidden=${[...prefs.hidden].join(',')}\nwidths=${JSON.stringify(prefs.widths)}\n` +
          log.join('\n')}
      </pre>
    </div>
  );
}
