import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { S3FileStorage, UnconfiguredFileStorage } from './file-storage.js';

interface Captured {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

/** Máy chủ S3 giả: ghi lại yêu cầu và trả mã định sẵn. Đủ để kiểm tra dạng yêu cầu mà AWS SDK gửi đi. */
describe('S3FileStorage (máy chủ S3 giả cục bộ)', () => {
  let server: Server;
  let endpoint: string;
  let captured: Captured[] = [];
  let respondWith = 200;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        captured.push({
          method: req.method ?? '',
          path: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks),
        });
        if (req.method === 'GET' && (req.url ?? '').includes('list-type=2')) {
          const token = new URL(req.url ?? '', 'http://x').searchParams.get(
            'continuation-token',
          );
          const page = token
            ? ['products/b/3.png']
            : ['products/a/1.png', 'products/a/2.png'];
          const contents = page
            .map(
              (k) =>
                `<Contents><Key>${k}</Key><LastModified>2026-11-01T00:00:00.000Z</LastModified><Size>3</Size></Contents>`,
            )
            .join('');
          const next = token
            ? ''
            : '<NextContinuationToken>trang-2</NextContinuationToken>';
          res.setHeader('Content-Type', 'application/xml');
          res.end(
            `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>product-images</Name><Prefix>products/</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>2</MaxKeys><IsTruncated>${token ? 'false' : 'true'}</IsTruncated>${next}${contents}</ListBucketResult>`,
          );
          return;
        }
        res.statusCode = respondWith;
        if (respondWith >= 400) {
          res.setHeader('Content-Type', 'application/xml');
          res.end(
            '<?xml version="1.0"?><Error><Code>InternalError</Code><Message>x</Message></Error>',
          );
        } else {
          res.end();
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });
  beforeEach(() => {
    captured = [];
    respondWith = 200;
  });

  const make = () =>
    new S3FileStorage({
      endpoint,
      region: 'us-east-1',
      bucket: 'product-images',
      accessKey: 'khoa-thu',
      secretKey: 'bi-mat-thu',
      publicBaseUrl: 'https://files.example.test/product-images',
    });

  it('put: PUT theo kiểu đường dẫn /bucket/khóa, kèm Content-Type, Cache-Control dài hạn, chữ ký và đúng nội dung', async () => {
    const body = Buffer.from('noi dung anh');
    await make().put('products/abc/x.png', body, 'image/png');
    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.method).toBe('PUT');
    expect(req.path.split('?')[0]).toBe('/product-images/products/abc/x.png');
    expect(req.headers['content-type']).toBe('image/png');
    expect(req.headers['cache-control']).toContain('immutable');
    expect(req.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=khoa-thu\//,
    );
    expect(req.body.toString()).toBe('noi dung anh');
  });

  it('delete: DELETE đúng khóa', async () => {
    respondWith = 204;
    await make().delete('products/abc/x.png');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.method).toBe('DELETE');
    expect(captured[0]!.path.split('?')[0]).toBe(
      '/product-images/products/abc/x.png',
    );
  });

  it('put lỗi từ kho (HTTP 500) → AppError 502 STORAGE_ERROR, không lộ chi tiết nội bộ', async () => {
    respondWith = 500;
    await expect(
      make().put('products/abc/y.png', Buffer.from('x'), 'image/png'),
    ).rejects.toMatchObject({
      status: 502,
      response: { code: 'STORAGE_ERROR' },
    });
  }, 30_000);

  it('list: liệt kê qua nhiều trang (ContinuationToken) và trả đúng khóa + thời điểm sửa', async () => {
    const files = await make().list('products/');
    expect(files.map((f) => f.key)).toEqual([
      'products/a/1.png',
      'products/a/2.png',
      'products/b/3.png',
    ]);
    expect(files[0]!.lastModified.toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(captured.filter((c) => c.method === 'GET')).toHaveLength(2);
  });

  it('publicUrl ghép địa chỉ công khai với khóa đối tượng', () => {
    expect(make().publicUrl('products/abc/x.png')).toBe(
      'https://files.example.test/product-images/products/abc/x.png',
    );
  });
});

describe('UnconfiguredFileStorage', () => {
  it('mọi thao tác báo 503 STORAGE_NOT_CONFIGURED', async () => {
    const s = new UnconfiguredFileStorage();
    await expect(s.put()).rejects.toMatchObject({ status: 503 });
    await expect(s.delete()).rejects.toMatchObject({ status: 503 });
    expect(() => s.publicUrl()).toThrow();
  });
});
