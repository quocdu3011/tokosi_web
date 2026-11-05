import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuthSettingsService } from './auth-settings.service.js';
import {
  AuthSettingsController,
  GoogleAuthController,
} from './google-auth.controller.js';
import { GoogleAuthService } from './google-auth.service.js';
import { SUPABASE_KEYS, SupabaseJwtVerifier } from './supabase-jwt.verifier.js';

/** Đăng nhập/đăng ký bằng Google qua Supabase + cài đặt do Quản lý chỉnh. */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [GoogleAuthController, AuthSettingsController],
  providers: [
    // Mặc định dùng JWKS từ xa của Supabase; test ghi đè bằng khóa cục bộ
    { provide: SUPABASE_KEYS, useValue: undefined },
    SupabaseJwtVerifier,
    AuthSettingsService,
    GoogleAuthService,
  ],
})
export class GoogleAuthModule {}
