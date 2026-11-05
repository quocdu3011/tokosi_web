'use client';

import { Building2 } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/lib/auth/store';
import { findBranch, useBranchStore } from '@/lib/branch';

/**
 * Ô chọn chi nhánh làm việc. Danh sách lấy từ `/auth/me` → `branches`
 * (nhân viên: chi nhánh được gán; Quản lý: tất cả). Chỉ 1 chi nhánh thì hiện tên, không cho chọn.
 */
export function BranchSwitcher() {
  const branches = useAuthStore((s) => s.user?.branches ?? []);
  const branchId = useBranchStore((s) => s.branchId);
  const setBranchId = useBranchStore((s) => s.setBranchId);

  if (branches.length === 0) {
    return <span className="text-destructive text-sm">Chưa được gán chi nhánh</span>;
  }

  if (branches.length === 1) {
    return (
      <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <Building2 className="size-4" />
        {branches[0]!.name}
      </span>
    );
  }

  return (
    <Select value={branchId ?? undefined} onValueChange={setBranchId}>
      <SelectTrigger size="sm" aria-label="Chi nhánh làm việc" className="min-w-40">
        <Building2 className="size-4" />
        <SelectValue placeholder="Chọn chi nhánh">
          {findBranch(branches, branchId)?.name}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
