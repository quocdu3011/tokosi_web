/** Giới hạn tải ảnh hàng hóa (docs/api/endpoints.md mục 2.2); server kiểm tra lại theo nội dung file. */
export const MAX_IMAGES_PER_PRODUCT = 10;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function validateImageFiles(
  existingCount: number,
  files: { name: string; size: number; type: string }[],
): string | null {
  if (files.length === 0) return 'Chưa chọn ảnh';
  if (existingCount + files.length > MAX_IMAGES_PER_PRODUCT) {
    return `Mỗi hàng tối đa ${MAX_IMAGES_PER_PRODUCT} ảnh (đang có ${existingCount})`;
  }
  for (const f of files) {
    if (!(IMAGE_TYPES as readonly string[]).includes(f.type)) {
      return `${f.name}: chỉ nhận ảnh JPEG, PNG hoặc WebP`;
    }
    if (f.size > MAX_IMAGE_BYTES) return `${f.name}: ảnh lớn hơn 5 MB`;
  }
  return null;
}
