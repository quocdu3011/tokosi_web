/**
 * Xuất bảng ra file. Excel do API dựng (`?format=xlsx`, docs/api/README.md mục 4);
 * HTML dựng ở trình duyệt từ các dòng đã lấy về.
 */

export interface ExportColumn<TData> {
  /** Tiêu đề cột trong file. */
  header: string;
  /** Giá trị dạng chữ của ô (đã định dạng như trên màn hình). */
  value: (row: TData) => string;
  /** Cột số liệu: canh phải. */
  numeric?: boolean;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Trang HTML độc lập (CSS nhúng sẵn, nền sáng để in/gửi mail), mở được không cần mạng. */
export function buildHtmlDocument<TData>(opts: {
  title: string;
  subtitle?: string;
  columns: ExportColumn<TData>[];
  rows: TData[];
  generatedAt?: Date;
}): string {
  const { title, subtitle, columns, rows } = opts;
  const when = (opts.generatedAt ?? new Date()).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const head = columns
    .map((c) => `<th${c.numeric ? ' class="num"' : ''}>${escapeHtml(c.header)}</th>`)
    .join('');
  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((c) => `<td${c.numeric ? ' class="num"' : ''}>${escapeHtml(c.value(row))}</td>`)
          .join('')}</tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 24px; font: 14px/1.5 system-ui, "Segoe UI", sans-serif; color: #0f172a; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p { margin: 0 0 16px; color: #64748b; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px 12px; border: 1px solid #cbd5e1; text-align: left; vertical-align: top; }
  th { position: sticky; top: 0; background: #f1f5f9; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  @media print { th { position: static; } }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>${subtitle ? `${escapeHtml(subtitle)} · ` : ''}${rows.length.toLocaleString('vi-VN')} dòng · Xuất lúc ${escapeHtml(when)}</p>
<table>
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table>
</body>
</html>
`;
}

/** Tên file an toàn + ngày: "hang-hoa-2026-11-05.html" (ngày theo giờ Việt Nam). */
export function exportFilename(base: string, ext: string, now = new Date()): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
  return `${base}-${date}.${ext}`;
}

/** Kích hoạt tải file ở trình duyệt. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Hoãn thu hồi để trình duyệt kịp bắt đầu tải.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
