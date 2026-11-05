/**
 * Chuẩn bị kho file cho dev: tạo bucket (nếu chưa có) và cho phép ĐỌC công khai để thẻ <img> dùng được URL ảnh.
 * Chạy: `pnpm --filter @kiot/api storage:init` sau khi bật MinIO (`pnpm db:up`). Chạy lại an toàn.
 * Production: tạo bucket và chính sách đọc công khai bằng công cụ của nhà cung cấp (R2, S3…), không dùng script này.
 */
import 'dotenv/config';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { loadConfig } from '../../config/app-config.js';

const storage = loadConfig().storage;
if (!storage) {
  throw new Error(
    'Chưa cấu hình kho file: đặt S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, FILE_PUBLIC_BASE_URL trong .env',
  );
}
if (process.env.NODE_ENV === 'production') {
  throw new Error('Script này chỉ dùng cho môi trường dev');
}

const client = new S3Client({
  endpoint: storage.endpoint,
  region: storage.region,
  credentials: {
    accessKeyId: storage.accessKey,
    secretAccessKey: storage.secretKey,
  },
  forcePathStyle: true,
});

// MinIO có thể chưa nhận kết nối ngay sau khi container khởi động: thử lại vài lần
async function exists(): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: storage!.bucket }));
      return true;
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) return false;
      if (attempt >= 15) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

try {
  if (await exists()) {
    console.log(`Bucket "${storage.bucket}" đã có`);
  } else {
    await client.send(new CreateBucketCommand({ Bucket: storage.bucket }));
    console.log(`Đã tạo bucket "${storage.bucket}"`);
  }
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: storage.bucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${storage.bucket}/*`],
          },
        ],
      }),
    }),
  );
  console.log(`Cho phép đọc công khai: ${storage.publicBaseUrl}/<khóa>`);
} finally {
  client.destroy();
}
