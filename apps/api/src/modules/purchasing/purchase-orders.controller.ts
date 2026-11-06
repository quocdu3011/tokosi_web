import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
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
import { xlsxFile } from './purchase-lines.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import {
  CancelDocDto,
  CreatePurchaseOrderDto,
  ListPurchaseOrdersQueryDto,
  PurchaseOrderDto,
  PurchaseOrderListDto,
  UpdatePurchaseOrderDto,
} from './purchasing.dto.js';

@ApiTags('Đặt hàng nhập')
@ApiBearerAuth()
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get()
  @RequirePermission('purchase.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Danh sách phiếu đặt hàng nhập của chi nhánh làm việc',
    description:
      '`receiveState` (chưa nhập / nhập một phần / đã nhập đủ) tính từ các phiếu nhập hoàn tất. `?format=xlsx` tải Excel theo đúng bộ lọc.',
  })
  @ApiOkResponse({ type: PurchaseOrderListDto })
  async list(
    @WorkingBranchId() branchId: string,
    @Query() query: ListPurchaseOrdersQueryDto,
  ) {
    if (query.format === 'xlsx') {
      return xlsxFile(
        await this.orders.exportXlsx(branchId, query),
        'dat-hang-nhap',
      );
    }
    const { data, meta } = await this.orders.list(branchId, query);
    return { data, meta };
  }

  @Get(':id')
  @RequirePermission('purchase.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Chi tiết phiếu đặt hàng nhập',
    description:
      'Dòng hàng kèm `receivedQty`, `remainingQty` và danh sách phiếu nhập hoàn tất.',
  })
  @ApiOkResponse({ type: PurchaseOrderDto })
  @ApiNotFoundResponse({
    description: 'Không có phiếu (hoặc thuộc chi nhánh khác)',
  })
  get(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.orders.get(branchId, id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('purchase.edit')
  @RequireBranch()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Tạo phiếu đặt hàng nhập',
    description:
      'Không chạm kho và công nợ. `status`: `draft` (mặc định) hoặc `confirmed`.',
  })
  @ApiCreatedResponse({ type: PurchaseOrderDto })
  create(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Body() body: CreatePurchaseOrderDto,
  ) {
    return this.orders.create(user, branchId, body);
  }

  @Put(':id')
  @RequirePermission('purchase.edit')
  @RequireBranch()
  @ApiOperation({
    summary: 'Sửa phiếu đặt hàng nhập (thay toàn bộ dòng hàng)',
    description:
      'Chỉ khi phiếu còn mở và chưa có phiếu nhập hoàn tất (409 nếu đã có).',
  })
  @ApiOkResponse({ type: PurchaseOrderDto })
  update(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdatePurchaseOrderDto,
  ) {
    return this.orders.update(user, branchId, id, body);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermission('purchase.edit')
  @RequireBranch()
  @ApiOperation({
    summary: 'Xác nhận với nhà cung cấp (phiếu tạm → đã xác nhận)',
  })
  @ApiOkResponse({ type: PurchaseOrderDto })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_STATE: không phải phiếu tạm',
  })
  confirm(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.orders.confirm(branchId, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('purchase.edit')
  @RequireBranch()
  @ApiOperation({
    summary: 'Kết thúc phiếu đặt (nhà cung cấp không giao nốt phần còn lại)',
    description:
      'Cần đã có ít nhất một phiếu nhập. Hủy một phiếu nhập sau đó sẽ mở lại phiếu đặt nếu thiếu hàng.',
  })
  @ApiOkResponse({ type: PurchaseOrderDto })
  complete(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.orders.complete(branchId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('purchase.cancel')
  @RequireBranch()
  @ApiOperation({
    summary: 'Hủy phiếu đặt hàng nhập',
    description: 'Chỉ khi chưa có phiếu nhập hoàn tất.',
  })
  @ApiOkResponse({ type: PurchaseOrderDto })
  cancel(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: CancelDocDto,
  ) {
    return this.orders.cancel(branchId, id, body.reason);
  }
}
