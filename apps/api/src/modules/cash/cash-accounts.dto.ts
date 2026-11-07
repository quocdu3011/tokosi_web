import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { QueryBoolean } from '../../common/query.js';

export const CASH_ACCOUNT_TYPES = ['cash', 'bank'] as const;
export const CASH_DIRECTIONS = ['in', 'out'] as const;
/** Số nguyên đồng không âm (quỹ đầu kỳ). */
const OPENING = /^\d{1,15}$/;

export class CashAccountDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Tiền mặt - Sài Gòn' }) name!: string;
  @ApiProperty({ enum: CASH_ACCOUNT_TYPES }) type!: 'cash' | 'bank';
  @ApiProperty({ description: 'Số dư quỹ đầu kỳ (số nguyên đồng)' })
  openingBalance!: string;
  @ApiProperty({
    description:
      'Số dư hiện tại = quỹ đầu kỳ + tổng thu − tổng chi của các phiếu hoàn tất (tính khi đọc, không lưu)',
  })
  balance!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({
    description: 'Đã có phiếu thu/chi (hoàn tất hoặc đã hủy): khi đó không sửa được quỹ đầu kỳ',
  })
  hasTransactions!: boolean;
}

export class CashAccountListDto {
  @ApiProperty({ type: [CashAccountDto] }) data!: CashAccountDto[];
}

export class ListCashAccountsQueryDto {
  @ApiPropertyOptional({ description: 'Lấy cả quỹ đã ngưng hoạt động (mặc định chỉ quỹ đang hoạt động)' })
  @QueryBoolean()
  includeInactive?: boolean;
}

export class CreateCashAccountDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ enum: CASH_ACCOUNT_TYPES })
  @IsIn(CASH_ACCOUNT_TYPES)
  type!: 'cash' | 'bank';

  @ApiPropertyOptional({ example: '369310338', description: 'Quỹ đầu kỳ, số nguyên đồng ≥ 0 (mặc định 0)' })
  @IsOptional()
  @IsString()
  @Matches(OPENING, { message: 'Quỹ đầu kỳ phải là số nguyên đồng không âm' })
  openingBalance?: string;
}

export class UpdateCashAccountDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Chỉ đổi được khi quỹ CHƯA có phiếu nào (đổi số đầu kỳ làm sai mọi số dư lịch sử), ngược lại 422 INVALID_STATE',
  })
  @IsOptional()
  @IsString()
  @Matches(OPENING, { message: 'Quỹ đầu kỳ phải là số nguyên đồng không âm' })
  openingBalance?: string;

  @ApiPropertyOptional({ description: 'Ngưng hoạt động: không nhận phiếu mới' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ------------------------------------------------------------------ danh mục

export class CashCategoryDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Khóa ổn định của danh mục hệ thống (customer_payment, customer_refund, supplier_payment, supplier_refund, other_in…); danh mục tự tạo là null',
  })
  code!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: CASH_DIRECTIONS }) direction!: 'in' | 'out';
  @ApiProperty({ description: 'Danh mục hệ thống: không đổi hướng, không ngưng hoạt động' })
  isSystem!: boolean;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() sortOrder!: number;
}

export class CashCategoryListDto {
  @ApiProperty({ type: [CashCategoryDto] }) data!: CashCategoryDto[];
}

export class ListCashCategoriesQueryDto {
  @ApiPropertyOptional({ enum: CASH_DIRECTIONS })
  @IsOptional()
  @IsIn(CASH_DIRECTIONS)
  direction?: 'in' | 'out';

  @ApiPropertyOptional({ description: 'Lấy cả danh mục đã ngưng (mặc định chỉ danh mục đang dùng)' })
  @QueryBoolean()
  includeInactive?: boolean;
}

export class CreateCashCategoryDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ enum: CASH_DIRECTIONS })
  @IsIn(CASH_DIRECTIONS)
  direction!: 'in' | 'out';
}

export class UpdateCashCategoryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Danh mục hệ thống không ngưng được' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
