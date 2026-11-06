import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { FilesModule } from '../files/files.module.js';
import { OrphanImagesService } from './orphan-images.service.js';
import { ProductImagesController } from './product-images.controller.js';
import { ProductImagesService } from './product-images.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

/** Danh mục hàng hóa: sản phẩm, ảnh. */
@Module({
  imports: [AuditModule, FilesModule],
  controllers: [ProductsController, ProductImagesController],
  exports: [ProductsService],
  providers: [ProductsService, ProductImagesService, OrphanImagesService],
})
export class CatalogModule {}
