import { formatDocumentCode } from '@kiot/shared';
import { eq, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import type { Database } from './database.module.js';
import { codeSequences } from './schema/index.js';

/**
 * Cấp mã chứng từ tiếp theo cho một tiền tố (HD, DH, PN, KH, NV…), ví dụ "HD016891".
 *
 * Nguyên tử và an toàn khi nhiều yêu cầu cùng lúc: một câu UPDATE ... RETURNING duy nhất nên mỗi lời gọi
 * nhận số khác nhau. Gọi BÊN TRONG transaction của chứng từ: nếu chứng từ bị hủy bỏ (rollback) thì số cũng
 * được trả lại, không để hổng số.
 */
export async function nextDocumentCode(
  db: Pick<Database, 'update'>,
  prefix: string,
): Promise<string> {
  const [row] = await db
    .update(codeSequences)
    .set({
      nextValue: sql`${codeSequences.nextValue} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(codeSequences.prefix, prefix))
    .returning({ next: codeSequences.nextValue, digits: codeSequences.digits });
  if (!row) {
    throw new AppError(
      500,
      'INTERNAL_ERROR',
      `Chưa khởi tạo bộ đếm mã cho tiền tố "${prefix}"`,
    );
  }
  return formatDocumentCode(prefix, row.next - 1, row.digits);
}
