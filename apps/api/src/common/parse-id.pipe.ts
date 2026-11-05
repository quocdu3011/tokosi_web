import {
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { AppError } from './app-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Kiểm tra tham số đường dẫn phải là UUID. Sai dạng → `400 VALIDATION_ERROR` kèm
 * `details: [{ field: <tên tham số>, message }]` đúng hợp đồng lỗi (thay cho `BAD_REQUEST` mặc định của
 * pipe UUID có sẵn của Nest). Dùng: `@Param('id', ParseIdPipe) id: string`.
 */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (typeof value === 'string' && UUID.test(value)) return value;
    const field = metadata.data || 'id';
    throw new AppError(400, 'VALIDATION_ERROR', `${field} không hợp lệ`, [
      { field, message: 'Phải là mã định danh (UUID) hợp lệ' },
    ]);
  }
}
