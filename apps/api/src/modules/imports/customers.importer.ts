import {
  CUSTOMER_PRICE_LEVELS,
  CUSTOMER_SALES_METHODS,
  DOCUMENT_PREFIX,
  normalizeVnPhone,
  type CustomerPriceLevel,
} from '@kiot/shared';
import { eq, inArray } from 'drizzle-orm';
import {
  normalizeHeader,
  type CellValue,
  type ParsedSheet,
} from '../../common/excel.js';
import { lockCustomerImport } from '../../common/advisory-lock.js';
import { nextFreeDocumentCode } from '../../db/code-sequence.js';
import type { Tx } from '../../db/database.module.js';
import {
  branches,
  customerProfiles,
  customerVisits,
  customers,
  debtLedger,
  users,
} from '../../db/schema/index.js';
import { CUSTOMER_CODE_PATTERN } from '../customers/customers.dto.js';
import { canonicalMethods, isRealDate, todayVn } from '../customers/customers.service.js';
import {
  asFlag,
  asNonNegInt,
  asText,
  chunk,
  hasColumn,
  pick,
  type ImportOutcome,
  type ImportRowError,
} from './import-cells.js';

/** Tên cột (đã chuẩn hóa) theo file TKS_Bao_cao_kinh_doanh_customers. */
const COL = {
  code: ['ma khach hang'],
  name: ['ten khach', 'ten khach hang'],
  sale: ['sale'],
  level: ['level gia'],
  fresh: ['khach moi'],
  lastVisit: ['tiep khach lan cuoi'],
  phone: ['dien thoai'],
  address: ['dia chi'],
  location: ['dinh vi kho'],
  count: ['so luong kho'],
  area: ['dien tich'],
  competitors: ['doi thu'],
  methods: ['hinh thuc ban hang'],
  scale: ['quy mo khach'],
  visits: ['cac ngay tiep khach'],
  photo: ['anh kho'],
  status: ['trang thai'],
  note: ['ghi chu'],
} as const;
const DEBT_PREFIX = 'cong no ';
const BATCH = 500;
const MAX_WH_COUNT = 1000;

export interface CustomerImportOptions {
  userId: string;
  /** Chứng từ gốc của bút toán công nợ đầu kỳ (mã `IMP-…`, id = id lần nhập). */
  ref: { id: string; code: string };
  /** Chi nhánh người nhập được ghi công nợ đầu kỳ (cần debt.view tất cả + truy cập chi nhánh); rỗng = không được. */
  debtBranchIds: string[];
}

interface ProfileFields {
  warehouseLocation?: string;
  warehouseCount?: number;
  warehouseArea?: string;
  warehousePhotoUrl?: string;
  competitors?: string;
  salesMethods?: string[];
  /** null = ô ghi "Chưa có" (xóa quy mô). */
  scale?: string | null;
}

interface ParsedRow {
  row: number;
  code?: string;
  name: string;
  saleId?: string;
  level?: CustomerPriceLevel;
  hasFresh: boolean;
  newSince: string | null;
  source: string | null;
  phone?: string;
  address?: string;
  note?: string;
  active?: boolean;
  profile: ProfileFields;
  visits: string[];
  debts: Array<{ branchId: string; branchName: string; amount: string }>;
}

const LEVEL_BY_TEXT = new Map<string, CustomerPriceLevel>(
  (Object.entries(CUSTOMER_PRICE_LEVELS) as Array<[CustomerPriceLevel, string]>).flatMap(
    ([code, label]) => [
      [normalizeHeader(label), code] as const,
      [code, code] as const,
    ],
  ),
);
const METHOD_BY_TEXT = new Map<string, string>(
  CUSTOMER_SALES_METHODS.map((m) => [normalizeHeader(m), m] as const),
);
const ACTIVE_TEXT = new Set(['dang hoat dong', 'hoat dong', 'dang kinh doanh', 'active']);
const INACTIVE_TEXT = new Set([
  'ngung',
  'ngung hoat dong',
  'ngung kinh doanh',
  'ngung giao dich',
  'inactive',
]);

const keyOf = (name: string) => normalizeHeader(name);

/**
 * Nhập khách hàng từ Excel (cột theo file TKS). Ghép dòng với khách hiện có theo MÃ (nếu có) hoặc theo TÊN (không dấu,
 * không phân biệt hoa thường); không ghép được thì tạo mới. Chạy lại cùng file không tạo trùng.
 *
 * Ô TRỐNG = để nguyên (khi cập nhật) / giá trị mặc định (khi tạo). Cột "Công nợ <chi nhánh>" ghi bút toán công nợ ĐẦU
 * KỲ cho từng chi nhánh và CHỈ cho khách tạo mới (cập nhật khách có sẵn mà có ô nợ → lỗi, tránh ghi đầu kỳ hai lần).
 * Số điện thoại trùng khách khác chỉ cảnh báo. Kiểm tra toàn bộ file trước; có lỗi thì KHÔNG ghi gì. Phải chạy trong
 * transaction của người gọi.
 */
export async function importCustomers(
  tx: Tx,
  sheet: ParsedSheet,
  opts: CustomerImportOptions,
): Promise<ImportOutcome> {
  // ĐẦU TIÊN: các lần nhập khách chạy lần lượt (xem lockCustomerImport), rồi mới đọc khách hiện có
  await lockCustomerImport(tx);
  const errors: ImportRowError[] = [];
  const warnings: ImportRowError[] = [];
  const headers = sheet.headers;
  if (!hasColumn(headers, COL.name)) {
    errors.push({
      row: 1,
      field: 'Tên khách',
      message: 'Thiếu cột bắt buộc "Tên khách"',
    });
  }

  // ---- nạp dữ liệu tham chiếu
  const branchRows = await tx.select().from(branches);
  const debtColumns = new Map<string, { id: string; name: string }>(); // tiêu đề chuẩn hóa -> chi nhánh
  for (const h of headers.filter((x) => x.startsWith(DEBT_PREFIX))) {
    const rest = h.slice(DEBT_PREFIX.length).trim();
    const b = branchRows.find(
      (x) =>
        normalizeHeader(x.name.replace(/^chi nhánh\s+/i, '')) === rest ||
        normalizeHeader(x.code) === rest,
    );
    if (!b) {
      errors.push({
        row: 1,
        field: h,
        message: `Không nhận ra chi nhánh trong tên cột "${h}"`,
      });
    } else {
      debtColumns.set(h, { id: b.id, name: b.name });
    }
  }
  const userRows = await tx
    .select({ id: users.id, code: users.code, fullName: users.fullName, role: users.role, isActive: users.isActive })
    .from(users);
  const usersByKey = new Map<string, string[]>();
  for (const u of userRows) {
    if (!u.isActive || u.role === 'pending') continue;
    for (const k of new Set([keyOf(u.fullName), u.code.toLowerCase()])) {
      usersByKey.set(k, [...(usersByKey.get(k) ?? []), u.id]);
    }
  }
  const existing = await tx.select().from(customers);
  const usedCodes = new Set(existing.map((c) => c.code.toLowerCase()));
  const byCode = new Map(existing.filter((c) => !c.deletedAt && !c.linkedBranchId).map((c) => [c.code.toLowerCase(), c]));
  const byName = new Map<string, typeof existing>();
  for (const c of existing) {
    if (c.deletedAt || c.linkedBranchId) continue;
    const k = keyOf(c.name);
    byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  const byPhone = new Map<string, typeof existing>();
  for (const c of existing) {
    if (c.deletedAt || !c.phone) continue;
    byPhone.set(c.phone, [...(byPhone.get(c.phone) ?? []), c]);
  }

  // ---- đọc từng dòng
  const parsed: ParsedRow[] = [];
  const today = todayVn();
  for (const { row, values } of sheet.rows) {
    const err = (field: string, message: string) => errors.push({ row, field, message });
    const name = asText(pick(values, COL.name));
    if (!name) {
      err('Tên khách', 'Thiếu tên khách');
      continue;
    }
    if (name.length > 255) err('Tên khách', 'Tên khách dài quá 255 ký tự');
    const p: ParsedRow = { row, name, hasFresh: false, newSince: null, source: null, profile: {}, visits: [], debts: [] };

    const code = asText(pick(values, COL.code));
    if (code) {
      if (!CUSTOMER_CODE_PATTERN.test(code)) err('Mã Khách hàng', 'Mã chỉ gồm chữ, số, "-", "_", "." và dài 1-30 ký tự');
      else p.code = code;
    }

    const sale = asText(pick(values, COL.sale));
    if (sale) {
      const found = usersByKey.get(keyOf(sale)) ?? [];
      if (found.length === 0) err('Sale', `Không tìm thấy nhân viên "${sale}" (cần tạo tài khoản trước, tên phải trùng họ tên)`);
      else if (found.length > 1) err('Sale', `Có ${found.length} nhân viên trùng tên "${sale}"`);
      else p.saleId = found[0];
    }

    const level = asText(pick(values, COL.level));
    if (level) {
      const lv = LEVEL_BY_TEXT.get(keyOf(level));
      if (!lv) err('Level giá', `Level giá "${level}" không hợp lệ (Mới, Vừa, Lớn, Vip)`);
      else p.level = lv;
    }

    const fresh = asText(pick(values, COL.fresh));
    if (fresh) {
      const m = /^T(\d{1,2})\/(\d{2})(?:\s*-\s*(.+))?$/i.exec(fresh);
      const old = /^c[uũ](?:\s*-\s*(.+))?$/i.exec(fresh);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
        p.hasFresh = true;
        p.newSince = `20${m[2]}-${String(Number(m[1])).padStart(2, '0')}-01`;
        p.source = m[3]?.trim() || null;
      } else if (old) {
        p.hasFresh = true;
        p.newSince = null;
        p.source = old[1]?.trim() || null;
      } else {
        err('Khách mới', `"${fresh}" không hợp lệ (vd T6/26, T6/26-Page, Cũ)`);
      }
    }

    // Điện thoại: lấy số hợp lệ đầu tiên, các số còn lại ghi vào ghi chú
    const rawPhone = asText(pick(values, COL.phone));
    const extra: string[] = [];
    let badPhone: string | null = null;
    if (rawPhone) {
      const phones = splitPhones(rawPhone);
      if (phones.length === 0) {
        // Số rác ("555", "0"…): không chặn cả file; giữ nguyên văn trong ghi chú và cảnh báo để sửa sau
        warnings.push({
          row,
          field: 'Điện thoại',
          message: `Số điện thoại "${rawPhone.slice(0, 40)}" không hợp lệ, đã đưa vào ghi chú`,
        });
        badPhone = rawPhone.slice(0, 100);
      } else {
        p.phone = phones[0];
        extra.push(...phones.slice(1));
      }
    }
    p.address = asText(pick(values, COL.address)) ?? undefined;
    const note = asText(pick(values, COL.note));
    const noteParts = [
      note,
      extra.length > 0 ? `SĐT khác: ${extra.join(', ')}` : null,
      badPhone ? `SĐT gốc: ${badPhone}` : null,
    ].filter((x): x is string => !!x);
    if (noteParts.length > 0) p.note = noteParts.join('. ');

    const status = pick(values, COL.status);
    if (status !== undefined && asText(status) !== null) {
      const flag = asFlag(status);
      const txt = keyOf(String(status));
      if (flag !== null && flag !== undefined) p.active = flag;
      else if (ACTIVE_TEXT.has(txt)) p.active = true;
      else if (INACTIVE_TEXT.has(txt)) p.active = false;
      else err('Trạng thái', `Trạng thái "${String(status)}" không hợp lệ`);
    }

    // Hồ sơ kho
    const loc = asText(pick(values, COL.location));
    if (loc) p.profile.warehouseLocation = loc;
    const cnt = pick(values, COL.count);
    if (cnt !== undefined && asText(cnt) !== null) {
      const n = asNonNegInt(cnt);
      if (n === undefined || n === null || n > MAX_WH_COUNT) err('Số lượng kho', `Số lượng kho phải là số nguyên từ 0 đến ${MAX_WH_COUNT}`);
      else p.profile.warehouseCount = n;
    }
    const area = asText(pick(values, COL.area));
    if (area) p.profile.warehouseArea = area.slice(0, 200);
    const comp = asText(pick(values, COL.competitors));
    if (comp) p.profile.competitors = comp;
    const methods = asText(pick(values, COL.methods));
    if (methods) {
      const out: string[] = [];
      for (const part of methods.split(/[,;/\n]+/).map((x) => x.trim()).filter(Boolean)) {
        const m = METHOD_BY_TEXT.get(keyOf(part));
        if (!m) err('Hình thức bán hàng', `"${part}" không thuộc danh sách (${CUSTOMER_SALES_METHODS.join(', ')})`);
        else out.push(m);
      }
      p.profile.salesMethods = canonicalMethods(out);
    }
    const scale = asText(pick(values, COL.scale));
    if (scale) p.profile.scale = keyOf(scale) === 'chua co' ? null : scale.slice(0, 100);
    const photo = asText(pick(values, COL.photo));
    if (photo) {
      if (/^https?:\/\/\S+$/i.test(photo)) p.profile.warehousePhotoUrl = photo;
      else
        warnings.push({
          row,
          field: 'Ảnh kho',
          message: 'Ảnh kho không phải đường link http(s), đã bỏ qua',
        });
    }

    // Ngày tiếp khách
    const dayTexts = [
      ...tokens(pick(values, COL.lastVisit)),
      ...tokens(pick(values, COL.visits)),
    ];
    for (const d of dayTexts) {
      const iso = parseVnDate(d);
      if (!iso) err('Các ngày tiếp khách', `Ngày "${String(d)}" không hợp lệ (dd/mm/yyyy)`);
      else if (iso > today) err('Các ngày tiếp khách', `Ngày ${String(d)} ở tương lai`);
      else if (!p.visits.includes(iso)) p.visits.push(iso);
    }

    // Công nợ đầu kỳ
    for (const [h, b] of debtColumns) {
      const cell = values[h];
      if (cell === undefined || asText(cell) === null) continue;
      const amount = asMoneyInt(cell);
      if (amount === undefined || amount === null) {
        err(h, `Công nợ "${String(cell)}" phải là số nguyên đồng`);
      } else if (Number(amount) !== 0) {
        if (!opts.debtBranchIds.includes(b.id)) {
          err(
            h,
            opts.debtBranchIds.length === 0
              ? 'Bạn không có quyền ghi công nợ đầu kỳ khi nhập khách (cần quyền customer.debt.opening)'
              : `Bạn không có quyền ghi công nợ đầu kỳ của ${b.name}`,
          );
        } else {
          p.debts.push({ branchId: b.id, branchName: b.name, amount });
        }
      }
    }
    parsed.push(p);
  }

  // ---- ghép với khách hiện có, phát hiện trùng trong file
  type Match = { p: ParsedRow; existing?: (typeof existing)[number] };
  const matches: Match[] = [];
  const seenCodes = new Map<string, number>();
  const seenNames = new Map<string, number>();
  const seenIds = new Map<string, number>();
  for (const p of parsed) {
    const err = (field: string, message: string) => errors.push({ row: p.row, field, message });
    let ex: (typeof existing)[number] | undefined;
    if (p.code) {
      const k = p.code.toLowerCase();
      if (seenCodes.has(k)) {
        err('Mã Khách hàng', `Mã trùng với dòng ${seenCodes.get(k)} trong file`);
        continue;
      }
      seenCodes.set(k, p.row);
      ex = byCode.get(k);
      if (!ex && usedCodes.has(k)) {
        err('Mã Khách hàng', 'Mã này đã thuộc khách hàng khác (khách hệ thống hoặc đã xóa)');
        continue;
      }
    } else {
      const k = keyOf(p.name);
      const found = byName.get(k) ?? [];
      if (found.length > 1) {
        err('Tên khách', `Có ${found.length} khách trùng tên này, hãy ghi Mã Khách hàng để xác định`);
        continue;
      }
      if (seenNames.has(k)) {
        err('Tên khách', `Tên trùng với dòng ${seenNames.get(k)} trong file (không có mã để phân biệt)`);
        continue;
      }
      seenNames.set(k, p.row);
      ex = found[0];
    }
    if (ex) {
      if (seenIds.has(ex.id)) {
        err('Tên khách', `Trùng khách ${ex.code} với dòng ${seenIds.get(ex.id)} trong file`);
        continue;
      }
      seenIds.set(ex.id, p.row);
      if (p.debts.length > 0) {
        err('Công nợ', `Khách ${ex.code} đã có; công nợ đầu kỳ chỉ ghi khi tạo khách mới`);
        continue;
      }
    }
    matches.push({ p, existing: ex });
  }

  // ---- cảnh báo số điện thoại trùng
  const filePhones = new Map<string, number>();
  for (const { p, existing: ex } of matches) {
    if (!p.phone) continue;
    const others = (byPhone.get(p.phone) ?? []).filter((c) => c.id !== ex?.id);
    const earlier = filePhones.get(p.phone);
    if (others.length > 0) {
      warnings.push({
        row: p.row,
        field: 'Điện thoại',
        message: `Số điện thoại trùng khách ${others.slice(0, 3).map((c) => c.code).join(', ')}${others.length > 3 ? '…' : ''}`,
      });
    } else if (earlier !== undefined) {
      warnings.push({ row: p.row, field: 'Điện thoại', message: `Số điện thoại trùng dòng ${earlier} trong file` });
    }
    if (earlier === undefined) filePhones.set(p.phone, p.row);
  }

  if (errors.length > 0) return { created: 0, updated: 0, errors, warnings };

  // ---- ghi
  const updateIds = matches.filter((m) => m.existing).map((m) => m.existing!.id);
  const profiles = new Map<string, typeof customerProfiles.$inferSelect>();
  const visitKeys = new Set<string>();
  for (const part of chunk(updateIds, 1000)) {
    for (const pr of await tx.select().from(customerProfiles).where(inArray(customerProfiles.customerId, part))) {
      profiles.set(pr.customerId, pr);
    }
    for (const v of await tx.select({ c: customerVisits.customerId, d: customerVisits.visitedOn }).from(customerVisits).where(inArray(customerVisits.customerId, part))) {
      visitKeys.add(`${v.c}|${v.d}`);
    }
  }

  let created = 0;
  let updated = 0;
  const newRows: Array<{ p: ParsedRow; code: string }> = [];
  const visitInserts: Array<typeof customerVisits.$inferInsert> = [];
  const profileUpserts: Array<typeof customerProfiles.$inferInsert> = [];
  const debtById = new Map<string, ParsedRow['debts']>();

  for (const { p, existing: ex } of matches) {
    if (!ex) {
      const code =
        p.code ??
        (await nextFreeDocumentCode(tx, DOCUMENT_PREFIX.customer, async (c) => {
          if (usedCodes.has(c.toLowerCase())) return true;
          usedCodes.add(c.toLowerCase());
          return false;
        }));
      usedCodes.add(code.toLowerCase());
      newRows.push({ p, code });
      continue;
    }
    // cập nhật: chỉ các ô có giá trị; chỉ tính khi thật sự đổi
    const patch: Partial<typeof customers.$inferInsert> = {};
    if (p.name !== ex.name) patch.name = p.name;
    if (p.phone !== undefined && p.phone !== ex.phone) patch.phone = p.phone;
    if (p.address !== undefined && p.address !== ex.address) patch.address = p.address;
    if (p.note !== undefined && p.note !== ex.note) patch.note = p.note;
    if (p.saleId !== undefined && p.saleId !== ex.salesOwnerId) patch.salesOwnerId = p.saleId;
    if (p.level !== undefined && p.level !== ex.priceLevel) patch.priceLevel = p.level;
    if (p.active !== undefined && p.active !== ex.isActive) patch.isActive = p.active;
    if (p.hasFresh) {
      if (p.newSince !== ex.newSince) patch.newSince = p.newSince;
      if (p.source !== ex.acquisitionSource) patch.acquisitionSource = p.source;
    }
    let changed = Object.keys(patch).length > 0;
    if (changed) {
      patch.updatedAt = new Date();
      await tx.update(customers).set(patch).where(eq(customers.id, ex.id));
    }
    const merged = mergeProfile(profiles.get(ex.id), p.profile);
    if (merged.changed && merged.value) {
      profileUpserts.push({ customerId: ex.id, ...merged.value });
      changed = true;
    }
    for (const d of p.visits) {
      if (!visitKeys.has(`${ex.id}|${d}`)) {
        visitInserts.push({ customerId: ex.id, visitedOn: d, createdBy: opts.userId });
        changed = true;
      }
    }
    if (changed) updated++;
  }

  for (const part of chunk(newRows, BATCH)) {
    const inserted = await tx
      .insert(customers)
      .values(
        part.map(({ p, code }) => ({
          code,
          name: p.name,
          phone: p.phone ?? null,
          address: p.address ?? null,
          note: p.note ?? null,
          salesOwnerId: p.saleId ?? null,
          priceLevel: p.level ?? 'new',
          newSince: p.hasFresh ? p.newSince : null,
          acquisitionSource: p.hasFresh ? p.source : null,
          isActive: p.active ?? true,
          createdBy: opts.userId,
        })),
      )
      .returning({ id: customers.id, code: customers.code });
    const idByCode = new Map(inserted.map((r) => [r.code, r.id]));
    for (const { p, code } of part) {
      const id = idByCode.get(code)!;
      created++;
      const merged = mergeProfile(undefined, p.profile);
      if (merged.value) profileUpserts.push({ customerId: id, ...merged.value });
      for (const d of p.visits) visitInserts.push({ customerId: id, visitedOn: d, createdBy: opts.userId });
      if (p.debts.length > 0) debtById.set(id, p.debts);
    }
  }

  for (const part of chunk(profileUpserts, BATCH)) {
    for (const pr of part) {
      await tx
        .insert(customerProfiles)
        .values(pr)
        .onConflictDoUpdate({ target: customerProfiles.customerId, set: { ...pr, updatedAt: new Date() } });
    }
  }
  for (const part of chunk(visitInserts, BATCH)) {
    await tx.insert(customerVisits).values(part).onConflictDoNothing();
  }
  const ledger = [...debtById].flatMap(([customerId, debts]) =>
    debts.map((d) => ({
      branchId: d.branchId,
      partyType: 'customer' as const,
      partyId: customerId,
      entryType: 'opening' as const,
      refType: 'import',
      refId: opts.ref.id,
      refCode: opts.ref.code,
      amount: d.amount,
      occurredAt: new Date(),
      note: 'Công nợ đầu kỳ nhập từ file Excel',
      createdBy: opts.userId,
    })),
  );
  for (const part of chunk(ledger, BATCH)) await tx.insert(debtLedger).values(part);

  return { created, updated, errors, warnings };
}

// ---------------------------------------------------------------- hàm thuần

type ProfileValue = Omit<typeof customerProfiles.$inferInsert, 'customerId'>;

/** Gộp các ô có giá trị vào hồ sơ hiện có. `value` null = không có gì để lưu; `changed` = khác hồ sơ cũ. */
function mergeProfile(
  cur: typeof customerProfiles.$inferSelect | undefined,
  f: ProfileFields,
): { value: ProfileValue | null; changed: boolean } {
  const next: ProfileValue = {
    warehouseLocation: f.warehouseLocation ?? cur?.warehouseLocation ?? null,
    warehouseCount: f.warehouseCount ?? cur?.warehouseCount ?? null,
    warehouseArea: f.warehouseArea ?? cur?.warehouseArea ?? null,
    warehousePhotoUrl: f.warehousePhotoUrl ?? cur?.warehousePhotoUrl ?? null,
    competitors: f.competitors ?? cur?.competitors ?? null,
    salesMethods: f.salesMethods ?? cur?.salesMethods ?? [],
    scale: f.scale !== undefined ? f.scale : (cur?.scale ?? null),
  };
  const empty =
    next.warehouseLocation === null &&
    next.warehouseCount === null &&
    next.warehouseArea === null &&
    next.warehousePhotoUrl === null &&
    next.competitors === null &&
    (next.salesMethods?.length ?? 0) === 0 &&
    next.scale === null;
  if (empty) return { value: null, changed: false };
  const same =
    cur !== undefined &&
    cur.warehouseLocation === next.warehouseLocation &&
    cur.warehouseCount === next.warehouseCount &&
    cur.warehouseArea === next.warehouseArea &&
    cur.warehousePhotoUrl === next.warehousePhotoUrl &&
    cur.competitors === next.competitors &&
    (cur.salesMethods ?? []).join('|') === (next.salesMethods ?? []).join('|') &&
    cur.scale === next.scale;
  return { value: next, changed: !same };
}

/**
 * Tách ô điện thoại thành các số hợp lệ. Ô có thể chứa nhãn ("Cường: 035.466.0707/ Quang: 0348058821"), chữ thừa
 * ("dạ 0329 823 483"), nhiều số ngăn bằng `/ , ;` hoặc dính liền (20/30 chữ số = 2/3 số 10 chữ số).
 */
export function splitPhones(raw: string): string[] {
  const out: string[] = [];
  const add = (p: string | null) => {
    if (p && !out.includes(p)) out.push(p);
  };
  for (const m of raw.match(/\+?\d[\d\s.\-()]*\d|\d/g) ?? []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 20 && digits.length % 10 === 0) {
      for (let i = 0; i < digits.length; i += 10) add(normalizeVnPhone(digits.slice(i, i + 10)));
      continue;
    }
    add(
      normalizeVnPhone(m) ??
        (/^\d{9}$/.test(digits) ? normalizeVnPhone('0' + digits) : null),
    );
  }
  return out;
}

/** Số nguyên đồng (được âm) từ ô; ô trống → null; sai định dạng (có phần thập phân, chữ…) → undefined. */
function asMoneyInt(v: CellValue | undefined): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    return Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : undefined;
  }
  const s = String(v).trim().replace(/\s/g, '');
  if (s === '') return null;
  return /^-?\d{1,15}$/.test(s) ? s : undefined;
}

/** Ô ngày: nhiều ngày ngăn bằng dấu phẩy, chấm phẩy, xuống dòng hoặc khoảng trắng. */
function tokens(v: CellValue | undefined): Array<string | number> {
  if (v === null || v === undefined) return [];
  if (typeof v === 'number') return [v];
  return String(v)
    .split(/[,;\n\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** dd/mm/yyyy, d/m/yyyy, yyyy-mm-dd hoặc số ngày của Excel → YYYY-MM-DD; sai → null. */
export function parseVnDate(v: string | number): string | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 1) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }
  const vn = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  let d: string | null = null;
  if (vn) d = `${vn[3]}-${vn[2]!.padStart(2, '0')}-${vn[1]!.padStart(2, '0')}`;
  else if (iso) d = v;
  return d && isRealDate(d) ? d : null;
}

