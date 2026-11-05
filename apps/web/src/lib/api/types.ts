/**
 * Kiểu dữ liệu dùng trong frontend, lấy từ `schema.d.ts` (sinh tự động từ docs/api/openapi.json
 * bằng lệnh `pnpm api:types`). KHÔNG sửa tay `schema.d.ts`; khi backend đổi hợp đồng thì sinh lại.
 */
import type { components } from './schema';

type Schemas = components['schemas'];

export type AuthUser = Schemas['AuthUserDto'];
export type BranchSummary = Schemas['BranchSummaryDto'];
export type Branch = Schemas['BranchDto'];
export type SessionResponse = Schemas['SessionResponseDto'];
export type RefreshResponse = Schemas['RefreshResponseDto'];
export type Grant = Schemas['GrantDto'];
export type PermissionCatalog = Schemas['PermissionCatalogDto'];
export type PermissionModule = Schemas['PermissionModuleDto'];
export type PermissionDef = Schemas['PermissionDefDto'];
export type RoleSummary = Schemas['RoleSummaryDto'];
export type RolePermissions = Schemas['RolePermissionsDto'];
export type SetRolePermissionsResult = Schemas['SetRolePermissionsResultDto'];
export type User = Schemas['UserDto'];
export type UserWithPassword = Schemas['UserWithPasswordDto'];
export type UserList = Schemas['UserListDto'];
export type CreateUserInput = Schemas['CreateUserDto'];
export type UpdateUserInput = Schemas['UpdateUserDto'];
export type SetUserBranchesInput = Schemas['SetUserBranchesDto'];
export type RoleCode = Schemas['RoleSummaryDto']['role'];

/** Phân hệ Hàng hóa (docs/api/endpoints.md mục 2). */
export type Product = Schemas['ProductDto'];
export type ProductList = Schemas['ProductListDto'];
export type CategoryNode = Schemas['CategoryNodeDto'];
export type CreateProductInput = Schemas['CreateProductDto'];
export type UpdateProductInput = Schemas['UpdateProductDto'];
export type ProductBranch = Schemas['ProductBranchDto'];
export type ProductImage = Schemas['ProductImageDto'];
export type ProductLookup = Schemas['ProductLookupDto'];
export type CreateCategoryInput = Schemas['CreateCategoryDto'];
export type UpdateCategoryInput = Schemas['UpdateCategoryDto'];
export type StockCardMovement = Schemas['StockCardMovementDto'];
export type StockCard = Schemas['StockCardDto'];

/** Nhập dữ liệu từ Excel (docs/api/endpoints.md mục 9). */
export type ImportJob = Schemas['ImportJobDto'];
export type ImportRowError = Schemas['ImportErrorDto'];

/** Đăng nhập Google và cài đặt tự đăng ký (docs/api/endpoints.md mục 1). */
export type GoogleSignupInput = Schemas['GoogleSignupDto'];
export type AuthSettings = Schemas['AuthSettingsDto'];
export type UpdateAuthSettingsInput = Schemas['UpdateAuthSettingsDto'];
/** `POST /auth/google` trả 202 khi chưa có tài khoản và được phép tự đăng ký (chưa tạo gì). */
export interface GoogleSignupRequired {
  status: 'signup_required';
  signupToken: string;
  email: string;
  suggestedName: string;
}

/** Phân trang chuẩn của mọi danh sách (docs/api/README.md mục 4). */
export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
