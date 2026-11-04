import { SignJWT } from 'jose';
import { loadConfig } from '../../config/app-config.js';
import {
  TokenService,
  generateRefreshToken,
  hashRefreshToken,
} from './token.service.js';

const SECRET = 'test-secret-test-secret-test-secret-0123';
const config = loadConfig({ JWT_ACCESS_SECRET: SECRET });
const service = new TokenService(config);

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('TokenService – access token', () => {
  it('ký rồi xác minh ra đúng id người dùng, sống đúng thời hạn', async () => {
    const { token, expiresIn } = await service.signAccessToken('user-1');
    expect(expiresIn).toBe(900);
    expect(token.split('.')).toHaveLength(3);
    expect(await service.verifyAccessToken(token)).toBe('user-1');
  });

  it('token chỉ chứa id người dùng, không chứa vai trò hay quyền', async () => {
    const { token } = await service.signAccessToken('user-1');
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1]!, 'base64url').toString(),
    );
    expect(Object.keys(payload).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'sub',
    ]);
  });

  it('hết hạn → TOKEN_EXPIRED; còn hạn đến giây cuối cùng', async () => {
    const issued = new Date('2026-11-04T08:00:00Z');
    const { token } = await service.signAccessToken('u', issued);
    await expect(
      service.verifyAccessToken(token, new Date(issued.getTime() + 899_000)),
    ).resolves.toBe('u');
    await expect(
      service.verifyAccessToken(token, new Date(issued.getTime() + 901_000)),
    ).rejects.toMatchObject({
      status: 401,
      code: 'TOKEN_EXPIRED',
    });
  });

  it('chữ ký sai (khóa khác) hoặc bị sửa → UNAUTHENTICATED', async () => {
    const other = new TokenService(
      loadConfig({
        JWT_ACCESS_SECRET: 'khac-khac-khac-khac-khac-khac-khac-01',
      }),
    );
    const { token } = await other.signAccessToken('u');
    await expect(service.verifyAccessToken(token)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });

    const { token: good } = await service.signAccessToken('u');
    const [h, p, s] = good.split('.');
    const forged = b64({
      ...JSON.parse(Buffer.from(p!, 'base64url').toString()),
      sub: 'admin',
    });
    await expect(
      service.verifyAccessToken(`${h}.${forged}.${s}`),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('từ chối thuật toán "none" và thuật toán khác HS256', async () => {
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      sub: 'u',
      iss: 'kiot-api',
      aud: 'kiot-web',
      exp: Math.floor(Date.now() / 1000) + 600,
    })}.`;
    await expect(service.verifyAccessToken(unsigned)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    const hs512 = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('u')
      .setIssuer('kiot-api')
      .setAudience('kiot-web')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(SECRET));
    await expect(service.verifyAccessToken(hs512)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('từ chối sai issuer / audience / thiếu sub', async () => {
    const key = new TextEncoder().encode(SECRET);
    const base = () =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('10m');
    const wrongIssuer = await base()
      .setSubject('u')
      .setIssuer('ai-do')
      .setAudience('kiot-web')
      .sign(key);
    const wrongAudience = await base()
      .setSubject('u')
      .setIssuer('kiot-api')
      .setAudience('khac')
      .sign(key);
    const noSubject = await base()
      .setIssuer('kiot-api')
      .setAudience('kiot-web')
      .sign(key);
    for (const t of [wrongIssuer, wrongAudience, noSubject]) {
      await expect(service.verifyAccessToken(t)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    }
  });

  it('rác không phải JWT → UNAUTHENTICATED', async () => {
    for (const t of ['', 'abc', 'a.b.c', 'Bearer x']) {
      await expect(service.verifyAccessToken(t)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHENTICATED',
      });
    }
  });
});

describe('refresh token', () => {
  it('ngẫu nhiên, đủ dài, khác nhau mỗi lần', () => {
    const a = generateRefreshToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateRefreshToken()).not.toBe(a);
  });

  it('băm SHA-256 ổn định và không chứa token gốc', () => {
    const t = generateRefreshToken();
    expect(hashRefreshToken(t)).toBe(hashRefreshToken(t));
    expect(hashRefreshToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(t)).not.toContain(t);
    expect(hashRefreshToken(t)).not.toBe(hashRefreshToken(`${t}x`));
  });
});
