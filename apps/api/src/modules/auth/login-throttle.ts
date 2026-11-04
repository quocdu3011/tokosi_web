import { AppError } from '../../common/app-error.js';

/**
 * Giới hạn đăng nhập sai (chống dò mật khẩu): quá `maxFailures` lần sai trong `windowMs` thì chặn tạm
 * cho tới khi lần sai cũ nhất rơi khỏi cửa sổ. Khóa theo "địa chỉ IP + tên đăng nhập" để kẻ lạ không
 * khóa được tài khoản của người khác từ IP khác.
 *
 * Lưu trong bộ nhớ của tiến trình (mất khi khởi động lại, không chia sẻ giữa nhiều bản API). Đủ cho một
 * bản triển khai duy nhất; nếu chạy nhiều bản thì chuyển sang CSDL/Redis.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Ném 429 `RATE_LIMITED` nếu khóa này đang bị chặn. */
  assertAllowed(key: string): void {
    const recent = this.prune(key);
    if (recent.length >= this.maxFailures) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(((recent[0] as number) + this.windowMs - this.now()) / 1000),
      );
      throw new AppError(
        429,
        'RATE_LIMITED',
        `Đăng nhập sai quá nhiều lần. Thử lại sau ${Math.ceil(retryAfterSeconds / 60)} phút.`,
        { retryAfterSeconds },
      );
    }
  }

  recordFailure(key: string): void {
    const recent = this.prune(key);
    recent.push(this.now());
    this.failures.set(key, recent);
    if (this.failures.size > 10_000) this.sweep();
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private prune(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length === 0) this.failures.delete(key);
    else this.failures.set(key, recent);
    return recent;
  }

  private sweep(): void {
    // Xóa/ghi lại khóa đang duyệt trong Map là an toàn trong JavaScript
    for (const key of this.failures.keys()) this.prune(key);
  }
}
