import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionGuard } from './permission.guard.js';
import { PermissionsService } from './permissions.service.js';
import { RolesController } from './roles.controller.js';

/**
 * Phân quyền theo vai trò, cấu hình được trong CSDL.
 * LƯU Ý THỨ TỰ: khi thêm AuthModule (JWT), AuthGuard phải được đăng ký APP_GUARD TRƯỚC PermissionGuard
 * để `request.user` đã có khi kiểm tra quyền.
 */
@Global()
@Module({
  controllers: [RolesController],
  providers: [
    PermissionsService,
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PermissionsService],
})
export class AuthorizationModule {}
