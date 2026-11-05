import { ApiProperty } from '@nestjs/swagger';
import { USER_ROLES } from '@kiot/shared';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { GrantDto } from '../authorization/roles.dto.js';

export class LoginDto {
  @ApiProperty({
    example: 'quanly',
    description: 'Tên đăng nhập (không phân biệt hoa thường)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @ApiProperty({ example: '••••••••••' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Mật khẩu hiện tại' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;

  @ApiProperty({
    description:
      'Mật khẩu mới: 10–128 ký tự, khác mật khẩu cũ, không chứa tên đăng nhập',
  })
  @IsString()
  @MaxLength(256)
  newPassword!: string;
}

export class BranchSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'SG' }) code!: string;
  @ApiProperty({ example: 'Chi nhánh Sài Gòn' }) name!: string;
}

export class AuthUserDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'NV0001' }) code!: string;
  @ApiProperty({ example: 'quanly' }) username!: string;
  @ApiProperty({ example: 'Quản lý' }) fullName!: string;
  @ApiProperty({ enum: USER_ROLES }) role!: string;
  @ApiProperty({
    description:
      'true → chỉ gọi được /auth/me, /auth/change-password, /auth/logout cho tới khi đổi mật khẩu',
  })
  mustChangePassword!: boolean;
  @ApiProperty({
    type: [GrantDto],
    description:
      'Quyền hiện tại của vai trò (Quản lý chỉnh được). Frontend ẩn/khóa chức năng theo danh sách này.',
  })
  permissions!: GrantDto[];
  @ApiProperty({ type: String, nullable: true }) defaultBranchId!:
    string | null;
  @ApiProperty({
    type: [BranchSummaryDto],
    description: 'Chi nhánh được làm việc (Quản lý: tất cả)',
  })
  branches!: BranchSummaryDto[];
}

export class SessionResponseDto {
  @ApiProperty({
    description:
      'JWT, gửi trong header `Authorization: Bearer …`. Lưu trong bộ nhớ, không lưu localStorage.',
  })
  accessToken!: string;
  @ApiProperty({
    example: 900,
    description: 'Số giây access token còn hiệu lực',
  })
  expiresIn!: number;
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
}

export class RefreshResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ example: 900 }) expiresIn!: number;
}
