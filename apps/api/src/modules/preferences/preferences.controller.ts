import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { type AuthUser, CurrentUser } from '../../common/auth-user.js';
import { TablePrefsDto, TablePrefsMapDto } from './preferences.dto.js';
import { PreferencesService } from './preferences.service.js';
import { TableKeyPipe } from './table-key.pipe.js';

const TABLE_KEY_PARAM = {
  name: 'tableKey',
  example: 'products',
  description:
    'Khóa bảng ở giao diện: chữ thường/số, có thể có `:` `_` `-`, tối đa 64 ký tự (vd `products`, `purchase-orders`)',
} as const;

/**
 * Tùy chỉnh bảng của CHÍNH người đăng nhập — chỉ cần đăng nhập, không có `@RequirePermission` (ai cũng chỉnh được
 * giao diện của mình). Người dùng đang bị bắt đổi mật khẩu vẫn bị chặn (403 `PASSWORD_CHANGE_REQUIRED`) như mọi
 * endpoint nghiệp vụ; chỉ `/auth/me` và `/auth/change-password` được mở cho họ.
 */
@ApiTags('Tùy chỉnh bảng')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '`UNAUTHENTICATED`: chưa đăng nhập' })
@ApiForbiddenResponse({
  description: '`PASSWORD_CHANGE_REQUIRED`: cần đổi mật khẩu trước',
})
@Controller('me/table-prefs')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get()
  @ApiOperation({
    summary: 'Tùy chỉnh bảng của tôi (mọi bảng đã lưu)',
    description:
      'Trả `{ data: { [tableKey]: TablePrefs } }`; bảng chưa lưu thì không có khóa. Chỉ của người dùng đang đăng nhập.',
  })
  @ApiOkResponse({ type: TablePrefsMapDto })
  list(@CurrentUser() user: AuthUser) {
    return this.preferences.list(user.id);
  }

  @Put(':tableKey')
  @ApiOperation({
    summary: 'Lưu tùy chỉnh một bảng (thay thế toàn bộ)',
    description:
      'Thay thế TOÀN BỘ bản ghi của bảng (không gộp với bản cũ); chưa có thì tạo. Mọi trường tùy chọn; trường lạ → 400. ' +
      'Không ghi nhật ký thao tác (chỉ là tùy chọn giao diện).',
  })
  @ApiParam(TABLE_KEY_PARAM)
  @ApiOkResponse({ type: TablePrefsDto, description: 'Đối tượng đã lưu' })
  @ApiBadRequestResponse({
    description: '`VALIDATION_ERROR`: khóa bảng hoặc nội dung không hợp lệ',
  })
  save(
    @CurrentUser() user: AuthUser,
    @Param('tableKey', TableKeyPipe) tableKey: string,
    @Body() body: TablePrefsDto,
  ) {
    return this.preferences.save(user.id, tableKey, body);
  }

  @Delete(':tableKey')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Xóa tùy chỉnh một bảng (về mặc định)',
    description: 'Không có bản ghi cũng trả 204.',
  })
  @ApiParam(TABLE_KEY_PARAM)
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: '`VALIDATION_ERROR`: khóa bảng sai' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('tableKey', TableKeyPipe) tableKey: string,
  ): Promise<void> {
    await this.preferences.remove(user.id, tableKey);
  }
}
