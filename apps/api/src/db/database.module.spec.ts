import { Test } from '@nestjs/testing';
import { DB, DatabaseModule } from './database.module.js';

describe('DatabaseModule', () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it('khởi tạo Drizzle mà không cần kết nối thật (Pool kết nối lười)', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    expect(moduleRef.get(DB)).toBeDefined();
    await moduleRef.close();
  });

  it('báo lỗi rõ ràng khi thiếu DATABASE_URL', async () => {
    delete process.env.DATABASE_URL;

    await expect(
      Test.createTestingModule({ imports: [DatabaseModule] }).compile(),
    ).rejects.toThrow(/DATABASE_URL/);
  });
});
