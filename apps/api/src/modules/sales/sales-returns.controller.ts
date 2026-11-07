import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type AuthUser,
  CurrentUser,
  WorkingBranchId,
} from '../../common/auth-user.js';
import { ParseIdPipe } from '../../common/parse-id.pipe.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import { RequireBranch } from '../branches/require-branch.decorator.js';
import { Idempotent } from '../idempotency/idempotent.decorator.js';
import { xlsxFile } from '../purchasing/purchase-lines.js';
import { SalesReturnsService } from './sales-returns.service.js';
import {
  CancelSaleDocDto,
  CreateSalesReturnDto,
  ListSalesReturnsQueryDto,
  SalesReturnDto,
  SalesReturnListDto,
  UpdateSaleNoteDto,
} from './sales.dto.js';

@ApiTags('Trả hàng bán')
@ApiBearerAuth()
@Controller('sales-returns')
export class SalesReturnsController {
  constructor(private readonly returns: SalesReturnsService) {}

  @Get()
  @RequirePermission('invoice.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Danh sách phiếu trả hàng bán của chi nhánh làm việc',
    description:
      'Quyền xem "chỉ của mình": chỉ phiếu trả của hóa đơn do mình bán. `?format=xlsx` tải Excel theo đúng bộ lọc (tiêu đề như file chi tiết trả hàng của KiotViet).',
  })
  @ApiOkResponse({ type: SalesReturnListDto })
  async list(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Query() query: ListSalesReturnsQueryDto,
  ) {
    if (query.format === 'xlsx') {
      return xlsxFile(
        await this.returns.exportXlsx(user, branchId, query),
        'tra-hang',
      );
    }
    const { data, meta } = await this.returns.list(user, branchId, query);
    return { data, meta };
  }

  @Get(':id')
  @RequirePermission('invoice.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Chi tiết phiếu trả hàng bán',
    description:
      '`priceDifference` (chênh lệch giá nhập lại tính vào lợi nhuận) chỉ có khi người gọi có quyền product.cost.view.',
  })
  @ApiOkResponse({ type: SalesReturnDto })
  @ApiNotFoundResponse({
    description: 'Không có phiếu (hoặc thuộc chi nhánh khác / không phải của mình)',
  })
  get(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.returns.get(user, branchId, id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('return.create')
  @RequireBranch()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Tạo phiếu trả hàng bán',
    description:
      'Tiền trả khách LUÔN ghi giảm công nợ khách tại chi nhánh (không hoàn tiền trên phiếu). Dòng `restock` cộng lại tồn nhưng không đổi giá vốn bình quân. Có `invoiceId` thì tổng trả mỗi mặt hàng không vượt số đã bán (422 RETURN_QTY_EXCEEDED) và giá trả không vượt giá bán thực của dòng sau giảm giá phiếu (422 RETURN_PRICE_EXCEEDED). Quyền "chỉ của mình": bắt buộc hóa đơn do mình bán.',
  })
  @ApiCreatedResponse({ type: SalesReturnDto })
  @ApiForbiddenResponse({ description: 'Hóa đơn do người khác bán (quyền "chỉ của mình")' })
  @ApiUnprocessableEntityResponse({
    description: 'RETURN_QTY_EXCEEDED hoặc hóa đơn gốc đã hủy',
  })
  create(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Body() body: CreateSalesReturnDto,
  ) {
    return this.returns.create(user, branchId, body);
  }

  @Patch(':id')
  @RequirePermission('return.create')
  @RequireBranch()
  @ApiOperation({ summary: 'Sửa ghi chú phiếu trả hàng (không sửa gì khác)' })
  @ApiOkResponse({ type: SalesReturnDto })
  updateNote(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdateSaleNoteDto,
  ) {
    return this.returns.updateNote(user, branchId, id, body.note);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('return.cancel')
  @RequireBranch()
  @ApiOperation({
    summary: 'Hủy phiếu trả hàng (bút toán đảo)',
    description:
      'Trừ lại tồn của các dòng đã nhập lại kho (không đủ tồn → 422 STOCK_NOT_ENOUGH) và cộng lại công nợ khách.',
  })
  @ApiOkResponse({ type: SalesReturnDto })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_STATE (đã hủy) hoặc STOCK_NOT_ENOUGH',
  })
  cancel(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: CancelSaleDocDto,
  ) {
    return this.returns.cancel(user, branchId, id, body.reason);
  }
}
