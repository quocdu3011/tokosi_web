/**
 * Nếu là lỗi trùng khóa duy nhất của PostgreSQL (mã 23505), trả về tên ràng buộc bị vi phạm (có thể không có
 * tên với một số driver). Driver có thể bọc lỗi gốc trong `cause`.
 */
export function uniqueViolation(e: unknown): { constraint?: string } | null {
  for (const x of [e, (e as { cause?: unknown } | null)?.cause]) {
    if (typeof x !== 'object' || x === null) continue;
    const { code, constraint } = x as { code?: unknown; constraint?: unknown };
    if (code === '23505') {
      return typeof constraint === 'string' ? { constraint } : {};
    }
  }
  return null;
}
