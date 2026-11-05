import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/** Tham số query dạng boolean: chấp nhận `true`/`false` (chuỗi), bỏ trống = không lọc. */
export const QueryBoolean = () =>
  applyDecorators(
    IsOptional(),
    Transform(({ value }: { value: unknown }) =>
      value === 'true' ? true : value === 'false' ? false : value,
    ),
    IsBoolean(),
  );
