import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import type { StorageConfig } from '../../config/app-config.js';

/**
 * Kho lưu file (ảnh hàng hóa). Token inject: `FileStorage`. Chuẩn S3 nên chạy được với MinIO tự cài,
 * Cloudflare R2 hay AWS S3 chỉ bằng đổi cấu hình. Test thay bằng bản giả trong bộ nhớ.
 */
export abstract class FileStorage {
  /** Lưu file dưới khóa đã cho. */
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Xóa file; khóa không tồn tại không phải lỗi. */
  abstract delete(key: string): Promise<void>;
  /** URL công khai của file (cho thẻ <img>). */
  abstract publicUrl(key: string): string;
  /** Liệt kê mọi file có khóa bắt đầu bằng `prefix` (dùng để dọn file mồ côi). */
  abstract list(prefix: string): Promise<StoredFile[]>;
}

export interface StoredFile {
  key: string;
  lastModified: Date;
}

export class S3FileStorage extends FileStorage {
  private readonly client: S3Client;
  private readonly logger = new Logger(S3FileStorage.name);

  constructor(private readonly config: StorageConfig) {
    super();
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      // MinIO dùng đường dẫn dạng http://host:9000/bucket/key thay vì bucket.host
      forcePathStyle: true,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // tên đối tượng ngẫu nhiên và không đổi nên cho phép trình duyệt giữ bộ nhớ đệm lâu
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (e) {
      this.logger.error(
        `Không tải được ${key} lên kho file: ${e instanceof Error ? e.name : 'lỗi không rõ'}`,
      );
      throw new AppError(
        502,
        'STORAGE_ERROR',
        'Không lưu được ảnh lên kho file. Vui lòng thử lại.',
      );
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  publicUrl(key: string): string {
    return `${this.config.publicBaseUrl}/${key}`;
  }

  async list(prefix: string): Promise<StoredFile[]> {
    const out: StoredFile[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const o of page.Contents ?? []) {
        if (o.Key)
          out.push({ key: o.Key, lastModified: o.LastModified ?? new Date() });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
}

/** Dùng khi chưa cấu hình kho file (dev/test): mọi thao tác ghi báo 503 rõ ràng. */
export class UnconfiguredFileStorage extends FileStorage {
  put(): Promise<void> {
    return Promise.reject(this.error());
  }
  delete(): Promise<void> {
    return Promise.reject(this.error());
  }
  publicUrl(): string {
    throw this.error();
  }
  list(): Promise<StoredFile[]> {
    return Promise.reject(this.error());
  }
  private error(): AppError {
    return new AppError(
      503,
      'STORAGE_NOT_CONFIGURED',
      'Chưa cấu hình kho lưu file ảnh (S3_ENDPOINT, S3_BUCKET… trong .env)',
    );
  }
}
