import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** Tham số phân trang + sắp xếp dùng chung cho mọi danh sách (`?page=1&limit=20&sort=-createdAt`). */
export class PageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    default: DEFAULT_PAGE_LIMIT,
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    example: '-createdAt',
    description:
      'Tên cột cần sắp xếp; thêm `-` phía trước để giảm dần. Chỉ nhận các cột endpoint cho phép',
  })
  @IsOptional()
  @IsString()
  @Matches(/^-?[A-Za-z]{1,30}$/)
  sort?: string;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function pageParams(
  q: { page?: number; limit?: number },
  maxLimit: number = MAX_PAGE_LIMIT,
): { page: number; limit: number; offset: number } {
  const page = q.page ?? 1;
  const limit = Math.min(q.limit ?? DEFAULT_PAGE_LIMIT, maxLimit);
  return { page, limit, offset: (page - 1) * limit };
}

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

/**
 * Đọc `sort` (`name`, `-createdAt`) theo danh sách cột cho phép.
 * Cột lạ → undefined để service dùng thứ tự mặc định (không ném lỗi: tham số sắp xếp sai không đáng làm hỏng yêu cầu).
 */
export function parseSort<K extends string>(
  sort: string | undefined,
  allowed: readonly K[],
): { field: K; desc: boolean } | undefined {
  if (!sort) return undefined;
  const desc = sort.startsWith('-');
  const field = (desc ? sort.slice(1) : sort) as K;
  return allowed.includes(field) ? { field, desc } : undefined;
}
