/**
 * Sinh tài liệu CSDL từ lược đồ Drizzle (nguồn sự thật) để xem bằng công cụ:
 *   - docs/db/schema.dbml          → dán vào https://dbdiagram.io hoặc dùng dbdocs / VS Code (DBML)
 *   - docs/db/schema.sql           → DDL đầy đủ (ghép từ migration) để nạp vào PostgreSQL/DBeaver/pgModeler
 *   - docs/db/data-dictionary.md   → từ điển dữ liệu: từng bảng, cột, kiểu, ràng buộc, khóa ngoại, chỉ mục
 * Chạy: `pnpm db:docs` (trong apps/api). Không cần kết nối CSDL.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { type Column, is, SQL } from 'drizzle-orm';
import { toSnakeCase } from 'drizzle-orm/casing';
import {
  getTableConfig,
  isPgEnum,
  PgDialect,
  PgTable,
  type PgEnum,
  type AnyPgTable,
} from 'drizzle-orm/pg-core';
import * as schema from './schema/index.js';

const outDir = resolve(process.argv[2] ?? '../../docs/db');
const dialect = new PgDialect();

// ---------------------------------------------------------------- mô tả (tiếng Việt)

/** Nhóm bảng hiển thị trong sơ đồ. */
const GROUPS: Record<string, string[]> = {
  'Hệ thống': [
    'branches',
    'users',
    'refresh_tokens',
    'audit_logs',
    'code_sequences',
    'company_profile',
    'idempotency_keys',
    'import_jobs',
    'user_branches',
    'role_permissions',
    'user_identities',
    'system_settings',
  ],
  'Hàng hóa & giá': [
    'categories',
    'products',
    'product_images',
    'product_components',
    'price_books',
    'price_book_items',
  ],
  'Tồn kho & chuyển kho': [
    'stocks',
    'stock_movements',
    'stock_transfers',
    'stock_transfer_items',
  ],
  'Đối tác': [
    'customers',
    'customer_branch_terms',
    'customer_invoice_profiles',
    'suppliers',
  ],
  'Đơn hàng': [
    'orders',
    'order_items',
    'invoices',
    'invoice_items',
    'invoice_payments',
    'sales_returns',
    'sales_return_items',
  ],
  'Mua hàng': [
    'goods_receipts',
    'goods_receipt_items',
    'purchase_returns',
    'purchase_return_items',
  ],
  'Sổ quỹ & công nợ': [
    'cash_accounts',
    'cash_categories',
    'cash_transactions',
    'debt_ledger',
    'payment_allocations',
  ],
};

const TABLE_NOTES: Record<string, string> = {
  branches:
    'Chi nhánh/kho (Hà Nội, Sài Gòn). Giá bán, tồn kho, giá vốn, công nợ, quỹ và mọi chứng từ đều tách theo chi nhánh.',
  user_branches:
    'Chi nhánh người dùng được làm việc (Quản lý thấy tất cả, không cần dòng ở đây).',
  role_permissions:
    'Quyền của từng vai trò do Quản lý cấu hình (vai trò manager luôn đủ quyền, không lưu ở đây).',
  user_identities:
    'Danh tính đăng nhập bên ngoài (Google qua Supabase) gắn với người dùng; khớp theo provider_subject, không theo email.',
  system_settings:
    'Cài đặt hệ thống dạng khóa → JSON do Quản lý chỉnh (vd mở/tắt tự đăng ký bằng Google).',
  customer_branch_terms:
    'Hạn mức và kỳ hạn công nợ của khách, riêng từng chi nhánh.',
  stock_transfers:
    'Phiếu chuyển kho giữa 2 chi nhánh, 2 bước (đang đi đường → đã nhận). Không phải hóa đơn bán. Giá nhập bên nhận = giá vốn bên gửi + phí vận chuyển phân bổ.',
  stock_transfer_items:
    'Dòng hàng chuyển kho: giá vốn bên gửi, phần phí phân bổ và giá nhập kho của bên nhận.',
  users: 'Người dùng đăng nhập. Vai trò cố định (enum user_role).',
  refresh_tokens: 'Refresh token (lưu băm, không lưu token thô).',
  audit_logs: 'Nhật ký thao tác — chỉ thêm, không sửa.',
  code_sequences: 'Bộ đếm sinh mã chứng từ theo tiền tố (HD, DH, PN…).',
  company_profile: 'Thông tin công ty (1 dòng) dùng cho mẫu in.',
  idempotency_keys:
    'Chống tạo trùng khi gửi lại yêu cầu (header Idempotency-Key).',
  import_jobs: 'Công việc import Excel chạy nền.',
  categories: 'Nhóm hàng dạng cây (parent_id).',
  products:
    'Hàng hóa — chỉ thông tin DÙNG CHUNG giữa các chi nhánh. Giá bán ở price_book_items, tồn kho/giá vốn/vị trí ở stocks (theo chi nhánh).',
  product_images: 'Ảnh sản phẩm.',
  product_components:
    'Thành phần của combo: combo_id → component_id (hàng hóa) với qty nguyên dương. Combo không có tồn/giá vốn riêng, luôn tính từ thành phần.',
  price_books:
    'Bảng giá theo hạng khách (Chung, Lớn, Vừa, VIP và 3 bản VAT). Thiếu giá thì lùi về bảng mặc định.',
  price_book_items:
    'Giá bán của từng sản phẩm trong từng bảng giá, TẠI TỪNG CHI NHÁNH.',
  stocks:
    'Kho theo (chi nhánh, sản phẩm): tồn, giá vốn bình quân, giá nhập cuối, tồn tối thiểu/tối đa, vị trí kho. Chỉ cập nhật cùng transaction với stock_movements.',
  stock_movements: 'Sổ cái kho — chỉ thêm. Phục vụ thẻ kho.',
  customers:
    'Khách hàng. Công nợ không lưu ở đây: số dư = tổng debt_ledger (có thể âm). sales_owner_id = nhân viên phụ trách.',
  customer_invoice_profiles: 'Thông tin xuất hóa đơn VAT/điện tử của khách.',
  suppliers:
    'Nhà cung cấp; kind phân biệt NCC hàng hóa với lái xe/đối tượng khác; group_name là nhóm NCC (chuỗi tự do, có thể để trống).',
  orders: 'Đặt hàng. draft = phiếu tạm giữ hàng; một đơn → tối đa một hóa đơn.',
  order_items: 'Dòng hàng của đơn đặt hàng.',
  invoices:
    'Hóa đơn bán. Không sửa sau khi tạo (hủy và tạo lại). root_invoice_id/revision_no dành cho bản sửa .nn.',
  invoice_items:
    'Dòng hóa đơn; lưu bản sao mã/tên/đơn vị/giá vốn tại thời điểm bán.',
  invoice_payments:
    'Khoản thanh toán lúc xuất hóa đơn (tiền mặt/chuyển khoản).',
  sales_returns:
    'Trả hàng bán. Có thể không tham chiếu hóa đơn; mặc định bù trừ công nợ.',
  sales_return_items: 'Dòng hàng trả lại của khách.',
  goods_receipts:
    'Phiếu nhập hàng. po_ref chỉ là mã phiếu đặt nhập dạng chữ để đối chiếu.',
  goods_receipt_items: 'Dòng hàng của phiếu nhập.',
  purchase_returns: 'Trả hàng nhập (trả lại nhà cung cấp).',
  purchase_return_items: 'Dòng hàng của phiếu trả nhập.',
  cash_accounts: 'Quỹ: tiền mặt hoặc tài khoản ngân hàng.',
  cash_categories: 'Danh mục thu chi chuẩn.',
  cash_transactions:
    'Phiếu thu/chi. amount luôn dương, chiều do direction. party_id đa hình theo party_type.',
  debt_ledger:
    'Sổ cái công nợ — chỉ thêm. amount có dấu (+ tăng nợ, − giảm nợ). Số dư được phép âm. party_id đa hình nên không có khóa ngoại.',
  payment_allocations: 'Cấn trừ phiếu thu vào từng hóa đơn.',
};

/** Mô tả cột quan trọng; khóa dạng `bang.cot`. */
const COLUMN_NOTES: Record<string, string> = {
  'products.product_type':
    'Loại hàng: goods = Hàng hóa (mặc định), combo = gói các hàng thành phần (không có tồn/giá vốn riêng)',
  'customers.sales_owner_id':
    'Nhân viên phụ trách (ở KiotViet là "Nhóm khách hàng")',
  'customers.default_price_book_id': 'Bảng giá tự áp khi đặt hàng',
  'customers.linked_branch_id':
    'Khách hàng hệ thống đại diện một chi nhánh (chuyển kho nội bộ)',
  'suppliers.linked_branch_id':
    'Nhà cung cấp hệ thống đại diện một chi nhánh (chuyển kho nội bộ)',
  'customer_branch_terms.credit_limit':
    'Hạn mức công nợ tại chi nhánh này (cảnh báo mềm)',
  'stocks.cost_price': 'Giá vốn bình quân gia quyền CỦA chi nhánh này',
  'stocks.last_purchase_price': 'Giá nhập cuối của chi nhánh này',
  'stocks.location': 'Vị trí kho tại chi nhánh này',
  'price_book_items.price':
    'Giá bán tại chi nhánh (branch_id) trong bảng giá (price_book_id)',
  'debt_ledger.branch_id': 'Công nợ tách biệt theo chi nhánh',
  'stock_transfers.goods_value':
    'Tổng tiền hàng theo giá vốn bên gửi tại thời điểm gửi',
  'stock_transfers.shipping_fee':
    'Phí vận chuyển; cộng vào giá nhập kho của bên nhận',
  'stock_transfers.shipping_paid_by':
    'Bên ứng tiền trả xe; sender → công nợ đối ứng gồm cả phí',
  'stock_transfers.debt_amount': 'Công nợ đối ứng đã ghi khi nhận hàng',
  'stock_transfer_items.unit_cost_received':
    'Giá nhập kho bên nhận = giá vốn gửi + phí phân bổ / số lượng',
  'orders.deposit_amount': 'Tiền đặt cọc đã thu',
  'invoices.paid_total':
    'Đã thu khi tạo + đã cấn trừ về sau (cache của sổ cái)',
  'invoices.root_invoice_id': 'Hóa đơn gốc (bản sửa .nn)',
  'invoice_items.unit_cost': 'Giá vốn tại thời điểm bán (tính lãi gộp)',
  'invoice_items.unit_price': 'list_price − discount_per_unit',
  'order_items.discount_per_unit':
    'Giảm giá tính trên 1 đơn vị (số tiền, không phải %)',
  'invoice_items.discount_per_unit':
    'Giảm giá tính trên 1 đơn vị (số tiền, không phải %)',
  'stocks.on_hand': 'Tồn thực tế; không âm (CHECK)',
  'stock_movements.qty_delta': 'Số lượng thay đổi: + nhập, − xuất',
  'cash_transactions.amount': 'Luôn dương; chiều thu/chi do direction',
  'cash_transactions.party_id': 'Đa hình theo party_type (không có khóa ngoại)',
  'debt_ledger.amount': '+ tăng nợ, − giảm nợ',
  'debt_ledger.party_id': 'Đa hình theo party_type (không có khóa ngoại)',
  'goods_receipts.po_ref':
    'Mã phiếu đặt nhập (PDN…) dạng chữ, chỉ để đối chiếu',
  'sales_return_items.restock': 'true = nhập lại kho',
};

// ---------------------------------------------------------------- tiện ích

type PgCol = Column & { keyAsName?: boolean };

const colName = (c: PgCol): string =>
  c.keyAsName ? toSnakeCase(c.name) : c.name;

function typeName(c: Column): string {
  const t = c.getSQLType();
  const map: Record<string, string> = {
    'timestamp with time zone': 'timestamptz',
    'numeric(18, 0)': 'numeric(18,0)',
    'numeric(18, 4)': 'numeric(18,4)',
    'numeric(14, 3)': 'numeric(14,3)',
    'numeric(12, 2)': 'numeric(12,2)',
  };
  return map[t] ?? t;
}

function renderDefault(c: Column): string | null {
  if (!c.hasDefault) return null;
  const d = c.default;
  if (d === undefined || d === null) return null;
  if (is(d, SQL)) return `\`${dialect.sqlToQuery(d).sql}\``;
  if (typeof d === 'string') {
    const isNumericType = /^(numeric|integer|bigint)/.test(typeName(c));
    return isNumericType && /^-?\d+(\.\d+)?$/.test(d) ? d : `'${d}'`;
  }
  return typeof d === 'number' || typeof d === 'boolean'
    ? String(d)
    : JSON.stringify(d);
}

function renderSql(sqlObj: SQL, nameOf: (c: Column) => string): string {
  const q = dialect.sqlToQuery(sqlObj);
  // Thay "bang"."cot" bằng tên cột đã đổi snake_case khi có thể
  return q.sql.replace(/"[^"]+"\."([^"]+)"/g, (_m, col: string) =>
    nameOf({ name: col } as Column),
  );
}

const allExports = Object.values(schema) as unknown[];
const tables = allExports.filter((v): v is AnyPgTable => is(v, PgTable));
const enums = allExports.filter(isPgEnum) as PgEnum<[string, ...string[]]>[];

const cfgOf = new Map(
  tables.map((t) => [getTableConfig(t).name, getTableConfig(t)]),
);
const tableName = (t: AnyPgTable): string => getTableConfig(t).name;

// Bảng chưa được xếp nhóm ở trên vẫn xuất hiện trong tài liệu, ở nhóm "Khác" (kèm cảnh báo).
{
  const grouped = new Set(Object.values(GROUPS).flat());
  const orphans = [...cfgOf.keys()].filter((n) => !grouped.has(n));
  if (orphans.length > 0) {
    GROUPS['Khác'] = orphans;
    console.warn(
      `Cảnh báo: bảng chưa xếp nhóm trong export-docs.ts: ${orphans.join(', ')}`,
    );
  }
}

// ---------------------------------------------------------------- DBML

function buildDbml(): string {
  const out: string[] = [];
  out.push(`Project kiot {
  database_type: 'PostgreSQL'
  Note: '''
    # Kiot — Lược đồ CSDL
    Sinh tự động từ apps/api/src/db/schema (Drizzle). KHÔNG sửa tay — chạy \`pnpm db:docs\`.

    Quy ước kiểu số: numeric(18,0) = tiền chứng từ (đồng); numeric(18,4) = đơn giá/giá vốn; numeric(14,3) = số lượng.
    Chứng từ không xóa cứng (đổi status). Sổ cái stock_movements và debt_ledger chỉ thêm.
  '''
}
`);

  for (const e of enums) {
    out.push(
      `enum ${e.enumName} {\n${e.enumValues.map((v) => `  "${v}"`).join('\n')}\n}\n`,
    );
  }

  const refs: string[] = [];
  for (const [name, cfg] of cfgOf) {
    const lines: string[] = [];
    const pkCols = cfg.primaryKeys.flatMap((p) =>
      p.columns.map((c) => colName(c as PgCol)),
    );
    for (const c of cfg.columns as PgCol[]) {
      const attrs: string[] = [];
      if (c.primary) attrs.push('pk');
      if (c.notNull && !c.primary) attrs.push('not null');
      if (c.isUnique && !c.primary) attrs.push('unique');
      const def = renderDefault(c);
      if (def) attrs.push(`default: ${def}`);
      const note = COLUMN_NOTES[`${name}.${colName(c)}`];
      if (note) attrs.push(`note: '${note.replace(/'/g, "\\'")}'`);
      lines.push(
        `  ${colName(c)} ${typeName(c)}${attrs.length ? ` [${attrs.join(', ')}]` : ''}`,
      );
    }

    const idx: string[] = [];
    if (pkCols.length > 1) idx.push(`    (${pkCols.join(', ')}) [pk]`);
    for (const i of cfg.indexes) {
      const cols = i.config.columns.map((c) =>
        is(c, SQL) ? `\`${renderSql(c, colName)}\`` : colName(c as PgCol),
      );
      const flags = [
        `name: '${i.config.name}'`,
        ...(i.config.unique ? ['unique'] : []),
      ];
      idx.push(`    (${cols.join(', ')}) [${flags.join(', ')}]`);
    }
    if (idx.length) lines.push(`\n  indexes {\n${idx.join('\n')}\n  }`);

    const notes: string[] = [];
    if (TABLE_NOTES[name]) notes.push(TABLE_NOTES[name]);
    for (const ck of cfg.checks)
      notes.push(`CHECK ${ck.name}: ${renderSql(ck.value, colName)}`);
    if (notes.length) lines.push(`\n  Note: '''${notes.join('\n')}'''`);

    out.push(`Table ${name} {\n${lines.join('\n')}\n}\n`);

    for (const fk of cfg.foreignKeys) {
      const r = fk.reference();
      const from = r.columns.map((c) => colName(c as PgCol));
      const to = r.foreignColumns.map((c) => colName(c as PgCol));
      const ft = tableName(r.foreignTable as AnyPgTable);
      const fmt = (t: string, cols: string[]) =>
        cols.length > 1 ? `${t}.(${cols.join(', ')})` : `${t}.${cols[0]}`;
      const opts =
        fk.onDelete && fk.onDelete !== 'no action'
          ? ` [delete: ${fk.onDelete}]`
          : '';
      refs.push(`Ref: ${fmt(name, from)} > ${fmt(ft, to)}${opts}`);
    }
  }

  out.push(refs.join('\n') + '\n');

  for (const [group, list] of Object.entries(GROUPS)) {
    out.push(
      `TableGroup "${group}" {\n${list.map((t) => `  ${t}`).join('\n')}\n}\n`,
    );
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- Từ điển dữ liệu (Markdown)

function buildDictionary(): string {
  const md: string[] = [];
  md.push('# Từ điển dữ liệu\n');
  md.push(
    '> **Sinh tự động** từ `apps/api/src/db/schema` bằng `pnpm db:docs` — không sửa tay. Tổng quan và cách xem sơ đồ: [`README.md`](README.md).\n',
  );
  md.push(`**${tables.length} bảng · ${enums.length} kiểu liệt kê (enum)**\n`);

  md.push('## Mục lục\n');
  for (const [group, list] of Object.entries(GROUPS)) {
    md.push(
      `- **${group}**: ${list.map((t) => `[\`${t}\`](#${t})`).join(', ')}`,
    );
  }
  md.push('');

  md.push('## Kiểu liệt kê (enum)\n');
  md.push('| Enum | Giá trị |\n| --- | --- |');
  for (const e of enums)
    md.push(
      `| \`${e.enumName}\` | ${e.enumValues.map((v) => `\`${v}\``).join(', ')} |`,
    );
  md.push('');

  for (const [group, list] of Object.entries(GROUPS)) {
    md.push(`## ${group}\n`);
    for (const name of list) {
      const cfg = cfgOf.get(name);
      if (!cfg) continue;
      md.push(`### ${name}\n`);
      if (TABLE_NOTES[name]) md.push(`${TABLE_NOTES[name]}\n`);
      const pkCols = new Set(
        cfg.primaryKeys.flatMap((p) =>
          p.columns.map((c) => colName(c as PgCol)),
        ),
      );
      const fkOf = new Map<string, string>();
      for (const fk of cfg.foreignKeys) {
        const r = fk.reference();
        r.columns.forEach((c, i) => {
          const target = `${tableName(r.foreignTable as AnyPgTable)}.${colName(r.foreignColumns[i] as PgCol)}`;
          const del =
            fk.onDelete && fk.onDelete !== 'no action'
              ? ` (on delete ${fk.onDelete})`
              : '';
          fkOf.set(colName(c as PgCol), `→ \`${target}\`${del}`);
        });
      }
      md.push(
        '| Cột | Kiểu | Null | Mặc định | Ràng buộc / ghi chú |\n| --- | --- | :-: | --- | --- |',
      );
      for (const c of cfg.columns as PgCol[]) {
        const n = colName(c);
        const flags: string[] = [];
        if (c.primary || pkCols.has(n)) flags.push('**PK**');
        if (c.isUnique) flags.push('unique');
        if (fkOf.has(n)) flags.push(fkOf.get(n) as string);
        const note = COLUMN_NOTES[`${name}.${n}`];
        if (note) flags.push(note);
        const def = renderDefault(c);
        md.push(
          `| \`${n}\` | ${typeName(c)} | ${c.notNull || c.primary ? '' : '✔'} | ${def ? `\`${def.replace(/`/g, '')}\`` : ''} | ${flags.join('; ')} |`,
        );
      }
      md.push('');
      if (pkCols.size > 1)
        md.push(
          `**Khóa chính ghép:** (${[...pkCols].map((c) => `\`${c}\``).join(', ')})\n`,
        );
      if (cfg.indexes.length) {
        md.push('**Chỉ mục:**\n');
        for (const i of cfg.indexes) {
          const cols = i.config.columns.map((c) =>
            is(c, SQL)
              ? `\`${renderSql(c, colName)}\``
              : `\`${colName(c as PgCol)}\``,
          );
          const where = i.config.where
            ? ` WHERE ${renderSql(i.config.where, colName)}`
            : '';
          md.push(
            `- \`${i.config.name}\`${i.config.unique ? ' (unique)' : ''}: ${cols.join(', ')}${where}`,
          );
        }
        md.push('');
      }
      if (cfg.checks.length) {
        md.push('**Ràng buộc CHECK:**\n');
        for (const ck of cfg.checks)
          md.push(`- \`${ck.name}\`: \`${renderSql(ck.value, colName)}\``);
        md.push('');
      }
    }
  }
  return md.join('\n');
}

/** Ghép các file migration (đã được drizzle-kit sinh với snake_case) thành một file DDL duy nhất. */
function buildSql(): string {
  const dir = resolve('drizzle');
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^\d+_.*\.sql$/.test(f))
        .sort()
    : [];
  const parts = files.map(
    (f) =>
      `-- ===== ${f} =====\n` +
      readFileSync(resolve(dir, f), 'utf8').replace(
        /--> statement-breakpoint\r?\n?/g,
        '',
      ),
  );
  return (
    '-- Sinh tự động từ apps/api/drizzle/*.sql bằng `pnpm db:docs` — không sửa tay.\n' +
    '-- Chạy theo thứ tự trên PostgreSQL 17 để tạo toàn bộ lược đồ (DBeaver, pgModeler, DataGrip…).\n\n' +
    parts.join('\n')
  );
}

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'schema.sql'), buildSql(), 'utf8');
writeFileSync(resolve(outDir, 'schema.dbml'), buildDbml(), 'utf8');
writeFileSync(resolve(outDir, 'data-dictionary.md'), buildDictionary(), 'utf8');
console.log(
  `Đã ghi ${outDir}\\schema.dbml và data-dictionary.md (${tables.length} bảng, ${enums.length} enum) và schema.sql`,
);
