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

/**
 * Như `nextDocumentCode` nhưng BỎ QUA các mã đã có người dùng (nhập tay hoặc chuyển từ hệ thống cũ). Nếu không, một
 * mã nhập tay trùng đúng số kế tiếp sẽ làm mọi lần tự cấp sau đó lỗi trùng mãi mãi (giao dịch hủy kéo bộ đếm lùi lại).
 * `isTaken` kiểm tra mã đã tồn tại chưa. Mỗi mã bị bỏ qua vẫn tiêu một số của bộ đếm.
 */
export async function nextFreeDocumentCode(
  db: Pick<Database, 'update'>,
  prefix: string,
  isTaken: (code: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_SKIPPED_CODES; attempt++) {
    const code = await nextDocumentCode(db, prefix);
    if (!(await isTaken(code))) return code;
  }
  throw new AppError(
    500,
    'INTERNAL_ERROR',
    `Không tìm được mã "${prefix}" còn trống sau ${MAX_SKIPPED_CODES} lần thử; hãy nâng bộ đếm mã lên số lớn nhất hiện có`,
  );
}

const MAX_SKIPPED_CODES = 1000;
