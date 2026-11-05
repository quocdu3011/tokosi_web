import { ApiError, NETWORK_ERROR } from './errors';

/**
 * Lớp gọi API theo hợp đồng docs/api/README.md:
 * - Gửi `Authorization: Bearer <accessToken>` (token chỉ nằm trong bộ nhớ) và `X-Branch-Id`.
 * - Gặp `401 TOKEN_EXPIRED` → gọi `POST /auth/refresh` (GOM một Promise dùng chung cho mọi yêu cầu
 *   đang chờ, vì refresh token xoay vòng: gọi song song sẽ bị từ chối) rồi thử lại ĐÚNG MỘT lần.
 * - Refresh thất bại hoặc `401` khác → báo hết phiên để về trang đăng nhập.
 * - Mọi lỗi được chuẩn hóa thành `ApiError`.
 */

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Thân yêu cầu, tự chuyển JSON. */
  body?: unknown;
  /** Tham số truy vấn; giá trị rỗng/null/undefined bị bỏ qua. */
  query?: Record<string, QueryValue>;
  /** Bắt buộc với lệnh tạo chứng từ (docs/api/README.md mục 6). */
  idempotencyKey?: string;
  /** Ghi đè chi nhánh làm việc; `null` = không gửi `X-Branch-Id`. */
  branchId?: string | null;
  /** `false` với endpoint công khai (đăng nhập…) — không gửi token, không tự refresh. */
  auth?: boolean;
  signal?: AbortSignal;
  /** Giá trị header `Accept`; mặc định `application/json`. */
  accept?: string;
}

export interface ApiClientDeps {
  baseUrl: string;
  fetch?: typeof fetch;
  getAccessToken: () => string | null;
  setAccessToken: (token: string | null) => void;
  getBranchId: () => string | null;
  /** Gọi khi phiên hết hạn hẳn (refresh thất bại / 401 không thể cứu). */
  onSessionExpired: () => void;
}

export function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>) {
  const url = `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Lấy tên file từ header `Content-Disposition` (hỗ trợ `filename*=UTF-8''…` và `filename="…"`). */
export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // rơi xuống dạng thường
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header);
  return plain?.[1]?.trim() || null;
}

/** Đọc thân lỗi; server có thể trả HTML/rỗng khi proxy lỗi → vẫn ra `ApiError` có `code`. */
async function toApiError(res: Response): Promise<ApiError> {
  const headerRequestId = res.headers.get('x-request-id');
  try {
    const body = (await res.json()) as Partial<{
      code: string;
      message: string;
      details: unknown;
      requestId: string;
    }>;
    if (body && typeof body.code === 'string') {
      return new ApiError({
        status: res.status,
        code: body.code,
        message: body.message ?? 'Đã có lỗi xảy ra.',
        details: body.details,
        requestId: body.requestId ?? headerRequestId,
      });
    }
  } catch {
    // Thân không phải JSON — dùng thông báo chung bên dưới.
  }
  return new ApiError({
    status: res.status,
    code: `HTTP_${res.status}`,
    message: 'Máy chủ trả về lỗi không xác định.',
    requestId: headerRequestId,
  });
}

export function createApiClient(deps: ApiClientDeps) {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  let refreshPromise: Promise<string | null> | null = null;

  /**
   * Lấy access token mới bằng cookie refresh. Nhiều nơi gọi cùng lúc thì dùng chung một Promise.
   * Trả `null` nếu phiên đã hết (không ném lỗi).
   */
  function refreshAccessToken(): Promise<string | null> {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        try {
          const res = await doFetch(buildUrl(deps.baseUrl, '/auth/refresh'), {
            method: 'POST',
            credentials: 'include',
          });
          if (!res.ok) {
            deps.setAccessToken(null);
            return null;
          }
          const data = (await res.json()) as { accessToken: string };
          deps.setAccessToken(data.accessToken);
          return data.accessToken;
        } catch {
          // Lỗi mạng: không kết luận phiên hết hạn, nhưng cũng không có token.
          return null;
        } finally {
          refreshPromise = null;
        }
      })();
    }
    return refreshPromise;
  }

  async function send(path: string, opts: RequestOptions, token: string | null) {
    const headers: Record<string, string> = { Accept: opts.accept ?? 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const branchId = opts.branchId === undefined ? deps.getBranchId() : opts.branchId;
    if (branchId) headers['X-Branch-Id'] = branchId;
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    try {
      return await doFetch(buildUrl(deps.baseUrl, path, opts.query), {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: 'include',
        signal: opts.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new ApiError({
        status: 0,
        code: NETWORK_ERROR,
        message: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
      });
    }
  }

  /** Gửi yêu cầu (có refresh token, thử lại đúng một lần) và trả về phản hồi đã `ok`; lỗi → `ApiError`. */
  async function execute(path: string, opts: RequestOptions): Promise<Response> {
    const useAuth = opts.auth !== false;
    let token = useAuth ? deps.getAccessToken() : null;
    // Tải lại trang làm mất token trong bộ nhớ: lấy lại bằng cookie refresh trước khi gọi.
    if (useAuth && !token) token = await refreshAccessToken();
    let res = await send(path, opts, token);

    if (useAuth && res.status === 401) {
      const err = await toApiError(res);
      if (err.code !== 'TOKEN_EXPIRED') {
        deps.onSessionExpired();
        throw err;
      }
      const newToken = await refreshAccessToken();
      if (!newToken) {
        deps.onSessionExpired();
        throw err;
      }
      // Thử lại đúng một lần; idempotencyKey giữ nguyên nên không tạo trùng chứng từ.
      res = await send(path, opts, newToken);
      if (res.status === 401) {
        deps.onSessionExpired();
        throw await toApiError(res);
      }
    }

    if (!res.ok) throw await toApiError(res);
    return res;
  }

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await execute(path, opts);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Tải một file (vd. `?format=xlsx`) kèm tên file lấy từ `Content-Disposition` nếu trình duyệt đọc được. */
  async function download(
    path: string,
    opts: Omit<RequestOptions, 'method' | 'body' | 'accept'> = {},
  ): Promise<{ blob: Blob; filename: string | null }> {
    const res = await execute(path, { ...opts, method: 'GET', accept: '*/*' });
    return {
      blob: await res.blob(),
      filename: parseContentDispositionFilename(res.headers.get('content-disposition')),
    };
  }

  return {
    request,
    download,
    refreshAccessToken,
    get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...opts, method: 'GET' }),
    post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...opts, method: 'POST', body }),
    put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...opts, method: 'PUT', body }),
    patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...opts, method: 'PATCH', body }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
