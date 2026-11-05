import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Test hiện chỉ kiểm tra logic thuần (gọi API, quyền, định dạng) nên chạy trong môi trường Node.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
