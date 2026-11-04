import { Global, Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service.js';
import { RolesController } from './roles.controller.js';

/**
 * Phân quyền theo vai trò, cấu hình được trong CSDL.
 * `PermissionGuard` được đăng ký toàn cục trong AuthModule (để đúng thứ tự sau AuthGuard).
 */
@Global()
@Module({
  controllers: [RolesController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class AuthorizationModule {}
