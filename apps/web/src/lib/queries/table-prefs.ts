'use client';

import type { TablePrefs } from '@kiot/shared';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { toast } from 'sonner';

import type { ColumnSpec } from '@/components/data-table/column-meta';
import {
  LEGACY_STORAGE_KEYS,
  pruneLegacyPrefs,
  readLegacyPrefs,
  sanitizeTables,
} from '@/components/data-table/prefs-core';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth/store';

/**
 * Tùy chỉnh bảng THEO TÀI KHOẢN (`/me/table-prefs`, docs/api/endpoints.md mục 1):
 * ẩn/hiện cột, thứ tự, độ rộng, số dòng mỗi trang. Server là nguồn đúng.
 *
 * Ba lớp dữ liệu, từ cũ đến mới:
 * 1. Bản sao nóng trong localStorage (`tks:table-prefs:<userId>`) để vẽ ngay lần đầu, trước khi server trả lời.
 * 2. Kết quả `GET /me/table-prefs` trong cache React Query (`staleTime: Infinity`, khóa chứa user.id).
 * 3. Thay đổi cục bộ CHƯA được server xác nhận (`slots`): áp lạc quan vào cache, gom (debounce) rồi mới `PUT`;
 *    lớp này luôn phủ lên kết quả GET nên một lần GET về muộn không ghi đè thao tác vừa làm.
 */

/** Chờ người dùng ngừng thao tác (kéo mép cột bắn sự kiện liên tục) rồi mới gửi lên server. */
export const TABLE_PREFS_DEBOUNCE_MS = 600;

const HOT_KEY_PREFIX = 'tks:table-prefs:';
export const hotStorageKey = (userId: string) => `${HOT_KEY_PREFIX}${userId}`;

export const tablePrefsKeys = {
  all: (userId: string | null) => ['me', 'table-prefs', userId ?? ''] as const,
};

export interface TablePrefsData {
  tables: Record<string, TablePrefs>;
  /** `true` khi dữ liệu đã đến từ server (chưa chỉ là bản lạc quan). */
  fromServer: boolean;
}

const EMPTY_TABLES: Record<string, TablePrefs> = {};

type PrefsUpdate = TablePrefs | ((current: TablePrefs | undefined) => TablePrefs);

// ---------------------------------------------------------------------------------------------
// Bản sao nóng (localStorage) — đọc qua useSyncExternalStore: lần vẽ đầu (hydrate) luôn dùng mặc định,
// sau đó mới áp bản đã lưu, nên không lệch HTML phía server.
// ---------------------------------------------------------------------------------------------

/** Giải mã bản sao nóng; thiếu/hỏng → `null`. */
export function parseHotCopy(raw: string | null): Record<string, TablePrefs> | null {
  if (!raw) return null;
  try {
    return sanitizeTables(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

const hotListeners = new Set<() => void>();

function readHotRaw(userId: string): string | null {
  try {
    return window.localStorage.getItem(hotStorageKey(userId));
  } catch {
    return null; // localStorage bị chặn
  }
}

function writeHot(userId: string, tables: Record<string, TablePrefs>) {
  try {
    window.localStorage.setItem(hotStorageKey(userId), JSON.stringify(tables));
  } catch {
    // Không lưu được bản sao nóng vẫn dùng bình thường: server mới là nguồn đúng.
  }
  hotListeners.forEach((listener) => listener());
}

function subscribeHot(callback: () => void) {
  hotListeners.add(callback);
  window.addEventListener('storage', callback); // đồng bộ giữa các tab
  return () => {
    hotListeners.delete(callback);
    window.removeEventListener('storage', callback);
  };
}

// ---------------------------------------------------------------------------------------------
// Thay đổi chưa được server xác nhận: gom theo (người dùng, bảng), gửi tuần tự.
// ---------------------------------------------------------------------------------------------

interface Slot {
  userId: string;
  tableKey: string;
  /** Giá trị mới nhất muốn lưu; `null` = xóa (về mặc định). */
  value: TablePrefs | null;
  /** Tăng sau mỗi thay đổi; so với số phiên bản lúc gửi để biết có thay đổi mới hơn không. */
  version: number;
  /** Còn khác với server (chưa gửi, đang gửi hoặc gửi lỗi). */
  dirty: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** Hàng đợi: PUT của cùng một bảng không bao giờ chạy chồng nhau. */
  chain: Promise<unknown>;
}

const slots = new Map<string, Slot>();
const slotKey = (userId: string, tableKey: string) => `${userId}|${tableKey}`;
const tablePath = (tableKey: string) => `/me/table-prefs/${encodeURIComponent(tableKey)}`;

function currentTables(qc: QueryClient, userId: string): Record<string, TablePrefs> {
  return (
    qc.getQueryData<TablePrefsData>(tablePrefsKeys.all(userId))?.tables ??
    parseHotCopy(readHotRaw(userId)) ??
    EMPTY_TABLES
  );
}

/** Phủ các thay đổi chưa được xác nhận lên kết quả GET. */
function overlayDirty(userId: string, tables: Record<string, TablePrefs>) {
  const out = { ...tables };
  for (const slot of slots.values()) {
    if (slot.userId !== userId || !slot.dirty) continue;
    if (slot.value === null) delete out[slot.tableKey];
    else out[slot.tableKey] = slot.value;
  }
  return out;
}

/** Cập nhật lạc quan: cache React Query + bản sao nóng. */
function applyLocal(qc: QueryClient, userId: string, tableKey: string, value: TablePrefs | null) {
  const tables = { ...currentTables(qc, userId) };
  if (value === null) delete tables[tableKey];
  else tables[tableKey] = value;
  qc.setQueryData<TablePrefsData>(tablePrefsKeys.all(userId), (old) => ({
    tables,
    fromServer: old?.fromServer ?? false,
  }));
  writeHot(userId, tables);
}

function notifySaveFailed() {
  // Cùng `id` → nhiều lần lỗi liên tiếp chỉ hiện một thông báo.
  toast.warning('Chưa lưu được tùy chỉnh bảng lên máy chủ. Thay đổi vẫn áp dụng trong phiên này.', {
    id: 'table-prefs-save-failed',
  });
}

/** Gửi ngay giá trị mới nhất của slot. Trả `true` nếu server đã nhận. */
function send(slot: Slot): Promise<boolean> {
  if (slot.timer) {
    clearTimeout(slot.timer);
    slot.timer = null;
  }
  const { version, value, userId, tableKey } = slot;
  const run = slot.chain.then(async () => {
    // Đã đăng xuất / đổi người khác giữa chừng: PUT sẽ ghi nhầm vào tài khoản mới → bỏ.
    if (useAuthStore.getState().user?.id !== userId) {
      slot.dirty = false;
      slots.delete(slotKey(userId, tableKey));
      return false;
    }
    try {
      if (value === null) await api.delete(tablePath(tableKey));
      else await api.put<TablePrefs>(tablePath(tableKey), value);
      if (slot.version === version) {
        slot.dirty = false;
        if (!slot.timer) slots.delete(slotKey(userId, tableKey));
      }
      return true;
    } catch {
      notifySaveFailed(); // giữ `dirty` + giá trị cục bộ: phiên này vẫn dùng bản mới
      return false;
    }
  });
  slot.chain = run;
  return run;
}

function enqueue(
  qc: QueryClient,
  userId: string,
  tableKey: string,
  value: TablePrefs | null,
  immediate: boolean,
): Promise<boolean> {
  applyLocal(qc, userId, tableKey, value);
  const key = slotKey(userId, tableKey);
  let slot = slots.get(key);
  if (!slot) {
    slot = {
      userId,
      tableKey,
      value,
      version: 0,
      dirty: true,
      timer: null,
      chain: Promise.resolve(),
    };
    slots.set(key, slot);
  }
  slot.value = value;
  slot.version += 1;
  slot.dirty = true;
  if (slot.timer) clearTimeout(slot.timer);
  if (immediate) return send(slot);
  const pending = slot;
  pending.timer = setTimeout(() => {
    pending.timer = null;
    void send(pending);
  }, TABLE_PREFS_DEBOUNCE_MS);
  return Promise.resolve(true);
}

/** Gửi ngay mọi thay đổi đang chờ debounce (của một bảng, hoặc tất cả). */
export function flushTablePrefs(userId: string | null, tableKey?: string) {
  for (const slot of slots.values()) {
    if (!slot.timer) continue;
    if (userId !== null && slot.userId !== userId) continue;
    if (tableKey !== undefined && slot.tableKey !== tableKey) continue;
    void send(slot);
  }
}

let flushListenersAdded = false;
/** Rời trang/đổi tab trong lúc còn thay đổi chờ gửi → gửi luôn, khỏi mất. */
function ensureFlushListeners() {
  if (flushListenersAdded || typeof window === 'undefined') return;
  flushListenersAdded = true;
  const flushAll = () => flushTablePrefs(null);
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}

function removeLegacyKeys(keys: readonly string[]) {
  try {
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // bỏ qua
  }
}

// ---------------------------------------------------------------------------------------------
// Hook công khai
// ---------------------------------------------------------------------------------------------

/** `GET /me/table-prefs`, phủ thay đổi chưa được xác nhận lên kết quả và cập nhật bản sao nóng. */
export async function fetchTablePrefs(
  userId: string,
  signal?: AbortSignal,
): Promise<TablePrefsData> {
  const res = await api.get<{ data?: unknown }>('/me/table-prefs', { signal });
  const tables = overlayDirty(userId, sanitizeTables(res?.data));
  writeHot(userId, tables);
  return { tables, fromServer: true };
}

/**
 * Lưu tùy chỉnh một bảng: cập nhật lạc quan ngay, gửi `PUT` sau {@link TABLE_PREFS_DEBOUNCE_MS} ms kể từ lần đổi cuối.
 * `update` là bản mới hoặc hàm nhận bản mới nhất (gồm cả thay đổi lạc quan chưa gửi).
 */
export function saveTablePrefs(
  qc: QueryClient,
  userId: string,
  tableKey: string,
  update: PrefsUpdate,
): void {
  const current: TablePrefs | undefined = currentTables(qc, userId)[tableKey];
  const next = typeof update === 'function' ? update(current) : update;
  void enqueue(qc, userId, tableKey, next, false);
}

/** Đặt một bảng về mặc định: xóa lạc quan ngay và gửi `DELETE` ngay (hủy `PUT` đang chờ). Trả `true` nếu server đã nhận. */
export function resetTablePrefs(
  qc: QueryClient,
  userId: string,
  tableKey: string,
): Promise<boolean> {
  // Khóa cũ còn đó thì lần sau sẽ bị nhập ngược lên server.
  const legacy = LEGACY_STORAGE_KEYS[tableKey];
  removeLegacyKeys([legacy?.hidden, legacy?.widths].filter((k): k is string => !!k));
  return enqueue(qc, userId, tableKey, null, true);
}

export interface AllTablePrefs {
  /** Tùy chỉnh mọi bảng đã biết (server + thay đổi lạc quan; chưa có thì bản sao nóng; không có gì thì rỗng). */
  tables: Readonly<Record<string, TablePrefs>>;
  /** Đủ dữ liệu để vẽ (đã có bản sao nóng hoặc server đã trả lời — kể cả lỗi). Màn nên chờ cờ này trước khi gọi danh sách. */
  isReady: boolean;
  /** Đã nhận được `GET /me/table-prefs` thành công. */
  isServerLoaded: boolean;
  /** Lần GET gần nhất lỗi (vẫn dùng bản sao nóng/mặc định). */
  isError: boolean;
}

/** Tải tùy chỉnh mọi bảng của người dùng đang đăng nhập (một lần mỗi phiên). */
export function useAllTablePrefs(): AllTablePrefs {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const hotRaw = useSyncExternalStore(
    subscribeHot,
    () => (userId ? readHotRaw(userId) : null),
    () => null,
  );
  const hot = useMemo(() => parseHotCopy(hotRaw), [hotRaw]);

  useEffect(ensureFlushListeners, []);

  const query = useQuery({
    queryKey: tablePrefsKeys.all(userId),
    enabled: userId !== null,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: ({ signal }) =>
      userId
        ? fetchTablePrefs(userId, signal)
        : Promise.resolve({ tables: EMPTY_TABLES, fromServer: false }),
  });

  return {
    tables: query.data?.tables ?? hot ?? EMPTY_TABLES,
    isReady: userId === null || query.status !== 'pending' || hot !== null,
    isServerLoaded: query.data?.fromServer === true,
    isError: query.isError,
  };
}

/**
 * Lưu tùy chỉnh một bảng: cập nhật LẠC QUAN ngay (cache + bản sao nóng), gửi `PUT` sau
 * {@link TABLE_PREFS_DEBOUNCE_MS} ms kể từ lần đổi cuối. Lỗi gửi → toast nhẹ, giữ giá trị cục bộ.
 * `update` có thể là hàm nhận bản mới nhất (kể cả thay đổi lạc quan chưa gửi) — dùng khi bắn liên tục.
 */
export function useSaveTablePrefs() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const save = useCallback(
    (tableKey: string, update: PrefsUpdate) => {
      if (userId) saveTablePrefs(qc, userId, tableKey, update);
    },
    [qc, userId],
  );
  const flush = useCallback((tableKey?: string) => flushTablePrefs(userId, tableKey), [userId]);
  return useMemo(() => ({ save, flush }), [save, flush]);
}

/** Đặt lại một bảng về mặc định: xóa bản ghi trên server (`DELETE`), cache, bản sao nóng và khóa localStorage cũ. */
export function useResetTablePrefs() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return useCallback(
    (tableKey: string) => {
      if (userId) void resetTablePrefs(qc, userId, tableKey);
    },
    [qc, userId],
  );
}

const migrationAttempted = new Set<string>();

/**
 * Chuyển MỘT LẦN tùy chỉnh cũ (localStorage theo trình duyệt) lên server. Chỉ gọi khi server đã trả lời
 * (`isServerLoaded`) và CHƯA có bản ghi cho bảng này. Chỉ nhập phần người dùng thật sự đã đổi
 * (so với mặc định của `specs`); gửi thành công mới xóa khóa cũ. Mỗi (người dùng, bảng) thử một lần mỗi phiên.
 */
export function migrateLegacyPrefs(
  qc: QueryClient,
  userId: string,
  tableKey: string,
  specs: readonly ColumnSpec[],
) {
  const marker = slotKey(userId, tableKey);
  if (specs.length === 0 || migrationAttempted.has(marker)) return;
  migrationAttempted.add(marker);

  let legacy;
  try {
    legacy = readLegacyPrefs(tableKey, (key) => window.localStorage.getItem(key));
  } catch {
    return; // localStorage bị chặn
  }
  if (!legacy) return;
  const pruned = pruneLegacyPrefs(legacy.prefs, specs);
  if (!pruned) {
    removeLegacyKeys(legacy.keys); // không có gì khác mặc định -> khỏi nhập
    return;
  }
  const keys = legacy.keys;
  void enqueue(qc, userId, tableKey, pruned, true).then((ok) => {
    if (ok) removeLegacyKeys(keys);
  });
}
