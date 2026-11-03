import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  PERMISSIONS,
  PERMISSION_MODULES,
  ROLES,
  ROLE_LABELS,
  type PermissionDef,
  type Role,
} from '@kiot/shared';
import { AppError } from '../../common/app-error.js';
import type { AppRequest } from '../../common/auth-user.js';
import {
  PermissionCatalogDto,
  RolePermissionsDto,
  RoleSummaryDto,
  SetRolePermissionsDto,
  SetRolePermissionsResultDto,
} from './roles.dto.js';
import { PermissionsService } from './permissions.service.js';
import { RequirePermission } from './require-permission.decorator.js';

function parseRole(value: string): Role {
  if (!(ROLES as readonly string[]).includes(value)) {
    throw new AppError(404, 'NOT_FOUND', `Không có vai trò "${value}"`);
  }
  return value as Role;
}

/** Màn hình "Phân quyền" dành cho Quản lý. */
@ApiTags('Phân quyền')
@ApiBearerAuth()
@RequirePermission('role.manage')
@ApiForbiddenResponse({
  description: 'Không có quyền `role.manage` (chỉ Quản lý)',
})
@Controller()
export class RolesController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get('permissions/catalog')
  @ApiOperation({
    summary: 'Danh mục quyền, gom theo phân hệ (để dựng ma trận phân quyền)',
  })
  @ApiOkResponse({ type: PermissionCatalogDto })
  catalog(): PermissionCatalogDto {
    return {
      modules: PERMISSION_MODULES.map((m) => ({
        key: m.key,
        label: m.label,
        permissions: PERMISSIONS.filter((p) => p.module === m.key).map((p) =>
          toDto(p),
        ),
      })),
    };
  }

  @Get('roles')
  @ApiOperation({ summary: 'Danh sách vai trò kèm số quyền và số người dùng' })
  @ApiOkResponse({ type: [RoleSummaryDto] })
  async list(): Promise<RoleSummaryDto[]> {
    const summaries = await this.permissions.listRoleSummaries();
    return summaries.map((s) => ({ ...s, label: ROLE_LABELS[s.role] }));
  }

  @Get('roles/:role/permissions')
  @ApiOperation({ summary: 'Quyền hiện tại của một vai trò' })
  @ApiParam({ name: 'role', enum: ROLES })
  @ApiOkResponse({ type: RolePermissionsDto })
  @ApiNotFoundResponse({ description: 'Vai trò không tồn tại' })
  async get(@Param('role') roleParam: string): Promise<RolePermissionsDto> {
    const role = parseRole(roleParam);
    return {
      role,
      label: ROLE_LABELS[role],
      locked: role === 'manager',
      permissions: await this.permissions.getGrants(role),
    };
  }

  @Put('roles/:role/permissions')
  @ApiOperation({
    summary: 'Đặt lại toàn bộ quyền của một vai trò',
    description:
      'Thay thế toàn bộ bộ quyền cũ. Server tự thêm các quyền bắt buộc đi kèm (trả trong `autoAdded`). ' +
      'Có hiệu lực ngay cho mọi người dùng thuộc vai trò đó, không cần đăng nhập lại.',
  })
  @ApiParam({ name: 'role', enum: ROLES })
  @ApiOkResponse({ type: SetRolePermissionsResultDto })
  @ApiConflictResponse({
    description: '`ROLE_LOCKED`: không chỉnh được vai trò Quản lý',
  })
  async set(
    @Param('role') roleParam: string,
    @Body() body: SetRolePermissionsDto,
    @Req() req: AppRequest,
  ): Promise<SetRolePermissionsResultDto> {
    const role = parseRole(roleParam);
    const result = await this.permissions.setGrants(
      role,
      body.permissions,
      req.user?.id ?? null,
    );
    return {
      role,
      label: ROLE_LABELS[role],
      locked: false,
      permissions: result.grants,
      autoAdded: result.autoAdded,
    };
  }

  @Post('roles/:role/permissions/reset')
  @ApiOperation({
    summary: 'Khôi phục cấu hình mặc định (đề xuất ban đầu) của một vai trò',
  })
  @ApiParam({ name: 'role', enum: ROLES })
  @ApiOkResponse({ type: SetRolePermissionsResultDto })
  @ApiConflictResponse({
    description: '`ROLE_LOCKED`: không chỉnh được vai trò Quản lý',
  })
  async reset(
    @Param('role') roleParam: string,
    @Req() req: AppRequest,
  ): Promise<SetRolePermissionsResultDto> {
    const role = parseRole(roleParam);
    const result = await this.permissions.resetToDefaults(
      role,
      req.user?.id ?? null,
    );
    return {
      role,
      label: ROLE_LABELS[role],
      locked: false,
      permissions: result.grants,
      autoAdded: [],
    };
  }
}

function toDto(
  p: PermissionDef,
): PermissionCatalogDto['modules'][number]['permissions'][number] {
  return {
    code: p.code,
    label: p.label,
    description: p.description,
    scopable: p.scopable ?? false,
    requires: [...(p.requires ?? [])],
    lockedToAdmin: p.lockedToAdmin ?? false,
  };
}
