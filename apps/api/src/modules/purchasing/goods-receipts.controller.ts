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
import { GoodsReceiptsService } from './goods-receipts.service.js';
import { xlsxFile } from './purchase-lines.js';
import {
  CancelDocDto,
  CreateGoodsReceiptDto,
  GoodsReceiptDto,
  GoodsReceiptListDto,
  ListGoodsReceiptsQueryDto,
  UpdateNoteDto,
} from './purchasing.dto.js';

@ApiTags('Nhập hàng')
@ApiBearerAuth()
@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(private readonly receipts: GoodsReceiptsService) {}

  @Get()
  @RequirePermission('purchase.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Danh sách phiếu nhập hàng của chi nhánh làm việc',
    description:
      '`?format=xlsx` tải Excel (mỗi dòng hàng một dòng) theo đúng bộ lọc.',
  })
  @ApiOkResponse({ type: GoodsReceiptListDto })
  async list(
    @WorkingBranchId() branchId: string,
    @Query() query: ListGoodsReceiptsQueryDto,
  ) {
    if (query.format === 'xlsx') {
      return xlsxFile(
        await this.receipts.exportXlsx(branchId, query),
        'nhap-hang',
      );
    }
    const { data, meta } = await this.receipts.list(branchId, query);
    return { data, meta };
  }

  @Get(':id')
  @RequirePermission('purchase.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Chi tiết phiếu nhập hàng (kèm dòng hàng và số đã trả lại)',
  })
  @ApiOkResponse({ type: GoodsReceiptDto })
  @ApiNotFoundResponse({
    description: 'Không có phiếu (hoặc thuộc chi nhánh khác)',
  })
  get(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.receipts.get(branchId, id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('purchase.edit')
  @RequireBranch()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Tạo phiếu nhập hàng',
    description:
      'Cộng tồn và tính lại giá vốn bình quân của chi nhánh làm việc, ghi nợ nhà cung cấp tại chi nhánh đó. Có `purchaseOrderId` thì nhập theo phiếu đặt (nhập một phần được; đủ thì phiếu đặt tự hoàn thành). Tiền trả nhà cung cấp làm bằng phiếu chi ở Sổ quỹ.',
  })
  @ApiCreatedResponse({ type: GoodsReceiptDto })
  create(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Body() body: CreateGoodsReceiptDto,
  ) {
    return this.receipts.create(user, branchId, body);
  }

  @Patch(':id')
  @RequirePermission('purchase.edit')
  @RequireBranch()
  @ApiOperation({
    summary: 'Sửa ghi chú phiếu nhập',
    description: 'Chỉ ghi chú sửa được; muốn đổi hàng/giá hãy hủy rồi tạo lại.',
  })
  @ApiOkResponse({ type: GoodsReceiptDto })
  updateNote(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdateNoteDto,
  ) {
    return this.receipts.updateNote(branchId, id, body.note ?? null);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('purchase.cancel')
  @RequireBranch()
  @ApiOperation({
    summary: 'Hủy phiếu nhập',
    description:
      'Trừ lại tồn (giá vốn tính ngược) và ghi bút toán đảo công nợ. Không hủy được khi hàng đã bán hết (422 STOCK_NOT_ENOUGH) hoặc đã có phiếu trả hàng nhập (409).',
  })
  @ApiOkResponse({ type: GoodsReceiptDto })
  @ApiConflictResponse({
    description: 'INVALID_STATE: đã có phiếu trả hàng nhập',
  })
  @ApiUnprocessableEntityResponse({
    description: 'STOCK_NOT_ENOUGH / INVALID_STATE',
  })
  cancel(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: CancelDocDto,
  ) {
    return this.receipts.cancel(user, branchId, id, body.reason);
  }
}
