import { LoginThrottle } from './login-throttle.js';

describe('LoginThrottle', () => {
  const makeClock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it('cho phép tới số lần sai tối đa rồi chặn bằng 429 RATE_LIMITED', () => {
    const clock = makeClock();
    const throttle = new LoginThrottle(3, 60_000, clock.now);
    for (let i = 0; i < 3; i++) {
      throttle.assertAllowed('k');
      throttle.recordFailure('k');
    }
    expect(() => throttle.assertAllowed('k')).toThrowError(
      expect.objectContaining({ status: 429, code: 'RATE_LIMITED' }),
    );
  });

  it('báo đúng thời gian chờ còn lại', () => {
    const clock = makeClock();
    const throttle = new LoginThrottle(2, 60_000, clock.now);
    throttle.recordFailure('k');
    clock.advance(10_000);
    throttle.recordFailure('k');
    try {
      throttle.assertAllowed('k');
      throw new Error('phải bị chặn');
    } catch (e) {
      expect(
        (e as { response: { details: { retryAfterSeconds: number } } }).response
          .details.retryAfterSeconds,
      ).toBe(50);
    }
  });

  it('hết cửa sổ thời gian thì được thử lại', () => {
    const clock = makeClock();
    const throttle = new LoginThrottle(2, 60_000, clock.now);
    throttle.recordFailure('k');
    throttle.recordFailure('k');
    expect(() => throttle.assertAllowed('k')).toThrow();
    clock.advance(60_001);
    expect(() => throttle.assertAllowed('k')).not.toThrow();
  });

  it('đăng nhập đúng thì xóa bộ đếm', () => {
    const throttle = new LoginThrottle(2, 60_000);
    throttle.recordFailure('k');
    throttle.reset('k');
    throttle.recordFailure('k');
    expect(() => throttle.assertAllowed('k')).not.toThrow();
  });

  it('mỗi khóa tính riêng: sai ở IP/tài khoản này không khóa IP/tài khoản khác', () => {
    const throttle = new LoginThrottle(1, 60_000);
    throttle.recordFailure('1.1.1.1|quanly');
    expect(() => throttle.assertAllowed('1.1.1.1|quanly')).toThrow();
    expect(() => throttle.assertAllowed('2.2.2.2|quanly')).not.toThrow();
    expect(() => throttle.assertAllowed('1.1.1.1|khac')).not.toThrow();
  });
});
