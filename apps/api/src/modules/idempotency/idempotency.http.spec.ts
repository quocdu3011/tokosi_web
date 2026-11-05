import { Body, Controller, Module, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../common/app-error.js';
import { idempotencyKeys } from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { canonicalJson } from './canonical-json.js';
import { Idempotent } from './idempotent.decorator.js';
import { IdempotencyModule } from './idempotency.module.js';

let executions = 0;
let delayMs = 0;

@Controller('probe-doc')
class ProbeController {
  @Post('create')
  @Idempotent()
  async create(@Body() body: { n?: number; fail?: boolean }) {
    executions++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (body.fail) throw new AppError(422, 'STOCK_NOT_ENOUGH', 'Không đủ tồn');
    return { id: randomUUID(), execution: executions, n: body.n ?? 0 };
  }

  @Post('plain')
  plain() {
    executions++;
    return { execution: executions };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('canonicalJson', () => {
  it('cùng nội dung khác thứ tự khóa → cùng chuỗi; khác nội dung → khác chuỗi', () => {
    expect(canonicalJson({ a: 1, b: { c: [1, { y: 2, x: 1 }] } })).toBe(
      canonicalJson({ b: { c: [1, { x: 1, y: 2 }] }, a: 1 }),
    );
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: '1' }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe(canonicalJson({ b: 1 }));
  });
});

describe('Idempotency-Key qua HTTP', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  const post = async (
    user: string,
    key: string | null,
    body: object = {},
    branch?: string,
  ) => {
    const api = await t.as(user, branch);
    const req = api.post('/probe-doc/create').send(body);
    if (key !== null) req.set('Idempotency-Key', key);
    return req;
  };

  beforeAll(async () => {
    t = await createHttpTestApp({ imports: [IdempotencyModule, ProbeModule] });
    await t.makeUser('sale1', 'sales', [t.sg]);
    await t.makeUser('sale2', 'sales', [t.sg]);
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });

  it('thiếu hoặc sai dạng Idempotency-Key → 400 VALIDATION_ERROR (handler không chạy)', async () => {
    executions = 0;
    for (const key of [
      null,
      'ngan',
      'co dau cach trong khoa',
      'x'.repeat(129),
    ]) {
      const res = await post('sale1', key);
      expect(res.status).toBe(400);
      expect(res.body.details[0].field).toBe('Idempotency-Key');
    }
    expect(executions).toBe(0);
  });

  it('gửi lại CÙNG khóa + cùng nội dung: không chạy lại, trả đúng kết quả lần đầu (cùng id, cùng mã 201), có header Idempotent-Replay', async () => {
    executions = 0;
    const key = `khoa-${randomUUID()}`;
    const first = await post('sale1', key, { n: 5 });
    expect(first.status).toBe(201);
    const again = await post('sale1', key, { n: 5 });
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(first.headers['idempotent-replay']).toBeUndefined();
    expect(executions).toBe(1);
    // thứ tự khóa trong body khác nhau vẫn là cùng nội dung
    await post('sale1', `khoa-${randomUUID()}`, { n: 1, fail: false });
  });

  it('cùng khóa nhưng NỘI DUNG khác → 409 IDEMPOTENCY_CONFLICT, handler không chạy', async () => {
    executions = 0;
    const key = `khoa-${randomUUID()}`;
    await post('sale1', key, { n: 1 }).then((r) => expect(r.status).toBe(201));
    const res = await post('sale1', key, { n: 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(executions).toBe(1);
  });

  it('khóa là của TỪNG người dùng: hai người dùng cùng một chuỗi khóa không đụng nhau', async () => {
    executions = 0;
    const key = `khoa-${randomUUID()}`;
    const a = await post('sale1', key, { n: 1 });
    const b = await post('sale2', key, { n: 1 });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).not.toBe(b.body.id);
    expect(executions).toBe(2);
  });

  it('handler lỗi → nhả khóa: sửa lỗi rồi gửi lại CÙNG khóa thì chạy lại bình thường', async () => {
    executions = 0;
    const key = `khoa-${randomUUID()}`;
    const failed = await post('sale1', key, { n: 1, fail: true });
    expect(failed.status).toBe(422);
    expect(failed.body.code).toBe('STOCK_NOT_ENOUGH');
    expect(
      await t.db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, key)),
    ).toHaveLength(0);
    // nội dung đã sửa (không còn lỗi) nhưng vẫn dùng khóa cũ
    const ok = await post('sale1', key, { n: 1 });
    expect(ok.status).toBe(201);
    expect(executions).toBe(2);
  });

  it('hai yêu cầu CÙNG khóa gửi song song: chỉ MỘT bên được chạy, bên kia 409 REQUEST_IN_PROGRESS; sau đó gửi lại nhận kết quả', async () => {
    executions = 0;
    delayMs = 150;
    try {
      const key = `khoa-${randomUUID()}`;
      const [a, b] = await Promise.all([
        post('sale1', key, { n: 9 }),
        post('sale1', key, { n: 9 }),
      ]);
      const statuses = [a.status, b.status].sort((x, y) => x - y);
      expect(statuses).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.code).toBe('REQUEST_IN_PROGRESS');
      expect(executions).toBe(1);
      const winner = a.status === 201 ? a : b;
      const replay = await post('sale1', key, { n: 9 });
      expect(replay.body).toEqual(winner.body);
      expect(executions).toBe(1);
    } finally {
      delayMs = 0;
    }
  });

  it('khóa đã hết hạn được coi như mới; purgeExpired dọn khóa hết hạn', async () => {
    executions = 0;
    const key = `khoa-${randomUUID()}`;
    await post('sale1', key, { n: 1 });
    await t.db
      .update(idempotencyKeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(idempotencyKeys.key, key));
    const again = await post('sale1', key, { n: 1 });
    expect(again.status).toBe(201);
    expect(executions).toBe(2); // chạy lại vì khóa cũ đã hết hạn

    await t.db
      .update(idempotencyKeys)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(idempotencyKeys.key, key));
    const { IdempotencyService } = await import('./idempotency.service.js');
    const removed = await new IdempotencyService(t.db).purgeExpired();
    expect(removed).toBeGreaterThanOrEqual(1);
  });

  it('endpoint KHÔNG gắn @Idempotent không bị ảnh hưởng (không cần header)', async () => {
    const api = await t.as('sale1');
    const res = await api.post('/probe-doc/plain').send({});
    expect(res.status).toBe(201);
  });
});
