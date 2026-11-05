import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, userIdentities, users } from '../../db/schema/index.js';
import { createHttpTestApp } from '../../test-utils/http-app.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { UsersModule } from '../users/users.module.js';
import { GoogleAuthModule } from './google-auth.module.js';
import { MAX_PENDING_ACCOUNTS } from './google-auth.service.js';
import { SUPABASE_KEYS } from './supabase-jwt.verifier.js';

process.env.SUPABASE_URL = 'https://abcd.supabase.co';
process.env.LOGIN_MAX_FAILURES = '1000';

const ISS = 'https://abcd.supabase.co/auth/v1';
const GOOD_PW = 'Mat-khau-google-thu-1';

describe('Đăng nhập / đăng ký bằng Google (Supabase)', () => {
  let t: Awaited<ReturnType<typeof createHttpTestApp>>;
  let privateKey: CryptoKey;
  let otherKey: CryptoKey;
  let seq = 0;

  async function supabaseToken(
    over: {
      sub?: string;
      email?: string;
      provider?: string;
      verified?: boolean;
      aud?: string;
      iss?: string;
      exp?: number;
      key?: CryptoKey;
    } = {},
  ): Promise<string> {
    const sub = over.sub ?? `g-${++seq}`;
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      email: over.email ?? `${sub}@congty.vn`,
      app_metadata: { provider: over.provider ?? 'google' },
      user_metadata: {
        email_verified: over.verified ?? true,
        full_name: 'Nguyễn Văn Gu',
      },
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject(sub)
      .setIssuer(over.iss ?? ISS)
      .setAudience(over.aud ?? 'authenticated')
      .setIssuedAt(now)
      .setExpirationTime(over.exp ?? now + 3600)
      .sign(over.key ?? privateKey);
  }

  const loginG = (accessToken: string) =>
    t.http().post('/api/v1/auth/google').send({ accessToken });
  const signupBody = (signupToken: string, over: object = {}) => ({
    signupToken,
    username: 'nguyenvana',
    password: GOOD_PW,
    fullName: 'Nguyễn Văn A',
    phone: '0901234567',
    ...over,
  });
  const signupG = (body: object) =>
    t.http().post('/api/v1/auth/google/signup').send(body);

  async function setSettings(body: object) {
    return (await t.as('quanly')).patch('/settings/auth').send(body);
  }
  /** Lấy signupToken cho một danh tính Google mới (công tắc phải đang bật). */
  async function getSignupToken(sub?: string): Promise<string> {
    const res = await loginG(await supabaseToken({ sub })).expect(202);
    return res.body.signupToken as string;
  }

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    otherKey = (await generateKeyPair('ES256')).privateKey;
    const jwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: 'k1',
      alg: 'ES256',
    };
    t = await createHttpTestApp({
      imports: [GoogleAuthModule, UsersModule, CatalogModule],
      overrides: [[SUPABASE_KEYS, createLocalJWKSet({ keys: [jwk] })]],
    });
    await t.makeUser('sale1', 'sales', [t.sg]);
  });
  afterAll(async () => {
    await t.close();
  });

  it('token Supabase sai chữ ký / aud / iss / hết hạn / không phải Google / email chưa xác minh → 401', async () => {
    const bad = [
      await supabaseToken({ key: otherKey }),
      await supabaseToken({ aud: 'anon' }),
      await supabaseToken({ iss: 'https://evil.supabase.co/auth/v1' }),
      await supabaseToken({ exp: Math.floor(Date.now() / 1000) - 10 }),
      await supabaseToken({ provider: 'email' }),
      await supabaseToken({ verified: false }),
      'khong.phai.jwt-hop-le-nhung-du-dai-de-qua-validator',
    ];
    for (const token of bad) {
      const res = await loginG(token);
      expect(res.status, token.slice(0, 20)).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    }
  });

  it('mặc định tắt tự đăng ký: người chưa có tài khoản nhận 403 SIGNUP_DISABLED và không tạo gì', async () => {
    const before = await t.db.select().from(users);
    const res = await loginG(await supabaseToken()).expect(403);
    expect(res.body.code).toBe('SIGNUP_DISABLED');
    expect(await t.db.select().from(users)).toHaveLength(before.length);
  });

  it('cài đặt: chỉ Quản lý; bật mà không có tên miền → 400; tên miền sai định dạng → 400; có ghi nhật ký', async () => {
    const sale = await t.as('sale1', t.sg);
    await sale.get('/settings/auth').expect(403);
    await sale
      .patch('/settings/auth')
      .send({ googleSignupEnabled: true })
      .expect(403);

    const manager = await t.as('quanly');
    const initial = await manager.get('/settings/auth').expect(200);
    expect(initial.body).toEqual({
      googleSignupEnabled: false,
      googleSignupDomains: [],
    });
    expect((await setSettings({ googleSignupEnabled: true })).status).toBe(400);
    expect((await manager.get('/settings/auth')).body.googleSignupEnabled).toBe(
      false,
    );
    expect(
      (await setSettings({ googleSignupDomains: ['khong hop le'] })).status,
    ).toBe(400);

    const ok = await setSettings({
      googleSignupEnabled: true,
      googleSignupDomains: [' @CongTy.vn ', 'congty.vn'],
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      googleSignupEnabled: true,
      googleSignupDomains: ['congty.vn'],
    });
    const log = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'settings.auth_update'));
    expect(log).toHaveLength(1);
    expect(log[0]!.before).toMatchObject({ googleSignupEnabled: false });
  });

  it('tên miền không nằm trong danh sách → 403; đúng tên miền → 202 kèm signupToken và chưa tạo user', async () => {
    const before = await t.db.select().from(users);
    const wrong = await loginG(
      await supabaseToken({ email: 'ai-do@gmail.com' }),
    ).expect(403);
    expect(wrong.body.code).toBe('SIGNUP_DISABLED');

    const res = await loginG(
      await supabaseToken({ sub: 'g-moi', email: 'An@CongTy.vn' }),
    ).expect(202);
    expect(res.body).toMatchObject({
      status: 'signup_required',
      email: 'an@congty.vn',
      suggestedName: 'Nguyễn Văn Gu',
    });
    expect(res.body.signupToken).toEqual(expect.any(String));
    expect(await t.db.select().from(users)).toHaveLength(before.length);
  });

  it('đăng ký: validate tên đăng nhập, mật khẩu, SĐT; sai thì không tạo gì', async () => {
    const tok = await getSignupToken('g-validate');
    const cases: Array<[object, string]> = [
      [{ username: 'Ab' }, 'username'],
      [{ username: 'có dấu' }, 'username'],
      [{ password: 'ngan' }, 'password'],
      [{ password: 'nguyenvana-nguyenvana' }, 'password'],
      [{ phone: '123' }, 'phone'],
    ];
    for (const [over, field] of cases) {
      const res = await signupG(signupBody(tok, over));
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(res.body.details[0].field).toBe(field);
    }
    expect(
      await t.db.select().from(users).where(eq(users.username, 'nguyenvana')),
    ).toHaveLength(0);
  });

  it('đăng ký thành công: user chờ cấp quyền, không quyền, không chi nhánh; chỉ vào được /auth/me', async () => {
    const tok = await getSignupToken('g-a');
    const res = await signupG(
      signupBody(tok, { phone: '+84901234567' }),
    ).expect(201);
    expect(res.body.user).toMatchObject({
      username: 'nguyenvana',
      fullName: 'Nguyễn Văn A',
      role: 'pending',
      permissions: [],
      branches: [],
      mustChangePassword: false,
    });
    expect(res.headers['set-cookie']?.[0]).toContain('refresh_token=');
    const [u] = await t.db
      .select()
      .from(users)
      .where(eq(users.username, 'nguyenvana'));
    expect(u).toMatchObject({ role: 'pending', phone: '0901234567' });
    const ids = await t.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, u!.id));
    expect(ids).toMatchObject([
      { provider: 'google', providerSubject: 'g-a', email: 'g-a@congty.vn' },
    ]);

    const auth = { Authorization: `Bearer ${res.body.accessToken as string}` };
    await t.http().get('/api/v1/auth/me').set(auth).expect(200);
    // mọi endpoint nghiệp vụ bị chặn
    for (const url of [
      '/products',
      '/categories',
      '/users',
      '/roles',
      '/settings/auth',
    ]) {
      const r = await t.http().get(`/api/v1${url}`).set(auth);
      expect(r.status, `${url} → ${r.status}`).toBe(403);
    }
    // đăng nhập mật khẩu vẫn dùng được
    await t
      .http()
      .post('/api/v1/auth/login')
      .send({ username: 'nguyenvana', password: GOOD_PW })
      .expect(200);
    const logs = await t.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'auth.google_signup'));
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs[0])).not.toContain(GOOD_PW);
  });

  it('đăng ký đồng thời cùng tài khoản Google → chỉ một bên thắng; sau đó đăng nhập Google vào thẳng tài khoản cũ', async () => {
    const tok = await getSignupToken('g-dup');
    const [a, b] = await Promise.all([
      signupG(signupBody(tok, { username: 'trung-google-1' })),
      signupG(signupBody(tok, { username: 'trung-google-2' })),
    ]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe('GOOGLE_ALREADY_REGISTERED');

    const res = await loginG(await supabaseToken({ sub: 'g-dup' })).expect(200);
    expect(res.body.user.role).toBe('pending');
    expect(res.headers['set-cookie']?.[0]).toContain('refresh_token=');
  });

  it('tên đăng nhập đã dùng → 409 và token vẫn dùng lại được với tên khác', async () => {
    const tok = await getSignupToken('g-name');
    const res = await signupG(signupBody(tok, { username: 'quanly' }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_USERNAME');
    await signupG(signupBody(tok, { username: 'ten-khac-ok' })).expect(201);
  });

  it('signupToken: access token thường hoặc chuỗi bậy không dùng được; signupToken không dùng làm access token', async () => {
    const login = await t
      .http()
      .post('/api/v1/auth/login')
      .send({ username: 'sale1', password: 'Mat-khau-nhan-vien-1' })
      .expect(200);
    const res = await signupG(
      signupBody(login.body.accessToken as string, { username: 'xxx-1' }),
    );
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SIGNUP_TOKEN_INVALID');
    expect(
      (await signupG(signupBody('bay', { username: 'xxx-2' }))).status,
    ).toBe(401);
    // token cùng khóa/iss nhưng sai aud (có đủ email) cũng bị từ chối: chỉ aud phân biệt hai loại token
    const forged = await new SignJWT({ email: 'gia@congty.vn' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('g-gia')
      .setIssuer('kiot-api')
      .setAudience('kiot-web')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));
    expect(
      (await signupG(signupBody(forged, { username: 'xxx-3' }))).status,
    ).toBe(401);
    const tok = await getSignupToken('g-typ');
    await t
      .http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tok}`)
      .expect(401);
  });

  it('tắt công tắc giữa chừng: signupToken đã phát không còn tạo được tài khoản; người cũ vẫn đăng nhập được', async () => {
    const tok = await getSignupToken('g-off');
    expect((await setSettings({ googleSignupEnabled: false })).status).toBe(
      200,
    );
    const res = await signupG(signupBody(tok, { username: 'sau-khi-tat' }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SIGNUP_DISABLED');
    await loginG(await supabaseToken({ sub: 'g-a' })).expect(200);
    expect((await setSettings({ googleSignupEnabled: true })).status).toBe(200);
  });

  it('Quản lý cấp vai trò + chi nhánh thì có hiệu lực ngay, không cần đăng nhập lại', async () => {
    const login = await loginG(await supabaseToken({ sub: 'g-a' })).expect(200);
    const auth = {
      Authorization: `Bearer ${login.body.accessToken as string}`,
    };
    await t
      .http()
      .get('/api/v1/products')
      .set(auth)
      .set('X-Branch-Id', t.sg)
      .expect(403);

    const manager = await t.as('quanly');
    const list = await manager.get('/users?role=pending').expect(200);
    const target = list.body.data.find(
      (u: { username: string }) => u.username === 'nguyenvana',
    );
    expect(target.role).toBe('pending');
    // chưa gán chi nhánh thì không đổi sang vai trò thật được
    await manager
      .patch(`/users/${target.id}`)
      .send({ role: 'sales' })
      .expect(400);
    await manager
      .put(`/users/${target.id}/branches`)
      .send({ branchIds: [t.sg] })
      .expect(200);
    await manager
      .patch(`/users/${target.id}`)
      .send({ role: 'sales' })
      .expect(200);

    const me = await t.http().get('/api/v1/auth/me').set(auth).expect(200);
    expect(me.body.role).toBe('sales');
    expect(me.body.permissions.length).toBeGreaterThan(0);
    await t
      .http()
      .get('/api/v1/products')
      .set(auth)
      .set('X-Branch-Id', t.sg)
      .expect(200);
  });

  it('tài khoản bị khóa không đăng nhập Google được', async () => {
    const tok = await getSignupToken('g-lock');
    await signupG(signupBody(tok, { username: 'bi-khoa' })).expect(201);
    const [u] = await t.db
      .select()
      .from(users)
      .where(eq(users.username, 'bi-khoa'));
    await t.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, u!.id));
    const res = await loginG(await supabaseToken({ sub: 'g-lock' })).expect(
      401,
    );
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('giới hạn số tài khoản đang chờ cấp quyền', async () => {
    const tok = await getSignupToken('g-cap');
    const pendings = await t.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'pending'), eq(users.isActive, true)));
    for (let i = pendings.length; i < MAX_PENDING_ACCOUNTS; i++) {
      await t.makeUser(`cho-${i}`, 'pending');
    }
    const res = await signupG(signupBody(tok, { username: 'vuot-gioi-han' }));
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('SIGNUP_LIMIT');
  });
});
