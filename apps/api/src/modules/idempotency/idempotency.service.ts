import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { DB, type Database } from '../../db/database.module.js';
import { idempotencyKeys } from '../../db/schema/index.js';
import { canonicalJson } from './canonical-json.js';

/** Khóa idempotency còn hiệu lực trong 24 giờ kể từ lần đầu. */
export const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export type Begin =
  | { kind: 'execute'; id: string }
  | { kind: 'replay'; status: number; body: unknown };

export interface RequestFingerprint {
  userId: string;
  key: string;
  /** `POST /api/v1/invoices` — phương thức + đường dẫn (không gồm query). */
  endpoint: string;
  /** Mọi thứ làm thay đổi ý nghĩa của yêu cầu: query, body, chi nhánh làm việc. */
  content: unknown;
}

@Injectable()
export class IdempotencyService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Bắt đầu một yêu cầu có khóa. Chèn bản ghi "đang xử lý" TRƯỚC khi chạy handler nên hai yêu cầu cùng khóa chạy
   * song song chỉ có MỘT bên được thực thi, bên kia nhận 409 `REQUEST_IN_PROGRESS`.
   */
  async begin(fp: RequestFingerprint): Promise<Begin> {
    const requestHash = createHash('sha256')
      .update(canonicalJson({ endpoint: fp.endpoint, content: fp.content }))
      .digest('hex');
    for (let attempt = 0; attempt < 2; attempt++) {
      const inserted = await this.db
        .insert(idempotencyKeys)
        .values({
          userId: fp.userId,
          key: fp.key,
          endpoint: fp.endpoint,
          requestHash,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        })
        .onConflictDoNothing()
        .returning({ id: idempotencyKeys.id });
      if (inserted[0]) return { kind: 'execute', id: inserted[0].id };

      const [existing] = await this.db
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, fp.userId),
            eq(idempotencyKeys.key, fp.key),
          ),
        );
      if (!existing) continue; // bị xóa giữa hai câu lệnh (yêu cầu trước thất bại): thử lại
      if (existing.expiresAt.getTime() <= Date.now()) {
        await this.db
          .delete(idempotencyKeys)
          .where(eq(idempotencyKeys.id, existing.id));
        continue; // khóa cũ đã hết hạn: coi như mới
      }
      if (existing.requestHash !== requestHash) {
        throw new AppError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key này đã được dùng cho một yêu cầu có nội dung khác. Hãy tạo khóa mới cho thao tác mới.',
        );
      }
      if (existing.responseStatus === null) {
        throw new AppError(
          409,
          'REQUEST_IN_PROGRESS',
          'Yêu cầu trước đó với cùng Idempotency-Key đang được xử lý. Đợi giây lát rồi xem lại kết quả, đừng gửi lại.',
        );
      }
      return {
        kind: 'replay',
        status: existing.responseStatus,
        body: existing.responseBody,
      };
    }
    throw new AppError(409, 'REQUEST_IN_PROGRESS', 'Vui lòng thử lại');
  }

  /** Lưu kết quả thành công để các lần gửi lại nhận đúng kết quả này. */
  async complete(id: string, status: number, body: unknown): Promise<void> {
    const resourceId =
      body && typeof body === 'object' && 'id' in body
        ? String((body as { id: unknown }).id)
        : null;
    await this.db
      .update(idempotencyKeys)
      .set({
        responseStatus: status,
        responseBody: body ?? null,
        resourceId:
          resourceId && /^[0-9a-f-]{36}$/i.test(resourceId) ? resourceId : null,
      })
      .where(eq(idempotencyKeys.id, id));
  }

  /** Yêu cầu thất bại: nhả khóa để client sửa lỗi rồi gửi lại cùng khóa. */
  async abort(id: string): Promise<void> {
    await this.db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, id));
  }

  /** Dọn các khóa đã hết hạn. */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const removed = await this.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, now))
      .returning({ id: idempotencyKeys.id });
    return removed.length;
  }
}
