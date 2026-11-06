import { Module } from '@nestjs/common';
import { PreferencesController } from './preferences.controller.js';
import { PreferencesService } from './preferences.service.js';

/**
 * Tùy chọn giao diện theo tài khoản (hiện: tùy chỉnh bảng — `/me/table-prefs`). Không cần import AuthModule: ba guard
 * toàn cục đã được đăng ký ở AuthModule và áp cho mọi controller.
 */
@Module({
  controllers: [PreferencesController],
  providers: [PreferencesService],
})
export class PreferencesModule {}
