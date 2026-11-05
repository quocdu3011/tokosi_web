import { describe, expect, it } from 'vitest';
import { ParseIdPipe } from './parse-id.pipe.js';

const pipe = new ParseIdPipe();
const meta = (data: string) =>
  ({ type: 'param', data }) as Parameters<ParseIdPipe['transform']>[1];

describe('ParseIdPipe', () => {
  it('UUID hợp lệ (chữ hoa/thường) đi qua nguyên vẹn', () => {
    const id = '0192ab12-3c4d-7e5f-8a9b-0c1d2e3f4a5b';
    expect(pipe.transform(id, meta('id'))).toBe(id);
    expect(pipe.transform(id.toUpperCase(), meta('id'))).toBe(id.toUpperCase());
  });

  it('sai dạng → 400 VALIDATION_ERROR kèm details có TÊN tham số', () => {
    for (const bad of [
      'khong-phai-uuid',
      '',
      '123',
      '0192ab12-3c4d-7e5f-8a9b',
      'g192ab12-3c4d-7e5f-8a9b-0c1d2e3f4a5b',
    ]) {
      expect(() => pipe.transform(bad, meta('imageId'))).toThrow(
        expect.objectContaining({
          status: 400,
          response: expect.objectContaining({
            code: 'VALIDATION_ERROR',
            details: [{ field: 'imageId', message: expect.any(String) }],
          }),
        }),
      );
    }
  });
});
