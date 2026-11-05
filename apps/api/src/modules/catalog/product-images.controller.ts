import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { ParseIdPipe } from '../../common/parse-id.pipe.js';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  RequireAnyPermission,
  RequirePermission,
} from '../authorization/require-permission.decorator.js';
import {
  MAX_IMAGES_PER_PRODUCT,
  MAX_IMAGE_BYTES,
  ProductImagesService,
  type UploadedFile,
} from './product-images.service.js';
import { ProductImageDto } from './products.dto.js';

export class ReorderImagesDto {
  @ApiProperty({
    type: [String],
    description:
      'Id của TẤT CẢ ảnh hiện có của hàng theo thứ tự mới; ảnh đầu là ảnh đại diện',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IMAGES_PER_PRODUCT)
  @IsUUID('all', { each: true })
  imageIds!: string[];
}

@ApiTags('Hàng hóa')
@ApiBearerAuth()
@Controller('products/:id/images')
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Get()
  @RequirePermission('product.view')
  @ApiOperation({ summary: 'Danh sách ảnh của hàng (theo thứ tự hiển thị)' })
  @ApiOkResponse({ type: [ProductImageDto] })
  list(@Param('id', ParseIdPipe) id: string) {
    return this.images.list(id);
  }

  @Post()
  @RequireAnyPermission('product.edit', 'product.content.edit')
  @UseInterceptors(
    FilesInterceptor('files', MAX_IMAGES_PER_PRODUCT, {
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: `Tối đa ${MAX_IMAGES_PER_PRODUCT} ảnh mỗi lần, mỗi ảnh tối đa ${MAX_IMAGE_BYTES / 1024 / 1024} MB, định dạng JPEG, PNG hoặc WebP`,
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Tải NHIỀU ảnh lên cùng lúc (multipart/form-data, field "files")',
    description:
      'Ảnh lưu trên kho file riêng và mỗi ảnh có URL riêng. Tất cả hoặc không gì cả: một ảnh lỗi thì không lưu ảnh nào. Định dạng kiểm tra theo nội dung file, không theo đuôi. Mỗi hàng tối đa 10 ảnh. Trả về TOÀN BỘ ảnh của hàng sau khi thêm.',
  })
  @ApiCreatedResponse({ type: [ProductImageDto] })
  @ApiNotFoundResponse({ description: 'Không tìm thấy hàng hóa' })
  add(
    @Param('id', ParseIdPipe) id: string,
    @UploadedFiles() files: UploadedFile[] | undefined,
  ) {
    return this.images.addMany(id, files ?? []);
  }

  @Put('order')
  @RequireAnyPermission('product.edit', 'product.content.edit')
  @ApiOperation({
    summary: 'Sắp lại thứ tự ảnh (ảnh đầu là ảnh đại diện)',
  })
  @ApiOkResponse({ type: [ProductImageDto] })
  reorder(
    @Param('id', ParseIdPipe) id: string,
    @Body() body: ReorderImagesDto,
  ) {
    return this.images.reorder(id, body.imageIds);
  }

  @Delete(':imageId')
  @HttpCode(204)
  @RequireAnyPermission('product.edit', 'product.content.edit')
  @ApiOperation({
    summary: 'Xóa một ảnh',
    description:
      'Xóa cả file trên kho file (nếu ảnh do hệ thống lưu). Ảnh nhập từ Excel chỉ bị gỡ khỏi hàng.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Không tìm thấy ảnh' })
  async remove(
    @Param('id', ParseIdPipe) id: string,
    @Param('imageId', ParseIdPipe) imageId: string,
  ): Promise<void> {
    await this.images.remove(id, imageId);
  }
}
