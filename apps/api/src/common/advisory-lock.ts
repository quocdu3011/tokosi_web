import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/database.module.js';

/**
 * Khóa tư vấn (advisory lock) theo đối tác + chi nhánh, giữ tới hết transaction.
 *
 * VÌ SAO: công nợ là tổng các dòng `debt_ledger` nên không có dòng nào để `FOR UPDATE`. Hai hóa đơn của cùng một
 * khách tại cùng chi nhánh chốt song song sẽ cùng đọc số dư cũ và cùng vượt hạn mức.
 *
 * QUY TẮC: mọi nghiệp vụ ĐỌC số dư công nợ để QUYẾT ĐỊNH (kiểm tra hạn mức…) rồi GHI `debt_ledger` phải gọi hàm này
 * ĐẦU TIÊN trong transaction, sau đó mới đọc số dư. Khi cần khóa nhiều đối tác, khóa theo thứ tự (loại, id, chi nhánh)
 * tăng dần để không bế tắc.
 */
export async function lockPartyBranch(
  tx: DbOrTx,
  partyType: 'customer' | 'supplier',
  partyId: string,
  branchId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`debt:${partyType}:${partyId}:${branchId}`}, 0))`,
  );
}
