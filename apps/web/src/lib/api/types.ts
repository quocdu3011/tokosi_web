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
/**
 * openapi.json hiện khai báo `phone` / `defaultBranchId` là `Record<string, never> | null`
 * (swagger thiếu `type` cho field nullable). Theo docs/api/endpoints.md hai field này là
 * `string | null` → sửa kiểu ở đây cho đúng hợp đồng (đã ghi để báo backend).
 */
type FixNullableStrings<T, K extends keyof T> = Omit<T, K> & { [P in K]: string | null };

export type User = FixNullableStrings<Schemas['UserDto'], 'phone' | 'defaultBranchId'>;
export type UserWithPassword = FixNullableStrings<
  Schemas['UserWithPasswordDto'],
  'phone' | 'defaultBranchId'
>;
export interface UserList {
  data: User[];
  meta: PageMeta;
}
export type CreateUserInput = Schemas['CreateUserDto'];
export type UpdateUserInput = Omit<Schemas['UpdateUserDto'], 'phone' | 'defaultBranchId'> & {
  phone?: string | null;
  defaultBranchId?: string | null;
};
export interface SetUserBranchesInput {
  branchIds: string[];
  defaultBranchId?: string | null;
}
export type RoleCode = Schemas['RoleSummaryDto']['role'];

/** Phân hệ Hàng hóa (docs/api/endpoints.md mục 2). */
export type Product = Schemas['ProductDto'];
export type ProductList = Schemas['ProductListDto'];
export type CategoryNode = Schemas['CategoryNodeDto'];

/** Nhập dữ liệu từ Excel (docs/api/endpoints.md mục 9). */
export type ImportJob = Schemas['ImportJobDto'];
export type ImportRowError = Schemas['ImportErrorDto'];

/** Phân trang chuẩn của mọi danh sách (docs/api/README.md mục 4). */
export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
