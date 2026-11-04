import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/** Quản lý người dùng (tạo, sửa, khóa, đặt lại mật khẩu, gán chi nhánh) — chỉ Quản lý. */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
