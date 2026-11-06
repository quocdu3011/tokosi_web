'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

// Giống use-column-widths: lưu trong localStorage, đọc qua useSyncExternalStore nên lần vẽ đầu
// (hydrate) luôn dùng mặc định, sau đó mới áp lựa chọn đã lưu — không lệch HTML phía server.
const listeners = new Set<() => void>();

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeRaw(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Không lưu được vẫn dùng bình thường trong phiên này.
  }
  listeners.forEach((l) => l());
}
function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener('storage', callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', callback);
  };
}

function parse(raw: string | null, defaults: readonly string[]): ReadonlySet<string> {
  if (!raw) return new Set(defaults);
  try {
    const saved = JSON.parse(raw) as unknown;
    if (Array.isArray(saved))
      return new Set(saved.filter((x): x is string => typeof x === 'string'));
  } catch {
    // dữ liệu hỏng → dùng mặc định
  }
  return new Set(defaults);
}

/**
 * Cột đang ẩn của một bảng, nhớ theo trình duyệt qua `storageKey`.
 * `defaultHidden` là các cột ẩn khi chưa chọn gì; phải là hằng ở mức module (không tạo mới mỗi lần vẽ).
 */
export function useColumnVisibility(storageKey: string, defaultHidden: readonly string[]) {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(storageKey),
    () => null,
  );
  const hidden = useMemo(() => parse(raw, defaultHidden), [raw, defaultHidden]);

  const setVisible = useCallback(
    (id: string, visible: boolean) => {
      const next = new Set(hidden);
      if (visible) next.delete(id);
      else next.add(id);
      writeRaw(storageKey, JSON.stringify([...next]));
    },
    [hidden, storageKey],
  );
  const reset = useCallback(() => writeRaw(storageKey, null), [storageKey]);

  return { hidden, setVisible, reset };
}
