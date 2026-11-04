import { MIN_JWT_SECRET_LENGTH, loadConfig } from './app-config.js';

const SECRET = 'a'.repeat(MIN_JWT_SECRET_LENGTH);

describe('loadConfig', () => {
  it('đọc cấu hình và dùng mặc định hợp lý', () => {
    const c = loadConfig({ JWT_ACCESS_SECRET: SECRET });
    expect(c).toEqual({
      jwtAccessSecret: SECRET,
      accessTtlSeconds: 900,
      refreshTtlDays: 14,
      cookieSecure: false,
      loginMaxFailures: 5,
      loginWindowSeconds: 900,
    });
  });

  it('không khởi động với khóa thiếu hoặc quá ngắn', () => {
    expect(() => loadConfig({})).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadConfig({ JWT_ACCESS_SECRET: '' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() => loadConfig({ JWT_ACCESS_SECRET: 'change-me' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() =>
      loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(MIN_JWT_SECRET_LENGTH - 1) }),
    ).toThrow();
    expect(() =>
      loadConfig({ JWT_ACCESS_SECRET: 'a'.repeat(MIN_JWT_SECRET_LENGTH) }),
    ).not.toThrow();
  });

  it('cookie Secure tự bật ở production và có thể ghi đè', () => {
    expect(
      loadConfig({ JWT_ACCESS_SECRET: SECRET, NODE_ENV: 'production' })
        .cookieSecure,
    ).toBe(true);
    expect(
      loadConfig({ JWT_ACCESS_SECRET: SECRET, NODE_ENV: 'development' })
        .cookieSecure,
    ).toBe(false);
    expect(
      loadConfig({
        JWT_ACCESS_SECRET: SECRET,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'false',
      }).cookieSecure,
    ).toBe(false);
    expect(
      loadConfig({ JWT_ACCESS_SECRET: SECRET, COOKIE_SECURE: 'true' })
        .cookieSecure,
    ).toBe(true);
  });

  it('nhận các số tùy chỉnh và từ chối giá trị sai', () => {
    const c = loadConfig({
      JWT_ACCESS_SECRET: SECRET,
      ACCESS_TOKEN_TTL_SECONDS: '60',
      REFRESH_TOKEN_TTL_DAYS: '30',
      LOGIN_MAX_FAILURES: '3',
      LOGIN_WINDOW_SECONDS: '120',
    });
    expect(c).toMatchObject({
      accessTtlSeconds: 60,
      refreshTtlDays: 30,
      loginMaxFailures: 3,
      loginWindowSeconds: 120,
    });
    for (const bad of ['0', '-5', 'abc', '1.5']) {
      expect(() =>
        loadConfig({
          JWT_ACCESS_SECRET: SECRET,
          ACCESS_TOKEN_TTL_SECONDS: bad,
        }),
      ).toThrow(/ACCESS_TOKEN_TTL_SECONDS/);
    }
  });
});
