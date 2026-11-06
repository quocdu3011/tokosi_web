import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CUSTOMER_PRICE_LEVEL_CODES,
  CUSTOMER_SALES_METHODS,
  type CustomerPriceLevel,
} from '@kiot/shared';
import { PageQueryDto } from '../../common/pagination.js';
import { QueryBoolean } from '../../common/query.js';

/** Mã khách tự nhập: chữ, số, `-`, `_`, `.`; 1–30 ký tự. Bỏ trống = hệ thống cấp (KH000056…). */
export const CUSTOMER_CODE_PATTERN = /^[A-Za-z0-9._-]{1,30}$/;

export const CUSTOMER_SORT_FIELDS = [
  'code',
  'name',
  'createdAt',
  'newSince',
] as const;

const PRICE_LEVEL_DESC =
  'Level giá: new = Mới, medium = Vừa, large = Lớn, vip = Vip. Chỉ để nhân viên tham chiếu khi báo giá (hệ thống không có bảng giá)';

// ---------------------------------------------------------------- hồ sơ kho

export class CustomerProfileDto {
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Định vị kho: link bản đồ, tọa độ hoặc địa chỉ chữ',
  })
  warehouseLocation!: string | null;
  @ApiProperty({ nullable: true, type: Number }) warehouseCount!: number | null;
  @ApiProperty({
    nullable: true,
    type: String,
    example: '600m2',
    description: 'Diện tích kho, nhập tự do',
  })
  warehouseArea!: string | null;
  @ApiProperty({ nullable: true, type: String }) warehousePhotoUrl!:
    | string
    | null;
  @ApiProperty({ nullable: true, type: String }) competitors!: string | null;
  @ApiProperty({
    type: [String],
    enum: CUSTOMER_SALES_METHODS,
    description: 'Hình thức bán hàng (chọn nhiều)',
  })
  salesMethods!: string[];
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Quy mô khách; null = "Chưa có"',
  })
  scale!: string | null;
}

/** Các trường hồ sơ khi tạo/sửa; trường vắng mặt = không đổi, `null` = xóa giá trị đó. */
export class CustomerProfileInputDto {
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  warehouseLocation?: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  warehouseCount?: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  warehouseArea?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(1000)
  warehousePhotoUrl?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  competitors?: string | null;

  @ApiPropertyOptional({ type: [String], enum: CUSTOMER_SALES_METHODS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CUSTOMER_SALES_METHODS.length)
  @IsIn(CUSTOMER_SALES_METHODS as readonly string[], { each: true })
  salesMethods?: string[];

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  scale?: string | null;
}

// ---------------------------------------------------------------- phản hồi

export class CustomerSalesOwnerDto {
  @ApiProperty() id!: string;
  @ApiProperty() fullName!: string;
}

export class CustomerBranchFiguresDto {
  @ApiProperty() branchId!: string;
  @ApiProperty({ example: 'SG' }) branchCode!: string;
  @ApiProperty() branchName!: string;
  @ApiProperty({
    example: '1200000000',
    description:
      'Tổng bán TẠI chi nhánh này = tổng hóa đơn hoàn tất (chưa có hóa đơn thì 0)',
  })
  totalSales!: string;
  @ApiProperty({ description: 'Tổng bán trừ trả hàng TẠI chi nhánh này' })
  netSales!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'Thời điểm hóa đơn hoàn tất gần nhất tại chi nhánh này',
  })
  lastTransactionAt!: string | null;
  @ApiPropertyOptional({
    example: '12500000',
    description:
      'Công nợ phải thu TẠI chi nhánh này (+ = khách còn nợ, có thể ÂM = khách dư/ứng trước). VẮNG MẶT nếu thiếu quyền debt.view (hoặc debt.view chỉ của mình và đây không phải khách mình phụ trách)',
  })
  balance?: string;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Hạn mức công nợ tại chi nhánh này; null = không giới hạn. Vắng mặt như balance',
  })
  creditLimit?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Kỳ hạn thanh toán (ngày) tại chi nhánh này. Vắng mặt như balance',
  })
  paymentTermDays?: number | null;
}

export class CustomerWarningDto {
  @ApiProperty({ example: 'DUPLICATE_PHONE' }) code!: string;
  @ApiProperty() message!: string;
  @ApiPropertyOptional({
    description: 'Các khách khác cùng số điện thoại',
  })
  customers?: Array<{ id: string; code: string; name: string }>;
}

export class CustomerDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'KH006974' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    example: '0901234567',
    description: 'Đã chuẩn hóa; KHÔNG duy nhất (có thể trùng khách khác)',
  })
  phone!: string | null;
  @ApiProperty({ nullable: true, type: String }) address!: string | null;
  @ApiProperty({
    nullable: true,
    type: CustomerSalesOwnerDto,
    description: 'Nhân viên phụ trách (cột "Sale" của file TKS)',
  })
  salesOwner!: CustomerSalesOwnerDto | null;
  @ApiProperty({ enum: CUSTOMER_PRICE_LEVEL_CODES, description: PRICE_LEVEL_DESC })
  priceLevel!: CustomerPriceLevel;
  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-01',
    description: 'Tháng trở thành khách mới (ngày đầu tháng); null = khách cũ/không rõ',
  })
  newSince!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'Page' })
  acquisitionSource!: string | null;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({
    description:
      'true = khách hệ thống đại diện một chi nhánh (chuyển kho nội bộ); không sửa được',
  })
  isInternalBranch!: boolean;
  @ApiProperty({ nullable: true, type: CustomerProfileDto })
  profile!: CustomerProfileDto | null;
  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-11-03',
    description: 'Ngày tiếp khách gần nhất (YYYY-MM-DD)',
  })
  lastVisitedOn!: string | null;
  @ApiProperty({
    type: [CustomerBranchFiguresDto],
    description:
      'Số liệu TÁCH BIỆT theo chi nhánh, không bao giờ cộng gộp. Danh sách: chỉ chi nhánh làm việc. Chi tiết: mọi chi nhánh người dùng được phép',
  })
  branches!: CustomerBranchFiguresDto[];
  @ApiProperty({ nullable: true, type: String, description: 'Họ tên người tạo' })
  createdByName!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
  @ApiPropertyOptional({
    type: [CustomerWarningDto],
    description:
      'Cảnh báo mềm (vd DUPLICATE_PHONE); chỉ có ở chi tiết, tạo và sửa',
  })
  warnings?: CustomerWarningDto[];
}

export class CustomerListMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class CustomerListDto {
  @ApiProperty({ type: [CustomerDto] }) data!: CustomerDto[];
  @ApiProperty({ type: CustomerListMetaDto }) meta!: CustomerListMetaDto;
}

export class CustomerLookupItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String }) address!: string | null;
  @ApiProperty({ enum: CUSTOMER_PRICE_LEVEL_CODES })
  priceLevel!: CustomerPriceLevel;
  @ApiProperty({ nullable: true, type: CustomerSalesOwnerDto })
  salesOwner!: CustomerSalesOwnerDto | null;
  @ApiPropertyOptional({
    description: 'Công nợ tại chi nhánh làm việc; vắng mặt nếu thiếu quyền xem',
  })
  balance?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  creditLimit?: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Hạn mức còn lại = hạn mức − công nợ (có thể âm = đã vượt); null nếu không giới hạn',
  })
  creditAvailable?: string | null;
}

export class CustomerVisitDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: '2026-11-03' }) visitedOn!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ nullable: true, type: String }) createdByName!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

// ---------------------------------------------------------------- yêu cầu

export class ListCustomersQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Tìm không dấu theo mã, tên, SĐT' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: CUSTOMER_PRICE_LEVEL_CODES })
  @IsOptional()
  @IsIn(CUSTOMER_PRICE_LEVEL_CODES)
  priceLevel?: CustomerPriceLevel;

  @ApiPropertyOptional({ description: 'Nhân viên phụ trách (id người dùng)' })
  @IsOptional()
  @IsUUID()
  salesOwnerId?: string;

  @ApiPropertyOptional({
    description: 'Đúng nguồn khách mới (không phân biệt hoa thường, dấu), vd Page',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  acquisitionSource?: string;

  @ApiPropertyOptional({
    example: '2026-03',
    description: 'Khách mới từ tháng này (YYYY-MM, gồm cả tháng này)',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Tháng phải có dạng YYYY-MM' })
  newSinceFrom?: string;

  @ApiPropertyOptional({
    example: '2026-11',
    description: 'Khách mới đến tháng này (YYYY-MM, gồm cả tháng này)',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Tháng phải có dạng YYYY-MM' })
  newSinceTo?: string;

  @ApiPropertyOptional({
    description:
      'true = đang nợ (nợ > 0 TẠI chi nhánh làm việc), false = không nợ. Cần quyền debt.view; nếu debt.view chỉ "của mình" thì chỉ tính trong khách mình phụ trách',
  })
  @QueryBoolean()
  hasDebt?: boolean;

  @ApiPropertyOptional() @QueryBoolean() isActive?: boolean;

  @ApiPropertyOptional({
    description: 'true = gồm cả khách hệ thống đại diện chi nhánh (mặc định ẩn)',
  })
  @QueryBoolean()
  includeInternal?: boolean;

  @ApiPropertyOptional({
    enum: ['xlsx'],
    description:
      'xlsx = tải Excel theo đúng bộ lọc, tiêu đề như file TKS (bỏ qua page/limit, tối đa 10.000 dòng)',
  })
  @IsOptional()
  @IsIn(['xlsx'])
  format?: 'xlsx';
}

export class LookupCustomersQueryDto {
  @ApiPropertyOptional({ description: 'Tìm không dấu theo mã, tên, SĐT' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

class CustomerFieldsDto {
  @ApiPropertyOptional({ nullable: true, type: String, example: '0901 234 567' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Id nhân viên phụ trách (người dùng đang hoạt động)',
  })
  @IsOptional()
  @IsUUID()
  salesOwnerId?: string | null;

  @ApiPropertyOptional({ enum: CUSTOMER_PRICE_LEVEL_CODES })
  @IsOptional()
  @IsIn(CUSTOMER_PRICE_LEVEL_CODES)
  priceLevel?: CustomerPriceLevel;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '2026-10-01',
    description:
      'Tháng trở thành khách mới, dạng YYYY-MM-01 (chỉ nhận ngày đầu tháng); null = khách cũ',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-01$/, {
    message: 'Chỉ nhận ngày đầu tháng, dạng YYYY-MM-01',
  })
  newSince?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'Page' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  acquisitionSource?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: CustomerProfileInputDto,
    description:
      'Hồ sơ kho/đối thủ. Gửi object: chỉ đổi các trường có mặt. Gửi null: xóa cả hồ sơ',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerProfileInputDto)
  profile?: CustomerProfileInputDto | null;
}

export class CreateCustomerDto extends CustomerFieldsDto {
  @ApiPropertyOptional({
    example: 'KH006974',
    description:
      'Bỏ trống = hệ thống tự cấp. Chữ, số, "-", "_", "."; 1–30 ký tự; không trùng (kể cả khác hoa thường)',
  })
  @IsOptional()
  @Matches(CUSTOMER_CODE_PATTERN, {
    message: 'Mã chỉ gồm chữ, số, "-", "_", "." và dài 1-30 ký tự',
  })
  code?: string;

  @ApiProperty({ example: 'HN - Cửa hàng Ví Dụ' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
}

export class UpdateCustomerDto extends CustomerFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'false = ngưng giao dịch' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetCustomerTermsDto {
  @ApiProperty({
    nullable: true,
    type: String,
    example: '50000000',
    description: 'Hạn mức công nợ (số nguyên đồng ≥ 0); null = không giới hạn',
  })
  @IsOptional()
  @Matches(/^\d{1,15}$/, { message: 'Hạn mức là số nguyên đồng không âm' })
  creditLimit!: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 15,
    description: 'Kỳ hạn thanh toán (ngày, 0–3650); null = không quy định',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  paymentTermDays!: number | null;
}

export class CustomerTermsDto {
  @ApiProperty() branchId!: string;
  @ApiProperty({ nullable: true, type: String }) creditLimit!: string | null;
  @ApiProperty({ nullable: true, type: Number }) paymentTermDays!: number | null;
}

export class CreateCustomerVisitDto {
  @ApiProperty({
    example: '2026-11-03',
    description: 'Ngày tiếp khách (giờ Việt Nam), không được ở tương lai',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Ngày phải có dạng YYYY-MM-DD' })
  visitedOn!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}
