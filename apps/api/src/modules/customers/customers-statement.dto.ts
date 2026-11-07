import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { LedgerQueryDto } from '../suppliers/suppliers.dto.js';

export const STATEMENT_KINDS = [
  'opening',
  'invoice',
  'invoice_cancel',
  'sales_return',
  'sales_return_cancel',
  'receipt',
  'refund',
  'cash_cancel',
  'adjustment',
] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

// ------------------------------------------------------------------ tuổi nợ

export class CustomerAgingInvoiceDto {
  @ApiProperty() invoiceId!: string;
  @ApiProperty({ example: 'HD016890' }) code!: string;
  @ApiProperty({ type: String, format: 'date-time' }) invoicedAt!: string;
  @ApiProperty({ description: 'Khách cần trả' }) total!: string;
  @ApiProperty({ description: 'Đã trả = thu lúc xuất + cấn trừ thu nợ về sau' }) paid!: string;
  @ApiProperty({ description: 'Tổng phiếu trả hàng hoàn tất gắn hóa đơn' }) returned!: string;
  @ApiProperty({ description: 'Còn nợ (> 0)' }) outstanding!: string;
  @ApiProperty({ description: 'Số ngày lịch (giờ Việt Nam) từ ngày hóa đơn đến hôm nay' }) ageDays!: number;
  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-11-18',
    description: 'Ngày đến hạn = ngày hóa đơn + kỳ hạn công nợ của khách tại chi nhánh; null nếu khách không có kỳ hạn',
  })
  dueDate!: string | null;
  @ApiProperty({ description: 'true khi đã qua ngày đến hạn (không có kỳ hạn thì luôn false)' }) overdue!: boolean;
}

export class CustomerAgingBucketsDto {
  @ApiProperty({ description: '0–30 ngày' }) d0_30!: string;
  @ApiProperty({ description: '31–60 ngày' }) d31_60!: string;
  @ApiProperty({ description: '61–90 ngày' }) d61_90!: string;
  @ApiProperty({ description: 'Trên 90 ngày' }) over90!: string;
}

export class CustomerAgingDto {
  @ApiProperty({ description: 'Chi nhánh làm việc; mỗi chi nhánh một bộ số riêng' }) branchId!: string;
  @ApiProperty({ example: '2026-11-07', description: 'Ngày tính (giờ Việt Nam)' }) asOf!: string;
  @ApiProperty({ type: [CustomerAgingInvoiceDto], description: 'Hóa đơn còn nợ, cũ nhất trước' })
  invoices!: CustomerAgingInvoiceDto[];
  @ApiProperty({ type: CustomerAgingBucketsDto, description: 'Tổng còn nợ của hóa đơn theo nhóm tuổi (tính theo ngày hóa đơn)' })
  buckets!: CustomerAgingBucketsDto;
  @ApiProperty({ description: 'Σ còn nợ của các hóa đơn' }) invoiceTotal!: string;
  @ApiProperty({ description: 'Nợ của khách tại chi nhánh theo sổ công nợ (bằng `closingBalance` của sổ)' }) balance!: string;
  @ApiProperty({
    description:
      'balance − invoiceTotal: phần nợ không gắn hóa đơn nào, gồm nợ đầu kỳ chuyển từ KiotViet, điều chỉnh và tiền khách trả trước chưa cấn (số âm)',
  })
  notAllocated!: string;
}

// ------------------------------------------------------------------ sao kê

export class CustomerStatementQueryDto extends LedgerQueryDto {
  @ApiPropertyOptional({
    enum: ['xlsx'],
    description: 'xlsx = tải Excel biên bản đối chiếu theo đúng kỳ',
  })
  @IsOptional()
  @IsIn(['xlsx'])
  format?: 'xlsx';
}

export class CustomerStatementLineDto {
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ enum: STATEMENT_KINDS }) kind!: StatementKind;
  @ApiProperty({ nullable: true, type: String, description: 'Loại chứng từ gốc: invoice, sales_return, cash_transaction…' })
  refType!: string | null;
  @ApiProperty({ nullable: true, type: String }) refId!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'HD016890' }) refCode!: string | null;
  @ApiProperty({ example: 'Hóa đơn HD016890' }) description!: string;
  @ApiProperty({ description: 'Phát sinh tăng nợ (số dương hoặc 0). Hóa đơn: tổng tiền khách cần trả' })
  increase!: string;
  @ApiProperty({ description: 'Phát sinh giảm nợ (số dương hoặc 0). Hóa đơn: phần thu ngay lúc xuất' })
  decrease!: string;
  @ApiProperty({ description: 'Còn nợ sau dòng này (cộng dồn từ nợ đầu kỳ)' }) balance!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
}

export class CustomerStatementTotalsDto {
  @ApiProperty() increase!: string;
  @ApiProperty() decrease!: string;
}

export class CustomerStatementPartyDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
  @ApiProperty({ nullable: true, type: String }) address!: string | null;
}

export class CustomerStatementBranchDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class CustomerStatementDto {
  @ApiProperty({ type: CustomerStatementPartyDto }) customer!: CustomerStatementPartyDto;
  @ApiProperty({ type: CustomerStatementBranchDto }) branch!: CustomerStatementBranchDto;
  @ApiProperty({ nullable: true, type: String, example: '2026-11-01' }) from!: string | null;
  @ApiProperty({ nullable: true, type: String, example: '2026-11-30' }) to!: string | null;
  @ApiProperty({ description: 'Nợ trước ngày `from` (0 nếu không có `from`)' }) openingBalance!: string;
  @ApiProperty({ type: [CustomerStatementLineDto] }) lines!: CustomerStatementLineDto[];
  @ApiProperty({ type: CustomerStatementTotalsDto, description: 'Cộng phát sinh trong kỳ' }) totals!: CustomerStatementTotalsDto;
  @ApiProperty({ description: 'Nợ cuối kỳ = nợ đầu kỳ + tăng − giảm; bằng `closingBalance` của sổ công nợ cùng kỳ' })
  closingBalance!: string;
}
