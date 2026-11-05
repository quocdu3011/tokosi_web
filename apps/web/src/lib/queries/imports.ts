import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { ImportJob } from '@/lib/api/types';
import { isModeSupported, type ImportMode, type ImportType } from '@/lib/imports';
import { productKeys } from '@/lib/queries/products';

/** Nhập Excel (`/imports/:type`, quyền `import.run`) — docs/api/endpoints.md mục 9. */

export interface RunImportArgs {
  type: ImportType;
  mode: ImportMode;
  file: File;
  /** `true` = chỉ kiểm tra, không ghi gì (mặc định của API); `false` mới ghi thật. */
  dryRun: boolean;
  /** Chi nhánh cho tồn tối thiểu-tối đa / vị trí. */
  branchId: string | null;
}

/** Tải file lên. Chế độ chưa được API hỗ trợ bị chặn TẠI ĐÂY để không bao giờ gửi nhầm thành "đè". */
export function runImport({ type, mode, file, dryRun, branchId }: RunImportArgs) {
  if (!isModeSupported(type, mode)) {
    return Promise.reject(new Error('Chế độ nhập này chưa được hệ thống hỗ trợ.'));
  }
  const body = new FormData();
  body.append('file', file);
  return api.post<ImportJob>(`/imports/${type}`, body, {
    query: { dryRun, branchId },
  });
}

/** File Excel mẫu — file nhập phải đúng định dạng mẫu này. */
export function downloadImportTemplate(type: ImportType) {
  return api.download(`/imports/${type}/template`);
}

/**
 * Nhập thật xong thì làm mới mọi thứ có thể đã đổi: danh sách hàng hóa, nhóm hàng (nhập tự tạo nhóm
 * còn thiếu). Chạy kiểm tra (`dryRun`) không ghi gì nên không làm mới.
 */
export function useRunImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: runImport,
    onSuccess: (job) => {
      if (job.dryRun || job.status !== 'completed') return;
      void qc.invalidateQueries({ queryKey: productKeys.all });
      void qc.invalidateQueries({ queryKey: productKeys.categories });
    },
  });
}
