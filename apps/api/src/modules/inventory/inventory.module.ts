import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';

/** Cổng duy nhất thay đổi tồn kho (khóa dòng, không âm, giá vốn bình quân, sổ cái). */
@Module({
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
