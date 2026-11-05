import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CategoryNodeDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'NHÀ BẾP' }) name!: string;
  @ApiProperty({ nullable: true, type: String }) parentId!: string | null;
  @ApiProperty({
    description:
      'Số hàng hóa chưa xóa thuộc nhóm này VÀ mọi nhóm con (nhóm cha cộng dồn từ nhóm con)',
  })
  productCount!: number;
  @ApiProperty({ type: () => [CategoryNodeDto] }) children!: CategoryNodeDto[];
}

export class CreateCategoryDto {
  @ApiProperty({
    example: 'Dao kéo',
    description:
      'Tên nhóm, 1-100 ký tự; không trùng trong cùng nhóm cha (không phân biệt hoa thường và dấu)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    description: 'Nhóm cha; bỏ trống = nhóm gốc. Tối đa 3 cấp',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Nhóm cha mới; null = chuyển ra nhóm gốc',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}
