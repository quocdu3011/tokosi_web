import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeHeader, readSheet } from '../../common/excel.js';
import {
  cashAccounts,
  cashTransactions,
  customers,
  debtLedger,
  paymentAllocations,
  products,
  suppliers,
  users,
} from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { SalesModule } from '../sales/sales.module.js';
import { CashModule } from './cash.module.js';

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

/**
 * Sổ quỹ. Sài Gòn: khách K1 có 3 hóa đơn 100.000 / 50.000 / 30.000 (HD1 cũ nhất), HD1 đã trả hàng 20.000 → còn nợ
 * 80.000 / 50.000 / 30.000, công nợ khách 160.000. Khách K2 để thử hủy hóa đơn đã cấn trừ.
 */
describe('Sổ quỹ qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  const cid: Record<string, string> = {};
  const inv: Record<string, string> = {};
  const cat: Record<string, string> = {};
  let supplierId: string;
  let cashSg: string;
  let bankSg: string;
  let cashHn: string;
  let pid: string;

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [IdempotencyModule, SalesModule, CashModule] });
    await t.makeUser('tro1', 'assistant', [t.sg, t.hn]);
    await t.makeUser('ketoan1', 'accountant', [t.sg, t.hn]);
    await t.makeUser('sale1', 'sales', [t.sg]);
    pid = (await t.db.insert(products).values({ code: 'A', name: 'Hàng A' }).returning())[0]!.id;
    await t.db.transaction((tx) =>
      new InventoryService(t.db).applyMovements(tx, [
        { branchId: t.sg, productId: pid, qtyDelta: '1000', unitCost: '1000', refType: 'opening' },
      ]),
    );
    for (const c of await t.db
      .insert(customers)
      .values([
        { code: 'K1', name: 'Khách Một' },
        { code: 'K2', name: 'Khách Hai' },
      ])
      .returning())
      cid[c.code] = c.id;
    // Khách nội bộ (đại diện chi nhánh) do seed tạo sẵn
    cid.KN = (await t.db.select().from(customers)).find((c) => c.linkedBranchId !== null)!.id;
    supplierId = (await t.db.insert(suppliers).values({ code: 'S1', name: 'NCC Một' }).returning())[0]!.id;
    const acc = await t.db.select().from(cashAccounts);
    cashSg = acc.find((a) => a.branchId === t.sg && a.type === 'cash')!.id;
    bankSg = acc.find((a) => a.branchId === t.sg && a.type === 'bank')!.id;
    cashHn = acc.find((a) => a.branchId === t.hn && a.type === 'cash')!.id;
    const cats = (await (await as('quanly')).get('/cash-categories?includeInactive=true').expect(200)).body.data;
    for (const c of cats as Array<{ id: string; code: string | null }>) if (c.code) cat[c.code] = c.id;
    // 3 hóa đơn của K1 (ngày khác nhau để thứ tự "cũ nhất" rõ ràng), hóa đơn của K2
    const mk = async (customer: string, qty: string, price: string, at: string) =>
      (
        await idem('tro1', '/invoices', {
          customerId: cid[customer],
          invoicedAt: at,
          items: [{ productId: pid, qty, price }],
        })
      ).body.id as string;
    inv.hd1 = await mk('K1', '10', '10000', '2026-10-01T03:00:00Z');
    inv.hd2 = await mk('K1', '5', '10000', '2026-10-02T03:00:00Z');
    inv.hd3 = await mk('K1', '3', '10000', '2026-10-03T03:00:00Z');
    inv.k2 = await mk('K2', '4', '10000', '2026-10-04T03:00:00Z');
    const r = await idem('tro1', '/sales-returns', {
      customerId: cid.K1,
      invoiceId: inv.hd1,
      items: [{ productId: pid, qty: '2', returnPrice: '10000' }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  const as = (user: string, branch: string = t.sg): Promise<Api> =>
    t.as(user, branch) as Promise<Api>;
  const idem = async (
    user: string,
    url: string,
    body: Record<string, unknown>,
    key: string | null = randomUUID(),
    branch: string = t.sg,
  ) => {
    const req = (await as(user, branch)).post(url).send(body);
    if (key) req.set('Idempotency-Key', key);
    return req;
  };
  const sumDebt = async (type: 'customer' | 'supplier', id: string) =>
    Number(
      (
        await t.db
          .select({ v: sql<string>`coalesce(sum(${debtLedger.amount}), 0)` })
          .from(debtLedger)
          .where(
            and(
              eq(debtLedger.partyType, type),
              eq(debtLedger.partyId, id),
              eq(debtLedger.branchId, t.sg),
            ),
          )
      )[0]!.v,
    );
  const outstanding = async (invoiceId: string) =>
    Number((await (await as('quanly')).get(`/invoices/${invoiceId}`).expect(200)).body.debt);
  const balanceOf = async (accountId: string) =>
    Number(
      (
        (await (await as('quanly')).get('/cash-accounts?includeInactive=true').expect(200)).body
          .data as Array<{ id: string; balance: string }>
      ).find((a) => a.id === accountId)!.balance,
    );
  const receipt = (user: string, customer: string, body: Record<string, unknown>) =>
    idem(user, `/customers/${cid[customer]}/receipts`, body);
  const cashTx = (body: Record<string, unknown>, user = 'ketoan1') =>
    idem(user, '/cash-transactions', { occurredAt: undefined, ...body });

  it('còn nợ hóa đơn trừ cả phiếu trả: 80.000 / 50.000 / 30.000; công nợ K1 160.000', async () => {
    expect(await outstanding(inv.hd1)).toBe(80000);
    expect(await outstanding(inv.hd2)).toBe(50000);
    expect(await outstanding(inv.hd3)).toBe(30000);
    expect(await sumDebt('customer', cid.K1!)).toBe(160000);
    const d = (await (await as('quanly')).get(`/invoices/${inv.hd1}`).expect(200)).body;
    expect(d).toMatchObject({ total: '100000', paid: '0', returned: '20000', debt: '80000', allocations: [] });
    const open = (await (await as('quanly')).get(`/invoices?customerId=${cid.K1}&hasDebt=true&limit=100`).expect(200)).body.data;
    expect(open).toHaveLength(3);
  });

  it('quỹ: số dư theo phiếu; sửa quỹ đầu kỳ chỉ khi quỹ chưa có phiếu; trùng tên → 409; phân quyền', async () => {
    const api = await as('quanly');
    const created = await api.post('/cash-accounts').send({ name: 'Quỹ thử', type: 'cash', openingBalance: '5000000' }).expect(201);
    expect(created.body).toMatchObject({ name: 'Quỹ thử', type: 'cash', openingBalance: '5000000', balance: '5000000', hasTransactions: false, isActive: true });
    await api.post('/cash-accounts').send({ name: 'quỹ THỬ', type: 'bank' }).expect(409);
    await api.patch(`/cash-accounts/${created.body.id}`).send({ openingBalance: '6000000' }).expect(200);
    expect(await balanceOf(created.body.id)).toBe(6000000);
    // thu vào quỹ thử rồi mới sửa đầu kỳ → 422
    const thu = await cashTx({ direction: 'in', amount: '1000', categoryId: cat.other_in, accountId: created.body.id });
    expect(thu.status, JSON.stringify(thu.body)).toBe(201);
    expect(await balanceOf(created.body.id)).toBe(6001000);
    const res = await api.patch(`/cash-accounts/${created.body.id}`).send({ openingBalance: '1' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_STATE');
    // quỹ chi nhánh khác không thấy trong danh sách; phiếu vào quỹ chi nhánh khác → 400
    const ids = ((await api.get('/cash-accounts').expect(200)).body.data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).not.toContain(cashHn);
    const other = await cashTx({ direction: 'in', amount: '1000', categoryId: cat.other_in, accountId: cashHn });
    expect(other.status).toBe(400);
    // Kế toán xem được nhưng không tạo/sửa quỹ; Sale không có quyền sổ quỹ
    await (await as('tro1')).get('/cash-accounts').expect(403); // Trợ lý không có cash.view
    await (await as('tro1')).post('/cash-accounts').send({ name: 'X', type: 'cash' }).expect(403);
    await (await as('sale1')).get('/cash-accounts').expect(403);
    await (await as('sale1')).get('/cash-transactions').expect(403);
    await api.patch(`/cash-accounts/${created.body.id}`).send({ isActive: false }).expect(200);
    const off = await cashTx({ direction: 'in', amount: '1000', categoryId: cat.other_in, accountId: created.body.id });
    expect(off.status).toBe(400);
  });

  it('danh mục: hệ thống đổi tên được nhưng không ngưng; tự tạo; trùng tên cùng hướng → 409', async () => {
    const api = await as('quanly');
    const sys = (await api.get('/cash-categories').expect(200)).body.data.find((c: { code: string }) => c.code === 'customer_payment');
    expect(sys).toMatchObject({ isSystem: true, direction: 'in', isActive: true });
    const res = await api.patch(`/cash-categories/${sys.id}`).send({ isActive: false });
    expect(res.status).toBe(422);
    await api.patch(`/cash-categories/${sys.id}`).send({ name: 'Tiền khách trả' }).expect(200);
    const mine = await api.post('/cash-categories').send({ name: 'Chi thử nghiệm', direction: 'out' }).expect(201);
    expect(mine.body).toMatchObject({ code: null, isSystem: false, direction: 'out' });
    await api.post('/cash-categories').send({ name: 'chi THỬ nghiệm', direction: 'out' }).expect(409);
    await api.post('/cash-categories').send({ name: 'chi THỬ nghiệm', direction: 'in' }).expect(201); // khác hướng thì được
    await (await as('tro1')).post('/cash-categories').send({ name: 'Y', direction: 'in' }).expect(403);
    cat.mine = mine.body.id;
  });

  it('thu nợ tự cấn vào hóa đơn cũ nhất: 100.000 → HD1 80.000 + HD2 20.000; nợ khách giảm; quỹ tăng', async () => {
    const before = await balanceOf(cashSg);
    const res = await receipt('ketoan1', 'K1', { accountId: cashSg, amount: '100000', note: 'khách chuyển tiền mặt' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      direction: 'in',
      amount: '100000',
      status: 'completed',
      category: { code: 'customer_payment' },
      party: { type: 'customer', code: 'K1' },
      note: 'khách chuyển tiền mặt',
    });
    expect(res.body.code).toMatch(/^TT\d{6}$/);
    const detail = (await (await as('quanly')).get(`/cash-transactions/${res.body.id}`).expect(200)).body;
    expect(detail.allocations.map((a: { amount: string }) => a.amount)).toEqual(['80000', '20000']);
    expect(await outstanding(inv.hd1)).toBe(0);
    expect(await outstanding(inv.hd2)).toBe(30000);
    expect(await outstanding(inv.hd3)).toBe(30000);
    expect(await sumDebt('customer', cid.K1!)).toBe(60000);
    expect(await balanceOf(cashSg)).toBe(before + 100000);
    const hd1 = (await (await as('quanly')).get(`/invoices/${inv.hd1}`).expect(200)).body;
    expect(hd1.paid).toBe('80000'); // thu nợ về sau tính vào đã trả
    expect(hd1.allocations).toHaveLength(1);
    cat.receiptId = res.body.id;
  });

  it('cấn trừ tay sai: vượt còn nợ, vượt tiền thu, hóa đơn của khách khác → 422 ALLOCATION_EXCEEDS và không ghi gì', async () => {
    const debt = await sumDebt('customer', cid.K1!);
    const txCount = (await t.db.select().from(cashTransactions)).length;
    for (const body of [
      { amount: '50000', allocations: [{ invoiceId: inv.hd3, amount: '40000' }] }, // HD3 chỉ còn 30.000
      { amount: '10000', allocations: [{ invoiceId: inv.hd2, amount: '20000' }] }, // vượt tiền thu
      { amount: '10000', allocations: [{ invoiceId: inv.k2, amount: '10000' }] }, // hóa đơn của K2
    ]) {
      const res = await receipt('ketoan1', 'K1', { accountId: cashSg, ...body });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.code).toBe('ALLOCATION_EXCEEDS');
    }
    expect(await sumDebt('customer', cid.K1!)).toBe(debt);
    expect((await t.db.select().from(cashTransactions)).length).toBe(txCount);
    expect(await outstanding(inv.hd3)).toBe(30000);
  });

  it('cấn tay đúng, không cấn (trả trước) và trả dư: nợ khách có thể âm', async () => {
    const ok = await receipt('ketoan1', 'K1', { accountId: bankSg, amount: '40000', allocations: [{ invoiceId: inv.hd3, amount: '30000' }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await outstanding(inv.hd3)).toBe(0);
    expect(await sumDebt('customer', cid.K1!)).toBe(20000); // 60.000 − 40.000
    // allocations: [] = không cấn
    await receipt('ketoan1', 'K1', { accountId: cashSg, amount: '5000', allocations: [] }).then((r) => expect(r.status).toBe(201));
    expect(await outstanding(inv.hd2)).toBe(30000);
    expect(await sumDebt('customer', cid.K1!)).toBe(15000);
    // thu 30.000 tự cấn HD2 30.000 → nợ khách −15.000 (âm là hợp lệ)
    await receipt('ketoan1', 'K1', { accountId: cashSg, amount: '30000' }).then((r) => expect(r.status).toBe(201));
    expect(await outstanding(inv.hd2)).toBe(0);
    expect(await sumDebt('customer', cid.K1!)).toBe(-15000);
    const open = (await (await as('quanly')).get(`/invoices?customerId=${cid.K1}&hasDebt=true`).expect(200)).body.data;
    expect(open).toHaveLength(0);
  });

  it('phiếu chi ghi công nợ theo danh mục hệ thống: trả NCC (−), hoàn tiền từ NCC (+), hoàn tiền khách (+); sai đối tượng → 400', async () => {
    const pay = await cashTx({ direction: 'out', amount: '700000', categoryId: cat.supplier_payment, accountId: cashSg, party: { type: 'supplier', id: supplierId } });
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    expect(pay.body.code).toMatch(/^CTM\d{6}$/);
    expect(await sumDebt('supplier', supplierId)).toBe(-700000);
    const refund = await cashTx({ direction: 'in', amount: '200000', categoryId: cat.supplier_refund, accountId: cashSg, party: { type: 'supplier', id: supplierId } });
    expect(refund.status).toBe(201);
    expect(await sumDebt('supplier', supplierId)).toBe(-500000);
    const back = await cashTx({ direction: 'out', amount: '15000', categoryId: cat.customer_refund, accountId: cashSg, party: { type: 'customer', id: cid.K1! } });
    expect(back.status).toBe(201);
    expect(await sumDebt('customer', cid.K1!)).toBe(0); // −15.000 + 15.000
    // thiếu đối tượng, sai loại đối tượng, sai hướng danh mục
    for (const body of [
      { direction: 'out', amount: '1000', categoryId: cat.supplier_payment, accountId: cashSg },
      { direction: 'out', amount: '1000', categoryId: cat.supplier_payment, accountId: cashSg, party: { type: 'customer', id: cid.K1! } },
      { direction: 'in', amount: '1000', categoryId: cat.supplier_payment, accountId: cashSg, party: { type: 'supplier', id: supplierId } },
    ]) {
      const res = await cashTx(body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    }
    // chỉ phiếu thu nợ khách mới có cấn trừ
    const alloc = await cashTx({ direction: 'out', amount: '1000', categoryId: cat.supplier_payment, accountId: cashSg, party: { type: 'supplier', id: supplierId }, allocations: [{ invoiceId: inv.k2, amount: '1000' }] });
    expect(alloc.status).toBe(400);
    // đối tác nội bộ → 404
    const internal = await receipt('ketoan1', 'KN', { accountId: cashSg, amount: '1000' });
    expect(internal.status).toBe(404);
    cat.payId = pay.body.id;
  });

  it('danh mục khác không ghi công nợ: đối tượng nhân viên / tên chữ / biển số xe; chi vượt quỹ chỉ cảnh báo', async () => {
    const debtRows = (await t.db.select().from(debtLedger)).length;
    const staff = (await t.db.select().from(users)).find((u) => u.username === 'ketoan1')!;
    const withStaff = await cashTx({ direction: 'out', amount: '300000', categoryId: cat.mine, accountId: cashSg, party: { type: 'employee', id: staff.id }, vehicleRef: '51C-12345', note: 'tạm ứng' });
    expect(withStaff.status, JSON.stringify(withStaff.body)).toBe(201);
    expect(withStaff.body).toMatchObject({ party: { type: 'employee' }, vehicleRef: '51C-12345' });
    const named = await cashTx({ direction: 'out', amount: '100000', categoryId: cat.mine, accountId: cashSg, partyName: 'Anh Tài xế' });
    expect(named.body).toMatchObject({ party: null, partyName: 'Anh Tài xế' });
    expect((await t.db.select().from(debtLedger)).length).toBe(debtRows);
    // chi vượt quỹ ngân hàng (số dư thấp hơn): vẫn ghi, có cảnh báo
    const bal = await balanceOf(bankSg);
    const big = await cashTx({ direction: 'out', amount: String(bal + 1000), categoryId: cat.mine, accountId: bankSg });
    expect(big.status, JSON.stringify(big.body)).toBe(201);
    expect(big.body.warnings).toMatchObject([{ code: 'CASH_NEGATIVE' }]);
    expect(await balanceOf(bankSg)).toBe(-1000);
    cat.bigId = big.body.id;
  });

  it('hủy phiếu: đảo công nợ; hủy hai lần → 422; phiếu thu lúc xuất hóa đơn → 409; hủy phiếu thu đã cấn thì hóa đơn hủy được', async () => {
    const api = await as('ketoan1');
    // trả NCC -700.000 hủy → nợ NCC về +200.000... (đã có hoàn +200.000 ⇒ −500.000 → +200.000)
    await api.post(`/cash-transactions/${cat.payId}/cancel`).send({}).expect(400);
    const c1 = await api.post(`/cash-transactions/${cat.payId}/cancel`).send({ reason: 'nhập nhầm' });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(c1.body).toMatchObject({ status: 'cancelled', cancelReason: 'nhập nhầm' });
    expect(await sumDebt('supplier', supplierId)).toBe(200000);
    const again = await api.post(`/cash-transactions/${cat.payId}/cancel`).send({ reason: 'x' });
    expect(again.status).toBe(422);
    // sửa ghi chú phiếu đã hủy → 422
    await api.patch(`/cash-transactions/${cat.payId}`).send({ note: 'y' }).expect(422);
    // phiếu thu tạo lúc xuất hóa đơn
    const withPay = await idem('tro1', '/invoices', { customerId: cid.K2, items: [{ productId: pid, qty: '1', price: '10000' }], payments: [{ method: 'cash', accountId: cashSg, amount: '4000' }] });
    expect(withPay.status).toBe(201);
    const issued = (await t.db.select().from(cashTransactions).where(eq(cashTransactions.refType, 'invoice'))).find((r) => r.refId === withPay.body.id)!;
    const blocked = await api.post(`/cash-transactions/${issued.id}/cancel`).send({ reason: 'x' });
    expect(blocked.status).toBe(409);
    // K2: thu nợ cấn vào hóa đơn → không hủy được hóa đơn; hủy phiếu thu → hủy được
    const rc = await receipt('ketoan1', 'K2', { accountId: cashSg, amount: '40000', allocations: [{ invoiceId: inv.k2, amount: '40000' }] });
    expect(rc.status, JSON.stringify(rc.body)).toBe(201);
    expect(await outstanding(inv.k2)).toBe(0);
    const cancelInv = await (await as('quanly')).post(`/invoices/${inv.k2}/cancel`).send({ reason: 'thử' });
    expect(cancelInv.status).toBe(409);
    await api.post(`/cash-transactions/${rc.body.id}/cancel`).send({ reason: 'khách đòi lại' }).expect(200);
    expect(await outstanding(inv.k2)).toBe(40000); // cấn trừ của phiếu đã hủy không còn tính
    expect((await t.db.select().from(paymentAllocations)).length).toBeGreaterThan(0); // dòng cấn trừ giữ nguyên
    const okCancel = await (await as('quanly')).post(`/invoices/${inv.k2}/cancel`).send({ reason: 'thử' });
    expect(okCancel.status, JSON.stringify(okCancel.body)).toBe(200);
    // hủy phiếu chi âm quỹ → quỹ về lại
    await api.post(`/cash-transactions/${cat.bigId}/cancel`).send({ reason: 'chi sai' }).expect(200);
    expect(await balanceOf(bankSg)).toBeGreaterThan(-1000);
  });

  it('danh sách: lọc, summary tồn đầu/tổng thu/tổng chi/tồn cuối, Excel đúng tiêu đề; chi nhánh khác không thấy; Idempotency-Key', async () => {
    const api = await as('quanly');
    const all = (await api.get('/cash-transactions?limit=100&accountId=' + cashSg).expect(200)).body;
    const done = (all.data as Array<{ status: string; direction: string; amount: string }>).filter((r) => r.status === 'completed');
    const sumBy = (d: string) => done.filter((r) => r.direction === d).reduce((s, r) => s + Number(r.amount), 0);
    expect(all.summary).toMatchObject({ totalIn: String(sumBy('in')), totalOut: String(sumBy('out')) });
    const opening = Number((await t.db.select().from(cashAccounts).where(eq(cashAccounts.id, cashSg)))[0]!.openingBalance);
    expect(Number(all.summary.closingBalance)).toBe(opening + sumBy('in') - sumBy('out'));
    expect(all.summary.closingBalance).toBe(String(await balanceOf(cashSg)));
    // lọc theo ngày tương lai gần = rỗng, tồn đầu = tồn cuối = số dư hiện tại
    const none = (await api.get(`/cash-transactions?accountId=${cashSg}&from=2099-01-01&to=2099-01-02`).expect(200)).body;
    expect(none.data).toHaveLength(0);
    expect(none.summary).toMatchObject({ openingBalance: String(await balanceOf(cashSg)), totalIn: '0', totalOut: '0' });
    expect((await api.get('/cash-transactions?direction=out&limit=100').expect(200)).body.data.every((r: { direction: string }) => r.direction === 'out')).toBe(true);
    expect((await api.get('/cash-transactions?partyType=supplier&partyId=' + supplierId).expect(200)).body.data.length).toBeGreaterThan(0);
    expect((await api.get('/cash-transactions?q=tam ung').expect(200)).body.data.length).toBe(1);
    expect((await api.get('/cash-transactions?q=tai xe').expect(200)).body.data.length).toBe(1);
    const sheetRes = await api.get('/cash-transactions?format=xlsx').buffer().parse(bin as never).expect(200);
    const sheet = await readSheet(sheetRes.body as Buffer);
    expect(sheet.headers.slice(0, 5)).toEqual(['Mã phiếu', 'Thời gian', 'Loại thu chi', 'Người nộp/nhận', 'Giá trị'].map(normalizeHeader));
    expect(sheet.rows.length).toBe((await api.get('/cash-transactions?limit=1').expect(200)).body.meta.total);
    await (await as('ketoan1', t.hn)).get(`/cash-transactions/${cat.receiptId}`).expect(404);
    expect(((await (await as('ketoan1', t.hn)).get('/cash-transactions').expect(200)).body.data as unknown[]).length).toBe(0);
    // Idempotency-Key: gửi lại cùng khóa không ghi thêm
    const key = randomUUID();
    const body = { direction: 'in', amount: '1234', categoryId: cat.other_in, accountId: cashSg };
    const a = await idem('ketoan1', '/cash-transactions', body, key);
    const b = await idem('ketoan1', '/cash-transactions', body, key);
    expect(a.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect((await idem('ketoan1', '/cash-transactions', body, null)).status).toBe(400); // thiếu Idempotency-Key
    // kiểm tra dữ liệu: số tiền lẻ/âm/0
    for (const amount of ['0', '-5', '10.5', 'abc']) {
      expect((await cashTx({ ...body, amount })).status).toBe(400);
    }
  });

  it('đối soát sổ cái khớp', async () => {
    expect((await new ReconciliationService().run(t.db)).ok).toBe(true);
  });
});
