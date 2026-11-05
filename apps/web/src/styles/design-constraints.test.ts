import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Khóa các ràng buộc của design system TKS Dashboard (MASTER.md mục 7.1, 4.2, 10):
 * không biến đổi 3D, không `transition: all`, không `background-attachment: fixed`,
 * `backdrop-filter` chỉ ở header/thẻ xác thực (không phải overlay toàn màn hình), chữ ≥ 12px,
 * không màu thô, không emoji làm icon, không còn Tailwind.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e)) && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const cssFiles = walk(SRC, ['.css']);
const tsxFiles = walk(SRC, ['.tsx', '.ts']);
const read = (f: string) => readFileSync(f, 'utf8');
// Bỏ chú thích để lời giải thích trong CSS không làm test báo nhầm.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

describe('design system – CSS', () => {
  it('có file CSS để quét', () => {
    expect(cssFiles.length).toBeGreaterThan(5);
  });

  it.each([
    ['transform-style: preserve-3d', /preserve-3d/],
    ['perspective', /perspective/],
    ['biến đổi 3D', /translateZ|rotateX|rotateY|translate3d/],
    ['background-attachment: fixed', /background-attachment\s*:\s*fixed/],
    ['transition: all', /transition\s*:\s*all\b/],
  ])('không dùng %s', (_name, pattern) => {
    const offenders = cssFiles.filter((f) => pattern.test(stripComments(read(f))));
    expect(offenders).toEqual([]);
  });

  it('backdrop-filter chỉ ở header và thẻ xác thực, không ở overlay toàn màn hình', () => {
    const allowed = new Set(['.app-header', '.auth-card']);
    const bad: string[] = [];
    for (const f of cssFiles) {
      for (const block of stripComments(read(f)).split('}')) {
        if (!/backdrop-filter/.test(block)) continue;
        const selector = block.split('{')[0]!.trim();
        if (!allowed.has(selector)) bad.push(`${f}: ${selector}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('không cỡ chữ dưới 12px', () => {
    const bad: string[] = [];
    for (const f of cssFiles) {
      for (const m of stripComments(read(f)).matchAll(/font-size\s*:\s*([\d.]+)px/g)) {
        if (Number(m[1]) < 12) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('không dùng màu thô #ff0000 / #00ff00 / #0000ff', () => {
    const offenders = [...cssFiles, ...tsxFiles].filter((f) =>
      /#(ff0000|00ff00|0000ff)\b/i.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('mọi cặp token sáng/tối đều có ở cả hai theme', () => {
    const tokens = read(join(SRC, 'styles/tokens.css'));
    const dark = tokens.slice(0, tokens.indexOf(":root[data-theme='light']"));
    const light = tokens.slice(tokens.indexOf(":root[data-theme='light']"));
    const names = (s: string) => new Set([...s.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const required = [
      '--bg',
      '--panel',
      '--panel-2',
      '--panel-3',
      '--border',
      '--primary',
      '--text',
      '--text-secondary',
      '--muted',
      '--amber',
      '--green',
      '--red',
      '--overlay-bg',
      '--alert-error-bg',
      '--toast-success-bg',
      '--bg-image',
    ];
    for (const t of required) {
      expect(names(dark).has(t), `dark thiếu ${t}`).toBe(true);
      expect(names(light).has(t), `light thiếu ${t}`).toBe(true);
    }
  });
});

describe('design system – mã nguồn', () => {
  it('không còn tham chiếu Tailwind', () => {
    const offenders = [...cssFiles, ...tsxFiles].filter((f) =>
      /tailwind|@apply|tw-animate/i.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('không dùng emoji làm icon (dùng SVG Lucide)', () => {
    const offenders = tsxFiles.filter((f) => /\p{Extended_Pictographic}/u.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
