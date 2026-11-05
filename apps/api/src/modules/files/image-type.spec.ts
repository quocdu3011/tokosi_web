import { describe, expect, it } from 'vitest';
import { detectImage } from './image-type.js';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
const jpg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(16),
]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(8),
]);

describe('detectImage', () => {
  it('nhận JPEG, PNG, WebP theo chữ ký byte', () => {
    expect(detectImage(jpg)).toEqual({
      contentType: 'image/jpeg',
      extension: 'jpg',
    });
    expect(detectImage(png)).toEqual({
      contentType: 'image/png',
      extension: 'png',
    });
    expect(detectImage(webp)).toEqual({
      contentType: 'image/webp',
      extension: 'webp',
    });
  });
  it('từ chối file giả dạng ảnh: HTML, SVG, exe, GIF, rỗng, quá ngắn, RIFF không phải WebP', () => {
    for (const bad of [
      Buffer.from('<html><script>alert(1)</script></html>'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      Buffer.from('MZ\x90\x00\x03'),
      Buffer.from('GIF89a'),
      Buffer.alloc(0),
      Buffer.from([0xff, 0xd8]),
      Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.alloc(4),
        Buffer.from('WAVE'),
        Buffer.alloc(8),
      ]),
    ]) {
      expect(detectImage(bad)).toBeNull();
    }
  });
});
