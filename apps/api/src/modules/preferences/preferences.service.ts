import { Inject, Injectable } from '@nestjs/common';
import type { TablePrefs } from '@kiot/shared';
import { and, asc, eq } from 'drizzle-orm';
import { DB, type Database } from '../../db/database.module.js';
import { userTablePrefs } from '../../db/schema/index.js';
import type { TablePrefsDto } from './preferences.dto.js';

/**
 * Tùy chỉnh bảng theo từng tài khoản (cột ẩn, thứ tự, độ rộng, số dòng/trang).
 *
 * Mọi truy vấn LUÔN lọc theo `userId` của người đang đăng nhập (do controller lấy từ `@CurrentUser()`, không nhận từ
 * client) — đây là ranh giới cô lập giữa các tài khoản.
 *
 * Không ghi `AuditService`: đây là tùy chọn giao diện của chính người dùng, không phải nghiệp vụ tiền/kho/nợ, và ghi
 * mỗi lần kéo độ rộng cột sẽ làm nhiễu nhật ký thao tác.
 */
@Injectable()
export class PreferencesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Toàn bộ tùy chỉnh của người dùng: khóa bảng → tùy chỉnh. */
  async list(userId: string): Promise<{ data: Record<string, TablePrefs> }> {
    const rows = await this.db
      .select({
        tableKey: userTablePrefs.tableKey,
        settings: userTablePrefs.settings,
      })
      .from(userTablePrefs)
      .where(eq(userTablePrefs.userId, userId))
      .orderBy(asc(userTablePrefs.tableKey));
    return {
      data: Object.fromEntries(rows.map((r) => [r.tableKey, r.settings])),
    };
  }

  /** Lưu (thay thế toàn bộ, không gộp với bản cũ) tùy chỉnh một bảng; chưa có thì tạo. Trả lại bản đã lưu. */
  async save(
    userId: string,
    tableKey: string,
    body: TablePrefsDto,
  ): Promise<TablePrefs> {
    const settings = normalize(body);
    const [row] = await this.db
      .insert(userTablePrefs)
      .values({ userId, tableKey, settings })
      .onConflictDoUpdate({
        target: [userTablePrefs.userId, userTablePrefs.tableKey],
        set: { settings, updatedAt: new Date() },
      })
      .returning({ settings: userTablePrefs.settings });
    return row!.settings;
  }

  /** Xóa tùy chỉnh một bảng (về mặc định). Không có bản ghi cũng không lỗi. */
  async remove(userId: string, tableKey: string): Promise<void> {
    await this.db
      .delete(userTablePrefs)
      .where(
        and(
          eq(userTablePrefs.userId, userId),
          eq(userTablePrefs.tableKey, tableKey),
        ),
      );
  }
}

/** Chỉ giữ các trường có giá trị, sao chép mảng/đối tượng để không giữ tham chiếu tới thể hiện DTO. */
function normalize(body: TablePrefsDto): TablePrefs {
  const out: TablePrefs = {};
  if (body.hidden !== undefined) out.hidden = [...body.hidden];
  if (body.order !== undefined) out.order = [...body.order];
  if (body.widths !== undefined) {
    out.widths = Object.fromEntries(Object.entries(body.widths));
  }
  if (body.pageSize !== undefined) out.pageSize = body.pageSize;
  return out;
}
