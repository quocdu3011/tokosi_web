import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { QueryBoolean } from '../../common/query.js';

export const IMPORT_TYPES = ['products', 'customers', 'suppliers'] as const;
/** Loại đã hỗ trợ; khách hàng và nhà cung cấp sẽ làm cùng phân hệ của chúng. */
export const SUPPORTED_IMPORT_TYPES = ['products'] as const;
export type SupportedImportType = (typeof SUPPORTED_IMPORT_TYPES)[number];

/** `overwrite` (mặc định): đè thông tin theo mã. `add`: cộng thêm số lượng, giữ nguyên thông tin cũ. */
export const IMPORT_MODES = ['overwrite', 'add'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_STORED_ERRORS = 500;

export class ImportErrorDto {
  @ApiProperty({ description: 'Số dòng trong file Excel (dòng 1 là tiêu đề)' })
  row!: number;
  @ApiProperty({ example: 'Mã hàng' }) field!: string;
  @ApiProperty({ example: 'Mã hàng trùng với dòng 12 trong file' })
  message!: string;
}

export class ImportJobDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: IMPORT_TYPES }) type!: string;
  @ApiProperty({
    enum: IMPORT_MODES,
    description:
      '`overwrite` = đè theo mã; `add` = cộng thêm tồn kho (cột Tồn kho), giữ nguyên thông tin cũ',
  })
  mode!: string;
  @ApiProperty({
    enum: ['queued', 'running', 'completed', 'failed'],
    description:
      'Hiện nhập xử lý ngay trong yêu cầu nên chỉ gặp completed hoặc failed. failed = có dòng lỗi hoặc lỗi hệ thống, KHÔNG ghi gì',
  })
  status!: string;
  @ApiProperty({ description: 'true = chỉ kiểm tra, không ghi dữ liệu' })
  dryRun!: boolean;
  @ApiProperty({ nullable: true, type: String }) fileName!: string | null;
  @ApiProperty({ description: 'Số dòng dữ liệu trong file' }) total!: number;
  @ApiProperty({
    description: 'Sẽ tạo / đã tạo (hàng hóa mới). Bằng 0 khi có lỗi',
  })
  created!: number;
  @ApiProperty({
    description:
      'Sẽ sửa / đã sửa, chỉ tính bản ghi có thay đổi thật nên chạy lại cùng file cho kết quả 0',
  })
  updated!: number;
  @ApiProperty({ description: 'Số dòng có lỗi' }) failed!: number;
  @ApiProperty({
    type: [ImportErrorDto],
    description: `Lỗi từng dòng (tối đa ${MAX_STORED_ERRORS} lỗi đầu)`,
  })
  errors!: ImportErrorDto[];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  finishedAt!: string | null;
}

export class ImportQueryDto {
  @ApiPropertyOptional({
    enum: IMPORT_MODES,
    default: 'overwrite',
    description:
      '`overwrite` (mặc định) = Import đè: cùng mã thì ghi thông tin trong file lên bản cũ, ô trống giữ nguyên. `add` = Import thêm: cùng mã thì CỘNG cột Tồn kho vào tồn của chi nhánh (số âm = trừ, không xuống dưới 0), thông tin khác giữ nguyên bản cũ; mã mới được tạo đầy đủ. Bắt buộc có branchId. Chạy lại sẽ cộng thêm lần nữa',
  })
  @IsOptional()
  @IsIn(IMPORT_MODES)
  mode?: ImportMode;

  @ApiPropertyOptional({
    default: true,
    description:
      'true (mặc định) = chỉ kiểm tra, không ghi gì. Phải gửi dryRun=false mới ghi thật',
  })
  @QueryBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description:
      'Chi nhánh làm việc. Bắt buộc khi mode=add (cộng/trừ tồn kho của chi nhánh đó); ở chế độ đè có thể bỏ trống vì không có cột nào của hàng hóa phụ thuộc chi nhánh',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
