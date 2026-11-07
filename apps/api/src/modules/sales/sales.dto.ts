import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
import { QueryBoolean } from '../../common/query.js';
import {
  DocMetaDto,
  DocPersonDto,
  DocRefDto,
} from '../purchasing/purchasing.dto.js';
import { Lines, QTY_PATTERN } from '../purchasing/purchase-lines.js';
import { MONEY_PATTERN, SaleLineDto } from './sale-lines.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const XLSX_DOC =
  'xlsx = tải Excel theo đúng bộ lọc, mỗi dòng hàng một dòng, tiêu đề như file chi tiết của KiotViet (bỏ qua page/limit, tối đa 10.000 phiếu)';

// ------------------------------------------------------------------ dùng chung

export class SaleCustomerDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'KH000002' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) phone!: string | null;
}

export class SaleWarningDto {
  @ApiProperty({ enum: ['STOCK_RESERVED', 'CREDIT_LIMIT_EXCEEDED'] })
  code!: string;
  @ApiProperty() message!: string;
  @ApiPropertyOptional() productId?: string;
  @ApiPropertyOptional() productCode?: string;
  @ApiPropertyOptional({ description: 'Số lượng cần (cộng các dòng cùng mặt hàng)' })
  requested?: string;
  @ApiPropertyOptional({
    description: 'Có thể bán = tồn − hàng đang giữ cho phiếu tạm khác',
  })
  available?: string;
  @ApiPropertyOptional() creditLimit?: string;
  @ApiPropertyOptional({ description: 'Nợ của khách tại chi nhánh sau chứng từ' })
  balanceAfter?: string;
}

export class ShipDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Địa chỉ lấy hàng',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pickupAddress?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Người nhận' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;
}

export class ListSalesDocsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm không dấu theo mã phiếu, mã/tên/SĐT khách',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ description: 'Người bán (id người dùng)' })
  @IsOptional()
  @IsUUID()
  sellerId?: string;
  @ApiPropertyOptional({ example: '2026-11-01', description: 'YYYY-MM-DD giờ Việt Nam, gồm cả ngày' })
  @IsOptional()
  @Matches(DAY, { message: 'Ngày phải có dạng YYYY-MM-DD' })
  from?: string;
  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(DAY, { message: 'Ngày phải có dạng YYYY-MM-DD' })
  to?: string;
  @ApiPropertyOptional({ enum: ['xlsx'], description: XLSX_DOC })
  @IsOptional()
  @IsIn(['xlsx'])
  format?: 'xlsx';
}

export class CancelSaleDocDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// ------------------------------------------------------------------ đặt hàng

export const ORDER_STATUSES = ['draft', 'completed', 'cancelled'] as const;
export type SaleOrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_SORT_FIELDS = ['orderedAt', 'code', 'total'] as const;

export class OrderItemDto {
  @ApiProperty() lineNo!: number;
  @ApiProperty() productId!: string;
  @ApiProperty({ example: 'T888LL' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '2000.000' }) qty!: string;
  @ApiProperty({ example: '13100', description: 'Đơn giá trước giảm' })
  price!: string;
  @ApiProperty({ example: '500', description: 'Giảm giá trên 1 đơn vị' })
  discountPerUnit!: string;
  @ApiProperty({ example: '12600', description: 'Giá bán = đơn giá − giảm giá' })
  unitPrice!: string;
  @ApiProperty({ example: '25200000' }) lineTotal!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiPropertyOptional({
    description:
      'Chỉ ở chi tiết phiếu tạm: có thể bán tại chi nhánh = tồn − hàng giữ cho phiếu tạm khác',
  })
  available?: string;
}

export class OrderDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'DH022295' }) code!: string;
  @ApiProperty({
    enum: ORDER_STATUSES,
    description: 'draft = Phiếu tạm (giữ hàng), completed = đã xuất hóa đơn, cancelled = đã hủy',
  })
  status!: SaleOrderStatus;
  @ApiProperty() branchId!: string;
  @ApiProperty({ type: SaleCustomerDto }) customer!: SaleCustomerDto;
  @ApiProperty({
    nullable: true,
    type: DocPersonDto,
    description: 'Người bán (Người nhận đặt)',
  })
  seller!: DocPersonDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) orderedAt!: string;
  @ApiProperty({ description: 'Tổng tiền hàng = Σ thành tiền' }) subtotal!: string;
  @ApiProperty({ description: 'Giảm giá phiếu (số tiền)' }) discount!: string;
  @ApiProperty({ description: 'Khách cần trả = tổng tiền hàng − giảm giá' })
  total!: string;
  @ApiProperty({ description: 'Tổng số lượng (tính khi đọc)' }) totalQty!: string;
  @ApiProperty({ description: 'Số dòng hàng' }) itemCount!: number;
  @ApiProperty({ type: ShipDto }) ship!: ShipDto;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({
    nullable: true,
    type: DocRefDto,
    description: 'Hóa đơn (hoàn tất) xuất từ phiếu này',
  })
  invoice!: DocRefDto | null;
  @ApiProperty({ nullable: true, type: DocPersonDto })
  createdBy!: DocPersonDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  cancelledAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) cancelReason!: string | null;
  @ApiPropertyOptional({ type: [OrderItemDto], description: 'Chỉ ở chi tiết' })
  items?: OrderItemDto[];
  @ApiPropertyOptional({
    type: [SaleWarningDto],
    description:
      'Cảnh báo mềm (không chặn): vượt có thể bán, vượt hạn mức nếu chốt ngay. Chỉ ở chi tiết/tạo/sửa phiếu tạm',
  })
  warnings?: SaleWarningDto[];
}

export class OrderListDto {
  @ApiProperty({ type: [OrderDto] }) data!: OrderDto[];
  @ApiProperty({ type: DocMetaDto }) meta!: DocMetaDto;
}

export class ListOrdersQueryDto extends ListSalesDocsQueryDto {
  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: SaleOrderStatus;
}

export class SaveOrderDto {
  @ApiProperty() @IsUUID() customerId!: string;
  @ApiPropertyOptional({
    description:
      'Người bán; mặc định = người đang đăng nhập. Quyền "chỉ của mình": luôn là chính mình',
  })
  @IsOptional()
  @IsUUID()
  sellerId?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  orderedAt?: string;
  @ApiPropertyOptional({
    example: '0',
    default: '0',
    description: 'Giảm giá cả phiếu (số nguyên đồng), ≤ tổng tiền hàng',
  })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'Giảm giá phải là số nguyên đồng ≥ 0' })
  discount?: string;
  @ApiPropertyOptional({ type: ShipDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShipDto)
  ship?: ShipDto;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
  @ApiProperty({
    type: [SaleLineDto],
    description:
      '1–500 dòng hàng hóa (combo phải tách thành hàng thành phần). Một mặt hàng có thể lặp nhiều dòng',
  })
  @Lines(SaleLineDto)
  items!: SaleLineDto[];
}

// ------------------------------------------------------------------ hóa đơn

export const INVOICE_STATUSES = ['completed', 'cancelled'] as const;
export type SaleInvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_SORT_FIELDS = ['invoicedAt', 'code', 'total'] as const;
export const PAYMENT_METHODS = ['cash', 'bank'] as const;

export class PaymentInputDto {
  @ApiProperty({ enum: PAYMENT_METHODS }) @IsIn(PAYMENT_METHODS) method!: 'cash' | 'bank';
  @ApiProperty({
    description:
      'Quỹ nhận tiền: phải thuộc chi nhánh làm việc, đang hoạt động và đúng loại (cash/bank)',
  })
  @IsUUID()
  accountId!: string;
  @ApiProperty({ example: '10000000', description: 'Số nguyên đồng > 0' })
  @IsString()
  @Matches(/^[1-9]\d{0,14}$/, { message: 'Số tiền phải là số nguyên đồng > 0' })
  amount!: string;
}

/** Thanh toán lúc xuất hóa đơn; phần chưa thanh toán tự ghi vào công nợ khách tại chi nhánh. */
class PaymentsMixin {
  @ApiPropertyOptional({
    type: [PaymentInputDto],
    description:
      'Các khoản thu lúc xuất (tiền mặt / chuyển khoản). Bỏ trống = ghi nợ toàn bộ. Tổng không vượt khách cần trả',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PaymentInputDto)
  payments?: PaymentInputDto[];
}

export class CreateInvoiceDto extends PaymentsMixin {
  @ApiProperty() @IsUUID() customerId!: string;
  @ApiPropertyOptional({
    description: 'Người bán; mặc định = người đang đăng nhập. Quyền "chỉ của mình": luôn là chính mình',
  })
  @IsOptional()
  @IsUUID()
  sellerId?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  invoicedAt?: string;
  @ApiPropertyOptional({ example: '0', default: '0', description: 'Giảm giá cả hóa đơn (số nguyên đồng) ≤ tổng tiền hàng' })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'Giảm giá phải là số nguyên đồng ≥ 0' })
  discount?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
  @ApiProperty({ type: [SaleLineDto], description: '1–500 dòng hàng hóa; một mặt hàng có thể lặp nhiều dòng' })
  @Lines(SaleLineDto)
  items!: SaleLineDto[];
}

export class InvoiceFromOrderDto extends PaymentsMixin {
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  invoicedAt?: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Bỏ trống = lấy ghi chú của phiếu' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class UpdateSaleNoteDto {
  @ApiProperty({ nullable: true, type: String, description: 'Chỉ sửa được ghi chú' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note!: string | null;
}

export class InvoiceAllocationDto {
  @ApiProperty({ example: 'TT000123' }) cashCode!: string;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty() amount!: string;
}

export class InvoiceItemDto {
  @ApiProperty() lineNo!: number;
  @ApiProperty() productId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '515.000' }) qty!: string;
  @ApiProperty({ description: 'Đơn giá trước giảm' }) price!: string;
  @ApiProperty({ description: 'Giảm giá trên 1 đơn vị' }) discountPerUnit!: string;
  @ApiProperty({ description: 'Giá bán = đơn giá − giảm giá' }) unitPrice!: string;
  @ApiProperty() lineTotal!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiPropertyOptional({
    example: '21800.5000',
    description: 'Giá vốn tại lúc bán. VẮNG MẶT nếu thiếu quyền product.cost.view',
  })
  unitCost?: string;
}

export class InvoicePaymentDto {
  @ApiProperty({ enum: PAYMENT_METHODS }) method!: 'cash' | 'bank';
  @ApiProperty() accountId!: string;
  @ApiProperty({ description: 'Tên quỹ' }) accountName!: string;
  @ApiProperty() amount!: string;
  @ApiProperty({ type: String, format: 'date-time' }) paidAt!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Mã phiếu thu (TT…) ở Sổ quỹ' })
  cashCode!: string | null;
}

export class InvoiceDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'HD016890' }) code!: string;
  @ApiProperty({ enum: INVOICE_STATUSES }) status!: SaleInvoiceStatus;
  @ApiProperty() branchId!: string;
  @ApiProperty({ nullable: true, type: DocRefDto, description: 'Phiếu đặt hàng gốc' })
  order!: DocRefDto | null;
  @ApiProperty({ type: SaleCustomerDto }) customer!: SaleCustomerDto;
  @ApiProperty({ nullable: true, type: DocPersonDto }) seller!: DocPersonDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) invoicedAt!: string;
  @ApiProperty({ description: 'Tổng tiền hàng' }) subtotal!: string;
  @ApiProperty({ description: 'Giảm giá hóa đơn' }) discount!: string;
  @ApiProperty({ description: 'Khách cần trả' }) total!: string;
  @ApiProperty({ description: 'Khách đã trả (thu lúc xuất + cấn trừ thu nợ về sau)' }) paid!: string;
  @ApiProperty({ description: 'Tổng phiếu trả hàng hoàn tất gắn hóa đơn này' }) returned!: string;
  @ApiProperty({
    description:
      'Còn nợ = khách cần trả − đã trả − phiếu trả hàng gắn hóa đơn, không âm (khách trả dư thì phần dư nằm ở công nợ khách)',
  })
  debt!: string;
  @ApiProperty() totalQty!: string;
  @ApiProperty() itemCount!: number;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ nullable: true, type: DocPersonDto }) createdBy!: DocPersonDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) cancelledAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) cancelReason!: string | null;
  @ApiPropertyOptional({ type: [InvoiceItemDto], description: 'Chỉ ở chi tiết' })
  items?: InvoiceItemDto[];
  @ApiPropertyOptional({ type: [InvoicePaymentDto], description: 'Chỉ ở chi tiết' })
  payments?: InvoicePaymentDto[];
  @ApiPropertyOptional({
    type: [InvoiceAllocationDto],
    description: 'Các khoản thu nợ về sau đã cấn trừ vào hóa đơn (phiếu thu còn hiệu lực); chỉ ở chi tiết',
  })
  allocations?: InvoiceAllocationDto[];
  @ApiPropertyOptional({
    description:
      'Lãi gộp = tổng tiền hàng − giảm giá − Σ(SL × giá vốn). Chỉ ở chi tiết và chỉ khi có product.cost.view',
  })
  grossProfit?: string;
  @ApiPropertyOptional({
    type: [SaleWarningDto],
    description: 'Cảnh báo mềm lúc xuất (vượt có thể bán, vượt hạn mức); chỉ trong phản hồi tạo hóa đơn',
  })
  warnings?: SaleWarningDto[];
}

export class InvoiceListDto {
  @ApiProperty({ type: [InvoiceDto] }) data!: InvoiceDto[];
  @ApiProperty({ type: DocMetaDto }) meta!: DocMetaDto;
}

export class ListInvoicesQueryDto extends ListSalesDocsQueryDto {
  @ApiPropertyOptional({ enum: INVOICE_STATUSES })
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: SaleInvoiceStatus;
  @ApiPropertyOptional({ description: 'true = còn nợ (khách cần trả > đã trả), false = đã trả đủ; chỉ tính hóa đơn hoàn tất' })
  @QueryBoolean()
  hasDebt?: boolean;
  @ApiPropertyOptional({ description: 'Chỉ hóa đơn xuất từ phiếu đặt hàng này' })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

// ------------------------------------------------------------------ trả hàng bán

export const RETURN_STATUSES = ['completed', 'cancelled'] as const;
export type SalesReturnStatus = (typeof RETURN_STATUSES)[number];
export const RETURN_SORT_FIELDS = ['returnedAt', 'code', 'total'] as const;

export class SalesReturnLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ example: '36', description: 'Số lượng trả > 0, tối đa 3 chữ số thập phân' })
  @IsString()
  @Matches(QTY_PATTERN, { message: 'Số lượng không hợp lệ' })
  qty!: string;
  @ApiProperty({ example: '130000', description: 'Giá trả (Giá bán) trên 1 đơn vị, số nguyên đồng; tiền trả khách = SL × giá trả, ghi giảm công nợ' })
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'Giá trả phải là số nguyên đồng ≥ 0' })
  returnPrice!: string;
  @ApiPropertyOptional({
    example: '120000',
    description: 'Giá nhập lại (có thể khác giá trả); mặc định = giá trả. Không đổi giá vốn bình quân; chênh lệch (giá trả − giá nhập lại) × SL tính vào lợi nhuận',
  })
  @IsOptional()
  @IsString()
  @Matches(MONEY_PATTERN, { message: 'Giá nhập lại phải là số nguyên đồng ≥ 0' })
  restockPrice?: string;
  @ApiPropertyOptional({ default: true, description: 'true = nhập lại kho (cộng tồn, không đổi giá vốn); false = không nhập kho' })
  @IsOptional()
  @IsBoolean()
  restock?: boolean;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class CreateSalesReturnDto {
  @ApiProperty() @IsUUID() customerId!: string;
  @ApiPropertyOptional({
    description: 'Hóa đơn gốc (cùng chi nhánh và khách). Bỏ trống = trả không tham chiếu hóa đơn; quyền "chỉ của mình" bắt buộc có hóa đơn của mình',
  })
  @IsOptional()
  @IsUUID()
  invoiceId?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  returnedAt?: string;
  @ApiPropertyOptional({ description: 'Người nhận trả hàng; mặc định = người đang đăng nhập' })
  @IsOptional()
  @IsUUID()
  receivedById?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
  @ApiProperty({ type: [SalesReturnLineDto], description: '1–500 dòng hàng hóa' })
  @Lines(SalesReturnLineDto)
  items!: SalesReturnLineDto[];
}

export class SalesReturnItemDto {
  @ApiProperty() productId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '36.000' }) qty!: string;
  @ApiProperty({ description: 'Giá trả (Giá bán)' }) returnPrice!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Giá nhập lại; null nếu không nhập kho' })
  restockPrice!: string | null;
  @ApiProperty() restock!: boolean;
  @ApiProperty() lineTotal!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
}

export class SalesReturnDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'TH001076' }) code!: string;
  @ApiProperty({ enum: RETURN_STATUSES }) status!: SalesReturnStatus;
  @ApiProperty() branchId!: string;
  @ApiProperty({ type: SaleCustomerDto }) customer!: SaleCustomerDto;
  @ApiProperty({ nullable: true, type: DocRefDto, description: 'Hóa đơn gốc' })
  invoice!: DocRefDto | null;
  @ApiProperty({ nullable: true, type: DocPersonDto, description: 'Người bán của hóa đơn gốc' })
  seller!: DocPersonDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) returnedAt!: string;
  @ApiProperty({ nullable: true, type: DocPersonDto, description: 'Người nhận trả' })
  receivedBy!: DocPersonDto | null;
  @ApiProperty({ description: 'Tổng tiền trả khách = Σ thành tiền; luôn GHI GIẢM công nợ khách (không hoàn tiền trên phiếu)' })
  total!: string;
  @ApiProperty() totalQty!: string;
  @ApiProperty() itemCount!: number;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ nullable: true, type: DocPersonDto }) createdBy!: DocPersonDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) cancelledAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) cancelReason!: string | null;
  @ApiPropertyOptional({ type: [SalesReturnItemDto], description: 'Chỉ ở chi tiết' })
  items?: SalesReturnItemDto[];
  @ApiPropertyOptional({
    description: 'Chênh lệch giá nhập lại tính vào lợi nhuận = Σ (giá trả − giá nhập lại) × SL các dòng nhập kho. Chỉ ở chi tiết và khi có product.cost.view',
  })
  priceDifference?: string;
}

export class SalesReturnListDto {
  @ApiProperty({ type: [SalesReturnDto] }) data!: SalesReturnDto[];
  @ApiProperty({ type: DocMetaDto }) meta!: DocMetaDto;
}

export class ListSalesReturnsQueryDto extends ListSalesDocsQueryDto {
  @ApiPropertyOptional({ enum: RETURN_STATUSES })
  @IsOptional()
  @IsIn(RETURN_STATUSES)
  status?: SalesReturnStatus;
  @ApiPropertyOptional({ description: 'Chỉ phiếu trả của hóa đơn này' })
  @IsOptional()
  @IsUUID()
  invoiceId?: string;
}
