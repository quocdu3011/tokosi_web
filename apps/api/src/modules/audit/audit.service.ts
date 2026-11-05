import { Injectable } from '@nestjs/common';
import { currentContext } from '../../common/request-context.js';
import type { DbOrTx } from '../../db/database.module.js';
import { auditLogs } from '../../db/schema/index.js';

export interface AuditEntry {
  /** Hành động, dạng `entity.verb` (vd `user.create`, `price.bulk_adjust`). */
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Mặc định lấy từ ngữ cảnh yêu cầu (người đang đăng nhập). Truyền tay khi chưa đăng nhập (vd đăng nhập). */
  userId?: string | null;
  branchId?: string | null;
  ip?: string | null;
}

/**
 * Nhật ký thao tác dùng chung. Luôn ghi CÙNG transaction với thay đổi dữ liệu (truyền `tx`) để không có thay đổi
 * nào thiếu nhật ký và không có nhật ký của thay đổi đã rollback.
 *
 * `requestId`, người dùng, chi nhánh và IP lấy tự động từ ngữ cảnh yêu cầu (AsyncLocalStorage).
 * KHÔNG đưa mật khẩu, token, băm mật khẩu vào `before`/`after`.
 */
@Injectable()
export class AuditService {
  async record(db: DbOrTx, entry: AuditEntry): Promise<void> {
    const ctx = currentContext();
    await db.insert(auditLogs).values({
      userId: entry.userId === undefined ? (ctx?.userId ?? null) : entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip === undefined ? (ctx?.ip ?? null) : entry.ip,
      requestId: ctx?.requestId ?? null,
      branchId:
        entry.branchId === undefined ? (ctx?.branchId ?? null) : entry.branchId,
    });
  }
}
