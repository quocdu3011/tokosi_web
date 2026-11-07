import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeHeader, readSheet } from '../../common/excel.js';
import {
  cashAccounts,
  customers,
  debtLedger,
  products,
} from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { CashModule } from '../cash/cash.module.js';
import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { SalesModule } from '../sales/sales.module.js';
import { CustomersModule } from './customers.module.js';

type Api = Awaited<
  ReturnType<Awaited<ReturnType<typeof createHttpTestApp>>['as']>
>;
const bin = (
  r: { on: (e: string, cb: (x: Buffer) => void) => void },
  cb: (e: null, b: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};
const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const vnDate = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * Khách K1 (do sale1 phụ trách, kỳ hạn công nợ 15 ngày) tại Sài Gòn:
 *  - nợ đầu kỳ 50.000 (01/01/2026), HD1 −10 ngày 20.000 (thu ngay 5.000), HD2 −45 ngày 30.000 (trả hàng 10.000),
 *    HD3 −75 ngày 40.000, HD4 −120 ngày 50.000 (thu nợ tự cấn 25.000), HD5 −5 ngày 10.000 (đã hủy);
 *  - thu nợ trả trước 8.000 không cấn.
 * Còn nợ hóa đơn: HD1 15.000 / HD2 20.000 / HD3 40.000 / HD4 25.000 = 100.000; công nợ theo sổ 142.000;
 * phần không gắn hóa đơn 42.000 (= nợ đầu kỳ 50.000 − trả trước 8.000).
 */
describe('Tuổi nợ và sao kê công nợ của khách qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  const cid: Record<string, string> = {};
  const inv: Record<string, string> = {};
  let cashSg: string;

  beforeAll(async () => {
    t = await createHttpTestApp({
      imports: [IdempotencyModule, CustomersModule, SalesModule, CashModule],
    });
    const sale1 = (await t.makeUser('sale1', 'sales', [t.sg])).id;
    await t.makeUser('tro1', 'assistant', [t.sg, t.hn]);
    await t.makeUser('ketoan1', 'accountant', [t.sg, t.hn]);
    await t.makeUser('kho1', 'warehouse', [t.sg]);
    const product = (await t.db.insert(products).values({ code: 'A', name: 'Hàng A' }).returning())[0]!;
    await t.db.transaction((tx) =>
      new InventoryService(t.db).applyMovements(tx, [
        { branchId: t.sg, productId: product.id, qtyDelta: '1000', unitCost: '100', refType: 'opening' },
      ]),
    );
    for (const c of await t.db
      .insert(customers)
      .values([
        { code: 'K1', name: 'Khách Một', phone: '0900000001', address: '1 Đường A', salesOwnerId: sale1 },
        { code: 'K2', name: 'Khách Hai' },
      ])
      .returning()) {
      cid[c.code] = c.id;
    }
    cashSg = (await t.db.select().from(cashAccounts)).find((a) => a.branchId === t.sg && a.type === 'cash')!.id;
    await (await as('quanly'))
      .put(`/customers/${cid.K1}/branches/${t.sg}/terms`)
      .send({ creditLimit: null, paymentTermDays: 15 })
      .expect(200);
    await t.db.insert(debtLedger).values({
      branchId: t.sg,
      partyType: 'customer',
      partyId: cid.K1!,
      entryType: 'opening',
      refCode: 'IMP-TEST',
      amount: '50000',
      occurredAt: new Date('2026-01-01T03:00:00Z'),
    });
    const mk = async (code: string, qty: string, days: number, extra: Record<string, unknown> = {}) => {
      const r = await idem('tro1', '/invoices', {
        customerId: cid.K1,
        invoicedAt: ago(days),
        items: [{ productId: product.id, qty, price: '10000' }],
        ...extra,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      inv[code] = r.body.id;
    };
    await mk('HD1', '2', 10, { payments: [{ method: 'cash', accountId: cashSg, amount: '5000' }] });
    await mk('HD2', '3', 45);
    await mk('HD3', '4', 75);
    await mk('HD4', '5', 120);
    await mk('HD5', '1', 5);
    const ret = await idem('tro1', '/sales-returns', {
      customerId: cid.K1,
      invoiceId: inv.HD2,
      items: [{ productId: product.id, qty: '1', returnPrice: '10000' }],
    });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    // thu nợ 25.000 tự cấn vào hóa đơn cũ nhất còn nợ (HD4), thu trước 8.000 không cấn
    expect((await idem('ketoan1', `/customers/${cid.K1}/receipts`, { accountId: cashSg, amount: '25000' })).status).toBe(201);
    expect(
      (await idem('ketoan1', `/customers/${cid.K1}/receipts`, { accountId: cashSg, amount: '8000', allocations: [] })).status,
    ).toBe(201);
    await (await as('quanly')).post(`/invoices/${inv.HD5}/cancel`).send({ reason: 'khách đổi ý' }).expect(200);
  }, 90_000);
  afterAll(async () => {
    await t.close();
  });

  const as = (user: string, branch: string = t.sg): Promise<Api> =>
    t.as(user, branch) as Promise<Api>;
  const idem = async (user: string, url: string, body: Record<string, unknown>) =>
    (await as(user)).post(url).send(body).set('Idempotency-Key', randomUUID());
  const get = async (url: string, user = 'quanly', branch: string = t.sg) =>
    (await as(user, branch)).get(url);

  it('tuổi nợ: từng hóa đơn còn nợ (trừ thu ngay, cấn trừ, trả hàng), nhóm tuổi theo ngày hóa đơn, quá hạn theo kỳ hạn', async () => {
    const res = await get(`/customers/${cid.K1}/aging`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const a = res.body;
    expect(a.branchId).toBe(t.sg);
    // cũ nhất trước; HD5 đã hủy không có mặt
    expect(a.invoices.map((i: { invoiceId: string }) => i.invoiceId)).toEqual([inv.HD4, inv.HD3, inv.HD2, inv.HD1]);
    const by = Object.fromEntries(a.invoices.map((i: { invoiceId: string }) => [i.invoiceId, i]));
    expect(by[inv.HD1]).toMatchObject({ total: '20000', paid: '5000', returned: '0', outstanding: '15000', ageDays: 10, overdue: false });
    expect(by[inv.HD2]).toMatchObject({ total: '30000', paid: '0', returned: '10000', outstanding: '20000', ageDays: 45, overdue: true });
    expect(by[inv.HD3]).toMatchObject({ outstanding: '40000', ageDays: 75, overdue: true });
    expect(by[inv.HD4]).toMatchObject({ total: '50000', paid: '25000', outstanding: '25000', ageDays: 120, overdue: true });
    // hạn = ngày hóa đơn + 15 ngày
    expect(by[inv.HD1].dueDate).toBe(vnDate(new Date(Date.parse(ago(10)) + 15 * DAY).toISOString()));
    expect(a.buckets).toEqual({ d0_30: '15000', d31_60: '20000', d61_90: '40000', over90: '25000' });
    expect(a).toMatchObject({ invoiceTotal: '100000', balance: '142000', notAllocated: '42000' });
    // khớp sổ công nợ
    const ledger = (await get(`/customers/${cid.K1}/ledger`)).body;
    expect(ledger.closingBalance).toBe(a.balance);
  });

  it('khách không có kỳ hạn công nợ: không có dueDate / không quá hạn; chi nhánh khác tách riêng', async () => {
    const k2inv = await idem('tro1', '/invoices', {
      customerId: cid.K2,
      invoicedAt: ago(200),
      items: [{ productId: (await t.db.select().from(products))[0]!.id, qty: '1', price: '7000' }],
    });
    expect(k2inv.status, JSON.stringify(k2inv.body)).toBe(201);
    const a = (await get(`/customers/${cid.K2}/aging`)).body;
    expect(a.invoices).toHaveLength(1);
    expect(a.invoices[0]).toMatchObject({ dueDate: null, overdue: false, ageDays: 200 });
    expect(a.buckets.over90).toBe('7000');
    // Hà Nội không có hóa đơn nào của khách này
    const hn = (await get(`/customers/${cid.K1}/aging`, 'quanly', t.hn)).body;
    expect(hn).toMatchObject({ invoices: [], invoiceTotal: '0', balance: '0', notAllocated: '0' });
  });

  it('sao kê cả đời: hóa đơn gộp tổng và thu ngay thành một dòng, hủy/trả/thu nợ/nợ đầu kỳ có nhãn riêng, số dư khớp sổ', async () => {
    const res = await get(`/customers/${cid.K1}/statement`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = res.body;
    expect(s.customer).toMatchObject({ code: 'K1', name: 'Khách Một', phone: '0900000001' });
    expect(s.branch.id).toBe(t.sg);
    expect(s.openingBalance).toBe('0');
    const kinds = (s.lines as Array<{ kind: string }>).reduce<Record<string, number>>(
      (m, l) => ({ ...m, [l.kind]: (m[l.kind] ?? 0) + 1 }),
      {},
    );
    expect(kinds).toEqual({ opening: 1, invoice: 5, invoice_cancel: 1, sales_return: 1, receipt: 2 });
    const hd1 = s.lines.find((l: { refId: string; kind: string }) => l.refId === inv.HD1 && l.kind === 'invoice');
    expect(hd1).toMatchObject({ increase: '20000', decrease: '5000', description: expect.stringMatching(/^Hóa đơn HD\d{6}$/) });
    const cancelled = s.lines.find((l: { kind: string }) => l.kind === 'invoice_cancel');
    expect(cancelled).toMatchObject({ increase: '0', decrease: '10000' });
    expect(s.lines.find((l: { kind: string }) => l.kind === 'sales_return')).toMatchObject({ increase: '0', decrease: '10000' });
    expect(s.lines.find((l: { kind: string }) => l.kind === 'opening')).toMatchObject({ increase: '50000', description: 'Nợ đầu kỳ IMP-TEST' });
    // cộng phát sinh và số dư cuối khớp sổ công nợ
    const sum = (k: 'increase' | 'decrease') =>
      s.lines.reduce((x: number, l: Record<string, string>) => x + Number(l[k]), 0);
    expect(s.totals).toEqual({ increase: String(sum('increase')), decrease: String(sum('decrease')) });
    expect(Number(s.closingBalance)).toBe(Number(s.openingBalance) + sum('increase') - sum('decrease'));
    const ledger = (await get(`/customers/${cid.K1}/ledger`)).body;
    expect(s.closingBalance).toBe(ledger.closingBalance);
    expect(s.lines.at(-1).balance).toBe(s.closingBalance);
  });

  it('sao kê theo kỳ: nợ đầu kỳ = các bút toán trước kỳ, chỉ có chứng từ trong kỳ, cuối kỳ khớp sổ cùng kỳ; ngày sai → 400', async () => {
    const from = vnDate(ago(100));
    const to = vnDate(ago(1));
    const res = await get(`/customers/${cid.K1}/statement?from=${from}&to=${to}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const s = res.body;
    // trước kỳ: nợ đầu kỳ 50.000 + HD4 50.000
    expect(s.openingBalance).toBe('100000');
    expect(s.from).toBe(from);
    expect(s.to).toBe(to);
    expect(s.lines.map((l: { refId: string }) => l.refId)).toEqual([inv.HD3, inv.HD2, inv.HD1, inv.HD5]);
    const ledger = (await get(`/customers/${cid.K1}/ledger?from=${from}&to=${to}`)).body;
    expect(s.openingBalance).toBe(ledger.openingBalance);
    expect(s.closingBalance).toBe(ledger.closingBalance);
    expect((await get(`/customers/${cid.K1}/statement?from=2026-02-31`)).status).toBe(400);
    expect((await get(`/customers/${cid.K1}/statement?from=2026-11-05&to=2026-11-01`)).status).toBe(400);
  });

  it('Excel biên bản đối chiếu: đúng tiêu đề, dòng nợ đầu kỳ, cộng phát sinh, nợ cuối kỳ', async () => {
    const res = await (await as('quanly'))
      .get(`/customers/${cid.K1}/statement?format=xlsx`)
      .buffer()
      .parse(bin as never)
      .expect(200);
    expect(String(res.headers['content-disposition'])).toContain('doi-chieu-cong-no');
    const sheet = await readSheet(res.body as Buffer);
    expect(sheet.headers).toEqual(
      ['Ngày', 'Chứng từ', 'Diễn giải', 'Phát sinh tăng', 'Phát sinh giảm', 'Còn nợ'].map(normalizeHeader),
    );
    const json = (await get(`/customers/${cid.K1}/statement`)).body;
    expect(sheet.rows).toHaveLength(json.lines.length + 3);
    const last = sheet.rows.at(-1)!.values;
    expect(last['dien giai']).toBe('Nợ cuối kỳ');
    expect(last['con no']).toBe(Number(json.closingBalance));
    expect(sheet.rows[0]!.values['dien giai']).toBe('Nợ đầu kỳ');
  });

  it('quyền: Kho (không có debt.view) → 403; Sale chỉ xem khách mình phụ trách; khách không tồn tại → 404', async () => {
    for (const path of ['aging', 'statement']) {
      expect((await get(`/customers/${cid.K1}/${path}`, 'kho1')).status, path).toBe(403);
      expect((await get(`/customers/${cid.K1}/${path}`, 'sale1')).status, path).toBe(200);
      expect((await get(`/customers/${cid.K2}/${path}`, 'sale1')).status, path).toBe(403);
      expect((await get(`/customers/${randomUUID()}/${path}`)).status, path).toBe(404);
    }
    expect((await new ReconciliationService().run(t.db)).ok).toBe(true);
  });
});
