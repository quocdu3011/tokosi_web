import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Khóa quy ước trang danh sách (docs/design-system/list-page.md): màn hình không tự viết cỡ trang cứng,
 * không dùng hook cột cũ, không dựng badge bằng <span class="badge">, bảng danh sách phải có `prefs`.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
const norm = (f: string) => f.split(String.fromCharCode(92)).join('/');
const read = (f: string) => readFileSync(f, 'utf8');

/** Danh sách chọn nằm trong dropdown (ngoại lệ có chủ đích: giữ limit cố định). */
const LIMIT_EXCEPTIONS = ['supplier-picker', 'reference-picker', 'purchase-lines'];

describe('quy ước trang danh sách', () => {
  it('không còn hook lưu cột cũ', () => {
    const bad = files.filter((f) => /use-column-(visibility|widths)/.test(read(f)));
    expect(bad.map(norm)).toEqual([]);
  });

  it('không hard-code PAGE_SIZE / limit: 20 ngoài các picker', () => {
    const bad = files.filter((f) => {
      if (LIMIT_EXCEPTIONS.some((e) => f.includes(e))) return false;
      if (f.includes(join('lib', 'api'))) return false;
      return /\bPAGE_SIZE\s*=|limit:\s*\d+/.test(read(f));
    });
    expect(bad.map(norm)).toEqual([]);
  });

  it('không dựng badge thô bằng <span className="badge …">', () => {
    const bad = files.filter(
      (f) =>
        !f.endsWith(join('ui', 'badge.tsx')) &&
        /<span[^>]*className=["'`{][^>]*(?<![-\w])badge(?![-\w])/.test(read(f)),
    );
    expect(bad.map(norm)).toEqual([]);
  });

  it('mọi <DataTable ở màn hình có phân trang đều truyền prefs', () => {
    const screens = files.filter((f) => /-screen\.tsx$/.test(f));
    const bad = screens.filter((f) => {
      const src = read(f);
      return /<DataTable\b/.test(src) && /<Pagination\b/.test(src) && !/prefs=\{/.test(src);
    });
    expect(bad.map(norm)).toEqual([]);
  });
});
