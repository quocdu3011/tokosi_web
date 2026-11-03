import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PERMISSION_CODES, ROLES } from '@kiot/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  ValidateNested,
} from 'class-validator';

const SCOPES = ['all', 'own'] as const;

export class GrantDto {
  @ApiProperty({
    example: 'invoice.view',
    description: 'Mã quyền trong danh mục (GET /permissions/catalog)',
  })
  @IsString()
  code!: string;

  @ApiProperty({
    enum: SCOPES,
    example: 'own',
    description:
      '`all` = toàn bộ dữ liệu; `own` = chỉ dữ liệu của mình (chỉ áp dụng quyền có `scopable`)',
  })
  @IsIn(SCOPES)
  scope!: 'all' | 'own';
}

export class SetRolePermissionsDto {
  @ApiProperty({
    type: [GrantDto],
    description: 'Bộ quyền MỚI của vai trò (thay thế toàn bộ bộ cũ)',
  })
  @IsArray()
  @ArrayMaxSize(PERMISSION_CODES.length)
  @ValidateNested({ each: true })
  @Type(() => GrantDto)
  permissions!: GrantDto[];
}

export class PermissionDefDto {
  @ApiProperty({ example: 'invoice.create' }) code!: string;
  @ApiProperty({ example: 'Xuất hóa đơn' }) label!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ description: 'Có thể chọn phạm vi "chỉ của mình"' })
  scopable!: boolean;
  @ApiProperty({
    type: [String],
    description: 'Quyền bắt buộc đi kèm (tự được thêm khi lưu)',
  })
  requires!: string[];
  @ApiProperty({
    description: 'Chỉ vai trò Quản lý có; không thể cấp cho vai trò khác',
  })
  lockedToAdmin!: boolean;
}

export class PermissionModuleDto {
  @ApiProperty({ example: 'sales' }) key!: string;
  @ApiProperty({ example: 'Đơn hàng' }) label!: string;
  @ApiProperty({ type: [PermissionDefDto] }) permissions!: PermissionDefDto[];
}

export class PermissionCatalogDto {
  @ApiProperty({ type: [PermissionModuleDto] }) modules!: PermissionModuleDto[];
}

export class RoleSummaryDto {
  @ApiProperty({ enum: ROLES }) role!: string;
  @ApiProperty({ example: 'Kế toán' }) label!: string;
  @ApiProperty({
    description: 'Vai trò Quản lý: luôn đủ quyền, không chỉnh được',
  })
  locked!: boolean;
  @ApiProperty() permissionCount!: number;
  @ApiProperty() userCount!: number;
}

export class RolePermissionsDto {
  @ApiProperty({ enum: ROLES }) role!: string;
  @ApiProperty() label!: string;
  @ApiProperty() locked!: boolean;
  @ApiProperty({ type: [GrantDto] }) permissions!: GrantDto[];
}

export class SetRolePermissionsResultDto extends RolePermissionsDto {
  @ApiProperty({
    type: [String],
    description: 'Quyền được tự thêm vì là điều kiện bắt buộc của quyền khác',
  })
  autoAdded!: string[];
}
