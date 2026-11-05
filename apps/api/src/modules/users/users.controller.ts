import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ParseIdPipe } from '../../common/parse-id.pipe.js';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  type AppRequest,
  type AuthUser,
  CurrentUser,
} from '../../common/auth-user.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { RequestContext } from '../auth/auth.service.js';
import {
  CreateUserDto,
  ListUsersQueryDto,
  ResetPasswordDto,
  SetUserBranchesDto,
  UpdateUserDto,
  UserDto,
  UserListDto,
  UserWithPasswordDto,
} from './users.dto.js';
import { UsersService } from './users.service.js';

const ctxOf = (req: AppRequest): RequestContext => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});

/** Màn hình "Người dùng" dành cho Quản lý. Các endpoint trả mật khẩu tạm cấm lưu bộ nhớ đệm. */
@ApiTags('Người dùng')
@ApiBearerAuth()
@RequirePermission('user.manage')
@ApiForbiddenResponse({
  description: 'Không có quyền `user.manage` (chỉ Quản lý)',
})
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Danh sách người dùng (tìm không dấu, lọc, phân trang)',
  })
  @ApiOkResponse({ type: UserListDto })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết một người dùng' })
  @ApiOkResponse({ type: UserDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy người dùng' })
  get(@Param('id', ParseIdPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Tạo người dùng',
    description:
      'Tài khoản mới bị bắt đổi mật khẩu ở lần đăng nhập đầu. Bỏ trống `password` thì hệ thống sinh mật khẩu tạm và trả `temporaryPassword` (chỉ một lần).',
  })
  @ApiCreatedResponse({ type: UserWithPasswordDto })
  @ApiConflictResponse({ description: '`DUPLICATE_USERNAME`' })
  create(
    @CurrentUser() actor: AuthUser,
    @Body() body: CreateUserDto,
    @Req() req: AppRequest,
  ) {
    return this.users.create(actor, body, ctxOf(req));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Sửa thông tin / vai trò / khóa-mở tài khoản',
    description:
      'Không có xóa người dùng: khóa bằng `isActive = false` (thu hồi mọi phiên đăng nhập ngay). Không tự khóa hoặc đổi vai trò của mình; không khóa hay hạ Quản lý hoạt động cuối cùng (`INVALID_STATE`).',
  })
  @ApiOkResponse({ type: UserDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy người dùng' })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdateUserDto,
    @Req() req: AppRequest,
  ) {
    return this.users.update(actor, id, body, ctxOf(req));
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Đặt lại mật khẩu',
    description:
      'Đặt mật khẩu mới, bắt đổi ở lần đăng nhập kế tiếp và thu hồi mọi phiên đang đăng nhập của người đó. Không áp dụng cho chính mình (dùng `POST /auth/change-password`). Bỏ trống `newPassword` thì hệ thống sinh và trả `temporaryPassword` (chỉ một lần).',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { temporaryPassword: { type: 'string' } },
    },
  })
  @ApiNotFoundResponse({ description: 'Không tìm thấy người dùng' })
  resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: ResetPasswordDto,
    @Req() req: AppRequest,
  ) {
    return this.users.resetPassword(actor, id, body, ctxOf(req));
  }

  @Put(':id/branches')
  @ApiOperation({
    summary: 'Gán chi nhánh cho người dùng (thay thế toàn bộ danh sách)',
    description:
      'Mọi vai trò trừ Quản lý phải có ít nhất một chi nhánh. Chi nhánh mặc định không còn được gán thì bị bỏ.',
  })
  @ApiOkResponse({ type: UserDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy người dùng' })
  setBranches(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseIdPipe) id: string,
    @Body() body: SetUserBranchesDto,
    @Req() req: AppRequest,
  ) {
    return this.users.setBranches(actor, id, body, ctxOf(req));
  }
}
