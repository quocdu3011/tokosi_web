import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { GoodsReceiptsController } from './goods-receipts.controller.js';
import { GoodsReceiptsService } from './goods-receipts.service.js';
import { PurchaseOrdersController } from './purchase-orders.controller.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { PurchaseReturnsController } from './purchase-returns.controller.js';
import { PurchaseReturnsService } from './purchase-returns.service.js';

/** Mua hàng: đặt hàng nhập, nhập hàng, trả hàng nhập (nhà cung cấp ở SuppliersModule). */
@Module({
  imports: [AuditModule, InventoryModule],
  controllers: [
    PurchaseOrdersController,
    GoodsReceiptsController,
    PurchaseReturnsController,
  ],
  providers: [
    PurchaseOrdersService,
    GoodsReceiptsService,
    PurchaseReturnsService,
  ],
})
export class PurchasingModule {}
