import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  IsBoolean,
} from 'class-validator';
import {
  LIQUIDATION_STATUSES,
  PRODUCT_TYPES,
  PRODUCT_EXPORT_COLUMNS,
  type LiquidationStatus,
  type ProductType,
} from '@kiot/shared';
import { PageQueryDto } from '../../common/pagination.js';
import { QueryBoolean } from '../../common/query.js';

/** Mã hàng: chữ, số, `-`, `_`, `.`; 1–30 ký tự; không dấu cách. */
export const PRODUCT_CODE_PATTERN = /^[A-Za-z0-9._-]{1,30}$/;
/** Số lượng thập phân không âm, tối đa 3 chữ số thập phân. */
export const QTY_PATTERN = /^\d{1,11}(\.\d{1,3})?$/;

export const PRODUCT_SORT_FIELDS = [
  'code',
  'name',
  'onHand',
  'createdAt',
] as const;

export class ProductImageDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'https://files.example.vn/products/…/a.jpg' })
  url!: string;
  @ApiProperty() sortOrder!: number;
}

export class ProductComponentDto {
  @ApiProperty() productId!: string;
  @ApiProperty({ example: 'DAO01' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 2, description: 'Số lượng trong MỘT combo' })
  qty!: number;
}

export class ProductDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'QKBSP' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({
    enum: PRODUCT_TYPES,
    description:
      '`goods` = Hàng hóa, `combo` = gói nhiều hàng thành phần. Combo không có tồn/giá vốn riêng: onHand, available, costPrice, lastPurchasePrice luôn tính từ thành phần; reserved luôn "0"; minStock/maxStock/location luôn null',
  })
  productType!: ProductType;
  @ApiProperty({
    enum: LIQUIDATION_STATUSES,
    description:
      'Trạng thái thanh lý: `normal` Thường (mặc định), `clearance` Thanh Lý, `disabled` Tắt Mã, `high_stock` Tồn Cao, `priority_stock` Tồn Ưu Tiên',
  })
  liquidationStatus!: LiquidationStatus;
  @ApiProperty({
    example: 'DAO01/2,KEO03/1',
    description:
      'Hàng thành phần của combo, dạng `MSP/SL,MSP/SL`; chuỗi rỗng với hàng hóa',
  })
  components!: string;
  @ApiProperty({
    type: () => [ProductComponentDto],
    description: 'Chi tiết hàng thành phần (rỗng với hàng hóa)',
  })
  componentItems!: ProductComponentDto[];
  @ApiProperty({
    description:
      'Chi nhánh mà các trường tồn/giá vốn/vị trí bên dưới tính cho (= chi nhánh làm việc, header X-Branch-Id)',
  })
  branchId!: string;
  @ApiPropertyOptional({
    description:
      'Giá vốn bình quân của chi nhánh này. VẮNG MẶT nếu thiếu quyền product.cost.view',
    example: '21800.5000',
  })
  costPrice?: string;
  @ApiPropertyOptional({
    description: 'Giá nhập cuối của chi nhánh này; như costPrice',
    nullable: true,
    type: String,
  })
  lastPurchasePrice?: string | null;
  @ApiProperty({ example: '515.000' }) onHand!: string;
  @ApiProperty({
    description: 'Đang giữ cho các đơn đặt hàng chưa chốt (phiếu tạm)',
  })
  reserved!: string;
  @ApiProperty({ description: 'onHand − reserved' }) available!: string;
  @ApiProperty({
    description:
      'Đang đặt nhà cung cấp. Chưa có phân hệ Đặt hàng nhập nên luôn "0"',
  })
  onOrder!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ type: [ProductImageDto] }) images!: ProductImageDto[];
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class ProductListMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class ProductListDto {
  @ApiProperty({ type: [ProductDto] }) data!: ProductDto[];
  @ApiProperty({ type: ProductListMetaDto }) meta!: ProductListMetaDto;
}

export class ListProductsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm không dấu theo mã và tên (mọi từ đều phải có mặt)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional() @QueryBoolean() isActive?: boolean;

  @ApiPropertyOptional({
    enum: PRODUCT_TYPES,
    description: 'Lọc theo loại hàng',
  })
  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: ProductType;

  @ApiPropertyOptional({
    enum: LIQUIDATION_STATUSES,
    description: 'Lọc theo trạng thái thanh lý',
  })
  @IsOptional()
  @IsIn(LIQUIDATION_STATUSES)
  liquidationStatus?: LiquidationStatus;

  @ApiPropertyOptional({
    description: 'true = chỉ hàng còn tồn tại chi nhánh làm việc',
  })
  @QueryBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({
    enum: ['xlsx'],
    description:
      'xlsx = tải file Excel theo đúng bộ lọc hiện tại (bỏ qua page/limit, tối đa 10.000 dòng)',
  })
  @IsOptional()
  @IsIn(['xlsx'])
  format?: 'xlsx';

  @ApiPropertyOptional({
    description:
      'Các cột Excel, phân cách bằng dấu phẩy. Bỏ qua = tất cả cột được phép. Thứ tự theo file mặc định; cột giá vốn cần product.cost.view.',
    example: 'code,name,onHand',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(
    new RegExp(
      `^(${PRODUCT_EXPORT_COLUMNS.map((c) => c.id).join('|')})(,(${PRODUCT_EXPORT_COLUMNS.map((c) => c.id).join('|')}))*$`,
    ),
    { message: 'Chọn ít nhất một cột Excel hợp lệ' },
  )
  columns?: string;
}

export class LookupQueryDto {
  @ApiPropertyOptional({
    description: 'Tìm không dấu theo mã và tên; bỏ trống = 20 hàng đầu theo mã',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ProductLookupDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: PRODUCT_TYPES }) productType!: ProductType;
  @ApiProperty({
    example: 'DAO01/2,KEO03/1',
    description:
      'Với combo: thành phần để thêm vào đơn (chọn combo = thêm từng thành phần × SL); hàng hóa: rỗng',
  })
  components!: string;
  @ApiProperty() available!: string;
  @ApiProperty({ nullable: true, type: String }) imageUrl!: string | null;
}

export class CreateProductDto {
  @ApiProperty({
    example: 'QKBSP',
    description:
      'Chữ, số, "-", "_", "."; 1-30 ký tự; không dấu cách; không trùng (kể cả khác hoa thường); không đổi được sau khi đã có giao dịch',
  })
  @Matches(PRODUCT_CODE_PATTERN, {
    message:
      'Mã hàng chỉ gồm chữ, số, "-", "_", "." và dài 1-30 ký tự, không có dấu cách',
  })
  code!: string;

  @ApiProperty({ example: 'Quạt kẹp bàn Super MST-A1' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ enum: PRODUCT_TYPES, default: 'goods' })
  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: ProductType;

  @ApiPropertyOptional({ enum: LIQUIDATION_STATUSES, default: 'normal' })
  @IsOptional()
  @IsIn(LIQUIDATION_STATUSES)
  liquidationStatus?: LiquidationStatus;

  @ApiPropertyOptional({
    example: 'DAO01/2,KEO03/1',
    description:
      'Bắt buộc (ít nhất 1 thành phần) khi productType = combo, dạng `MSP/SL,MSP/SL`: mã hàng hóa (không phải combo), số lượng nguyên dương, mã không lặp. Không được gửi với hàng hóa',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  components?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class UpdateProductDto {
  @ApiPropertyOptional({
    description: 'Chỉ đổi được khi hàng chưa có giao dịch nào',
  })
  @IsOptional()
  @Matches(PRODUCT_CODE_PATTERN, {
    message:
      'Mã hàng chỉ gồm chữ, số, "-", "_", "." và dài 1-30 ký tự, không có dấu cách',
  })
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    enum: PRODUCT_TYPES,
    description:
      'Chỉ đổi được khi hàng chưa có giao dịch và (khi đổi sang combo) chưa là thành phần của combo nào',
  })
  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: ProductType;

  @ApiPropertyOptional({ enum: LIQUIDATION_STATUSES })
  @IsOptional()
  @IsIn(LIQUIDATION_STATUSES)
  liquidationStatus?: LiquidationStatus;

  @ApiPropertyOptional({
    example: 'DAO01/2,KEO03/1',
    description:
      'Thay toàn bộ hàng thành phần của combo (`MSP/SL,MSP/SL`). Đổi sang combo thì bắt buộc gửi kèm',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  components?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Người chỉ có quyền "Sửa mô tả, ảnh hàng hóa" (product.content.edit) chỉ được sửa trường này',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({ description: 'false = ngưng kinh doanh' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ProductBranchDto {
  @ApiProperty() branchId!: string;
  @ApiProperty({ example: 'HN' }) branchCode!: string;
  @ApiProperty() branchName!: string;
  @ApiProperty() onHand!: string;
  @ApiProperty() reserved!: string;
  @ApiProperty() available!: string;
  @ApiPropertyOptional({ description: 'Vắng mặt nếu thiếu product.cost.view' })
  costPrice?: string;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Vắng mặt nếu thiếu product.cost.view',
  })
  lastPurchasePrice?: string | null;
}

export class StockCardQueryDto {
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

export class StockCardMovementDto {
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ example: 'goods_receipt' }) refType!: string;
  @ApiProperty({ nullable: true, type: String }) refId!: string | null;
  @ApiProperty({ nullable: true, type: String, example: 'PN000948' })
  refCode!: string | null;
  @ApiProperty({ example: '600.000' }) qtyDelta!: string;
  @ApiProperty({ example: '1000.000' }) balance!: string;
  @ApiPropertyOptional({
    description: 'Vắng mặt nếu thiếu product.cost.view',
    type: String,
    nullable: true,
  })
  unitCost?: string | null;
}

export class StockCardDto {
  @ApiProperty() branchId!: string;
  @ApiProperty({ example: '400.000' }) openingQty!: string;
  @ApiProperty({ type: [StockCardMovementDto] })
  movements!: StockCardMovementDto[];
  @ApiProperty({ example: '485.000' }) closingQty!: string;
}
