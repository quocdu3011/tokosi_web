import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '@kiot/shared';

export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Yêu cầu người gọi có ĐỦ các quyền liệt kê (vai trò của họ phải được cấp trong `role_permissions`).
 * Đặt ở controller (áp cho mọi handler) hoặc handler. Cần đăng nhập trước (AuthGuard gắn `request.user`).
 *
 *   @RequirePermission('invoice.create')
 *   @Post() create(@Req() req: AppRequest) { const scope = req.grants?.['invoice.create']; ... }
 *
 * `scope === 'own'` nghĩa là chỉ được thao tác dữ liệu của chính mình — service phải tự lọc theo đó.
 */
export const RequirePermission = (...codes: PermissionCode[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, codes);

export const ANY_PERMISSIONS_KEY = 'anyPermissions';

/**
 * Yêu cầu người gọi có ÍT NHẤT MỘT trong các quyền liệt kê (khác `@RequirePermission` bắt phải đủ mọi quyền).
 * Dùng khi hai quyền cùng cho phép một thao tác, vd tải ảnh: `product.edit` HOẶC `product.content.edit`.
 * Các quyền người gọi có được ghi vào `request.grants`. Có thể dùng cùng `@RequirePermission`.
 */
export const RequireAnyPermission = (...codes: PermissionCode[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, codes);
