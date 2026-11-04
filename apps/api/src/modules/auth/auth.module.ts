import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionGuard } from '../authorization/permission.guard.js';
import { BranchContextGuard } from '../branches/branch-context.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { TokenService } from './token.service.js';

/**
 * Xác thực JWT và ba guard toàn cục. THỨ TỰ ĐĂNG KÝ DƯỚI ĐÂY LÀ THỨ TỰ CHẠY và không được đổi:
 *   1. AuthGuard           — xác định người dùng (401 nếu chưa đăng nhập, trừ @Public)
 *   2. PermissionGuard     — kiểm tra @RequirePermission (cần người dùng từ bước 1)
 *   3. BranchContextGuard  — xác định chi nhánh làm việc cho @RequireBranch (cần người dùng)
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: BranchContextGuard },
  ],
  exports: [TokenService, AuthService],
})
export class AuthModule {}
