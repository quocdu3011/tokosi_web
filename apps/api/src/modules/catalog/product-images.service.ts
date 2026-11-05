import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { DB, type Database } from '../../db/database.module.js';
import { productImages, products } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { detectImage } from '../files/image-type.js';
import { FileStorage } from '../files/file-storage.js';
import type { ProductImageDto } from './products.dto.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 10;

/** Một file đã tải lên (multer, lưu trong bộ nhớ). */
export interface UploadedFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class ProductImagesService {
  private readonly logger = new Logger(ProductImagesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: FileStorage,
    private readonly auditLog: AuditService,
  ) {}

  async list(productId: string): Promise<ProductImageDto[]> {
    await this.assertProduct(this.db, productId);
    return this.imagesOf(this.db, productId);
  }

  /**
   * Thêm nhiều ảnh một lần cho hàng. Được ăn cả ngã về không: kiểm tra hết file trước, tải lên kho file, rồi ghi
   * CSDL trong một transaction; lỗi ở bất kỳ bước nào thì dọn các file đã tải lên.
   */
  async addMany(
    productId: string,
    files: UploadedFile[],
  ): Promise<ProductImageDto[]> {
    if (files.length === 0) {
      throw this.invalid('files', 'Chưa chọn ảnh nào');
    }
    await this.assertProduct(this.db, productId);

    // 1) kiểm tra từng file: dung lượng và chữ ký byte
    const checked = files.map((f, i) => {
      if (f.size === 0 || f.buffer.length === 0) {
        throw this.invalid(`files[${i}]`, `Ảnh "${f.originalname}" bị rỗng`);
      }
      if (f.buffer.length > MAX_IMAGE_BYTES) {
        throw this.invalid(
          `files[${i}]`,
          `Ảnh "${f.originalname}" lớn hơn ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
        );
      }
      const kind = detectImage(f.buffer);
      if (!kind) {
        throw this.invalid(
          `files[${i}]`,
          `"${f.originalname}" không phải ảnh JPEG, PNG hoặc WebP`,
        );
      }
      return {
        file: f,
        kind,
        key: `products/${productId}/${randomUUID()}.${kind.extension}`,
      };
    });
    const existing = await this.imagesOf(this.db, productId);
    if (existing.length + checked.length > MAX_IMAGES_PER_PRODUCT) {
      throw this.invalid(
        'files',
        `Mỗi hàng tối đa ${MAX_IMAGES_PER_PRODUCT} ảnh (đang có ${existing.length}, thêm ${checked.length})`,
      );
    }

    // 2) tải lên kho file; lỗi thì dọn những file đã tải
    const uploaded: string[] = [];
    try {
      for (const c of checked) {
        await this.storage.put(c.key, c.file.buffer, c.kind.contentType);
        uploaded.push(c.key);
      }
      // 3) ghi CSDL (khóa dòng hàng để hai lần tải đồng thời không vượt giới hạn)
      return await this.db.transaction(async (tx) => {
        await tx
          .select({ id: products.id })
          .from(products)
          .where(eq(products.id, productId))
          .for('update');
        const current = await this.imagesOf(tx, productId);
        if (current.length + checked.length > MAX_IMAGES_PER_PRODUCT) {
          throw this.invalid(
            'files',
            `Mỗi hàng tối đa ${MAX_IMAGES_PER_PRODUCT} ảnh`,
          );
        }
        const next = Math.max(-1, ...current.map((i) => i.sortOrder)) + 1;
        await tx.insert(productImages).values(
          checked.map((c, i) => ({
            productId,
            url: this.storage.publicUrl(c.key),
            storageKey: c.key,
            sortOrder: next + i,
          })),
        );
        await this.auditLog.record(tx, {
          action: 'product.images_add',
          entityType: 'product',
          entityId: productId,
          after: { count: checked.length, keys: checked.map((c) => c.key) },
        });
        return this.imagesOf(tx, productId);
      });
    } catch (e) {
      await this.cleanup(uploaded);
      throw e;
    }
  }

  /** Sắp lại thứ tự: `imageIds` phải đúng là tập ảnh hiện có của hàng. Ảnh đầu là ảnh đại diện. */
  async reorder(
    productId: string,
    imageIds: string[],
  ): Promise<ProductImageDto[]> {
    await this.assertProduct(this.db, productId);
    return this.db.transaction(async (tx) => {
      await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, productId))
        .for('update');
      const current = await this.imagesOf(tx, productId);
      const wanted = new Set(imageIds);
      if (
        wanted.size !== imageIds.length ||
        imageIds.length !== current.length ||
        !current.every((i) => wanted.has(i.id))
      ) {
        throw this.invalid(
          'imageIds',
          'Danh sách phải gồm đúng tất cả ảnh hiện có của hàng, mỗi ảnh một lần',
        );
      }
      for (const [index, id] of imageIds.entries()) {
        await tx
          .update(productImages)
          .set({ sortOrder: index })
          .where(
            and(
              eq(productImages.id, id),
              eq(productImages.productId, productId),
            ),
          );
      }
      await this.auditLog.record(tx, {
        action: 'product.images_reorder',
        entityType: 'product',
        entityId: productId,
        before: { imageIds: current.map((i) => i.id) },
        after: { imageIds },
      });
      return this.imagesOf(tx, productId);
    });
  }

  async remove(productId: string, imageId: string): Promise<void> {
    await this.assertProduct(this.db, productId);
    const storageKey = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(productImages)
        .where(
          and(
            eq(productImages.id, imageId),
            eq(productImages.productId, productId),
          ),
        )
        .for('update');
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy ảnh');
      await tx.delete(productImages).where(eq(productImages.id, imageId));
      await this.auditLog.record(tx, {
        action: 'product.images_remove',
        entityType: 'product',
        entityId: productId,
        before: { imageId, url: row.url, storageKey: row.storageKey },
      });
      return row.storageKey;
    });
    // Ảnh nhập từ Excel (URL ngoài) không có storageKey nên không động tới kho file
    if (storageKey) await this.cleanup([storageKey]);
  }

  // ------------------------------------------------------------------ nội bộ

  /** Xóa file trên kho; lỗi chỉ ghi log (file mồ côi vô hại hơn là làm hỏng yêu cầu). */
  private async cleanup(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (e) {
        this.logger.warn(
          `Không xóa được file ${key} trên kho: ${e instanceof Error ? e.name : 'lỗi không rõ'}`,
        );
      }
    }
  }

  private async imagesOf(
    db: Pick<Database, 'select'>,
    productId: string,
  ): Promise<ProductImageDto[]> {
    const rows = await db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, productId))
      .orderBy(asc(productImages.sortOrder), asc(productImages.createdAt));
    return rows.map((r) => ({ id: r.id, url: r.url, sortOrder: r.sortOrder }));
  }

  private async assertProduct(
    db: Pick<Database, 'select'>,
    productId: string,
  ): Promise<void> {
    const [row] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), isNull(products.deletedAt)));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy hàng hóa');
  }

  private invalid(field: string, message: string): AppError {
    return new AppError(400, 'VALIDATION_ERROR', message, [{ field, message }]);
  }
}
