import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  type AppRequest,
  type AuthUser,
  CurrentUser,
} from '../../common/auth-user.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import {
  BulkAdjustDto,
  BulkAdjustResultDto,
  CopyBranchDto,
  CopyBranchResultDto,
  GridDto,
  GridQueryDto,
  PriceBookDto,
  SaveGridDto,
  SaveGridResultDto,
  UpdatePriceBookDto,
} from './pricing.dto.js';
import { PricingService } from './pricing.service.js';

const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** YYYYMMDD theo giờ Việt Nam, dùng cho tên file tải về. */
const todayVn = () =>
  new Date(Date.now() + 7 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');

const headerBranch = (req: AppRequest): string | undefined => {
  const raw = req.headers['x-branch-id'];
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined;
};

@ApiTags('Thiết lập giá')
@ApiBearerAuth()
@Controller('price-books')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  @RequirePermission('product.view')
  @ApiOperation({ summary: 'Danh sách 7 bảng giá' })
  @ApiOkResponse({ type: [PriceBookDto] })
  list() {
    return this.pricing.listBooks();
  }

  @Get('grid')
  @RequirePermission('product.view')
  @ApiOperation({
    summary:
      'Lưới giá: mỗi dòng một sản phẩm, mỗi cột một bảng giá, theo MỘT chi nhánh',
    description:
      'Chi nhánh lấy từ tham số branchId hoặc header X-Branch-Id. Ô chưa có giá là null (khi bán sẽ lùi về Bảng giá chung của CÙNG chi nhánh).',
  })
  @ApiOkResponse({ type: GridDto })
  async grid(
    @CurrentUser() user: AuthUser,
    @Query() query: GridQueryDto,
    @Req() req: AppRequest,
  ) {
    const branchId = await this.pricing.resolveBranch(
      user,
      query.branchId,
      headerBranch(req),
    );
    if (query.format === 'xlsx') {
      const buffer = await this.pricing.gridXlsx(user, branchId, query);
      return new StreamableFile(buffer, {
        type: XLSX,
        disposition: `attachment; filename="bang-gia-${todayVn()}.xlsx"`,
      });
    }
    return this.pricing.grid(user, branchId, query);
  }

  @Put('grid')
  @RequirePermission('price.edit')
  @ApiOperation({
    summary: 'Lưu nhiều ô giá cùng lúc (chỉ gửi các ô thay đổi)',
    description:
      'Giá là số nguyên đồng; price = null xóa giá ô đó. Tối đa 500 ô; tất cả hoặc không gì cả.',
  })
  @ApiOkResponse({ type: SaveGridResultDto })
  saveGrid(@CurrentUser() user: AuthUser, @Body() body: SaveGridDto) {
    return this.pricing.saveGrid(user, body);
  }

  @Post('bulk-adjust')
  @HttpCode(200)
  @RequirePermission('price.edit')
  @ApiOperation({
    summary: 'Tăng/giảm giá hàng loạt (có chế độ xem trước)',
    description:
      'dryRun bắt buộc: true = chỉ xem trước. Chỉ áp dụng cho ô ĐÃ có giá; giá mới âm thì bỏ qua; luôn làm tròn ra số nguyên đồng.',
  })
  @ApiOkResponse({ type: BulkAdjustResultDto })
  bulkAdjust(@CurrentUser() user: AuthUser, @Body() body: BulkAdjustDto) {
    return this.pricing.bulkAdjust(user, body);
  }

  @Post('copy-branch')
  @HttpCode(200)
  @RequirePermission('price.edit')
  @ApiOperation({
    summary: 'Sao chép giá từ chi nhánh này sang chi nhánh kia',
    description:
      'Dùng để khởi tạo giá chi nhánh mới. overwrite=false (mặc định) chỉ chép ô đích chưa có giá.',
  })
  @ApiOkResponse({ type: CopyBranchResultDto })
  copyBranch(@CurrentUser() user: AuthUser, @Body() body: CopyBranchDto) {
    return this.pricing.copyBranch(user, body);
  }

  @Patch(':id')
  @RequirePermission('price.edit')
  @ApiOperation({
    summary: 'Đổi tên / bật tắt bảng giá',
    description: 'Không tắt được Bảng giá chung.',
  })
  @ApiOkResponse({ type: PriceBookDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy bảng giá' })
  @ApiConflictResponse({ description: 'DUPLICATE_NAME' })
  update(
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdatePriceBookDto,
  ) {
    return this.pricing.updateBook(id, body);
  }
}
