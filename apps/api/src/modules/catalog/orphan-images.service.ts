import { Inject, Injectable, Logger } from '@nestjs/common';
import { isNotNull } from 'drizzle-orm';
import { DB, type Database } from '../../db/database.module.js';
import { productImages } from '../../db/schema/index.js';
import { FileStorage } from '../files/file-storage.js';

/** File mới hơn mức này không bị coi là mồ côi (tránh xóa file đang tải dở). */
export const ORPHAN_GRACE_MS = 24 * 3600 * 1000;

/**
 * Tìm và dọn file ảnh MỒ CÔI trên kho file: có trên kho nhưng không còn dòng `product_images` nào trỏ tới.
 * Phát sinh khi tiến trình sập giữa lúc tải ảnh lên và ghi CSDL (lỗi thường được dọn ngay, sập thì không).
 * Chạy bằng `pnpm --filter @kiot/api storage:gc` (mặc định chỉ liệt kê, thêm `--apply` mới xóa).
 */
@Injectable()
export class OrphanImagesService {
  private readonly logger = new Logger(OrphanImagesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: FileStorage,
  ) {}

  async find(
    olderThanMs: number = ORPHAN_GRACE_MS,
    now: Date = new Date(),
  ): Promise<string[]> {
    const files = await this.storage.list('products/');
    const old = files.filter(
      (f) => now.getTime() - f.lastModified.getTime() >= olderThanMs,
    );
    if (old.length === 0) return [];
    const used = new Set(
      (
        await this.db
          .select({ key: productImages.storageKey })
          .from(productImages)
          .where(isNotNull(productImages.storageKey))
      ).map((r) => r.key),
    );
    return old.filter((f) => !used.has(f.key)).map((f) => f.key);
  }

  async remove(keys: string[]): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;
    for (const key of keys) {
      try {
        await this.storage.delete(key);
        deleted++;
      } catch (e) {
        failed++;
        this.logger.warn(
          `Không xóa được ${key}: ${e instanceof Error ? e.name : 'lỗi không rõ'}`,
        );
      }
    }
    return { deleted, failed };
  }
}
