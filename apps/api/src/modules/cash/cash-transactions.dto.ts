import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination.js';
import { DocMetaDto, DocPersonDto } from '../purchasing/purchasing.dto.js';
import { CASH_DIRECTIONS } from './cash-accounts.dto.js';

export const CASH_STATUSES = ['completed', 'cancelled'] as const;
export type CashStatus = (typeof CASH_STATUSES)[number];
export const CASH_PARTY_TYPES = ['customer', 'supplier', 'employee'] as const;
export type CashPartyType = (typeof CASH_PARTY_TYPES)[number];
export const CASH_SORT_FIELDS = ['occurredAt', 'code', 'amount'] as const;
/** Số nguyên đồng > 0. */
const AMOUNT = /^[1-9]\d{0,14}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------ đầu vào

export class CashPartyInputDto {
  @ApiProperty({ enum: CASH_PARTY_TYPES }) @IsIn(CASH_PARTY_TYPES) type!: CashPartyType;
  @ApiProperty() @IsUUID() id!: string;
}

export class CashAllocationInputDto {
  @ApiProperty({ description: 'Hóa đơn hoàn tất của khách, cùng chi nhánh' })
  @IsUUID()
  invoiceId!: string;
  @ApiProperty({ example: '4300000', description: 'Số nguyên đồng > 0, không vượt còn nợ của hóa đơn' })
  @IsString()
  @Matches(AMOUNT, { message: 'Số tiền phải là số nguyên đồng > 0' })
  amount!: string;
}

class CashTxBodyMixin {
  @ApiPropertyOptional({ type: String, format: 'date-time', description: 'Mặc định bây giờ; không ở tương lai' })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @ApiPropertyOptional({
    type: [CashAllocationInputDto],
    description:
      'Chỉ khi thu nợ khách (danh mục "Tiền khách trả"). Bỏ trống = tự cấn vào hóa đơn còn nợ cũ nhất; `[]` = không cấn (khách trả trước); có danh sách = cấn đúng theo đó. Phần không cấn ghi vào công nợ khách (nợ có thể âm)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CashAllocationInputDto)
  allocations?: CashAllocationInputDto[];

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class CreateCashTransactionDto extends CashTxBodyMixin {
  @ApiProperty({ enum: CASH_DIRECTIONS, description: 'Phải khớp hướng của danh mục' })
  @IsIn(CASH_DIRECTIONS)
  direction!: 'in' | 'out';

  @ApiProperty({ example: '4300000', description: 'Số nguyên đồng > 0 (luôn dương; chiều thu/chi do `direction`)' })
  @IsString()
  @Matches(AMOUNT, { message: 'Số tiền phải là số nguyên đồng > 0' })
  amount!: string;

  @ApiProperty() @IsUUID() categoryId!: string;

  @ApiProperty({ description: 'Quỹ thuộc chi nhánh làm việc và đang hoạt động' })
  @IsUUID()
  accountId!: string;

  @ApiPropertyOptional({
    type: CashPartyInputDto,
    description:
      'Đối tượng trong hệ thống. BẮT BUỘC (đúng loại) với danh mục ghi công nợ: "Tiền khách trả" và "Hoàn tiền khách" cần khách, "Công nợ nhà cung cấp" và "Hoàn tiền từ nhà cung cấp" cần nhà cung cấp. Danh mục khác: tùy chọn, không ghi công nợ',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CashPartyInputDto)
  party?: CashPartyInputDto;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Tên người nộp/nhận dạng chữ khi không có trong hệ thống (bỏ qua nếu có `party`)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  partyName?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Biển số / xe cho chi phí vận chuyển, xăng xe' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  vehicleRef?: string | null;
}

export class CreateCustomerReceiptDto extends CashTxBodyMixin {
  @ApiProperty({ description: 'Quỹ nhận tiền, thuộc chi nhánh làm việc' })
  @IsUUID()
  accountId!: string;

  @ApiProperty({ example: '4300000', description: 'Số nguyên đồng > 0' })
  @IsString()
  @Matches(AMOUNT, { message: 'Số tiền phải là số nguyên đồng > 0' })
  amount!: string;
}

export class UpdateCashTransactionNoteDto {
  @ApiProperty({ nullable: true, type: String, description: 'Chỉ sửa được ghi chú' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note!: string | null;
}

export class CancelCashTransactionDto {
  @ApiProperty({ description: 'Lý do hủy (bắt buộc)' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ListCashTransactionsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Tìm không dấu theo mã phiếu, tên người nộp/nhận, ghi chú' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional({ enum: CASH_DIRECTIONS }) @IsOptional() @IsIn(CASH_DIRECTIONS) direction?: 'in' | 'out';
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
  @ApiPropertyOptional({ enum: CASH_PARTY_TYPES }) @IsOptional() @IsIn(CASH_PARTY_TYPES) partyType?: CashPartyType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() partyId?: string;
  @ApiPropertyOptional({ enum: CASH_STATUSES }) @IsOptional() @IsIn(CASH_STATUSES) status?: CashStatus;
  @ApiPropertyOptional({ example: '2026-11-01', description: 'Từ ngày (giờ Việt Nam, gồm cả ngày)' })
  @IsOptional()
  @Matches(DAY)
  from?: string;
  @ApiPropertyOptional({ example: '2026-11-03', description: 'Đến ngày (gồm cả ngày)' })
  @IsOptional()
  @Matches(DAY)
  to?: string;
  @ApiPropertyOptional({ enum: ['xlsx'], description: 'xlsx = tải Excel theo đúng bộ lọc (bỏ qua page/limit, tối đa 10.000 phiếu)' })
  @IsOptional()
  @IsIn(['xlsx'])
  format?: 'xlsx';
}

// ------------------------------------------------------------------ đầu ra

export class CashCategoryRefDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) code!: string | null;
  @ApiProperty() name!: string;
}

export class CashAccountRefDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['cash', 'bank'] }) type!: 'cash' | 'bank';
}

export class CashPartyDto {
  @ApiProperty({ enum: CASH_PARTY_TYPES }) type!: CashPartyType;
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Mã khách / nhà cung cấp / nhân viên' }) code!: string | null;
  @ApiProperty() name!: string;
}

export class CashAllocationDto {
  @ApiProperty() invoiceId!: string;
  @ApiProperty({ example: 'HD016890' }) invoiceCode!: string;
  @ApiProperty() amount!: string;
}

export class CashWarningDto {
  @ApiProperty({ enum: ['CASH_NEGATIVE'] }) code!: string;
  @ApiProperty() message!: string;
}

export class CashTransactionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'TT000123', description: 'TT… phiếu thu, CTM… phiếu chi' }) code!: string;
  @ApiProperty() branchId!: string;
  @ApiProperty({ enum: CASH_DIRECTIONS }) direction!: 'in' | 'out';
  @ApiProperty({ description: 'Luôn dương' }) amount!: string;
  @ApiProperty({ type: CashCategoryRefDto }) category!: CashCategoryRefDto;
  @ApiProperty({ type: CashAccountRefDto }) account!: CashAccountRefDto;
  @ApiProperty({ nullable: true, type: CashPartyDto }) party!: CashPartyDto | null;
  @ApiProperty({ nullable: true, type: String, description: 'Tên người nộp/nhận dạng chữ (khi không có `party`)' })
  partyName!: string | null;
  @ApiProperty({ nullable: true, type: String }) vehicleRef!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Nguồn phát sinh: invoice (thu lúc xuất hóa đơn), import…' })
  refType!: string | null;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ enum: CASH_STATUSES }) status!: CashStatus;
  @ApiProperty({ nullable: true, type: DocPersonDto }) createdBy!: DocPersonDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) cancelledAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) cancelReason!: string | null;
  @ApiPropertyOptional({ type: [CashAllocationDto], description: 'Các hóa đơn đã cấn trừ (chỉ phiếu thu nợ khách, chỉ ở chi tiết)' })
  allocations?: CashAllocationDto[];
  @ApiPropertyOptional({ type: [CashWarningDto], description: 'Cảnh báo mềm, chỉ trong phản hồi tạo phiếu' })
  warnings?: CashWarningDto[];
}

export class CashSummaryDto {
  @ApiProperty({ description: 'Tồn quỹ đầu kỳ = quỹ đầu kỳ của các quỹ + thu − chi các phiếu hoàn tất trước `from`' })
  openingBalance!: string;
  @ApiProperty({ description: 'Tổng thu của phiếu hoàn tất khớp bộ lọc (toàn bộ, không chỉ trang hiện tại)' })
  totalIn!: string;
  @ApiProperty({ description: 'Tổng chi của phiếu hoàn tất khớp bộ lọc' }) totalOut!: string;
  @ApiProperty({ description: 'Tồn quỹ cuối kỳ (đến hết `to`); tính theo quỹ đang xét, không theo các bộ lọc loại/đối tượng' })
  closingBalance!: string;
}

export class CashTransactionListDto {
  @ApiProperty({ type: CashSummaryDto }) summary!: CashSummaryDto;
  @ApiProperty({ type: [CashTransactionDto] }) data!: CashTransactionDto[];
  @ApiProperty({ type: DocMetaDto }) meta!: DocMetaDto;
}
