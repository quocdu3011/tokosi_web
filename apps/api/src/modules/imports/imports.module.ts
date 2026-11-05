import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ImportsController } from './imports.controller.js';
import { ImportsService } from './imports.service.js';

/** Nhập dữ liệu từ Excel (hàng hóa, bảng giá). */
@Module({
  imports: [AuditModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
