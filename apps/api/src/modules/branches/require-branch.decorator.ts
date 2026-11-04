import { SetMetadata } from '@nestjs/common';

export const REQUIRE_BRANCH_KEY = 'requireBranch';

/**
 * Handler này làm việc trong MỘT chi nhánh: BranchContextGuard xác định chi nhánh từ header `X-Branch-Id`
 * (hoặc chi nhánh mặc định/duy nhất của người dùng), kiểm tra quyền truy cập rồi gắn vào request.
 * Lấy giá trị bằng `@WorkingBranchId()`.
 */
export const RequireBranch = () => SetMetadata(REQUIRE_BRANCH_KEY, true);
