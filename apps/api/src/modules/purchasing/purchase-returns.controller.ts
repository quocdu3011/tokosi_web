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
import { RequireBranch } from '../branches/require-branch.decorator.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import { Idempotent } from '../idempotency/idempotent.decorator.js';
import { PurchaseReturnsService } from './purchase-returns.service.js';
import { xlsxFile } from './purchase-lines.js';
import {
  CancelDocDto,
  CreatePurchaseReturnDto,
  PurchaseReturnDto,
  PurchaseReturnListDto,
  ListPurchaseReturnsQueryDto,
  UpdateNoteDto,
} from './purchasing.dto.js';

@ApiTags('Trả hàng nhập')
@ApiBearerAuth()
@Controller('purchase-returns')
export class PurchaseReturnsController {
  constructor(private readonly returns: PurchaseReturnsService) {}

  @Get()
  @RequirePermission('purchase.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Danh sách phiếu trả hàng nhập của chi nhánh làm việc',
    description:
      '`?format=xlsx` tải Excel (mỗi dòng hàng một dòng) theo đúng bộ lọc.',
  })
  @ApiOkResponse({ type: PurchaseReturnListDto })
  async list(
    @WorkingBranchId() branchId: string,
    @Query() query: ListPurchaseReturnsQueryDto,
  ) {
    if (query.format === 'xlsx') {
      return xlsxFile(
        await this.returns.exportXlsx(branchId, query),
        'tra-hang-nhap',
      );
    }
    const { data, meta } = await this.returns.list(branchId, query);
    return { data, meta };
  }

  @Get(':id')
  @RequirePermission('purchase.view')
  @RequireBranch()
  @ApiOperation({ summary: 'Chi tiết phiếu trả hàng nhập (kèm dòng hàng)' })
  @ApiOkResponse({ type: PurchaseReturnDto })
  @ApiNotFoundResponse({
    description: 'Không có phiếu (hoặc thuộc chi nhánh khác)',
  })
  get(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.returns.get(branchId, id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('purchase.edit')
  @RequireBranch()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Tạo phiếu trả hàng nhập',
    description:
      'Trừ tồn (giá vốn bình quân tính lại theo giá trả) và GIẢM công nợ nhà cung cấp tại chi nhánh làm việc. Có `goodsReceiptId` thì không được trả quá số đã nhập (422 RETURN_QTY_EXCEEDED). Luôn trừ vào công nợ; tiền hoàn lại (nếu có) ghi bằng phiếu thu ở Sổ quỹ.',
  })
  @ApiCreatedResponse({ type: PurchaseReturnDto })
  create(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Body() body: CreatePurchaseReturnDto,
  ) {
    return this.returns.create(user, branchId, body);
  }

  @Patch(':id')
  @RequirePermission('purchase.edit')
  @RequireBranch()
  @ApiOperation({
    summary: 'Sửa ghi chú phiếu trả hàng nhập',
    description: 'Chỉ ghi chú sửa được; muốn đổi hàng/giá hãy hủy rồi tạo lại.',
  })
  @ApiOkResponse({ type: PurchaseReturnDto })
  updateNote(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdateNoteDto,
  ) {
    return this.returns.updateNote(branchId, id, body.note ?? null);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('purchase.cancel')
  @RequireBranch()
  @ApiOperation({
    summary: 'Hủy phiếu trả hàng nhập',
    description:
      'Nhập lại hàng theo giá trả (giá vốn tính ngược) và tăng lại công nợ nhà cung cấp.',
  })
  @ApiOkResponse({ type: PurchaseReturnDto })
  @ApiUnprocessableEntityResponse({
    description: 'STOCK_NOT_ENOUGH / RETURN_QTY_EXCEEDED / INVALID_STATE',
  })
  cancel(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: CancelDocDto,
  ) {
    return this.returns.cancel(user, branchId, id, body.reason);
  }
}
