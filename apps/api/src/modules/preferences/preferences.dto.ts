import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  PAGE_SIZE_OPTIONS,
  TABLE_PREFS_LIMITS,
  type PageSizeOption,
} from '@kiot/shared';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const { maxColumns, maxColumnIdLength, minColumnWidth, maxColumnWidth } =
  TABLE_PREFS_LIMITS;

/** Trả về lý do `widths` không hợp lệ (tiếng Việt) hoặc `null` nếu hợp lệ. */
export function columnWidthsProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'widths phải là đối tượng { idCột: độ rộng }';
  }
  const entries = Object.entries(value);
  if (entries.length > maxColumns) {
    return `widths tối đa ${maxColumns} cột`;
  }
  for (const [id, width] of entries) {
    if (id.length === 0 || id.length > maxColumnIdLength) {
      return `Id cột trong widths phải dài 1–${maxColumnIdLength} ký tự`;
    }
    if (
      typeof width !== 'number' ||
      !Number.isInteger(width) ||
      width < minColumnWidth ||
      width > maxColumnWidth
    ) {
      return `Độ rộng cột "${id}" phải là số nguyên từ ${minColumnWidth} đến ${maxColumnWidth}`;
    }
  }
  return null;
}

/** class-validator không kiểm được khóa/giá trị của đối tượng tự do, nên kiểm bằng ràng buộc riêng. */
@ValidatorConstraint({ name: 'columnWidths', async: false })
class ColumnWidthsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return columnWidthsProblem(value) === null;
  }
  defaultMessage(args: ValidationArguments): string {
    return columnWidthsProblem(args.value) ?? 'widths không hợp lệ';
  }
}

/**
 * Tùy chỉnh của MỘT bảng. Mọi trường tùy chọn (thiếu = dùng mặc định của màn hình); `null` không hợp lệ.
 * Khớp `TablePrefs` trong `@kiot/shared`.
 */
export class TablePrefsDto {
  @ApiPropertyOptional({
    type: [String],
    maxItems: maxColumns,
    example: ['description'],
    description: `Id các cột đang ẩn (tối đa ${maxColumns}, mỗi id 1–${maxColumnIdLength} ký tự)`,
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(maxColumns)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(maxColumnIdLength, { each: true })
  hidden?: string[];

  @ApiPropertyOptional({
    type: [String],
    maxItems: maxColumns,
    example: ['code', 'name', 'onHand'],
    description:
      'Thứ tự id cột; cột không có trong danh sách xếp sau, theo thứ tự mặc định',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(maxColumns)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(maxColumnIdLength, { each: true })
  order?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: {
      type: 'integer',
      minimum: minColumnWidth,
      maximum: maxColumnWidth,
    },
    example: { name: 360 },
    description: `Độ rộng cột (px, số nguyên ${minColumnWidth}..${maxColumnWidth}) theo id cột; tối đa ${maxColumns} cột`,
  })
  @ValidateIf((_, value) => value !== undefined)
  @Validate(ColumnWidthsConstraint)
  widths?: Record<string, number>;

  @ApiPropertyOptional({
    enum: PAGE_SIZE_OPTIONS,
    example: 50,
    description: 'Số dòng mỗi trang',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(PAGE_SIZE_OPTIONS, {
    message: `pageSize phải là một trong: ${PAGE_SIZE_OPTIONS.join(', ')}`,
  })
  pageSize?: PageSizeOption;
}

/** Phản hồi `GET /me/table-prefs`: khóa bảng → tùy chỉnh (bảng chưa lưu thì không có khóa). */
@ApiExtraModels(TablePrefsDto)
export class TablePrefsMapDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(TablePrefsDto) },
    example: {
      products: {
        hidden: ['description'],
        order: ['code', 'name', 'onHand'],
        widths: { name: 360 },
        pageSize: 50,
      },
    },
  })
  data!: Record<string, TablePrefsDto>;
}
