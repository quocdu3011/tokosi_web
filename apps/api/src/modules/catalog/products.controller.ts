import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { ParseIdPipe } from '../../common/parse-id.pipe.js';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  type AppRequest,
  type AuthUser,
  CurrentUser,
  WorkingBranchId,
} from '../../common/auth-user.js';
import { RequireBranch } from '../branches/require-branch.decorator.js';
import {
  RequireAnyPermission,
  RequirePermission,
} from '../authorization/require-permission.decorator.js';
import {
  CreateProductDto,
  ListProductsQueryDto,
  LookupQueryDto,
  ProductBranchDto,
  ProductDto,
  ProductListDto,
  ProductLookupDto,
  SetProductBranchSettingsDto,
  StockCardDto,
  StockCardQueryDto,
  UpdateProductDto,
} from './products.dto.js';
import { ProductsService } from './products.service.js';

const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** YYYYMMDD theo giờ Việt Nam, dùng cho tên file tải về. */
const todayVn = () =>
  new Date(Date.now() + 7 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');

@ApiTags('Hàng hóa')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermission('product.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Danh sách hàng hóa (lọc, tìm không dấu, phân trang)',
    description:
      'Các trường giá/tồn/vị trí tính cho chi nhánh làm việc (header X-Branch-Id). costPrice và lastPurchasePrice chỉ có khi người gọi có quyền product.cost.view.',
  })
  @ApiOkResponse({ type: ProductListDto })
  async list(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Query() query: ListProductsQueryDto,
  ) {
    if (query.format === 'xlsx') {
      const buffer = await this.products.exportXlsx(user, branchId, query);
      return new StreamableFile(buffer, {
        type: XLSX,
        disposition: `attachment; filename="hang-hoa-${todayVn()}.xlsx"`,
      });
    }
    return this.products.list(user, branchId, query);
  }

  @Get('lookup')
  @RequirePermission('product.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Tìm nhanh cho ô chọn hàng (tối đa 20 dòng, không phân trang)',
  })
  @ApiOkResponse({ type: [ProductLookupDto] })
  lookup(@WorkingBranchId() branchId: string, @Query() query: LookupQueryDto) {
    return this.products.lookup(branchId, query.q);
  }

  @Get(':id')
  @RequirePermission('product.view')
  @RequireBranch()
  @ApiOperation({ summary: 'Chi tiết một hàng hóa (theo chi nhánh làm việc)' })
  @ApiOkResponse({ type: ProductDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy hàng hóa' })
  get(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.products.get(user, branchId, id);
  }

  @Post()
  @RequirePermission('product.edit')
  @RequireBranch()
  @ApiOperation({
    summary: 'Tạo hàng hóa',
    description:
      'Chỉ chứa thông tin dùng chung hai chi nhánh. Giá bán đặt qua lưới giá; tồn tối thiểu/tối đa và vị trí đặt qua PUT /products/:id/branches/:branchId; ảnh tải qua POST /products/:id/images (gọi sau khi có id).',
  })
  @ApiCreatedResponse({ type: ProductDto })
  @ApiConflictResponse({ description: 'DUPLICATE_CODE' })
  create(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Body() body: CreateProductDto,
  ) {
    return this.products.create(user, branchId, body);
  }

  @Patch(':id')
  @RequireAnyPermission('product.edit', 'product.content.edit')
  @RequireBranch()
  @ApiOperation({
    summary: 'Sửa hàng hóa (gồm ngưng bán isActive=false)',
    description:
      'Người chỉ có quyền "Sửa mô tả, ảnh hàng hóa" chỉ được gửi description. Mã hàng chỉ đổi được khi hàng chưa có giao dịch (INVALID_STATE).',
  })
  @ApiOkResponse({ type: ProductDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy hàng hóa' })
  @ApiConflictResponse({ description: 'DUPLICATE_CODE' })
  update(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdateProductDto,
    @Req() req: AppRequest,
  ) {
    const canEditAll = req.grants?.['product.edit'] !== undefined;
    return this.products.update(user, branchId, id, body, canEditAll);
  }

  @Get(':id/branches')
  @RequirePermission('product.view')
  @ApiOperation({
    summary: 'Chi tiết theo từng chi nhánh người dùng được phép',
    description:
      'Tồn, giá vốn (theo quyền), tồn tối thiểu/tối đa, vị trí kho và giá của cả 7 bảng giá.',
  })
  @ApiOkResponse({ type: [ProductBranchDto] })
  @ApiNotFoundResponse({ description: 'Không tìm thấy hàng hóa' })
  branches(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.products.branchesOf(user, id);
  }

  @Put(':id/branches/:branchId')
  @RequirePermission('product.edit')
  @ApiOperation({
    summary: 'Đặt tồn tối thiểu/tối đa và vị trí kho của một chi nhánh',
    description:
      'Không thay đổi số tồn hay giá vốn (chỉ nhập/xuất/chuyển kho mới đổi được).',
  })
  @ApiOkResponse({ type: ProductBranchDto })
  setBranchSettings(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIdPipe) id: string,
    @Param('branchId', ParseIdPipe) branchId: string,
    @Body() body: SetProductBranchSettingsDto,
  ) {
    return this.products.setBranchSettings(user, id, branchId, body);
  }

  @Get(':id/stock-card')
  @RequirePermission('product.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Thẻ kho: lịch sử nhập-xuất của hàng tại chi nhánh làm việc',
    description:
      'from/to theo ngày giờ Việt Nam (cả hai đầu đều tính). openingQty là tồn trước from; balance cộng dồn theo từng dòng.',
  })
  @ApiOkResponse({ type: StockCardDto })
  stockCard(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Query() query: StockCardQueryDto,
  ) {
    return this.products.stockCard(user, branchId, id, query);
  }
}
