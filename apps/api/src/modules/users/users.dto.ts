import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ROLES, USER_ROLES, type Role, type UserRole } from '@kiot/shared';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Tên đăng nhập: chữ thường không dấu, số, `.` `_` `-`, 3–32 ký tự (service tự đưa về chữ thường). */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export class UserDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'NV0002' }) code!: string;
  @ApiProperty({ example: 'ketoan01' }) username!: string;
  @ApiProperty({ example: 'Nguyễn Văn A' }) fullName!: string;
  @ApiProperty({ enum: USER_ROLES }) role!: UserRole;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({
    description: 'true = phải đổi mật khẩu ở lần đăng nhập kế tiếp',
  })
  mustChangePassword!: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastLoginAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) defaultBranchId!:
    string | null;
  @ApiProperty({
    type: [String],
    description:
      'Chi nhánh được gán. Quản lý luôn làm việc được ở mọi chi nhánh bất kể danh sách này',
  })
  branchIds!: string[];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class UserWithPasswordDto extends UserDto {
  @ApiPropertyOptional({
    description:
      'Mật khẩu tạm do hệ thống sinh — **chỉ hiện đúng một lần**, hãy chuyển cho người dùng. Không có khi quản trị tự đặt mật khẩu. Người dùng bị bắt đổi ở lần đăng nhập đầu',
  })
  temporaryPassword?: string;
}

export class ListUsersQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm không dấu theo mã / tên đăng nhập / họ tên / SĐT',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    enum: USER_ROLES,
    description: '`pending` = tài khoản tự đăng ký bằng Google, chờ cấp quyền',
  })
  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;

  @ApiPropertyOptional({ description: 'Lọc theo trạng thái hoạt động' })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UserListMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class UserListDto {
  @ApiProperty({ type: [UserDto] }) data!: UserDto[];
  @ApiProperty({ type: UserListMetaDto }) meta!: UserListMetaDto;
}

export class CreateUserDto {
  @ApiProperty({
    example: 'ketoan01',
    description:
      'Chữ thường không dấu, số, `.` `_` `-`; 3–32 ký tự. Không đổi được sau khi tạo',
  })
  @IsString()
  @MaxLength(64)
  username!: string;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role!: Role;

  @ApiPropertyOptional({
    example: '0901234567',
    description:
      'Số điện thoại Việt Nam (10–11 chữ số, bắt đầu 0 hoặc +84); server chuẩn hóa về dạng 0xxxxxxxxx. Sai định dạng → 400, field `phone`',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiProperty({
    type: [String],
    description:
      'Chi nhánh được gán (id từ `GET /branches`). Bắt buộc có ít nhất 1 với mọi vai trò trừ Quản lý',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  branchIds!: string[];

  @ApiPropertyOptional({
    description: 'Chi nhánh mặc định; phải nằm trong `branchIds`',
  })
  @IsOptional()
  @IsUUID()
  defaultBranchId?: string;

  @ApiPropertyOptional({
    description:
      'Mật khẩu ban đầu (10–128 ký tự, không chứa tên đăng nhập). Bỏ trống để hệ thống tự sinh và trả `temporaryPassword`',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'null hoặc chuỗi rỗng = xóa số; còn lại phải là số điện thoại hợp lệ (được chuẩn hóa)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @ApiPropertyOptional({
    enum: ROLES,
    description: 'Không đổi được vai trò của chính mình',
  })
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @ApiPropertyOptional({
    description:
      'false = khóa tài khoản (thu hồi mọi phiên ngay). Không tự khóa mình; không khóa Quản lý cuối cùng',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Chi nhánh mặc định; null = bỏ',
  })
  @IsOptional()
  @IsUUID()
  defaultBranchId?: string | null;
}

export class ResetPasswordDto {
  @ApiPropertyOptional({
    description:
      'Mật khẩu mới do quản trị đặt. Bỏ trống để hệ thống tự sinh và trả `temporaryPassword`',
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  newPassword?: string;
}

export class SetUserBranchesDto {
  @ApiProperty({
    type: [String],
    description: 'Danh sách chi nhánh MỚI (thay thế toàn bộ)',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  branchIds!: string[];

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Chi nhánh mặc định mới. Bỏ qua = giữ nếu vẫn còn được gán, ngược lại bỏ',
  })
  @IsOptional()
  @IsUUID()
  defaultBranchId?: string | null;
}
