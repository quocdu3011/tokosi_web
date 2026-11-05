import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { FilesModule } from '../files/files.module.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import { ProductImagesController } from './product-images.controller.js';
import { ProductImagesService } from './product-images.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

/** Danh mục hàng hóa: nhóm hàng, sản phẩm, ảnh. */
@Module({
  imports: [AuditModule, FilesModule],
  controllers: [
    CategoriesController,
    ProductsController,
    ProductImagesController,
  ],
  providers: [CategoriesService, ProductsService, ProductImagesService],
  exports: [CategoriesService, ProductsService],
})
export class CatalogModule {}
