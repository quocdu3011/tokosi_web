import { Controller, Get, Req, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { configureApp, parseTrustProxy } from './app.setup.js';
import { AppError } from './common/app-error.js';
import { buildPoolConfig } from './db/database.module.js';

@Controller('probe')
class ProbeController {
  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }

  @Get('limited')
  limited() {
    throw new AppError(429, 'RATE_LIMITED', 'Thử lại sau', {
      retryAfterSeconds: 42,
    });
  }
}

describe('parseTrustProxy', () => {
  it('bỏ trống/false → false; true → true; số → số lớp proxy; chuỗi khác giữ nguyên', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });
});

describe('buildPoolConfig', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

  it('mặc định có giới hạn thời gian cho truy vấn và transaction bị bỏ quên', () => {
    expect(buildPoolConfig(base)).toMatchObject({
      connectionString: base.DATABASE_URL,
      max: 10,
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'kiot-api',
    });
  });

  it('đọc được từ biến môi trường; giá trị sai hoặc thiếu DATABASE_URL thì ném lỗi rõ ràng', () => {
    expect(
      buildPoolConfig({
        ...base,
        DB_POOL_MAX: '25',
        DB_STATEMENT_TIMEOUT_MS: '5000',
        DB_IDLE_TX_TIMEOUT_MS: '8000',
      }),
    ).toMatchObject({
      max: 25,
      statement_timeout: 5000,
      idle_in_transaction_session_timeout: 8000,
    });
    for (const bad of ['0', '-1', 'abc', '1.5']) {
      expect(() => buildPoolConfig({ ...base, DB_POOL_MAX: bad })).toThrow(
        /DB_POOL_MAX/,
      );
    }
    expect(() => buildPoolConfig({})).toThrow(/DATABASE_URL/);
  });
});

describe('configureApp: header bảo mật, trust proxy, Retry-After', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  const make = async (trustProxy: boolean | number) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, { trustProxy });
    await app.init();
    return request(app.getHttpServer());
  };

  it('có header bảo mật của helmet và không lộ X-Powered-By; CORS vẫn hoạt động', async () => {
    const http = await make(false);
    const res = await http
      .get('/api/v1/probe/ip')
      .set('Origin', 'http://localhost:3000')
      .expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('không tin proxy (mặc định): giả header X-Forwarded-For KHÔNG đổi được IP', async () => {
    const http = await make(false);
    const res = await http
      .get('/api/v1/probe/ip')
      .set('X-Forwarded-For', '203.0.113.9')
      .expect(200);
    expect(res.body.ip).not.toContain('203.0.113.9');
  });

  it('TRUST_PROXY=1: lấy IP thật từ X-Forwarded-For của proxy', async () => {
    const http = await make(1);
    const res = await http
      .get('/api/v1/probe/ip')
      .set('X-Forwarded-For', '203.0.113.9')
      .expect(200);
    expect(res.body.ip).toBe('203.0.113.9');
  });

  it('lỗi 429 có header Retry-After đúng số giây phải chờ', async () => {
    const http = await make(false);
    const res = await http.get('/api/v1/probe/limited').expect(429);
    expect(res.headers['retry-after']).toBe('42');
    expect(res.body.code).toBe('RATE_LIMITED');
  });
});
