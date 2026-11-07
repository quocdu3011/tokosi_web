import { DOCUMENT_PREFIX } from '@kiot/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  normalizeHeader,
  type CellValue,
  type ParsedSheet,
} from '../../common/excel.js';
import { lockCashImport } from '../../common/advisory-lock.js';
import type { Tx } from '../../db/database.module.js';
import {
  cashAccounts,
  cashCategories,
  cashTransactions,
  codeSequences,
} from '../../db/schema/index.js';
import {
  asText,
  chunk,
  hasColumn,
  pick,
  type ImportOutcome,
  type ImportRowError,
} from './import-cells.js';

/** Tên cột (đã chuẩn hóa) theo file SoQuy của KiotViet. */
const COL = {
  code: ['ma phieu'],
  time: ['thoi gian'],
  category: ['loai thu chi'],
  party: ['nguoi nop/nhan', 'nguoi nop nhan'],
  amount: ['gia tri'],
} as const;

/** Nhãn của 4 dòng tổng kết cuối file (nằm ở cột "Người nộp/nhận", giá trị ở cột "Giá trị"). */
const SUMMARY = {
  opening: 'quy dau ky',
  totalIn: 'tong thu',
  totalOut: 'tong chi',
  closing: 'ton quy',
} as const;

/** "Loại thu chi" (đã chuẩn hóa, bỏ "phieu thu/chi") → mã danh mục hệ thống. Khớp theo thứ tự. */
const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/tien khach tra/, 'customer_payment'],
  [/cong no/, 'supplier_payment'],
  [/cuoc hang hoan/, 'return_freight'],
  [/phi thu ho/, 'cod_fee'],
  [/palet|\bben\b|ben bai/, 'port_pallet'],
  [/thue xe ngoai/, 'outsourced_truck'],
  [/xang xe/, 'fuel'],
  [/sua chua kho/, 'warehouse_repair'],
  [/xu ly hang loi/, 'defect_handling'],
  [/chuyen.?rut|rut tien/, 'cash_withdraw'],
  [/van chuyen/, 'freight'],
];
const VN_OFFSET_MS = 7 * 3600 * 1000;
const BATCH = 500;

export interface CashImportOptions {
  userId: string;
  branchId: string;
  /** Quỹ đích; bỏ trống = quỹ tiền mặt đang hoạt động của chi nhánh. */
  accountId?: string;
  /** Chứng từ gốc của lần nhập (`refType = 'import'`, `refId` = id lần nhập). */
  ref: { id: string; code: string };
}

interface Parsed {
  row: number;
  code: string;
  at: Date;
  direction: 'in' | 'out';
  amount: string;
  categoryId: string;
  partyName: string | null;
  vehicleRef: string | null;
  note: string;
}

/**
 * Nhập Sổ quỹ từ file KiotViet (`SoQuy_…`). Mỗi dòng có mã là một phiếu thu (giá trị dương) / chi (âm) vào MỘT quỹ của
 * chi nhánh; giữ nguyên mã phiếu của file. Bốn dòng tổng kết cuối file (không có mã) không được nhập mà dùng để đặt quỹ
 * đầu kỳ (khi quỹ còn trống) và đối chiếu tồn quỹ cuối. CHỈ ghi lịch sử quỹ: KHÔNG ghi công nợ và KHÔNG cấn trừ hóa đơn
 * (công nợ lấy từ số dư đầu kỳ của khách / nhà cung cấp, tránh trừ hai lần). Có lỗi thì không ghi gì. Phải chạy trong
 * transaction của người gọi.
 */
export async function importCashTransactions(
  tx: Tx,
  sheet: ParsedSheet,
  opts: CashImportOptions,
): Promise<ImportOutcome> {
  await lockCashImport(tx);
  const errors: ImportRowError[] = [];
  const warnings: ImportRowError[] = [];
  const headers = sheet.headers;
  const required: Array<[readonly string[], string]> = [
    [COL.code, 'Mã phiếu'],
    [COL.time, 'Thời gian'],
    [COL.category, 'Loại thu chi'],
    [COL.amount, 'Giá trị'],
  ];
  for (const [aliases, label] of required) {
    if (!hasColumn(headers, aliases)) {
      errors.push({ row: 1, field: label, message: `Thiếu cột bắt buộc "${label}"` });
    }
  }
  if (errors.length > 0) return { created: 0, updated: 0, errors, warnings };

  // ---- quỹ đích
  const accounts = await tx
    .select()
    .from(cashAccounts)
    .where(eq(cashAccounts.branchId, opts.branchId));
  const account = opts.accountId
    ? accounts.find((a) => a.id === opts.accountId)
    : accounts
        .filter((a) => a.type === 'cash' && a.isActive)
        .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!account) {
    return {
      created: 0,
      updated: 0,
      errors: [
        {
          row: 0,
          field: 'accountId',
          message: opts.accountId
            ? 'Quỹ đích không thuộc chi nhánh đã chọn'
            : 'Chi nhánh chưa có quỹ tiền mặt; hãy chỉ định quỹ đích (accountId)',
        },
      ],
      warnings,
    };
  }
  if (!account.isActive) {
    errors.push({ row: 0, field: 'accountId', message: `Quỹ "${account.name}" đã ngưng hoạt động` });
  }
  // Khóa dòng quỹ: người lập phiếu giữ khóa chia sẻ trên dòng này, nên trong lúc nhập không ai chen phiếu vào quỹ và
  // "quỹ còn trống" (quyết định đặt quỹ đầu kỳ) không bị sai giữa lúc kiểm tra và lúc ghi.
  const [locked] = await tx
    .select({ openingBalance: cashAccounts.openingBalance, isActive: cashAccounts.isActive })
    .from(cashAccounts)
    .where(eq(cashAccounts.id, account.id))
    .for('update');
  account.openingBalance = locked!.openingBalance;
  account.isActive = locked!.isActive;
  const [counted] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(cashTransactions)
    .where(eq(cashTransactions.accountId, account.id));
  const accountEmpty = (counted?.n ?? 0) === 0;

  const cats = await tx.select().from(cashCategories);
  const catByCode = new Map(cats.filter((c) => c.code).map((c) => [c.code!, c]));

  // ---- đọc từng dòng
  const parsed: Parsed[] = [];
  const summary: Partial<Record<keyof typeof SUMMARY, bigint>> = {};
  const seen = new Set<string>();
  for (const { row, values } of sheet.rows) {
    const err = (field: string, message: string) => errors.push({ row, field, message });
    const code = asText(pick(values, COL.code));
    const party = asText(pick(values, COL.party));
    const amount = asMoney(pick(values, COL.amount));

    if (!code) {
      // Dòng tổng kết: nhận diện theo nhãn ở cột Người nộp/nhận
      const key = (Object.keys(SUMMARY) as Array<keyof typeof SUMMARY>).find(
        (k) => party !== null && normalizeHeader(party) === SUMMARY[k],
      );
      if (!key) {
        err('Mã phiếu', 'Thiếu mã phiếu (dòng không có mã chỉ được là dòng tổng kết: Quỹ đầu kỳ, Tổng thu, Tổng chi, Tồn quỹ)');
      } else if (amount === undefined || amount === null) {
        err('Giá trị', `Giá trị dòng "${party}" không hợp lệ`);
      } else {
        summary[key] = amount;
      }
      continue;
    }
    if (code.length > 50) err('Mã phiếu', 'Mã phiếu dài quá 50 ký tự');
    const lower = code.toLowerCase();
    if (seen.has(lower)) err('Mã phiếu', `Mã phiếu "${code}" xuất hiện nhiều lần trong file`);
    seen.add(lower);

    const at = parseWhen(pick(values, COL.time));
    if (!at) err('Thời gian', 'Thời gian không hợp lệ (cần ngày giờ, vd 03/11/2026 14:30)');
    else if (at.getTime() > Date.now() + 5 * 60 * 1000) err('Thời gian', 'Thời gian ở tương lai');

    if (amount === undefined || amount === null || amount === 0n) {
      err('Giá trị', 'Giá trị phải là số nguyên đồng khác 0 (dương = thu, âm = chi)');
    }
    const kind = asText(pick(values, COL.category));
    if (!kind) err('Loại thu chi', 'Thiếu loại thu chi');
    if (!at || amount === undefined || amount === null || amount === 0n || !kind) continue;

    const direction: 'in' | 'out' = amount > 0n ? 'in' : 'out';
    const norm = normalizeHeader(kind).replace(/^phieu (thu|chi)\s*/, '');
    let cat = catByCode.get(CATEGORY_RULES.find(([re]) => re.test(norm))?.[1] ?? '');
    if (!cat) {
      cat = catByCode.get(direction === 'in' ? 'other_in' : 'other_out');
      warnings.push({
        row,
        field: 'Loại thu chi',
        message: `Không nhận ra loại "${kind.slice(0, 60)}", đã xếp vào "${cat?.name ?? 'khác'}" (nội dung gốc giữ ở ghi chú)`,
      });
    } else if (cat.direction !== direction) {
      warnings.push({
        row,
        field: 'Loại thu chi',
        message: `Loại "${kind.slice(0, 60)}" ngược chiều với dấu của giá trị, đã xếp vào mục khác`,
      });
      cat = catByCode.get(direction === 'in' ? 'other_in' : 'other_out');
    }
    if (!cat) {
      err('Loại thu chi', 'Thiếu danh mục thu/chi khác trong hệ thống');
      continue;
    }
    // "Xăng xe 51D 123.45 (Tên tài xế)": phần giữa từ khóa và dấu ngoặc là biển số xe
    let vehicleRef: string | null = null;
    if (cat.code === 'fuel') {
      const m = /xăng xe\s+([^()]+?)\s*(?:\(|$)/i.exec(kind);
      vehicleRef = m?.[1]?.trim().slice(0, 100) || null;
    }
    parsed.push({
      row,
      code,
      at: at!,
      direction,
      amount: (amount < 0n ? -amount : amount).toString(),
      categoryId: cat.id,
      partyName: party ? party.slice(0, 200) : null,
      vehicleRef,
      note: kind.slice(0, 500),
    });
  }
  if (errors.length > 0) return { created: 0, updated: 0, errors, warnings };

  // ---- mã phiếu đã có trong hệ thống (không phân biệt hoa thường)
  const rowOfCode = new Map(parsed.map((p) => [p.code.toLowerCase(), p.row]));
  for (const part of chunk([...rowOfCode.keys()], 1000)) {
    const hit = await tx
      .select({ code: cashTransactions.code })
      .from(cashTransactions)
      .where(inArray(sql`lower(${cashTransactions.code})`, part));
    for (const h of hit) {
      errors.push({
        row: rowOfCode.get(h.code.toLowerCase()) ?? 0,
        field: 'Mã phiếu',
        message: `Mã phiếu "${h.code}" đã có trong hệ thống`,
      });
    }
  }
  if (errors.length > 0) return { created: 0, updated: 0, errors, warnings };

  // ---- đối chiếu tổng kết cuối file
  const sum = (d: 'in' | 'out') =>
    parsed.filter((p) => p.direction === d).reduce((s, p) => s + BigInt(p.amount), 0n);
  const totalIn = sum('in');
  const totalOut = sum('out');
  if (summary.totalIn !== undefined && summary.totalIn !== totalIn) {
    errors.push({ row: 0, field: 'Tổng thu', message: `Tổng thu các phiếu (${totalIn}) khác dòng "Tổng thu" của file (${summary.totalIn})` });
  }
  if (summary.totalOut !== undefined && summary.totalOut !== totalOut && summary.totalOut !== -totalOut) {
    errors.push({ row: 0, field: 'Tổng chi', message: `Tổng chi các phiếu (${totalOut}) khác dòng "Tổng chi" của file (${summary.totalOut})` });
  }
  let opening = BigInt(account.openingBalance);
  if (summary.opening !== undefined) {
    if (accountEmpty) {
      opening = summary.opening;
    } else {
      warnings.push({ row: 0, field: 'Quỹ đầu kỳ', message: `Quỹ "${account.name}" đã có phiếu nên giữ nguyên quỹ đầu kỳ, bỏ qua dòng "Quỹ đầu kỳ" của file` });
    }
  }
  if (summary.closing !== undefined) {
    if (accountEmpty) {
      const closing = opening + totalIn - totalOut;
      if (closing !== summary.closing) {
        errors.push({ row: 0, field: 'Tồn quỹ', message: `Tồn quỹ tính được (${closing}) khác dòng "Tồn quỹ" của file (${summary.closing})` });
      }
    } else {
      warnings.push({ row: 0, field: 'Tồn quỹ', message: 'Quỹ đã có phiếu nên không đối chiếu được tồn quỹ cuối của file' });
    }
  }
  if (opening < 0n) {
    errors.push({ row: 0, field: 'Quỹ đầu kỳ', message: 'Quỹ đầu kỳ không được âm' });
  }
  if (errors.length > 0) return { created: 0, updated: 0, errors, warnings };

  // ---- ghi
  // Nâng bộ đếm mã lên số lớn nhất của file + 1 để mã tự cấp sau này không trùng. PHẢI làm TRƯỚC khi ghi phiếu: người
  // lập phiếu giữ dòng bộ đếm rồi chờ đúng mã mình vừa lấy; nếu ta đã ghi mã đó mà còn chờ dòng bộ đếm thì hai bên kẹt khóa
  // (deadlock). Lấy dòng bộ đếm trước thì bên kia chỉ phải chờ, không có vòng chờ.
  for (const prefix of [DOCUMENT_PREFIX.cashIn, DOCUMENT_PREFIX.cashOut]) {
    let max = 0;
    for (const p of parsed) {
      const m = new RegExp(`^${prefix}(\\d+)$`, 'i').exec(p.code);
      if (m) max = Math.max(max, Number(m[1]));
    }
    if (max > 0) {
      await tx
        .update(codeSequences)
        .set({
          nextValue: sql`greatest(${codeSequences.nextValue}, ${max + 1})`,
          updatedAt: new Date(),
        })
        .where(eq(codeSequences.prefix, prefix));
    }
  }
  let updated = 0;
  if (summary.opening !== undefined && accountEmpty && opening !== BigInt(account.openingBalance)) {
    await tx
      .update(cashAccounts)
      .set({ openingBalance: opening.toString(), updatedAt: new Date() })
      .where(eq(cashAccounts.id, account.id));
    updated = 1;
  }
  for (const part of chunk(parsed, BATCH)) {
    await tx.insert(cashTransactions).values(
      part.map((p) => ({
        code: p.code,
        branchId: opts.branchId,
        direction: p.direction,
        amount: p.amount,
        categoryId: p.categoryId,
        accountId: account.id,
        occurredAt: p.at,
        partyName: p.partyName,
        vehicleRef: p.vehicleRef,
        refType: 'import',
        refId: opts.ref.id,
        status: 'completed' as const,
        note: p.note,
        createdBy: opts.userId,
      })),
    );
  }
  return { created: parsed.length, updated, errors, warnings };
}

/** Số nguyên đồng (có thể âm) từ ô; lỗi → undefined; ô trống → null. */
function asMoney(v: CellValue | undefined): bigint | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isInteger(v) ? BigInt(v) : undefined;
  const s = String(v).trim().replace(/[.,\s]/g, '');
  return /^-?\d{1,15}$/.test(s) ? BigInt(s) : undefined;
}

/**
 * Thời gian của phiếu. Ô ngày giờ Excel được đọc thành chuỗi ISO có GIỜ TƯỜNG (KiotViet xuất giờ Việt Nam, không kèm
 * múi giờ) nên trừ 7 giờ để ra UTC; cũng nhận chuỗi `dd/MM/yyyy HH:mm[:ss]`.
 */
function parseWhen(v: CellValue | undefined): Date | null {
  if (typeof v !== 'string') return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(v);
  const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  let y: number;
  let mo: number;
  let d: number;
  let h: number;
  let mi: number;
  let s: number;
  if (iso) {
    y = Number(iso[1]);
    mo = Number(iso[2]);
    d = Number(iso[3]);
    h = Number(iso[4]);
    mi = Number(iso[5]);
    s = Number(iso[6]);
  } else if (vn) {
    d = Number(vn[1]);
    mo = Number(vn[2]);
    y = Number(vn[3]);
    h = Number(vn[4] ?? 0);
    mi = Number(vn[5] ?? 0);
    s = Number(vn[6] ?? 0);
  } else {
    return null;
  }
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(wall);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null; // ngày không có thật (31/02)
  return new Date(wall - VN_OFFSET_MS);
}
