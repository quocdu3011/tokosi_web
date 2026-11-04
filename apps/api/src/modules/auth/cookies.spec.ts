import { readCookie } from './cookies.js';

describe('readCookie', () => {
  it('đọc đúng cookie trong nhiều cookie', () => {
    expect(
      readCookie('a=1; refresh_token=abc_DEF-123; b=2', 'refresh_token'),
    ).toBe('abc_DEF-123');
    expect(readCookie('refresh_token=x', 'refresh_token')).toBe('x');
  });

  it('không có cookie → chuỗi rỗng', () => {
    expect(readCookie(undefined, 'refresh_token')).toBe('');
    expect(readCookie('', 'refresh_token')).toBe('');
    expect(readCookie('a=1; b=2', 'refresh_token')).toBe('');
  });

  it('không nhầm tên cookie có chung phần đầu hoặc cuối', () => {
    expect(
      readCookie(
        'x_refresh_token=bad; refresh_token_old=bad2',
        'refresh_token',
      ),
    ).toBe('');
  });

  it('giải mã URL và chịu được giá trị hỏng', () => {
    expect(readCookie('refresh_token=a%20b', 'refresh_token')).toBe('a b');
    expect(readCookie('refresh_token=%E0%A4%A', 'refresh_token')).toBe('');
  });
});
