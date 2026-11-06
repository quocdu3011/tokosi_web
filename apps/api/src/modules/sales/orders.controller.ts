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
import { OrdersService } from './orders.service.js';
import {
  CancelSaleDocDto,
  ListOrdersQueryDto,
  OrderDto,
  OrderListDto,
  SaveOrderDto,
} from './sales.dto.js';

@ApiTags('Đặt hàng')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermission('order.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Danh sách phiếu đặt hàng của chi nhánh làm việc',
    description:
      'Quyền "chỉ của mình": chỉ phiếu có người bán là chính mình. `?format=xlsx` tải Excel theo đúng bộ lọc (tiêu đề như file chi tiết đặt hàng của KiotViet).',
  })
  @ApiOkResponse({ type: OrderListDto })
  async list(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Query() query: ListOrdersQueryDto,
  ) {
    if (query.format === 'xlsx') {
      return xlsxFile(
        await this.orders.exportXlsx(user, branchId, query),
        'dat-hang',
      );
    }
    const { data, meta } = await this.orders.list(user, branchId, query);
    return { data, meta };
  }

  @Get(':id')
  @RequirePermission('order.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Chi tiết phiếu đặt hàng',
    description:
      'Phiếu tạm kèm `available` từng dòng (có thể bán = tồn − hàng giữ cho phiếu tạm khác) và `warnings` (vượt có thể bán, vượt hạn mức nếu chốt ngay).',
  })
  @ApiOkResponse({ type: OrderDto })
  @ApiNotFoundResponse({
    description: 'Không có phiếu (hoặc thuộc chi nhánh khác / không phải của mình)',
  })
  get(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.orders.get(user, branchId, id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('order.create')
  @RequireBranch()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Tạo phiếu tạm (đặt hàng)',
    description:
      'Không chạm kho, công nợ, quỹ; phiếu tạm giữ hàng. Server tính giá bán, thành tiền, tổng. Vượt có thể bán hoặc hạn mức chỉ trả `warnings`, không chặn.',
  })
  @ApiCreatedResponse({ type: OrderDto })
  create(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Body() body: SaveOrderDto,
  ) {
    return this.orders.create(user, branchId, body);
  }

  @Patch(':id')
  @RequirePermission('order.create')
  @RequireBranch()
  @ApiOperation({
    summary: 'Sửa phiếu tạm (thay toàn bộ, kể cả dòng hàng)',
    description: 'Chỉ khi còn là phiếu tạm. Quyền "chỉ của mình": chỉ phiếu của mình.',
  })
  @ApiOkResponse({ type: OrderDto })
  @ApiForbiddenResponse({ description: 'Phiếu do người khác bán' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_STATE: không còn là phiếu tạm' })
  update(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: SaveOrderDto,
  ) {
    return this.orders.update(user, branchId, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('order.create')
  @RequireBranch()
  @ApiOperation({ summary: 'Hủy phiếu tạm (nhả hàng đang giữ)' })
  @ApiOkResponse({ type: OrderDto })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_STATE: không còn là phiếu tạm' })
  cancel(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: CancelSaleDocDto,
  ) {
    return this.orders.cancel(user, branchId, id, body.reason);
  }
}
