import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { WorkingBranchId } from '../../common/auth-user.js';
import { ParseIdPipe } from '../../common/parse-id.pipe.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import { RequireBranch } from '../branches/require-branch.decorator.js';
import {
  CashAccountDto,
  CashAccountListDto,
  CashCategoryDto,
  CashCategoryListDto,
  CreateCashAccountDto,
  CreateCashCategoryDto,
  ListCashAccountsQueryDto,
  ListCashCategoriesQueryDto,
  UpdateCashAccountDto,
  UpdateCashCategoryDto,
} from './cash-accounts.dto.js';
import { CashAccountsService } from './cash-accounts.service.js';

@ApiTags('Sổ quỹ')
@ApiBearerAuth()
@Controller('cash-accounts')
export class CashAccountsController {
  constructor(private readonly accounts: CashAccountsService) {}

  @Get()
  @RequirePermission('cash.view')
  @RequireBranch()
  @ApiOperation({
    summary: 'Quỹ (tiền mặt / ngân hàng) của chi nhánh làm việc kèm số dư',
    description:
      'Số dư = quỹ đầu kỳ + tổng thu − tổng chi của các phiếu hoàn tất, tính khi đọc.',
  })
  @ApiOkResponse({ type: CashAccountListDto })
  async list(
    @WorkingBranchId() branchId: string,
    @Query() query: ListCashAccountsQueryDto,
  ) {
    return { data: await this.accounts.listAccounts(branchId, query) };
  }

  @Post()
  @RequirePermission('cash.manage')
  @RequireBranch()
  @ApiOperation({ summary: 'Tạo quỹ cho chi nhánh làm việc' })
  @ApiCreatedResponse({ type: CashAccountDto })
  @ApiConflictResponse({ description: 'DUPLICATE_NAME: trùng tên quỹ trong chi nhánh' })
  create(
    @WorkingBranchId() branchId: string,
    @Body() body: CreateCashAccountDto,
  ) {
    return this.accounts.createAccount(branchId, body);
  }

  @Patch(':id')
  @RequirePermission('cash.manage')
  @RequireBranch()
  @ApiOperation({
    summary: 'Sửa tên / ngưng hoạt động / quỹ đầu kỳ',
    description: 'Quỹ đầu kỳ chỉ đổi được khi quỹ chưa có phiếu nào.',
  })
  @ApiOkResponse({ type: CashAccountDto })
  @ApiNotFoundResponse({ description: 'Quỹ không có hoặc thuộc chi nhánh khác' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_STATE: đổi quỹ đầu kỳ khi đã có phiếu' })
  update(
    @WorkingBranchId() branchId: string,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdateCashAccountDto,
  ) {
    return this.accounts.updateAccount(branchId, id, body);
  }
}

@ApiTags('Sổ quỹ')
@ApiBearerAuth()
@Controller('cash-categories')
export class CashCategoriesController {
  constructor(private readonly accounts: CashAccountsService) {}

  @Get()
  @RequirePermission('cash.view')
  @ApiOperation({ summary: 'Danh mục thu chi (dùng chung hai chi nhánh)' })
  @ApiOkResponse({ type: CashCategoryListDto })
  async list(@Query() query: ListCashCategoriesQueryDto) {
    return { data: await this.accounts.listCategories(query) };
  }

  @Post()
  @RequirePermission('cash.manage')
  @ApiOperation({ summary: 'Tạo danh mục thu chi (không ghi công nợ)' })
  @ApiCreatedResponse({ type: CashCategoryDto })
  @ApiConflictResponse({ description: 'DUPLICATE_NAME' })
  create(@Body() body: CreateCashCategoryDto) {
    return this.accounts.createCategory(body);
  }

  @Patch(':id')
  @RequirePermission('cash.manage')
  @ApiOperation({
    summary: 'Đổi tên / ngưng danh mục',
    description:
      'Danh mục hệ thống (`isSystem`) đổi tên được nhưng không ngưng hoạt động và không đổi hướng (hướng không đổi được với mọi danh mục).',
  })
  @ApiOkResponse({ type: CashCategoryDto })
  @ApiNotFoundResponse({ description: 'Không có danh mục' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_STATE: ngưng danh mục hệ thống' })
  update(
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdateCashCategoryDto,
  ) {
    return this.accounts.updateCategory(id, body);
  }
}
