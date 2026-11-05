import { create } from 'zustand';

import type { AuthUser, BranchSummary } from '@/lib/api/types';

/**
 * Chi nhánh làm việc (Hà Nội / Sài Gòn). Gửi trong header `X-Branch-Id` cho mọi yêu cầu.
 * Chỉ lưu id chi nhánh ưa thích vào localStorage (không phải dữ liệu nhạy cảm) để lần sau mở lại.
 */
const STORAGE_KEY = 'kiot.workingBranchId';

function readStored(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string | null) {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Trình duyệt chặn lưu trữ: bỏ qua, chỉ mất tính năng nhớ lựa chọn.
  }
}

/**
 * Chọn chi nhánh làm việc hợp lệ cho người dùng, theo thứ tự:
 * lựa chọn đã lưu (nếu vẫn được phép) → chi nhánh mặc định → chi nhánh đầu tiên được phép.
 * Trả `null` nếu người dùng chưa được gán chi nhánh nào.
 */
export function resolveWorkingBranch(
  user: Pick<AuthUser, 'branches' | 'defaultBranchId'>,
  preferredId: string | null,
): string | null {
  const allowed = new Set(user.branches.map((b) => b.id));
  if (preferredId && allowed.has(preferredId)) return preferredId;
  if (user.defaultBranchId && allowed.has(user.defaultBranchId)) return user.defaultBranchId;
  return user.branches[0]?.id ?? null;
}

interface BranchState {
  branchId: string | null;
  setBranchId: (id: string | null) => void;
  /** Đồng bộ lại theo danh sách chi nhánh hiện tại của người dùng (sau đăng nhập / tải /auth/me). */
  syncWithUser: (user: Pick<AuthUser, 'branches' | 'defaultBranchId'>) => void;
}

export const useBranchStore = create<BranchState>((set, get) => ({
  branchId: null,
  setBranchId: (branchId) => {
    writeStored(branchId);
    set({ branchId });
  },
  syncWithUser: (user) => {
    const next = resolveWorkingBranch(user, get().branchId ?? readStored());
    if (next !== get().branchId) {
      writeStored(next);
      set({ branchId: next });
    }
  },
}));

export function findBranch(branches: BranchSummary[], id: string | null) {
  return branches.find((b) => b.id === id) ?? null;
}
