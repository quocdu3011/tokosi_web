import type { TablePrefs } from '@kiot/shared';
import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ColumnSpec } from '@/components/data-table/column-meta';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth/store';
import {
  TABLE_PREFS_DEBOUNCE_MS,
  fetchTablePrefs,
  flushTablePrefs,
  hotStorageKey,
  migrateLegacyPrefs,
  parseHotCopy,
  resetTablePrefs,
  saveTablePrefs,
  tablePrefsKeys,
  type TablePrefsData,
} from './table-prefs';

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));

/** localStorage giả trong môi trường Node. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

let qc: QueryClient;
let storage: ReturnType<typeof fakeStorage>;
let userSeq = 0;
let userId: string;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(api.put).mockResolvedValue({} as never);
  vi.mocked(api.delete).mockResolvedValue(undefined as never);
  qc = new QueryClient();
  storage = fakeStorage();
  vi.stubGlobal('window', { localStorage: storage });
  userId = `user-${++userSeq}`; // module giữ trạng thái chờ gửi theo người dùng: mỗi bài một người
  useAuthStore.setState({ user: { id: userId } as never });
});

afterEach(async () => {
  flushTablePrefs(null);
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useAuthStore.setState({ user: null });
});

const cached = (key = 'products') =>
  qc.getQueryData<TablePrefsData>(tablePrefsKeys.all(userId))?.tables[key];

describe('saveTablePrefs (lạc quan + debounce)', () => {
  it('cập nhật cache và bản sao nóng ngay, chưa gọi PUT', () => {
    saveTablePrefs(qc, userId, 'products', { pageSize: 50 });
    expect(cached()).toEqual({ pageSize: 50 });
    expect(parseHotCopy(storage.getItem(hotStorageKey(userId)))).toEqual({
      products: { pageSize: 50 },
    });
    expect(api.put).not.toHaveBeenCalled();
  });

  it('gom nhiều thay đổi liên tiếp thành MỘT lần PUT với giá trị cuối', async () => {
    for (const width of [200, 210, 220, 230]) {
      saveTablePrefs(qc, userId, 'products', (cur) => ({ ...cur, widths: { name: width } }));
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(api.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TABLE_PREFS_DEBOUNCE_MS);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith('/me/table-prefs/products', { widths: { name: 230 } });
  });

  it('hàm cập nhật nhận bản lạc quan mới nhất, không phải bản cũ của server', () => {
    saveTablePrefs(qc, userId, 'products', { hidden: ['a'] });
    saveTablePrefs(qc, userId, 'products', (cur) => ({ ...cur, pageSize: 100 }));
    expect(cached()).toEqual({ hidden: ['a'], pageSize: 100 });
  });

  it('hai bảng khác nhau gửi riêng, không ghi đè nhau', async () => {
    saveTablePrefs(qc, userId, 'products', { pageSize: 50 });
    saveTablePrefs(qc, userId, 'suppliers', { pageSize: 100 });
    await vi.advanceTimersByTimeAsync(TABLE_PREFS_DEBOUNCE_MS);
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(api.put).toHaveBeenCalledWith('/me/table-prefs/products', { pageSize: 50 });
    expect(api.put).toHaveBeenCalledWith('/me/table-prefs/suppliers', { pageSize: 100 });
  });

  it('flush gửi ngay, không chờ hết thời gian chờ', async () => {
    saveTablePrefs(qc, userId, 'products', { pageSize: 50 });
    flushTablePrefs(userId, 'products');
    await vi.advanceTimersByTimeAsync(0);
    expect(api.put).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TABLE_PREFS_DEBOUNCE_MS * 2);
    expect(api.put).toHaveBeenCalledTimes(1); // không gửi lần hai
  });

  it('PUT lỗi: toast nhẹ, GIỮ giá trị cục bộ (cache + bản sao nóng)', async () => {
    vi.mocked(api.put).mockRejectedValue(new Error('mạng'));
    saveTablePrefs(qc, userId, 'products', { pageSize: 100 });
    await vi.advanceTimersByTimeAsync(TABLE_PREFS_DEBOUNCE_MS);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(cached()).toEqual({ pageSize: 100 });
    expect(parseHotCopy(storage.getItem(hotStorageKey(userId)))?.products).toEqual({
      pageSize: 100,
    });
  });

  it('PUT mỗi bảng chạy tuần tự: thay đổi trong lúc đang gửi được gửi sau, không chồng nhau', async () => {
    let release: () => void = () => undefined;
    vi.mocked(api.put).mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({} as never))),
    );
    saveTablePrefs(qc, userId, 'products', { pageSize: 50 });
    await vi.advanceTimersByTimeAsync(TABLE_PREFS_DEBOUNCE_MS);
    expect(api.put).toHaveBeenCalledTimes(1);

    saveTablePrefs(qc, userId, 'products', { pageSize: 100 });
    await vi.advanceTimersByTimeAsync(TABLE_PREFS_DEBOUNCE_MS);
    expect(api.put).toHaveBeenCalledTimes(1); // lần đầu chưa xong

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.put).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.put).mock.calls[1]?.[1]).toEqual({ pageSize: 100 });
  });

  it('người dùng đã đổi trước khi gửi: bỏ PUT để không ghi nhầm vào tài khoản mới', async () => {
    saveTablePrefs(qc, userId, 'products', { pageSize: 50 });
    useAuthStore.setState({ user: { id: 'nguoi-khac' } as never });
    await vi.advanceTimersByTimeAsync(TABLE_PREFS_DEBOUNCE_MS);
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('resetTablePrefs', () => {
  it('xóa cache ngay, gửi DELETE ngay và hủy PUT đang chờ', async () => {
    saveTablePrefs(qc, userId, 'products', { pageSize: 50 });
    const done = resetTablePrefs(qc, userId, 'products');
    expect(cached()).toBeUndefined();
    await expect(done).resolves.toBe(true);
    expect(api.delete).toHaveBeenCalledWith('/me/table-prefs/products');
    await vi.advanceTimersByTimeAsync(TABLE_PREFS_DEBOUNCE_MS * 2);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('dọn cả khóa localStorage cũ để lần sau không bị nhập ngược lên server', async () => {
    storage.setItem('cols:products', '["description"]');
    storage.setItem('table:products', '{"name":400}');
    await resetTablePrefs(qc, userId, 'products');
    expect(storage.getItem('cols:products')).toBeNull();
    expect(storage.getItem('table:products')).toBeNull();
  });
});

describe('fetchTablePrefs', () => {
  it('đọc { data } của server, làm sạch, ghi bản sao nóng', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { products: { pageSize: 50, junk: 1 }, 'Sai Khoa': { pageSize: 15 } },
    } as never);
    const res = await fetchTablePrefs(userId);
    expect(res).toEqual({ tables: { products: { pageSize: 50 } }, fromServer: true });
    expect(parseHotCopy(storage.getItem(hotStorageKey(userId)))).toEqual(res.tables);
  });

  it('GET về muộn KHÔNG ghi đè thay đổi người dùng vừa làm (còn chờ server xác nhận)', async () => {
    saveTablePrefs(qc, userId, 'products', { pageSize: 100 });
    vi.mocked(api.get).mockResolvedValue({
      data: { products: { pageSize: 15 }, suppliers: { pageSize: 50 } },
    } as never);
    const res = await fetchTablePrefs(userId);
    expect(res.tables.products).toEqual({ pageSize: 100 });
    expect(res.tables.suppliers).toEqual({ pageSize: 50 });
  });

  it('bảng vừa đặt lại (chờ DELETE) không bị GET cũ làm sống lại', async () => {
    let release: () => void = () => undefined;
    vi.mocked(api.delete).mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(undefined as never))),
    );
    const pending = resetTablePrefs(qc, userId, 'products');
    vi.mocked(api.get).mockResolvedValue({ data: { products: { pageSize: 50 } } } as never);
    expect((await fetchTablePrefs(userId)).tables.products).toBeUndefined();
    release();
    await pending;
  });

  it('server trả thiếu data → không có bảng nào', async () => {
    vi.mocked(api.get).mockResolvedValue({} as never);
    expect((await fetchTablePrefs(userId)).tables).toEqual({});
  });
});

describe('migrateLegacyPrefs (chuyển một lần từ localStorage cũ)', () => {
  const SPECS: ColumnSpec[] = [
    { id: 'code', label: 'Mã', width: 120, hiddenByDefault: false, locked: true },
    { id: 'name', label: 'Tên', width: 320, hiddenByDefault: false, locked: false },
    { id: 'note', label: 'Ghi chú', width: 280, hiddenByDefault: true, locked: false },
  ];

  it('nhập phần đã đổi lên server ngay, rồi xóa khóa cũ', async () => {
    storage.setItem('cols:products', JSON.stringify(['name']));
    storage.setItem('table:products', JSON.stringify({ code: 120, name: 450 }));
    migrateLegacyPrefs(qc, userId, 'products', SPECS);
    expect(cached()).toEqual({ hidden: ['name'], widths: { name: 450 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith('/me/table-prefs/products', {
      hidden: ['name'],
      widths: { name: 450 },
    });
    expect(storage.getItem('cols:products')).toBeNull();
    expect(storage.getItem('table:products')).toBeNull();
  });

  it('chỉ thử một lần mỗi phiên cho mỗi (người dùng, bảng)', async () => {
    storage.setItem('cols:products', JSON.stringify(['name']));
    migrateLegacyPrefs(qc, userId, 'products', SPECS);
    migrateLegacyPrefs(qc, userId, 'products', SPECS);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('PUT lỗi: GIỮ khóa cũ để lần sau thử lại', async () => {
    vi.mocked(api.put).mockRejectedValue(new Error('mạng'));
    storage.setItem('cols:products', JSON.stringify(['name']));
    migrateLegacyPrefs(qc, userId, 'products', SPECS);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.getItem('cols:products')).not.toBeNull();
  });

  it('dữ liệu cũ chỉ là mặc định: khỏi gửi lên server, vẫn dọn khóa cũ', async () => {
    storage.setItem('cols:products', JSON.stringify(['note']));
    storage.setItem('table:products', JSON.stringify({ name: 320 }));
    migrateLegacyPrefs(qc, userId, 'products', SPECS);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.put).not.toHaveBeenCalled();
    expect(storage.getItem('cols:products')).toBeNull();
    expect(storage.getItem('table:products')).toBeNull();
  });

  it('không có khóa cũ nào: không làm gì', async () => {
    migrateLegacyPrefs(qc, userId, 'products', SPECS);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.put).not.toHaveBeenCalled();
    expect(cached()).toBeUndefined();
  });
});

describe('parseHotCopy', () => {
  it('thiếu/hỏng → null; hợp lệ → làm sạch', () => {
    expect(parseHotCopy(null)).toBeNull();
    expect(parseHotCopy('{hỏng')).toBeNull();
    const ok: Record<string, TablePrefs> = { products: { pageSize: 50 } };
    expect(parseHotCopy(JSON.stringify(ok))).toEqual(ok);
  });
});
