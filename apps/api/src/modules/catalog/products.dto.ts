import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  IsBoolean,
} from 'class-validator';
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

export class ProductDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'QKBSP' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) categoryId!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    example: 'ĐIỆN GIA DỤNG > Quạt điện',
  })
  categoryPath!: string | null;
  @ApiProperty({ example: 'Cái' }) unit!: string;
  @ApiProperty({
    description:
      'Chi nhánh mà các trường giá/tồn/vị trí bên dưới tính cho (= chi nhánh làm việc, header X-Branch-Id)',
  })
  branchId!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Giá Bảng giá chung TẠI chi nhánh này (số nguyên đồng); null nếu chưa có giá',
    example: '33500',
  })
  basePrice!: string | null;
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
  @ApiProperty({ nullable: true, type: String }) minStock!: string | null;
  @ApiProperty({ nullable: true, type: String }) maxStock!: string | null;
  @ApiProperty({ nullable: true, type: String }) location!: string | null;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ nullable: true, type: String }) weightG!: string | null;
  @ApiProperty({ type: [ProductImageDto] }) images!: ProductImageDto[];
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isSellable!: boolean;
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

  @ApiPropertyOptional({
    description: 'Lọc theo nhóm hàng, GỒM cả hàng của các nhóm con',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional() @QueryBoolean() isActive?: boolean;

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
  @ApiProperty() unit!: string;
  @ApiProperty({ nullable: true, type: String }) basePrice!: string | null;
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

  @ApiPropertyOptional({ description: 'Nhóm hàng (GET /categories)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'Cái', default: 'Cái' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ description: 'Trọng lượng gram', example: '850' })
  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: 'Trọng lượng không hợp lệ' })
  weightG?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isSellable?: boolean;
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

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit?: string;

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

  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: 'Trọng lượng không hợp lệ' })
  weightG?: string | null;

  @ApiPropertyOptional({ description: 'false = ngưng kinh doanh' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isSellable?: boolean;
}

export class ProductBranchPriceDto {
  @ApiProperty() priceBookId!: string;
  @ApiProperty({ example: 'LON' }) priceBookCode!: string;
  @ApiProperty({ nullable: true, type: String, example: '33000' })
  price!: string | null;
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
  @ApiProperty({ nullable: true, type: String }) minStock!: string | null;
  @ApiProperty({ nullable: true, type: String }) maxStock!: string | null;
  @ApiProperty({ nullable: true, type: String }) location!: string | null;
  @ApiProperty({
    type: [ProductBranchPriceDto],
    description: 'Giá của cả 7 bảng giá TẠI chi nhánh này (null = chưa có giá)',
  })
  prices!: ProductBranchPriceDto[];
}

export class SetProductBranchSettingsDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '10',
    description: 'Tồn tối thiểu (>= 0); null = bỏ. Phải <= tồn tối đa',
  })
  @IsOptional()
  @Matches(QTY_PATTERN, { message: 'Tồn tối thiểu không hợp lệ' })
  minStock?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: '2000' })
  @IsOptional()
  @Matches(QTY_PATTERN, { message: 'Tồn tối đa không hợp lệ' })
  maxStock?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Vị trí kho; null hoặc rỗng = bỏ',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string | null;
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
  @ApiPropertyOptional({ description: 'Vắng mặt nếu thiếu product.cost.view' })
  unitCost?: string | null;
}

export class StockCardDto {
  @ApiProperty() branchId!: string;
  @ApiProperty({ example: '400.000' }) openingQty!: string;
  @ApiProperty({ type: [StockCardMovementDto] })
  movements!: StockCardMovementDto[];
  @ApiProperty({ example: '485.000' }) closingQty!: string;
}
