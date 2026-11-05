'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

export const MIN_COLUMN_WIDTH = 64;
const MAX_COLUMN_WIDTH = 800;

export type ColumnWidths = Record<string, number>;

function clamp(width: number, min: number) {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(min, width)));
}

// Kho nhỏ trên localStorage: React đọc qua useSyncExternalStore nên lần vẽ đầu (hydrate) luôn dùng
// độ rộng mặc định, sau đó mới áp độ rộng đã lưu — không lệch HTML phía server.
const listeners = new Set<() => void>();

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // localStorage bị chặn
  }
}
function writeRaw(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // bỏ qua: độ rộng chỉ là tiện ích, không lưu được vẫn dùng bình thường trong phiên này
  }
  listeners.forEach((l) => l());
}
function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener('storage', callback); // đồng bộ giữa các tab
  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', callback);
  };
}

/** Gộp độ rộng đã lưu vào mặc định; bỏ cột lạ / giá trị hỏng. */
function merge(defaults: ColumnWidths, raw: string | null, min: number): ColumnWidths {
  if (!raw) return defaults;
  try {
    const saved = JSON.parse(raw) as ColumnWidths;
    const out = { ...defaults };
    for (const [id, w] of Object.entries(saved)) {
      if (id in defaults && Number.isFinite(w)) out[id] = clamp(w, min);
    }
    return out;
  } catch {
    return defaults;
  }
}

/**
 * Độ rộng từng cột (px), nhớ theo trình duyệt qua `storageKey`.
 * `defaults` phải là đối tượng ổn định (hằng ở mức module), không tạo mới mỗi lần vẽ.
 */
export function useColumnWidths(
  storageKey: string,
  defaults: ColumnWidths,
  min = MIN_COLUMN_WIDTH,
) {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(storageKey),
    () => null,
  );
  const widths = useMemo(() => merge(defaults, raw, min), [defaults, raw, min]);

  const save = useCallback(
    (next: ColumnWidths) => writeRaw(storageKey, JSON.stringify(next)),
    [storageKey],
  );
  const setWidth = useCallback(
    (id: string, width: number) => save({ ...widths, [id]: clamp(width, min) }),
    [save, widths, min],
  );
  const resetWidth = useCallback(
    (id: string) => save({ ...widths, [id]: defaults[id] ?? widths[id] ?? 160 }),
    [save, widths, defaults],
  );
  const resetAll = useCallback(() => writeRaw(storageKey, null), [storageKey]);

  return { widths, setWidth, resetWidth, resetAll };
}
