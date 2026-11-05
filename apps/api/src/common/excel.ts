import ExcelJS from 'exceljs';

export type CellValue = string | number | boolean | null;

export interface SheetColumn {
  /** Tiêu đề cột (hàng đầu tiên). */
  header: string;
  /** Độ rộng ký tự (mặc định theo độ dài tiêu đề). */
  width?: number;
}

/** Ghi một sheet (hàng đầu là tiêu đề) ra bộ đệm .xlsx. Số giữ kiểu số, chuỗi giữ chuỗi. */
export async function writeSheet(
  sheetName: string,
  columns: SheetColumn[],
  rows: CellValue[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({
    header: c.header,
    width: c.width ?? Math.max(12, c.header.length + 2),
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Chuẩn hóa tên cột để so khớp: bỏ dấu, hạ chữ thường, gộp khoảng trắng ("Nhóm hàng(3 Cấp)" → "nhom hang(3 cap)"). */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ParsedSheet {
  /** Tiêu đề đã chuẩn hóa theo thứ tự cột. */
  headers: string[];
  /** Mỗi dòng là đối tượng `{ tiêuĐềChuẩnHóa: giáTrị }`; ô trống là `null`. `row` là số dòng trong file (bắt đầu từ 2). */
  rows: Array<{ row: number; values: Record<string, CellValue> }>;
}

const MAX_ROWS = 20000;

/** Đọc sheet đầu tiên của file .xlsx. Dòng trống hoàn toàn bị bỏ qua. Ném lỗi nếu file không phải .xlsx hợp lệ. */
export async function readSheet(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('File không có sheet nào');
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  for (let c = 1; c <= sheet.columnCount; c++) {
    headers.push(normalizeHeader(cellText(headerRow.getCell(c).value)));
  }
  const rows: ParsedSheet['rows'] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const values: Record<string, CellValue> = {};
    let any = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const v = toCellValue(row.getCell(i + 1).value);
      if (v !== null) any = true;
      values[h] = v;
    });
    if (!any) continue;
    if (rows.length >= MAX_ROWS) {
      throw new Error(`File có quá ${MAX_ROWS} dòng dữ liệu`);
    }
    rows.push({ row: r, values });
  }
  return { headers, rows };
}

function toCellValue(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  const text = cellText(v);
  return text === '' ? null : text;
}

/** Văn bản của ô (công thức → kết quả, rich text → ghép đoạn, hyperlink → chữ hiển thị). */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
  if ('text' in v) return String(v.text);
  return '';
}
