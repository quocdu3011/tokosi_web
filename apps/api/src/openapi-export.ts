/**
 * Xuất đặc tả OpenAPI ra file để frontend sinh kiểu TypeScript mà không cần chạy server.
 * Chạy: `pnpm openapi:export` (trong apps/api) → ghi `docs/api/openapi.json`.
 * Không cần kết nối CSDL thật (Pool kết nối lười).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { createOpenApiDocument } from './openapi.js';

process.env.DATABASE_URL ??= 'postgresql://export:export@localhost:5432/export';
// Khóa giả chỉ để dựng ứng dụng khi xuất đặc tả (không dùng để ký token thật)
process.env.JWT_ACCESS_SECRET ??=
  'openapi-export-placeholder-secret-0123456789';

const outFile = resolve(process.argv[2] ?? '../../docs/api/openapi.json');

const app = await NestFactory.create(AppModule, { logger: false });
configureApp(app);
await app.init();

const document = createOpenApiDocument(app);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(document, null, 2) + '\n', 'utf8');
await app.close();

console.log(`Đã ghi ${outFile}`);
