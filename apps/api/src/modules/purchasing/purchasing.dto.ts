import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination.js';
import { Lines, PurchaseLineDto, ReturnLineDto } from './purchase-lines.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const XLSX_DOC =
  'xlsx = tải Excel theo đúng bộ lọc (mỗi dòng hàng một dòng Excel, bỏ qua page/limit, tối đa 10.000 phiếu)';

// ------------------------------------------------------------------ phản hồi dùng chung
export class DocPartyDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'NCC000001' }) code!: string;
  @ApiProperty() name!: string;
}
export class DocRefDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'PDN000394' }) code!: string;
}
export class DocPersonDto {
  @ApiProperty() id!: string;
  @ApiProperty() fullName!: string;
}
export class DocMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

class DocBaseDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() branchId!: string;
  @ApiProperty({ type: DocPartyDto }) supplier!: DocPartyDto;
  @ApiProperty({
    example: '240000000',
    description: 'Cần trả NCC (= Σ thành tiền các dòng)',
  })
  total!: string;
  @ApiProperty({
    example: '1095',
    description: 'Tổng số lượng các dòng (tính khi đọc)',
  })
  totalQty!: string;
  @ApiProperty({ description: 'Số mặt hàng (số dòng)' }) itemCount!: number;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ nullable: true, type: DocPersonDto })
  createdBy!: DocPersonDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  cancelledAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) cancelReason!: string | null;
}

// ------------------------------------------------------------------ nhập hàng
export class GoodsReceiptItemDto {
  @ApiProperty() productId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '1095' }) qty!: string;
  @ApiProperty({ example: '219967.9800', description: 'Giá nhập' })
  unitCost!: string;
  @ApiProperty({ example: '240000000' }) lineTotal!: string;
  @ApiProperty({
    example: '0',
    description: 'Đã trả lại NCC (phiếu trả hàng nhập hoàn tất)',
  })
  returnedQty!: string;
}
export class GoodsReceiptDto extends DocBaseDto {
  @ApiProperty({ enum: ['completed', 'cancelled'] }) status!:
    'completed' | 'cancelled';
  @ApiProperty({
    nullable: true,
    type: DocRefDto,
    description: 'Phiếu đặt hàng nhập; null nếu nhập trực tiếp',
  })
  purchaseOrder!: DocRefDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) receivedAt!: string;
  @ApiProperty({ nullable: true, type: DocPersonDto })
  receivedBy!: DocPersonDto | null;
  @ApiPropertyOptional({
    type: [GoodsReceiptItemDto],
    description: 'Chỉ có ở chi tiết, không có ở danh sách',
  })
  items?: GoodsReceiptItemDto[];
}
export class GoodsReceiptListDto {
  @ApiProperty({ type: [GoodsReceiptDto] }) data!: GoodsReceiptDto[];
  @ApiProperty({ type: DocMetaDto }) meta!: DocMetaDto;
}

export class ListDocsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm không dấu theo mã phiếu, mã và tên nhà cung cấp',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'YYYY-MM-DD giờ Việt Nam, gồm cả ngày',
  })
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

export const RECEIPT_SORT_FIELDS = ['receivedAt', 'code', 'total'] as const;
export class ListGoodsReceiptsQueryDto extends ListDocsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() purchaseOrderId?: string;
  @ApiPropertyOptional({ enum: ['completed', 'cancelled'] })
  @IsOptional()
  @IsIn(['completed', 'cancelled'])
  status?: 'completed' | 'cancelled';
}

export class CreateGoodsReceiptDto {
  @ApiProperty() @IsUUID() supplierId!: string;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Phiếu đặt hàng nhập (PDN…) nếu nhập theo đơn đặt',
  })
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Mặc định = bây giờ; không ở tương lai',
  })
  @IsOptional()
  @IsISO8601()
  receivedAt?: string;
  @ApiPropertyOptional({
    description: 'Người nhập; mặc định = người đang đăng nhập',
  })
  @IsOptional()
  @IsUUID()
  receivedById?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
  @ApiProperty({ type: [PurchaseLineDto] })
  @Lines(PurchaseLineDto)
  items!: PurchaseLineDto[];
}

export class UpdateNoteDto {
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Chỉ ghi chú sửa được sau khi lập phiếu',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note!: string | null;
}
export class CancelDocDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// ------------------------------------------------------------------ trả hàng nhập
export class PurchaseReturnItemDto {
  @ApiProperty() productId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '10' }) qty!: string;
  @ApiProperty({ example: '8450.2200', description: 'Giá trả lại' })
  returnPrice!: string;
  @ApiProperty() lineTotal!: string;
}
export class PurchaseReturnDto extends DocBaseDto {
  @ApiProperty({ enum: ['completed', 'cancelled'] }) status!:
    'completed' | 'cancelled';
  @ApiProperty({
    nullable: true,
    type: DocRefDto,
    description: 'Phiếu nhập gốc (nếu có)',
  })
  goodsReceipt!: DocRefDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) returnedAt!: string;
  @ApiProperty({ nullable: true, type: DocPersonDto })
  returnedBy!: DocPersonDto | null;
  @ApiPropertyOptional({ type: [PurchaseReturnItemDto] })
  items?: PurchaseReturnItemDto[];
}
export class PurchaseReturnListDto {
  @ApiProperty({ type: [PurchaseReturnDto] }) data!: PurchaseReturnDto[];
  @ApiProperty({ type: DocMetaDto }) meta!: DocMetaDto;
}
export const RETURN_SORT_FIELDS = ['returnedAt', 'code', 'total'] as const;
export class ListPurchaseReturnsQueryDto extends ListDocsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() goodsReceiptId?: string;
  @ApiPropertyOptional({ enum: ['completed', 'cancelled'] })
  @IsOptional()
  @IsIn(['completed', 'cancelled'])
  status?: 'completed' | 'cancelled';
}
export class CreatePurchaseReturnDto {
  @ApiProperty() @IsUUID() supplierId!: string;
  @ApiPropertyOptional({
    description: 'Phiếu nhập gốc; có thì không trả quá số đã nhập',
  })
  @IsOptional()
  @IsUUID()
  goodsReceiptId?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  returnedAt?: string;
  @ApiPropertyOptional({
    description: 'Người trả; mặc định = người đang đăng nhập',
  })
  @IsOptional()
  @IsUUID()
  returnedById?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
  @ApiProperty({ type: [ReturnLineDto] })
  @Lines(ReturnLineDto)
  items!: ReturnLineDto[];
}

// ------------------------------------------------------------------ đặt hàng nhập
export const ORDER_STATUSES = [
  'draft',
  'confirmed',
  'completed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_SORT_FIELDS = ['orderedAt', 'code', 'total'] as const;

export class PurchaseOrderItemDto {
  @ApiProperty() productId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '1000' }) qty!: string;
  @ApiProperty({ example: '5500.0000', description: 'Giá nhập' })
  unitCost!: string;
  @ApiProperty() lineTotal!: string;
  @ApiProperty({
    example: '500',
    description: 'Đã nhập (Σ phiếu nhập hoàn tất của phiếu đặt này)',
  })
  receivedQty!: string;
  @ApiProperty({
    example: '500',
    description: 'Còn phải nhập = max(0, qty − receivedQty)',
  })
  remainingQty!: string;
}
export class PurchaseOrderDto extends DocBaseDto {
  @ApiProperty({ enum: ORDER_STATUSES }) status!: OrderStatus;
  @ApiProperty({
    enum: ['none', 'partial', 'full'],
    description:
      'Tình trạng nhập (tính khi đọc): chưa nhập / nhập một phần / đã nhập đủ',
  })
  receiveState!: 'none' | 'partial' | 'full';
  @ApiProperty({ type: String, format: 'date-time' }) orderedAt!: string;
  @ApiProperty({ nullable: true, type: DocPersonDto })
  orderedBy!: DocPersonDto | null;
  @ApiPropertyOptional({ type: [PurchaseOrderItemDto] })
  items?: PurchaseOrderItemDto[];
  @ApiPropertyOptional({
    type: [DocRefDto],
    description: 'Các phiếu nhập hoàn tất của phiếu đặt này (chỉ ở chi tiết)',
  })
  receipts?: DocRefDto[];
}
export class PurchaseOrderListDto {
  @ApiProperty({ type: [PurchaseOrderDto] }) data!: PurchaseOrderDto[];
  @ApiProperty({ type: DocMetaDto }) meta!: DocMetaDto;
}
export class ListPurchaseOrdersQueryDto extends ListDocsQueryDto {
  @ApiPropertyOptional({ enum: ORDER_STATUSES })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;
}
export class CreatePurchaseOrderDto {
  @ApiProperty() @IsUUID() supplierId!: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  orderedAt?: string;
  @ApiPropertyOptional({
    description: 'Người đặt; mặc định = người đang đăng nhập',
  })
  @IsOptional()
  @IsUUID()
  orderedById?: string;
  @ApiPropertyOptional({
    enum: ['draft', 'confirmed'],
    default: 'draft',
    description: 'draft = phiếu tạm; confirmed = đã xác nhận với NCC',
  })
  @IsOptional()
  @IsIn(['draft', 'confirmed'])
  status?: 'draft' | 'confirmed';
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
  @ApiProperty({ type: [PurchaseLineDto] })
  @Lines(PurchaseLineDto)
  items!: PurchaseLineDto[];
}
export class UpdatePurchaseOrderDto extends CreatePurchaseOrderDto {}
