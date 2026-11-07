import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { dec } from '../../common/costing.js';
import { writeSheet, type CellValue } from '../../common/excel.js';
import { formatVnDateTime } from '../../common/vn-date.js';
import type { DbOrTx } from '../../db/database.module.js';
import { customerBranchTerms, debtLedger, invoices } from '../../db/schema/index.js';
import {
  allocatedExpr,
  outstandingExpr,
  returnedExpr,
} from '../sales/invoice-balance.js';
import type {
  CustomerAgingDto,
  CustomerStatementDto,
  CustomerStatementLineDto,
  StatementKind,
} from './customers-statement.dto.js';

const DAY_MS = 24 * 3600 * 1000;
const VN_OFFSET_MS = 7 * 3600 * 1000;

/** Nhãn tiếng Việt của từng loại dòng sao kê. */
export const STATEMENT_LABEL: Record<StatementKind, string> = {
  opening: 'Nợ đầu kỳ',
  invoice: 'Hóa đơn',
  invoice_cancel: 'Hủy hóa đơn',
  sales_return: 'Trả hàng',
  sales_return_cancel: 'Hủy phiếu trả hàng',
  receipt: 'Thu nợ',
  refund: 'Hoàn tiền khách',
  cash_cancel: 'Hủy phiếu thu/chi',
  adjustment: 'Điều chỉnh',
};

/** Ngày (YYYY-MM-DD) theo giờ Việt Nam của một thời điểm. */
const vnDay = (d: Date): string => new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

/** Loại dòng sao kê theo (chứng từ gốc, loại bút toán, dấu). */
export function statementKind(
  refType: string | null,
  entryType: string,
  amount: string,
): StatementKind {
  if (entryType === 'opening') return 'opening';
  if (refType === 'invoice') return entryType === 'adjustment' ? 'invoice_cancel' : 'invoice';
  if (refType === 'sales_return') {
    return entryType === 'adjustment' ? 'sales_return_cancel' : 'sales_return';
  }
  if (refType === 'cash_transaction') {
    if (entryType === 'adjustment') return 'cash_cancel';
    return dec(amount).isNegative() ? 'receipt' : 'refund';
  }
  return 'adjustment';
}

// ------------------------------------------------------------------ tuổi nợ

export async function buildAging(
  db: DbOrTx,
  customerId: string,
  branchId: string,
): Promise<CustomerAgingDto> {
  const today = vnDay(new Date());
  const [terms] = await db
    .select({ days: customerBranchTerms.paymentTermDays })
    .from(customerBranchTerms)
    .where(
      and(
        eq(customerBranchTerms.customerId, customerId),
        eq(customerBranchTerms.branchId, branchId),
      ),
    );
  const termDays = terms?.days ?? null;
  const rows = await db
    .select({
      id: invoices.id,
      code: invoices.code,
      invoicedAt: invoices.invoicedAt,
      total: invoices.total,
      paidTotal: invoices.paidTotal,
      allocated: allocatedExpr,
      returned: returnedExpr,
      outstanding: outstandingExpr,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.customerId, customerId),
        eq(invoices.branchId, branchId),
        eq(invoices.status, 'completed'),
        sql`${outstandingExpr} > 0`,
      ),
    )
    .orderBy(asc(invoices.invoicedAt), asc(invoices.code));

  const buckets = { d0_30: dec(0), d31_60: dec(0), d61_90: dec(0), over90: dec(0) };
  let invoiceTotal = dec(0);
  const list = rows.map((r) => {
    const day = vnDay(r.invoicedAt);
    const ageDays = Math.max(
      0,
      Math.round((Date.parse(today) - Date.parse(day)) / DAY_MS),
    );
    const due = termDays === null ? null : new Date(Date.parse(day) + termDays * DAY_MS).toISOString().slice(0, 10);
    const out = dec(r.outstanding);
    invoiceTotal = invoiceTotal.plus(out);
    const key = ageDays <= 30 ? 'd0_30' : ageDays <= 60 ? 'd31_60' : ageDays <= 90 ? 'd61_90' : 'over90';
    buckets[key] = buckets[key].plus(out);
    return {
      invoiceId: r.id,
      code: r.code,
      invoicedAt: r.invoicedAt.toISOString(),
      total: dec(r.total).toFixed(0),
      paid: dec(r.paidTotal).plus(dec(r.allocated)).toFixed(0),
      returned: dec(r.returned).toFixed(0),
      outstanding: out.toFixed(0),
      ageDays,
      dueDate: due,
      overdue: due !== null && today > due,
    };
  });
  const [sum] = await db
    .select({ v: sql<string>`coalesce(sum(${debtLedger.amount}), 0)` })
    .from(debtLedger)
    .where(
      and(
        eq(debtLedger.partyType, 'customer'),
        eq(debtLedger.partyId, customerId),
        eq(debtLedger.branchId, branchId),
      ),
    );
  const balance = dec(sum!.v);
  return {
    branchId,
    asOf: today,
    invoices: list,
    buckets: {
      d0_30: buckets.d0_30.toFixed(0),
      d31_60: buckets.d31_60.toFixed(0),
      d61_90: buckets.d61_90.toFixed(0),
      over90: buckets.over90.toFixed(0),
    },
    invoiceTotal: invoiceTotal.toFixed(0),
    balance: balance.toFixed(0),
    notAllocated: balance.minus(invoiceTotal).toFixed(0),
  };
}

// ------------------------------------------------------------------ sao kê

/**
 * Dựng sao kê từ sổ công nợ (nguồn duy nhất của nợ). Bút toán xuất hóa đơn (+tổng) và thu ngay lúc xuất (−đã thu) của
 * cùng một hóa đơn gộp thành MỘT dòng "Hóa đơn" (tăng = tổng, giảm = đã thu lúc xuất); các bút toán khác mỗi bút toán một dòng.
 */
export async function buildStatementLines(
  db: DbOrTx,
  customerId: string,
  branchId: string,
  range: { start?: Date; endExclusive?: Date },
): Promise<{
  openingBalance: string;
  lines: CustomerStatementLineDto[];
  totals: { increase: string; decrease: string };
  closingBalance: string;
}> {
  const base = and(
    eq(debtLedger.partyType, 'customer'),
    eq(debtLedger.partyId, customerId),
    eq(debtLedger.branchId, branchId),
  );
  let opening = dec(0);
  if (range.start) {
    const [sum] = await db
      .select({ v: sql<string>`coalesce(sum(${debtLedger.amount}), 0)` })
      .from(debtLedger)
      .where(and(base, lt(debtLedger.occurredAt, range.start)));
    opening = dec(sum!.v);
  }
  const entries = await db
    .select()
    .from(debtLedger)
    .where(
      and(
        base,
        range.start ? gte(debtLedger.occurredAt, range.start) : undefined,
        range.endExclusive ? lt(debtLedger.occurredAt, range.endExclusive) : undefined,
      ),
    )
    .orderBy(asc(debtLedger.occurredAt), asc(debtLedger.createdAt), asc(debtLedger.id));

  interface Group {
    first: (typeof entries)[number];
    kind: StatementKind;
    increase: ReturnType<typeof dec>;
    decrease: ReturnType<typeof dec>;
  }
  const groups: Group[] = [];
  const invoiceGroup = new Map<string, Group>();
  for (const e of entries) {
    const kind = statementKind(e.refType, e.entryType, e.amount);
    const amount = dec(e.amount);
    const up = amount.isPositive() ? amount : dec(0);
    const down = amount.isNegative() ? amount.negated() : dec(0);
    const existing = kind === 'invoice' && e.refId ? invoiceGroup.get(e.refId) : undefined;
    if (existing) {
      existing.increase = existing.increase.plus(up);
      existing.decrease = existing.decrease.plus(down);
      continue;
    }
    const g: Group = { first: e, kind, increase: up, decrease: down };
    groups.push(g);
    if (kind === 'invoice' && e.refId) invoiceGroup.set(e.refId, g);
  }

  let balance = opening;
  let totalUp = dec(0);
  let totalDown = dec(0);
  const lines = groups.map((g) => {
    balance = balance.plus(g.increase).minus(g.decrease);
    totalUp = totalUp.plus(g.increase);
    totalDown = totalDown.plus(g.decrease);
    return {
      occurredAt: g.first.occurredAt.toISOString(),
      kind: g.kind,
      refType: g.first.refType,
      refId: g.first.refId,
      refCode: g.first.refCode,
      description: g.first.refCode
        ? `${STATEMENT_LABEL[g.kind]} ${g.first.refCode}`
        : STATEMENT_LABEL[g.kind],
      increase: g.increase.toFixed(0),
      decrease: g.decrease.toFixed(0),
      balance: balance.toFixed(0),
      note: g.first.note,
    };
  });
  return {
    openingBalance: opening.toFixed(0),
    lines,
    totals: { increase: totalUp.toFixed(0), decrease: totalDown.toFixed(0) },
    closingBalance: balance.toFixed(0),
  };
}

/** Excel biên bản đối chiếu: nợ đầu kỳ, các dòng, cộng phát sinh, nợ cuối kỳ. */
export function statementXlsx(s: CustomerStatementDto): Promise<Buffer> {
  const rows: CellValue[][] = [
    [null, null, 'Nợ đầu kỳ', null, null, Number(s.openingBalance)],
    ...s.lines.map((l): CellValue[] => [
      formatVnDateTime(l.occurredAt),
      l.refCode,
      l.description,
      Number(l.increase),
      Number(l.decrease),
      Number(l.balance),
    ]),
    [null, null, 'Cộng phát sinh', Number(s.totals.increase), Number(s.totals.decrease), null],
    [null, null, 'Nợ cuối kỳ', null, null, Number(s.closingBalance)],
  ];
  return writeSheet(
    'Đối chiếu công nợ',
    [
      { header: 'Ngày', width: 18 },
      { header: 'Chứng từ', width: 14 },
      { header: 'Diễn giải', width: 36 },
      { header: 'Phát sinh tăng', width: 16 },
      { header: 'Phát sinh giảm', width: 16 },
      { header: 'Còn nợ', width: 16 },
    ],
    rows,
  );
}
