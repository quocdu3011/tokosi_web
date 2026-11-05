import { describe, expect, it } from 'vitest';

import { MAX_IMAGE_BYTES, validateImageFiles } from './product-images';

const img = (name = 'a.jpg', size = 1000, type = 'image/jpeg') => ({ name, size, type });

describe('validateImageFiles', () => {
  it('hợp lệ → null', () => {
    expect(validateImageFiles(0, [img(), img('b.png', 10, 'image/png')])).toBeNull();
    expect(validateImageFiles(8, [img(), img()])).toBeNull();
  });
  it('quá số ảnh tính cả ảnh có sẵn', () => {
    expect(validateImageFiles(9, [img(), img()])).toMatch(/tối đa 10/);
  });
  it('sai loại hoặc quá 5 MB', () => {
    expect(validateImageFiles(0, [img('a.gif', 10, 'image/gif')])).toMatch(/JPEG/);
    expect(validateImageFiles(0, [img('a.jpg', MAX_IMAGE_BYTES + 1)])).toMatch(/5 MB/);
    expect(validateImageFiles(0, [img('a.jpg', MAX_IMAGE_BYTES)])).toBeNull();
  });
  it('không chọn ảnh nào', () => {
    expect(validateImageFiles(0, [])).toMatch(/Chưa chọn/);
  });
});
