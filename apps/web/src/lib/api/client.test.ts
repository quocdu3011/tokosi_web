import { describe, expect, it, vi } from 'vitest';

import { buildUrl, createApiClient } from './client';
import { ApiError } from './errors';

/** Tạo Response JSON giả. */
function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  let token: string | null = 'cu';
  const onSessionExpired = vi.fn();
  const fetchMock = vi.fn(fetchImpl);
  const api = createApiClient({
    baseUrl: 'http://api/api/v1',
    fetch: fetchMock as unknown as typeof fetch,
    getAccessToken: () => token,
    setAccessToken: (t) => {
      token = t;
    },
    getBranchId: () => 'cn-hn',
    onSessionExpired,
  });
  return { api, fetchMock, onSessionExpired, getToken: () => token };
}

describe('buildUrl', () => {
  it('bỏ tham số rỗng và nối đúng dấu /', () => {
    expect(buildUrl('http://a/api/v1/', '/users', { q: 'an', page: 1, role: '', x: null })).toBe(
      'http://a/api/v1/users?q=an&page=1',
    );
  });
});

describe('createApiClient', () => {
  it('gửi Bearer token và X-Branch-Id', async () => {
    const { api, fetchMock } = setup(async () => json(200, { ok: true }));
    await api.get('/auth/me');
    const init = fetchMock.mock.calls[0]![1];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer cu');
    expect(headers['X-Branch-Id']).toBe('cn-hn');
    expect(init.credentials).toBe('include');
  });

  it('TOKEN_EXPIRED → refresh rồi thử lại đúng một lần với token mới', async () => {
    const { api, fetchMock, getToken } = setup(async (url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, { accessToken: 'moi', expiresIn: 900 });
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer cu') return json(401, { code: 'TOKEN_EXPIRED', message: 'hết hạn' });
      return json(200, { id: 1 });
    });
    await expect(api.get('/users')).resolves.toEqual({ id: 1 });
    expect(getToken()).toBe('moi');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('nhiều yêu cầu cùng hết hạn chỉ gọi refresh MỘT lần', async () => {
    let refreshCount = 0;
    const { api } = setup(async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCount++;
        await new Promise((r) => setTimeout(r, 5));
        return json(200, { accessToken: 'moi', expiresIn: 900 });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer cu') return json(401, { code: 'TOKEN_EXPIRED', message: 'hết hạn' });
      return json(200, {});
    });
    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(refreshCount).toBe(1);
  });

  it('refresh thất bại → báo hết phiên và ném lỗi', async () => {
    const { api, onSessionExpired } = setup(async (url) => {
      if (url.endsWith('/auth/refresh'))
        return json(401, { code: 'UNAUTHENTICATED', message: 'x' });
      return json(401, { code: 'TOKEN_EXPIRED', message: 'hết hạn' });
    });
    await expect(api.get('/users')).rejects.toBeInstanceOf(ApiError);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('401 UNAUTHENTICATED → báo hết phiên, không refresh', async () => {
    const { api, fetchMock, onSessionExpired } = setup(async () =>
      json(401, { code: 'UNAUTHENTICATED', message: 'Bạn cần đăng nhập' }),
    );
    await expect(api.get('/users')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('endpoint công khai (auth: false) không gửi token, 401 không coi là hết phiên', async () => {
    const { api, fetchMock, onSessionExpired } = setup(async () =>
      json(401, { code: 'UNAUTHENTICATED', message: 'Sai tên đăng nhập hoặc mật khẩu' }),
    );
    await expect(api.post('/auth/login', { username: 'a' }, { auth: false })).rejects.toMatchObject(
      {
        message: 'Sai tên đăng nhập hoặc mật khẩu',
      },
    );
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('chuẩn hóa lỗi hợp đồng và lỗi không phải JSON', async () => {
    const { api } = setup(async (url) => {
      if (url.endsWith('/html')) return new Response('<html>', { status: 502 });
      return json(400, {
        code: 'VALIDATION_ERROR',
        message: 'Tên không hợp lệ',
        details: [{ field: 'username', message: 'Tên không hợp lệ' }],
        requestId: 'r1',
      });
    });
    const err = (await api.post('/users', {}).catch((e) => e)) as ApiError;
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.fieldErrors).toEqual([{ field: 'username', message: 'Tên không hợp lệ' }]);
    expect(err.requestId).toBe('r1');
    const err2 = (await api.get('/html').catch((e) => e)) as ApiError;
    expect(err2.code).toBe('HTTP_502');
  });

  it('204 trả về undefined', async () => {
    const { api } = setup(async () => new Response(null, { status: 204 }));
    await expect(api.post('/auth/logout', undefined, { auth: false })).resolves.toBeUndefined();
  });

  it('chưa có token (vừa tải lại trang) → refresh trước khi gọi', async () => {
    const { api, fetchMock } = setup(async (url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, { accessToken: 'moi', expiresIn: 900 });
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer moi');
      return json(200, {});
    });
    // Mô phỏng mất token
    await api.refreshAccessToken();
    fetchMock.mockClear();
    await api.get('/auth/me');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('createApiClient – tải file lên', () => {
  it('FormData gửi nguyên, không ép Content-Type JSON (trình duyệt tự thêm boundary)', async () => {
    const { api, fetchMock } = setup(async () => json(202, { id: 'x' }));
    const body = new FormData();
    body.append('file', new Blob(['a']), 'a.xlsx');
    await api.post('/imports/products', body, { query: { dryRun: true } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api/api/v1/imports/products?dryRun=true');
    expect(init.body).toBe(body);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});

describe('createApiClient – delete', () => {
  it('gửi DELETE và chấp nhận 204 không có thân', async () => {
    const { api, fetchMock } = setup(async () => new Response(null, { status: 204 }));
    await expect(api.delete('/products/p1/images/i1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![1].method).toBe('DELETE');
  });
});
