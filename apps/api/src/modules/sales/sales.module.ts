import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { InvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { SalesReturnsController } from './sales-returns.controller.js';
import { SalesReturnsService } from './sales-returns.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

/** Đơn hàng: đặt hàng (phiếu tạm), hóa đơn, trả hàng bán. */
@Module({
  imports: [AuditModule, InventoryModule],
  controllers: [OrdersController, InvoicesController, SalesReturnsController],
  providers: [OrdersService, InvoicesService, SalesReturnsService],
})
export class SalesModule {}
