import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ParseIdPipe } from '../../common/parse-id.pipe.js';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import {
  CategoryNodeDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './categories.dto.js';
import { CategoriesService } from './categories.service.js';

@ApiTags('Nhóm hàng')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermission('product.view')
  @ApiOperation({
    summary: 'Cây nhóm hàng (không phân trang)',
    description:
      'productCount của nhóm cha đã gồm hàng của mọi nhóm con. Tối đa 3 cấp.',
  })
  @ApiOkResponse({ type: [CategoryNodeDto] })
  tree() {
    return this.categories.tree();
  }

  @Post()
  @RequirePermission('product.edit')
  @ApiOperation({ summary: 'Tạo nhóm hàng' })
  @ApiCreatedResponse({ type: CategoryNodeDto })
  @ApiConflictResponse({ description: 'DUPLICATE_NAME' })
  create(@Body() body: CreateCategoryDto) {
    return this.categories.create(body);
  }

  @Patch(':id')
  @RequirePermission('product.edit')
  @ApiOperation({
    summary: 'Đổi tên / chuyển nhóm cha',
    description:
      'Không được chuyển nhóm vào chính nó hoặc nhóm con của nó (INVALID_STATE); tổng không quá 3 cấp.',
  })
  @ApiOkResponse({ type: CategoryNodeDto })
  @ApiNotFoundResponse({ description: 'Không tìm thấy nhóm hàng' })
  @ApiConflictResponse({ description: 'DUPLICATE_NAME' })
  update(
    @Param('id', ParseIdPipe) id: string,
    @Body() body: UpdateCategoryDto,
  ) {
    return this.categories.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('product.edit')
  @ApiOperation({
    summary: 'Xóa nhóm hàng (xóa mềm)',
    description: 'Chỉ khi không còn nhóm con và không còn hàng hóa.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Không tìm thấy nhóm hàng' })
  async remove(@Param('id', ParseIdPipe) id: string): Promise<void> {
    await this.categories.remove(id);
  }
}
