import { MIN_JWT_SECRET_LENGTH, loadConfig } from './app-config.js';

const SECRET = 'a'.repeat(MIN_JWT_SECRET_LENGTH);
/** Production bắt buộc có kho file nên các test đặt NODE_ENV=production phải kèm nhóm biến này. */
const STORAGE_ENV = {
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
  FILE_PUBLIC_BASE_URL: 'http://localhost:9000/b',
};

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
      storage: null,
      supabase: null,
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
      loadConfig({
        JWT_ACCESS_SECRET: SECRET,
        NODE_ENV: 'production',
        ...STORAGE_ENV,
      }).cookieSecure,
    ).toBe(true);
    expect(
      loadConfig({ JWT_ACCESS_SECRET: SECRET, NODE_ENV: 'development' })
        .cookieSecure,
    ).toBe(false);
    expect(
      loadConfig({
        JWT_ACCESS_SECRET: SECRET,
        NODE_ENV: 'production',
        ...STORAGE_ENV,
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

  describe('kho file ảnh (S3/MinIO)', () => {
    const FULL = {
      JWT_ACCESS_SECRET: SECRET,
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'product-images',
      S3_ACCESS_KEY: 'khoa',
      S3_SECRET_KEY: 'bi-mat',
      FILE_PUBLIC_BASE_URL: 'http://localhost:9000/product-images/',
    };

    it('đặt đủ biến → có cấu hình; bỏ dấu / cuối của địa chỉ công khai; vùng mặc định us-east-1', () => {
      expect(loadConfig(FULL).storage).toEqual({
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        bucket: 'product-images',
        accessKey: 'khoa',
        secretKey: 'bi-mat',
        publicBaseUrl: 'http://localhost:9000/product-images',
      });
      expect(loadConfig({ ...FULL, S3_REGION: 'auto' }).storage?.region).toBe(
        'auto',
      );
    });

    it('dev/test không đặt biến nào → null (chạy được)', () => {
      expect(loadConfig({ JWT_ACCESS_SECRET: SECRET }).storage).toBeNull();
    });

    it('đặt thiếu một phần → ném lỗi nêu rõ biến còn thiếu (không chạy với cấu hình dở dang)', () => {
      const { S3_SECRET_KEY: _omit, ...partial } = FULL;
      expect(() => loadConfig(partial)).toThrow(/S3_SECRET_KEY/);
    });

    it('production bắt buộc có kho file', () => {
      expect(() =>
        loadConfig({ JWT_ACCESS_SECRET: SECRET, NODE_ENV: 'production' }),
      ).toThrow(/kho file/);
      expect(
        loadConfig({ ...FULL, NODE_ENV: 'production' }).storage,
      ).not.toBeNull();
    });
  });

  describe('Supabase (đăng nhập Google)', () => {
    const base = { JWT_ACCESS_SECRET: SECRET };
    it('không đặt → null; đặt https → lấy origin, bỏ đường dẫn thừa', () => {
      expect(loadConfig(base).supabase).toBeNull();
      expect(
        loadConfig({ ...base, SUPABASE_URL: 'https://abcd.supabase.co/' })
          .supabase,
      ).toEqual({ url: 'https://abcd.supabase.co' });
    });
    it('từ chối địa chỉ sai hoặc http ngoài localhost', () => {
      expect(() => loadConfig({ ...base, SUPABASE_URL: 'abc' })).toThrow(
        /SUPABASE_URL/,
      );
      expect(() =>
        loadConfig({ ...base, SUPABASE_URL: 'http://abcd.supabase.co' }),
      ).toThrow(/https/);
      expect(
        loadConfig({ ...base, SUPABASE_URL: 'http://localhost:54321' })
          .supabase,
      ).toEqual({ url: 'http://localhost:54321' });
    });
  });
});
