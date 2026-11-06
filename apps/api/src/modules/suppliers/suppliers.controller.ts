import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
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
  type AuthUser,
  CurrentUser,
  WorkingBranchId,
} from '../../common/auth-user.js';
import { RequireBranch } from '../branches/require-branch.decorator.js';
import { ParseIdPipe } from '../../common/parse-id.pipe.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import {
  CreateSupplierDto,
  LedgerDto,
  LedgerQueryDto,
  ListSuppliersQueryDto,
  SupplierBranchDto,
  SupplierDto,
  SupplierListDto,
  UpdateSupplierDto,
} from './suppliers.dto.js';
import { SuppliersService } from './suppliers.service.js';

const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** YYYYMMDD theo giờ Việt Nam, dùng cho tên file tải về. */
const todayVn = () =>
  new Date(Date.now() + 7 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');

@ApiTags('Nhà cung cấp')
@ApiBearerAuth()
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('purchase.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Danh sách nhà cung cấp (lọc, tìm không dấu, phân trang)',
    description:
      'Không gồm nhà cung cấp hệ thống đại diện chi nhánh. Mọi số tiền (nợ, tổng mua) tính RIÊNG cho chi nhánh làm việc (header X-Branch-Id), không dùng chung; nợ chỉ có khi người gọi có quyền debt.view.',
  })
  @ApiOkResponse({ type: SupplierListDto })
  async list(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Query() query: ListSuppliersQueryDto,
  ) {
    if (query.format === 'xlsx') {
      const buffer = await this.suppliers.exportXlsx(user, branchId, query);
      return new StreamableFile(buffer, {
        type: XLSX,
        disposition: `attachment; filename="nha-cung-cap-${todayVn()}.xlsx"`,
      });
    }
    return this.suppliers.list(user, branchId, query);
  }

  @Get(':id')
  @RequirePermission('purchase.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Chi tiết nhà cung cấp (số tiền theo chi nhánh làm việc)',
  })
  @ApiOkResponse({ type: SupplierDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy nhà cung cấp' })
  get(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.suppliers.get(user, branchId, id);
  }

  @Get(':id/branches')
  @RequirePermission('purchase.view')
  @ApiOperation({
    summary: 'Số tiền của nhà cung cấp tại từng chi nhánh người dùng được phép',
    description:
      'Mỗi chi nhánh một dòng; số tiền KHÔNG cộng gộp giữa các chi nhánh. Nợ vắng mặt nếu thiếu debt.view.',
  })
  @ApiOkResponse({ type: [SupplierBranchDto] })
  @ApiNotFoundResponse({ description: 'Không tìm thấy nhà cung cấp' })
  branches(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.suppliers.branchesOf(user, id);
  }

  @Get(':id/ledger')
  @RequirePermission('purchase.view', 'debt.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Sổ công nợ nhà cung cấp tại chi nhánh làm việc',
    description:
      'Số dư đầu kỳ (trước `from`), các dòng sổ cái trong khoảng ngày kèm số dư cộng dồn, số dư cuối kỳ. Mỗi chi nhánh một sổ riêng. Cần cả purchase.view và debt.view. `amount` dương = tăng nợ, âm = giảm nợ.',
  })
  @ApiOkResponse({ type: LedgerDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy nhà cung cấp' })
  ledger(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Query() query: LedgerQueryDto,
  ) {
    return this.suppliers.ledger(branchId, id, query);
  }

  @Post()
  @RequirePermission('purchase.edit')
  @RequireBranch()
  @ApiOperation({
    summary: 'Tạo nhà cung cấp',
    description: 'Bỏ trống `code` thì hệ thống tự cấp (NCC000056…).',
  })
  @ApiCreatedResponse({ type: SupplierDto })
  @ApiConflictResponse({ description: 'DUPLICATE_CODE: mã đã tồn tại' })
  create(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Body() body: CreateSupplierDto,
  ) {
    return this.suppliers.create(user, branchId, body);
  }

  @Patch(':id')
  @RequirePermission('purchase.edit')
  @RequireBranch()
  @ApiOperation({
    summary: 'Sửa tên, nhóm; ngưng hoặc mở lại giao dịch (isActive)',
    description:
      'Mã không đổi được. Nhà cung cấp hệ thống (chi nhánh) không sửa được.',
  })
  @ApiOkResponse({ type: SupplierDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy nhà cung cấp' })
  update(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdateSupplierDto,
  ) {
    return this.suppliers.update(user, branchId, id, body);
  }
}
