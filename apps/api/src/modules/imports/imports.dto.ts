import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { QueryBoolean } from '../../common/query.js';

export const IMPORT_TYPES = ['products', 'customers', 'suppliers'] as const;
/** Loại đã hỗ trợ; khách hàng và nhà cung cấp sẽ làm cùng phân hệ của chúng. */
export const SUPPORTED_IMPORT_TYPES = ['products'] as const;
export type SupportedImportType = (typeof SUPPORTED_IMPORT_TYPES)[number];

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
    default: true,
    description:
      'true (mặc định) = chỉ kiểm tra, không ghi gì. Phải gửi dryRun=false mới ghi thật',
  })
  @QueryBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description:
      'Chi nhánh cho tồn tối thiểu/tối đa, vị trí kho. Bắt buộc nếu file có các cột đó',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
