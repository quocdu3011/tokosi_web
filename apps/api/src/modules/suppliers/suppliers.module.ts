import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { SuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';

/** Nhà cung cấp (phân hệ Mua hàng). */
@Module({
  imports: [AuditModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
