import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/database.module.js';

export interface ReconciliationCheck {
  /** Mã ổn định của phép đối soát. */
  code: string;
  description: string;
  /** Số bản ghi lệch. */
  issues: number;
  /** Tối đa 20 bản ghi lệch đầu tiên để điều tra. */
  samples: Array<Record<string, unknown>>;
}

export interface ReconciliationReport {
  ok: boolean;
  checks: ReconciliationCheck[];
}

const SAMPLE_LIMIT = 20;

/**
 * Đối soát CHỈ ĐỌC giữa số liệu "cache" và sổ cái. Chạy: sau mỗi kịch bản chứng từ trong test, mỗi ngày trong giai
 * đoạn chạy song song với KiotViet, và trước/sau khi cắt chuyển (`pnpm --filter @kiot/api db:reconcile`).
 * Mọi phép kiểm tra đều phải ra 0 lệch; có lệch nghĩa là có đường ghi nào đó đã bỏ qua `InventoryService`/sổ cái.
 */
@Injectable()
export class ReconciliationService {
  async run(db: DbOrTx): Promise<ReconciliationReport> {
    const checks = await Promise.all([
      this.check(
        db,
        'stock_cache_vs_ledger',
        'Số tồn (stocks.on_hand) khác tổng sổ cái kho (stock_movements) theo từng (chi nhánh, sản phẩm)',
        sql`
          select coalesce(s.branch_id, m.branch_id) as branch_id,
                 coalesce(s.product_id, m.product_id) as product_id,
                 coalesce(s.on_hand, 0)::text as cached,
                 coalesce(m.qty, 0)::text as ledger
          from stocks s
          full join (
            select branch_id, product_id, sum(qty_delta) as qty
            from stock_movements group by branch_id, product_id
          ) m on m.branch_id = s.branch_id and m.product_id = s.product_id
          where coalesce(s.on_hand, 0) <> coalesce(m.qty, 0)
          order by 1, 2`,
      ),
      this.check(
        db,
        'debt_orphan_party',
        'Bút toán công nợ trỏ tới khách / nhà cung cấp không tồn tại (partyId không có khóa ngoại)',
        sql`
          select dl.id, dl.party_type::text as party_type, dl.party_id
          from debt_ledger dl
          where (dl.party_type = 'customer'
                 and not exists (select 1 from customers c where c.id = dl.party_id))
             or (dl.party_type = 'supplier'
                 and not exists (select 1 from suppliers s where s.id = dl.party_id))
          order by dl.created_at`,
      ),
      this.check(
        db,
        'cash_account_branch',
        'Phiếu quỹ ghi vào tài khoản quỹ thuộc chi nhánh KHÁC chi nhánh của phiếu',
        sql`
          select t.id, t.code, t.branch_id, a.branch_id as account_branch_id
          from cash_transactions t
          join cash_accounts a on a.id = t.account_id
          where a.branch_id is not null and a.branch_id <> t.branch_id
          order by t.created_at`,
      ),
      this.check(
        db,
        'debt_internal_symmetry',
        'Công nợ nội bộ giữa hai chi nhánh lệch nhau: tổng khách nội bộ (bên gửi) phải bằng tổng nhà cung cấp nội bộ (bên nhận)',
        sql`
          with receivable as (
            select c.linked_branch_id as other, dl.branch_id as me, sum(dl.amount) as amt
            from debt_ledger dl
            join customers c on dl.party_type = 'customer' and c.id = dl.party_id
            where c.linked_branch_id is not null
            group by 1, 2
          ), payable as (
            select s.linked_branch_id as other, dl.branch_id as me, sum(dl.amount) as amt
            from debt_ledger dl
            join suppliers s on dl.party_type = 'supplier' and s.id = dl.party_id
            where s.linked_branch_id is not null
            group by 1, 2
          )
          select coalesce(r.me, p.other) as sender_branch_id,
                 coalesce(r.other, p.me) as receiver_branch_id,
                 coalesce(r.amt, 0)::text as receivable_at_sender,
                 coalesce(p.amt, 0)::text as payable_at_receiver
          from receivable r
          full join payable p on r.me = p.other and r.other = p.me
          where coalesce(r.amt, 0) <> coalesce(p.amt, 0)`,
      ),
      this.check(
        db,
        'cash_debt_vs_ledger',
        'Phiếu quỹ thu/chi công nợ (danh mục hệ thống) có tổng bút toán công nợ khác số phải ghi (hoàn tất = ±số tiền, đã hủy = 0); bỏ qua phiếu thu lúc xuất hóa đơn và phiếu nhập từ file',
        sql`
          select t.id, t.code, t.status::text as status,
                 (case when t.status = 'completed'
                       then (case when c.code in ('customer_payment', 'supplier_payment') then -t.amount else t.amount end)
                       else 0 end)::text as expected,
                 coalesce((select sum(d.amount) from debt_ledger d
                           where d.ref_type = 'cash_transaction' and d.ref_id = t.id), 0)::text as booked
          from cash_transactions t
          join cash_categories c on c.id = t.category_id
          where c.code in ('customer_payment', 'supplier_payment', 'customer_refund', 'supplier_refund')
            and coalesce(t.ref_type, '') not in ('invoice', 'import')
            and (case when t.status = 'completed'
                      then (case when c.code in ('customer_payment', 'supplier_payment') then -t.amount else t.amount end)
                      else 0 end)
                <> coalesce((select sum(d.amount) from debt_ledger d
                             where d.ref_type = 'cash_transaction' and d.ref_id = t.id), 0)
          order by t.created_at`,
      ),
      this.check(
        db,
        'invoice_allocation_exceeds',
        'Hóa đơn hoàn tất có tổng cấn trừ thu nợ (phiếu quỹ còn hiệu lực) vượt phần còn phải thu sau khi thu lúc xuất',
        sql`
          select i.id, i.code, i.total::text as total, i.paid_total::text as paid_total, a.amt::text as allocated
          from invoices i
          join (
            select pa.invoice_id, sum(pa.amount) as amt
            from payment_allocations pa
            join cash_transactions ct on ct.id = pa.cash_transaction_id
            where ct.status = 'completed'
            group by pa.invoice_id
          ) a on a.invoice_id = i.id
          where i.status = 'completed' and a.amt > i.total - i.paid_total
          order by i.code`,
      ),
    ]);
    return { ok: checks.every((c) => c.issues === 0), checks };
  }

  private async check(
    db: DbOrTx,
    code: string,
    description: string,
    query: ReturnType<typeof sql>,
  ): Promise<ReconciliationCheck> {
    const result = await db.execute(query);
    const rows = result.rows as Array<Record<string, unknown>>;
    return {
      code,
      description,
      issues: rows.length,
      samples: rows.slice(0, SAMPLE_LIMIT),
    };
  }
}
