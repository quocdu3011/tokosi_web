import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Giá bán: số nguyên đồng, không âm. */
export const SELL_PRICE_PATTERN = /^\d{1,15}$/;
export const GRID_MAX_LIMIT = 200;
export const GRID_MAX_CHANGES = 500;

export class PriceBookDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'CHUNG' }) code!: string;
  @ApiProperty({ example: 'Bảng giá chung' }) name!: string;
  @ApiProperty() withVat!: boolean;
  @ApiProperty({ description: 'Bảng giá chung: dùng khi bảng khác thiếu giá' })
  isDefault!: boolean;
  @ApiProperty() isActive!: boolean;
}

export class UpdatePriceBookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({
    description: 'false = tắt bảng giá. Không tắt được Bảng giá chung',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class GridQueryDto {
  @ApiPropertyOptional({
    description:
      'Chi nhánh của lưới giá; bỏ trống = chi nhánh làm việc (X-Branch-Id). Phải là chi nhánh người dùng được phép',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Tìm không dấu theo mã và tên' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Gồm cả hàng của các nhóm con' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: GRID_MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(GRID_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    enum: ['xlsx'],
    description: 'xlsx = tải Excel theo bộ lọc (bỏ qua page/limit)',
  })
  @IsOptional()
  @IsIn(['xlsx'])
  format?: 'xlsx';
}

export class GridBookDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}

export class GridRowDto {
  @ApiProperty() productId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({
    description: 'Giá vốn của chi nhánh. VẮNG MẶT nếu thiếu product.cost.view',
  })
  costPrice?: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string', nullable: true },
    description:
      'Khóa = priceBookId, giá trị = giá bán (số nguyên đồng) hoặc null nếu chưa có giá',
  })
  prices!: Record<string, string | null>;
}

export class GridMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class GridDto {
  @ApiProperty() branchId!: string;
  @ApiProperty({ type: [GridBookDto] }) books!: GridBookDto[];
  @ApiProperty({ type: [GridRowDto] }) data!: GridRowDto[];
  @ApiProperty({ type: GridMetaDto }) meta!: GridMetaDto;
}

export class GridChangeDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @IsUUID() priceBookId!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '33000',
    description: 'Giá mới (số nguyên đồng); null = xóa giá, lùi về bảng chung',
  })
  @IsOptional()
  @Matches(SELL_PRICE_PATTERN, {
    message: 'Giá bán phải là số nguyên đồng, không âm',
  })
  price!: string | null;
}

export class SaveGridDto {
  @ApiProperty({ description: 'Chi nhánh được sửa giá' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({
    type: [GridChangeDto],
    description: `Tối đa ${GRID_MAX_CHANGES} ô mỗi lần`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(GRID_MAX_CHANGES)
  @ValidateNested({ each: true })
  @Type(() => GridChangeDto)
  changes!: GridChangeDto[];
}

export class SaveGridResultDto {
  @ApiProperty({
    description: 'Số ô thực sự thay đổi (bỏ qua ô giữ nguyên giá)',
  })
  updated!: number;
}

export class BulkAdjustDto {
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiProperty() @IsUUID() priceBookId!: string;

  @ApiPropertyOptional({
    description: 'Chỉ điều chỉnh hàng của nhóm này (gồm nhóm con)',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({
    enum: ['percent', 'amount'],
    description: 'percent = theo %, amount = cộng/trừ số tiền cố định mỗi ô',
  })
  @IsIn(['percent', 'amount'])
  mode!: 'percent' | 'amount';

  @ApiProperty({
    example: '5',
    description:
      'Số có dấu: dương = tăng, âm = giảm. Ví dụ 5 với percent = tăng 5%',
  })
  @Matches(/^-?\d{1,12}(\.\d{1,4})?$/, {
    message: 'Giá trị điều chỉnh không hợp lệ',
  })
  value!: string;

  @ApiPropertyOptional({
    example: '100',
    default: '1',
    description:
      'Làm tròn đến bội số này (số nguyên >= 1, nửa lên). Giá bán luôn là số nguyên đồng',
  })
  @IsOptional()
  @Matches(/^[1-9]\d{0,8}$/, {
    message: 'Bội số làm tròn phải là số nguyên >= 1',
  })
  roundTo?: string;

  @ApiProperty({
    description:
      'true = chỉ xem trước, KHÔNG lưu; false = lưu thật. Bắt buộc gửi rõ để không lưu nhầm',
  })
  @IsBoolean()
  dryRun!: boolean;
}

export class BulkAdjustPreviewDto {
  @ApiProperty() productId!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ example: '33000' }) oldPrice!: string;
  @ApiProperty({ example: '34700' }) newPrice!: string;
}

export class BulkAdjustResultDto {
  @ApiProperty() dryRun!: boolean;
  @ApiProperty({ description: 'Số ô đổi giá' }) affected!: number;
  @ApiProperty({ description: 'Số ô bỏ qua vì giá mới âm' }) skipped!: number;
  @ApiProperty({ description: 'Số ô giá không đổi sau khi làm tròn' })
  unchanged!: number;
  @ApiProperty({
    type: [BulkAdjustPreviewDto],
    description: 'Tối đa 200 dòng đầu',
  })
  preview!: BulkAdjustPreviewDto[];
}

export class CopyBranchDto {
  @ApiProperty() @IsUUID() fromBranchId!: string;
  @ApiProperty() @IsUUID() toBranchId!: string;

  @ApiPropertyOptional({
    description: 'Chỉ chép bảng giá này; bỏ trống = mọi bảng giá',
  })
  @IsOptional()
  @IsUUID()
  priceBookId?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'false = chỉ chép ô chi nhánh đích CHƯA có giá; true = ghi đè ô đã có',
  })
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
}

export class CopyBranchResultDto {
  @ApiProperty({ description: 'Số ô được chép / cập nhật' }) copied!: number;
  @ApiProperty({ description: 'Số ô bỏ qua (đã có giá hoặc giá giống nhau)' })
  skipped!: number;
}
