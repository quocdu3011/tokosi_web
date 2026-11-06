import {
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { TABLE_KEY_PATTERN } from '@kiot/shared';
import { AppError } from '../../common/app-error.js';

/**
 * Kiểm tra tham số đường dẫn `tableKey` khớp `TABLE_KEY_PATTERN` (chữ thường/số, có thể có `:` `_` `-`, ≤ 64 ký tự).
 * Sai → `400 VALIDATION_ERROR` kèm `details: [{ field: 'tableKey', message }]` đúng hợp đồng lỗi.
 */
@Injectable()
export class TableKeyPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (typeof value === 'string' && TABLE_KEY_PATTERN.test(value))
      return value;
    const field = metadata.data || 'tableKey';
    throw new AppError(400, 'VALIDATION_ERROR', `${field} không hợp lệ`, [
      {
        field,
        message:
          'Khóa bảng gồm chữ thường, số, `:` `_` `-` (bắt đầu bằng chữ hoặc số), tối đa 64 ký tự',
      },
    ]);
  }
}
