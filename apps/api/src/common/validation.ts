import type { ValidationError } from '@nestjs/common';
import { AppError } from './app-error.js';

export interface FieldIssue {
  field: string;
  message: string;
}

/** Làm phẳng cây `ValidationError` của class-validator thành `[{ field, message }]` (field dạng `items[0].qty`). */
export function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): FieldIssue[] {
  const out: FieldIssue[] = [];
  for (const err of errors) {
    const path = /^\d+$/.test(err.property)
      ? `${parent}[${err.property}]`
      : parent
        ? `${parent}.${err.property}`
        : err.property;
    for (const message of Object.values(err.constraints ?? {})) {
      out.push({ field: path, message });
    }
    if (err.children?.length) {
      out.push(...flattenValidationErrors(err.children, path));
    }
  }
  return out;
}

/** `exceptionFactory` cho `ValidationPipe`: ra `400 VALIDATION_ERROR` theo hợp đồng API. */
export function validationExceptionFactory(
  errors: ValidationError[],
): AppError {
  const details = flattenValidationErrors(errors);
  return new AppError(
    400,
    'VALIDATION_ERROR',
    details[0]?.message ?? 'Dữ liệu không hợp lệ',
    details,
  );
}
