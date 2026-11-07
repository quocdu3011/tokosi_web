import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { ParseIdPipe } from '../../common/parse-id.pipe.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import { RequireBranch } from '../branches/require-branch.decorator.js';
import { xlsxFile } from '../purchasing/purchase-lines.js';
import { LedgerDto, LedgerQueryDto } from '../suppliers/suppliers.dto.js';
import { statementXlsx } from './customer-statement.js';
import {
  CustomerAgingDto,
  CustomerStatementDto,
  CustomerStatementQueryDto,
} from './customers-statement.dto.js';
import {
  CreateCustomerDto,
  CreateCustomerVisitDto,
  CustomerDto,
  CustomerListDto,
  CustomerLookupItemDto,
  CustomerTermsDto,
  CustomerVisitDto,
  ListCustomersQueryDto,
  LookupCustomersQueryDto,
  SetCustomerTermsDto,
  UpdateCustomerDto,
} from './customers.dto.js';
import { CustomersService } from './customers.service.js';

const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** YYYYMMDD theo giờ Việt Nam, dùng cho tên file tải về. */
const todayStamp = () =>
  new Date(Date.now() + 7 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');

@ApiTags('Khách hàng')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customer.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Danh sách khách hàng (lọc, tìm không dấu, phân trang)',
    description:
      'Xem được MỌI khách, kể cả khách của nhân viên khác. Mặc định không gồm khách hệ thống đại diện chi nhánh (includeInternal=true để gồm). `branches[]` chỉ có chi nhánh làm việc (header X-Branch-Id); công nợ/hạn mức chỉ có khi có quyền debt.view (chỉ "của mình" thì chỉ với khách mình phụ trách). `?format=xlsx` tải Excel với tiêu đề như file TKS.',
  })
  @ApiOkResponse({ type: CustomerListDto })
  @ApiForbiddenResponse({ description: 'Lọc hasDebt khi thiếu debt.view' })
  async list(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Query() query: ListCustomersQueryDto,
  ) {
    if (query.format === 'xlsx') {
      const buffer = await this.customers.exportXlsx(user, branchId, query);
      return new StreamableFile(buffer, {
        type: XLSX,
        disposition: `attachment; filename="khach-hang-${todayStamp()}.xlsx"`,
      });
    }
    return this.customers.list(user, branchId, query);
  }

  @Get('lookup')
  @RequirePermission('customer.view')
  @RequireBranch()
  @ApiOperation({
    summary:
      'Tìm nhanh khách cho ô chọn khách (tối đa 20, chỉ khách đang hoạt động)',
    description:
      'Kèm công nợ, hạn mức và hạn mức còn lại TẠI chi nhánh làm việc nếu người gọi có quyền xem công nợ của khách đó.',
  })
  @ApiOkResponse({ type: [CustomerLookupItemDto] })
  lookup(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Query() query: LookupCustomersQueryDto,
  ) {
    return this.customers.lookup(user, branchId, query);
  }

  @Get(':id')
  @RequirePermission('customer.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Chi tiết khách hàng',
    description:
      '`branches[]` gồm MỌI chi nhánh người dùng được phép, mỗi chi nhánh một bộ số riêng (không cộng gộp). `warnings` có DUPLICATE_PHONE nếu số điện thoại trùng khách khác.',
  })
  @ApiOkResponse({ type: CustomerDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy khách hàng' })
  get(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.customers.get(user, branchId, id);
  }

  @Get(':id/ledger')
  @RequirePermission('customer.view', 'debt.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Sổ công nợ khách hàng tại chi nhánh làm việc',
    description:
      'Số dư đầu kỳ (trước `from`), các dòng sổ cái trong khoảng ngày kèm số dư cộng dồn, số dư cuối kỳ. Mỗi chi nhánh một sổ riêng. Cần customer.view và debt.view (chỉ "của mình" thì chỉ khách mình phụ trách). `amount` dương = tăng nợ (khách nợ thêm), âm = giảm nợ.',
  })
  @ApiOkResponse({ type: LedgerDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy khách hàng' })
  ledger(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Query() query: LedgerQueryDto,
  ) {
    return this.customers.ledger(user, branchId, id, query);
  }

  @Get(':id/aging')
  @RequirePermission('customer.view', 'debt.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Tuổi nợ của khách tại chi nhánh làm việc',
    description:
      'Các hóa đơn còn nợ (cũ nhất trước) tính tuổi theo ngày hóa đơn kèm ngày đến hạn / quá hạn nếu khách có kỳ hạn công nợ; tổng theo nhóm 0–30, 31–60, 61–90, trên 90 ngày. `invoiceTotal + notAllocated = balance` (công nợ theo sổ): `notAllocated` là nợ không gắn hóa đơn (nợ đầu kỳ chuyển từ KiotViet, điều chỉnh, tiền khách trả trước chưa cấn). Cần customer.view và debt.view (chỉ "của mình" thì chỉ khách mình phụ trách).',
  })
  @ApiOkResponse({ type: CustomerAgingDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy khách hàng' })
  @ApiForbiddenResponse({ description: 'Không được xem công nợ của khách này' })
  aging(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.customers.aging(user, branchId, id);
  }

  @Get(':id/statement')
  @RequirePermission('customer.view', 'debt.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Biên bản đối chiếu công nợ theo kỳ',
    description:
      'Nợ đầu kỳ, các chứng từ phát sinh trong kỳ (hóa đơn gộp tổng và phần thu ngay lúc xuất thành một dòng, trả hàng, thu nợ, hoàn tiền, hủy chứng từ), cộng phát sinh và nợ cuối kỳ của chi nhánh làm việc; `closingBalance` bằng sổ công nợ cùng kỳ. `?format=xlsx` tải Excel. `from` / `to` dạng YYYY-MM-DD (giờ Việt Nam, gồm cả ngày).',
  })
  @ApiOkResponse({ type: CustomerStatementDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy khách hàng' })
  @ApiForbiddenResponse({ description: 'Không được xem công nợ của khách này' })
  async statement(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Query() query: CustomerStatementQueryDto,
  ) {
    const statement = await this.customers.statement(user, branchId, id, query);
    if (query.format === 'xlsx') {
      return xlsxFile(await statementXlsx(statement), 'doi-chieu-cong-no');
    }
    return statement;
  }

  @Post()
  @RequirePermission('customer.edit')
  @RequireBranch()
  @ApiOperation({
    summary: 'Tạo khách hàng',
    description:
      'Bỏ trống `code` thì hệ thống tự cấp (KH000056…). Số điện thoại được chuẩn hóa, có thể trùng khách khác (chỉ cảnh báo trong `warnings`). Quyền "chỉ của mình": khách luôn do chính mình phụ trách.',
  })
  @ApiCreatedResponse({ type: CustomerDto })
  @ApiConflictResponse({ description: 'DUPLICATE_CODE: mã đã tồn tại' })
  create(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Body() body: CreateCustomerDto,
  ) {
    return this.customers.create(user, branchId, body);
  }

  @Patch(':id')
  @RequirePermission('customer.edit')
  @RequireBranch()
  @ApiOperation({
    summary:
      'Sửa khách hàng, hồ sơ kho; ngưng hoặc mở lại giao dịch (isActive)',
    description:
      'Mã không đổi được. Khách hệ thống đại diện chi nhánh không sửa được. Quyền "chỉ của mình": chỉ sửa khách mình phụ trách và không chuyển cho người khác.',
  })
  @ApiOkResponse({ type: CustomerDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy khách hàng' })
  @ApiForbiddenResponse({ description: 'Khách do nhân viên khác phụ trách' })
  update(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdateCustomerDto,
  ) {
    return this.customers.update(user, branchId, id, body);
  }

  @Put(':id/branches/:branchId/terms')
  @RequirePermission('customer.edit', 'debt.view')
  @ApiOperation({
    summary: 'Đặt hạn mức và kỳ hạn công nợ của khách tại một chi nhánh',
    description:
      'Riêng từng chi nhánh. Cả hai null = không giới hạn (xóa thiết lập). Cần customer.edit và debt.view; chi nhánh phải nằm trong chi nhánh người dùng được phép.',
  })
  @ApiOkResponse({ type: CustomerTermsDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy khách hàng' })
  setTerms(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIdPipe) id: string,
    @Param('branchId', ParseIdPipe) branchId: string,
    @Body() body: SetCustomerTermsDto,
  ) {
    return this.customers.setTerms(user, id, branchId, body);
  }

  @Get(':id/visits')
  @RequirePermission('customer.view')
  @ApiOperation({ summary: 'Lịch tiếp khách (mới nhất trước)' })
  @ApiOkResponse({ type: [CustomerVisitDto] })
  @ApiNotFoundResponse({ description: 'Không tìm thấy khách hàng' })
  visits(@Param('id', ParseIdPipe) id: string) {
    return this.customers.listVisits(id);
  }

  @Post(':id/visits')
  @RequirePermission('customer.visit.edit')
  @ApiOperation({
    summary: 'Ghi một ngày tiếp khách',
    description:
      'Chỉ người có quyền "Ghi ngày tiếp khách" (mặc định Quản lý). Ngày không được ở tương lai.',
  })
  @ApiCreatedResponse({ type: CustomerVisitDto })
  @ApiConflictResponse({ description: 'DUPLICATE_VISIT: đã ghi ngày này' })
  addVisit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: CreateCustomerVisitDto,
  ) {
    return this.customers.addVisit(user, id, body);
  }

  @Delete(':id/visits/:visitId')
  @HttpCode(204)
  @RequirePermission('customer.visit.edit')
  @ApiOperation({ summary: 'Xóa một ngày tiếp khách (ghi nhật ký)' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    description: 'Không tìm thấy khách hoặc ngày tiếp khách',
  })
  async removeVisit(
    @Param('id', ParseIdPipe) id: string,
    @Param('visitId', ParseIdPipe) visitId: string,
  ): Promise<void> {
    await this.customers.removeVisit(id, visitId);
  }
}
