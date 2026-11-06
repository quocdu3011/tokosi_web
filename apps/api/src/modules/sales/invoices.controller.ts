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
  ApiConflictResponse,
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
import { InvoicesService } from './invoices.service.js';
import {
  CancelSaleDocDto,
  CreateInvoiceDto,
  InvoiceDto,
  InvoiceFromOrderDto,
  InvoiceListDto,
  ListInvoicesQueryDto,
  UpdateSaleNoteDto,
} from './sales.dto.js';

@ApiTags('Hóa đơn')
@ApiBearerAuth()
@Controller()
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('invoices')
  @RequirePermission('invoice.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Danh sách hóa đơn của chi nhánh làm việc',
    description:
      'Quyền "chỉ của mình": chỉ hóa đơn có người bán là chính mình. `hasDebt` lọc hóa đơn hoàn tất còn nợ. `?format=xlsx` tải Excel theo đúng bộ lọc (tiêu đề như file chi tiết hóa đơn của KiotViet).',
  })
  @ApiOkResponse({ type: InvoiceListDto })
  async list(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Query() query: ListInvoicesQueryDto,
  ) {
    if (query.format === 'xlsx') {
      return xlsxFile(
        await this.invoices.exportXlsx(user, branchId, query),
        'hoa-don',
      );
    }
    const { data, meta } = await this.invoices.list(user, branchId, query);
    return { data, meta };
  }

  @Get('invoices/:id')
  @RequirePermission('invoice.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Chi tiết hóa đơn',
    description:
      'Kèm dòng hàng, các khoản thu lúc xuất, `paid`/`debt`. `unitCost` từng dòng và `grossProfit` chỉ có khi người gọi có quyền product.cost.view.',
  })
  @ApiOkResponse({ type: InvoiceDto })
  @ApiNotFoundResponse({
    description:
      'Không có hóa đơn (hoặc thuộc chi nhánh khác / không phải của mình)',
  })
  get(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.invoices.get(user, branchId, id);
  }

  @Post('invoices')
  @Idempotent()
  @RequirePermission('invoice.create')
  @RequireBranch()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Tạo hóa đơn trực tiếp (không qua phiếu đặt hàng)',
    description:
      'Nguyên tử: trừ kho (giá vốn lúc bán lưu trên dòng), ghi nợ khách theo chi nhánh, ghi phiếu thu cho các khoản `payments`. Thiếu tồn thực tế → 422 STOCK_NOT_ENOUGH. Vượt có thể bán / hạn mức chỉ trả `warnings`.',
  })
  @ApiCreatedResponse({ type: InvoiceDto })
  @ApiUnprocessableEntityResponse({
    description: 'STOCK_NOT_ENOUGH hoặc khách/hàng ngưng giao dịch',
  })
  create(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Body() body: CreateInvoiceDto,
  ) {
    return this.invoices.create(user, branchId, body);
  }

  @Post('orders/:id/invoice')
  @Idempotent()
  @RequirePermission('invoice.create')
  @RequireBranch()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Xuất hóa đơn từ phiếu đặt hàng (phiếu tạm)',
    description:
      'Lấy đúng dòng hàng, giảm giá, người bán của phiếu; phiếu chuyển sang hoàn thành. Một phiếu chỉ có một hóa đơn còn hiệu lực: xuất lần hai → 422; hủy hóa đơn thì phiếu quay về phiếu tạm.',
  })
  @ApiCreatedResponse({ type: InvoiceDto })
  @ApiForbiddenResponse({
    description: 'Phiếu do người khác bán (quyền "chỉ của mình")',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Phiếu không còn là phiếu tạm; STOCK_NOT_ENOUGH',
  })
  createFromOrder(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: InvoiceFromOrderDto,
  ) {
    return this.invoices.createFromOrder(user, branchId, id, body);
  }

  @Patch('invoices/:id')
  @RequirePermission('invoice.create')
  @RequireBranch()
  @ApiOperation({
    summary: 'Sửa ghi chú hóa đơn',
    description: 'Hóa đơn hoàn tất không sửa gì khác: hãy hủy rồi lập lại.',
  })
  @ApiOkResponse({ type: InvoiceDto })
  updateNote(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdateSaleNoteDto,
  ) {
    return this.invoices.updateNote(user, branchId, id, body.note);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @RequirePermission('invoice.cancel')
  @RequireBranch()
  @ApiOperation({
    summary: 'Hủy hóa đơn (bút toán đảo)',
    description:
      'Bắt buộc `reason`. Cộng lại tồn, đảo công nợ, hủy các phiếu thu lúc xuất; phiếu đặt hàng gốc quay về phiếu tạm. 409 nếu đã có phiếu trả hàng hoặc đã cấn trừ thu nợ.',
  })
  @ApiOkResponse({ type: InvoiceDto })
  @ApiConflictResponse({
    description: 'INVALID_STATE: còn phiếu trả hàng / đã cấn trừ thu nợ',
  })
  cancel(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: CancelSaleDocDto,
  ) {
    return this.invoices.cancel(user, branchId, id, body.reason ?? '');
  }
}
