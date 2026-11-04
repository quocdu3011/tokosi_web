import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { configureApp } from '../app.setup.js';
import { describeErrorForLog } from './all-exceptions.filter.js';
import { AppError } from './app-error.js';

class ItemDto {
  @IsInt()
  @Min(1)
  qty!: number;
}

class OrderDto {
  @IsString()
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items!: ItemDto[];
}

@Controller('probe')
class ProbeController {
  @Post('order')
  order(@Body() dto: OrderDto) {
    return dto;
  }

  @Get('app-error')
  appError() {
    throw new AppError(422, 'STOCK_NOT_ENOUGH', 'Không đủ tồn', [
      { field: 'items[0].qty', available: '120' },
    ]);
  }

  @Get('http-exception')
  httpException() {
    throw new HttpException('xấu', 418);
  }

  @Get('query-fail')
  queryFail() {
    const cause = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint: 'users_username_unique',
      table: 'users',
      detail: 'Key (username)=(nguyen.van.a) already exists.',
    });
    throw new Error(
      `Failed query: insert into "users" ("full_name","phone","password_hash") values ($1,$2,$3)${String.fromCharCode(10)}params: Nguyễn Văn Ân,0901234567,$argon2id$v=19$SECRET`,
      { cause },
    );
  }

  @Get('boom')
  boom() {
    throw new Error('mat khau db = secret-123 tai host noi-bo');
  }
}

describe('Hợp đồng lỗi { code, message, details, requestId }', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('lỗi nghiệp vụ (AppError): giữ nguyên code/message/details, thêm requestId', async () => {
    const res = await http().get('/api/v1/probe/app-error').expect(422);
    expect(res.body).toEqual({
      code: 'STOCK_NOT_ENOUGH',
      message: 'Không đủ tồn',
      details: [{ field: 'items[0].qty', available: '120' }],
      requestId: expect.any(String),
    });
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('ValidationPipe: 400 VALIDATION_ERROR, details là [{ field, message }] kể cả field lồng nhau', async () => {
    const res = await http()
      .post('/api/v1/probe/order')
      .send({ items: [{ qty: 0 }, { qty: 2 }] })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.requestId).toEqual(expect.any(String));
    const fields = (res.body.details as Array<{ field: string }>).map(
      (d) => d.field,
    );
    expect(fields).toContain('name');
    expect(fields).toContain('items[0].qty');
    for (const d of res.body.details) {
      expect(d).toEqual({
        field: expect.any(String),
        message: expect.any(String),
      });
    }
  });

  it('field lạ bị từ chối cũng theo hợp đồng', async () => {
    const res = await http()
      .post('/api/v1/probe/order')
      .send({ name: 'a', items: [], thua: 1 })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details[0].field).toBe('thua');
  });

  it('404 đường dẫn không tồn tại → NOT_FOUND tiếng Việt, có requestId', async () => {
    const res = await http().get('/api/v1/khong-co').expect(404);
    expect(res.body).toEqual({
      code: 'NOT_FOUND',
      message: expect.any(String),
      requestId: expect.any(String),
    });
  });

  it('HttpException mặc định của Nest được đổi sang code ổn định', async () => {
    const res = await http().get('/api/v1/probe/http-exception').expect(418);
    expect(res.body.code).toBe('HTTP_418');
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it('JSON hỏng → 400 BAD_REQUEST theo hợp đồng (không phải trang lỗi của Express)', async () => {
    const res = await http()
      .post('/api/v1/probe/order')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400);
    expect(res.body.code).toBe('BAD_REQUEST');
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it('lỗi bất ngờ → 500 INTERNAL_ERROR, KHÔNG lộ nội dung lỗi/stack, nhưng có ghi log kèm requestId', async () => {
    const spy = vi
      .spyOn((await import('@nestjs/common')).Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const res = await http().get('/api/v1/probe/boom').expect(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/secret-123|noi-bo|at /);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]![0])).toContain(res.body.requestId);
    spy.mockRestore();
  });

  it('X-Request-Id hợp lệ do bên gọi gửi được giữ nguyên; giá trị bậy bị thay', async () => {
    const ok = await http()
      .get('/api/v1/khong-co')
      .set('X-Request-Id', 'client-req-12345')
      .expect(404);
    expect(ok.body.requestId).toBe('client-req-12345');
    const bad = await http()
      .get('/api/v1/khong-co')
      .set('X-Request-Id', 'a b <script>')
      .expect(404);
    expect(bad.body.requestId).not.toContain('<');
    expect(bad.body.requestId.length).toBeGreaterThanOrEqual(8);
  });

  it('log lỗi 500 của truy vấn CSDL KHÔNG chứa SQL, tham số, họ tên, SĐT, băm mật khẩu hay giá trị khóa trùng; vẫn có mã PG, tên ràng buộc và requestId', async () => {
    const spy = vi
      .spyOn((await import('@nestjs/common')).Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const res = await http().get('/api/v1/probe/query-fail').expect(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    const logged = spy.mock.calls
      .map((c) => c.map(String).join(' '))
      .join(' | ');
    spy.mockRestore();
    expect(logged).toContain(res.body.requestId);
    expect(logged).toContain('23505');
    expect(logged).toContain('users_username_unique');
    expect(logged).not.toMatch(
      /Nguyễn|0901234567|argon2|SECRET|nguyen\.van\.a|insert into|params:/,
    );
  });

  it('describeErrorForLog: lỗi thường vẫn ghi đầy đủ stack', () => {
    const e = new Error('lỗi logic bình thường');
    expect(describeErrorForLog(e)).toContain('lỗi logic bình thường');
    expect(describeErrorForLog('chuỗi')).toBe('chuỗi');
  });
});
