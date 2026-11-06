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
import { PageQueryDto } from '../../common/pagination.js';
import { QueryBoolean } from '../../common/query.js';

/** Mã nhà cung cấp tự nhập: chữ, số, `-`, `_`, `.`; 1–30 ký tự. Bỏ trống = hệ thống cấp (NCC000056…). */
export const SUPPLIER_CODE_PATTERN = /^[A-Za-z0-9._-]{1,30}$/;

export const SUPPLIER_SORT_FIELDS = ['code', 'name', 'createdAt'] as const;

export class SupplierDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'NCC000002' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Nhóm nhà cung cấp: chuỗi tự do, có thể null; chỉ để phân loại/lọc, không có nghiệp vụ riêng (kể cả "Lái xe")',
  })
  groupName!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Họ tên người tạo',
  })
  createdByName!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({
    description:
      'Chi nhánh mà ba số tiền bên dưới tính cho (= chi nhánh làm việc, header X-Branch-Id). Tiền KHÔNG dùng chung giữa các chi nhánh',
  })
  branchId!: string;
  @ApiProperty({
    example: '1250000000',
    description:
      'Tổng mua TẠI chi nhánh này = số lịch sử của chi nhánh (chuyển từ KiotViet) + tổng phiếu nhập hoàn tất',
  })
  totalPurchase!: string;
  @ApiProperty({
    example: '1200000000',
    description:
      'Tổng mua trừ trả hàng TẠI chi nhánh này = số lịch sử + phiếu nhập − phiếu trả hàng nhập',
  })
  netPurchase!: string;
  @ApiPropertyOptional({
    example: '240000000',
    description:
      'Nợ cần trả hiện tại TẠI chi nhánh này (+ = còn nợ, có thể âm). VẮNG MẶT nếu thiếu quyền debt.view',
  })
  balance?: string;
}

export class SupplierBranchDto {
  @ApiProperty() branchId!: string;
  @ApiProperty({ example: 'SG' }) branchCode!: string;
  @ApiProperty() branchName!: string;
  @ApiProperty() totalPurchase!: string;
  @ApiProperty() netPurchase!: string;
  @ApiPropertyOptional({ description: 'Vắng mặt nếu thiếu debt.view' })
  balance?: string;
}

export class SupplierListMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class SupplierListDto {
  @ApiProperty({ type: [SupplierDto] }) data!: SupplierDto[];
  @ApiProperty({ type: SupplierListMetaDto }) meta!: SupplierListMetaDto;
}

export class ListSuppliersQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Tìm không dấu theo mã, tên, nhóm' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description: 'Đúng tên nhóm (không phân biệt hoa thường, dấu)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  groupName?: string;

  @ApiPropertyOptional({
    description:
      'true = đang nợ (nợ > 0 TẠI chi nhánh làm việc), false = không nợ. Cần quyền debt.view',
  })
  @QueryBoolean()
  hasDebt?: boolean;

  @ApiPropertyOptional() @QueryBoolean() isActive?: boolean;

  @ApiPropertyOptional({
    enum: ['xlsx'],
    description:
      'xlsx = tải Excel theo đúng bộ lọc (bỏ qua page/limit, tối đa 10.000 dòng)',
  })
  @IsOptional()
  @IsIn(['xlsx'])
  format?: 'xlsx';
}

export class CreateSupplierDto {
  @ApiPropertyOptional({
    example: 'NCC000056',
    description:
      'Bỏ trống = hệ thống tự cấp. Chữ, số, "-", "_", "."; 1–30 ký tự; không trùng (kể cả khác hoa thường)',
  })
  @IsOptional()
  @Matches(SUPPLIER_CODE_PATTERN, {
    message: 'Mã chỉ gồm chữ, số, "-", "_", "." và dài 1-30 ký tự',
  })
  code?: string;

  @ApiProperty({ example: 'Công ty TNHH ABC' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'Lái xe' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  groupName?: string | null;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'null hoặc rỗng = bỏ nhóm',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  groupName?: string | null;

  @ApiPropertyOptional({ description: 'false = ngưng giao dịch' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class LedgerQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-01',
    description:
      'Từ ngày (giờ Việt Nam, tính cả ngày này); bỏ trống = từ đầu. Dạng YYYY-MM-DD',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Ngày phải có dạng YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description:
      'Đến ngày (giờ Việt Nam, tính cả ngày này); bỏ trống = đến hiện tại',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Ngày phải có dạng YYYY-MM-DD' })
  to?: string;
}

export class LedgerEntryDto {
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty({
    enum: ['opening', 'invoice', 'payment', 'return', 'adjustment', 'transfer'],
  })
  entryType!: string;
  @ApiProperty({ nullable: true, type: String, example: 'goods_receipt' })
  refType!: string | null;
  @ApiProperty({ nullable: true, type: String }) refId!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'PN000948' })
  refCode!: string | null;
  @ApiProperty({
    example: '33735000',
    description: 'Dương = tăng nợ (mình nợ thêm), âm = giảm nợ',
  })
  amount!: string;
  @ApiProperty({
    example: '33735000',
    description: 'Số dư sau dòng này (cộng dồn từ số dư đầu kỳ)',
  })
  balance!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
}

export class LedgerDto {
  @ApiProperty({
    description:
      'Chi nhánh của sổ (= chi nhánh làm việc); mỗi chi nhánh một sổ riêng',
  })
  branchId!: string;
  @ApiProperty({
    example: '0',
    description: 'Số dư trước ngày `from` (0 nếu không có `from`)',
  })
  openingBalance!: string;
  @ApiProperty({ type: [LedgerEntryDto] }) entries!: LedgerEntryDto[];
  @ApiProperty({ example: '21345000' }) closingBalance!: string;
}
