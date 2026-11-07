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
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import { RequireBranch } from '../branches/require-branch.decorator.js';
import { Idempotent } from '../idempotency/idempotent.decorator.js';
import { xlsxFile } from '../purchasing/purchase-lines.js';
import { CashTransactionsService } from './cash-transactions.service.js';
import {
  CancelCashTransactionDto,
  CashTransactionDto,
  CashTransactionListDto,
  CreateCashTransactionDto,
  CreateCustomerReceiptDto,
  ListCashTransactionsQueryDto,
  UpdateCashTransactionNoteDto,
} from './cash-transactions.dto.js';

@ApiTags('Sổ quỹ')
@ApiBearerAuth()
@Controller('cash-transactions')
export class CashTransactionsController {
  constructor(private readonly cash: CashTransactionsService) {}

  @Get()
  @RequirePermission('cash.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Sổ quỹ: danh sách phiếu thu/chi của chi nhánh làm việc kèm tổng hợp kỳ',
    description:
      '`summary` (tồn đầu kỳ, tổng thu, tổng chi, tồn cuối kỳ) tính cho toàn bộ bộ lọc, không chỉ trang hiện tại. `?format=xlsx` tải Excel theo đúng bộ lọc (tiêu đề như file Sổ quỹ KiotViet: giá trị thu dương, chi âm).',
  })
  @ApiOkResponse({ type: CashTransactionListDto })
  async list(
    @WorkingBranchId() branchId: string,
    @Query() query: ListCashTransactionsQueryDto,
  ) {
    if (query.format === 'xlsx') {
      return xlsxFile(await this.cash.exportXlsx(branchId, query), 'so-quy');
    }
    return this.cash.list(branchId, query);
  }

  @Get(':id')
  @RequirePermission('cash.view')
  @RequireBranch()
  @ApiOperation({ summary: 'Chi tiết phiếu (kèm các hóa đơn đã cấn trừ nếu là phiếu thu nợ)' })
  @ApiOkResponse({ type: CashTransactionDto })
  @ApiNotFoundResponse({ description: 'Không có phiếu (hoặc thuộc chi nhánh khác)' })
  get(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
  ) {
    return this.cash.get(branchId, id);
  }

  @Post()
  @Idempotent()
  @RequirePermission('cash.create')
  @RequireBranch()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Lập phiếu thu/chi',
    description:
      'Danh mục hệ thống quyết định phiếu có ghi công nợ: "Tiền khách trả" (khách −), "Hoàn tiền khách" (khách +), "Công nợ nhà cung cấp" (NCC −), "Hoàn tiền từ nhà cung cấp" (NCC +) — bắt buộc `party` đúng loại. Danh mục khác không ghi công nợ. Thu nợ khách tự cấn trừ vào hóa đơn còn nợ cũ nhất (xem `allocations`). Phiếu chi làm quỹ âm chỉ cảnh báo (`warnings[].code = CASH_NEGATIVE`).',
  })
  @ApiCreatedResponse({ type: CashTransactionDto })
  @ApiUnprocessableEntityResponse({ description: 'ALLOCATION_EXCEEDS: cấn trừ vượt tiền thu hoặc vượt còn nợ của hóa đơn' })
  create(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Body() body: CreateCashTransactionDto,
  ) {
    return this.cash.create(user, branchId, body);
  }

  @Patch(':id')
  @RequirePermission('cash.create')
  @RequireBranch()
  @ApiOperation({ summary: 'Sửa ghi chú phiếu (không sửa gì khác; muốn đổi tiền thì hủy rồi lập lại)' })
  @ApiOkResponse({ type: CashTransactionDto })
  updateNote(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdateCashTransactionNoteDto,
  ) {
    return this.cash.updateNote(branchId, id, body.note);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('cash.cancel')
  @RequireBranch()
  @ApiOperation({
    summary: 'Hủy phiếu thu/chi',
    description:
      'Đảo bút toán công nợ của phiếu (nếu có). Phiếu thu lúc xuất hóa đơn (`refType = invoice`) không hủy riêng được (409): hủy hóa đơn gốc. Đã hủy → 422 INVALID_STATE.',
  })
  @ApiOkResponse({ type: CashTransactionDto })
  cancel(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: CancelCashTransactionDto,
  ) {
    return this.cash.cancel(branchId, id, body.reason);
  }
}

@ApiTags('Sổ quỹ')
@ApiBearerAuth()
@Controller('customers')
export class CustomerReceiptsController {
  constructor(private readonly cash: CashTransactionsService) {}

  @Post(':id/receipts')
  @Idempotent()
  @RequirePermission('cash.create')
  @RequireBranch()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Thu nợ nhanh theo khách',
    description:
      'Phiếu thu danh mục "Tiền khách trả" của khách tại chi nhánh làm việc; mặc định cấn trừ vào hóa đơn còn nợ cũ nhất, chọn tay được bằng `allocations`. Giảm công nợ khách cùng chi nhánh (nợ có thể âm khi khách trả dư).',
  })
  @ApiCreatedResponse({ type: CashTransactionDto })
  @ApiUnprocessableEntityResponse({ description: 'ALLOCATION_EXCEEDS' })
  createReceipt(
    @CurrentUser() user: AuthUser,
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) customerId: string,
    @Body() body: CreateCustomerReceiptDto,
  ) {
    return this.cash.createReceipt(user, branchId, customerId, body);
  }
}
