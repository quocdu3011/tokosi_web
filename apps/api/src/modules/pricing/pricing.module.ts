import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PricingController } from './pricing.controller.js';
import { PricingService } from './pricing.service.js';

/** Thiết lập giá: bảng giá, lưới giá theo chi nhánh, tăng/giảm hàng loạt, sao chép giữa chi nhánh. */
@Module({
  imports: [AuditModule],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
