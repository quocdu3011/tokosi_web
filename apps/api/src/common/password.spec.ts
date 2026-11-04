import {
  MIN_PASSWORD_LENGTH,
  generatePassword,
  hashPassword,
  verifyPassword,
} from './password.js';

describe('password', () => {
  it('băm bằng argon2id và so khớp đúng/sai', async () => {
    const h = await hashPassword('mat-khau-thu-nghiem');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(h).not.toContain('mat-khau-thu-nghiem');
    expect(await verifyPassword(h, 'mat-khau-thu-nghiem')).toBe(true);
    expect(await verifyPassword(h, 'mat-khau-sai')).toBe(false);
  });

  it('cùng mật khẩu cho hai bản băm khác nhau (có muối)', async () => {
    expect(await hashPassword('abc12345678')).not.toBe(
      await hashPassword('abc12345678'),
    );
  });

  it('bản băm hỏng thì trả false, không ném lỗi', async () => {
    expect(await verifyPassword('khong-phai-ban-bam', 'x')).toBe(false);
    expect(await verifyPassword('', 'x')).toBe(false);
  });

  it('mật khẩu sinh ra đủ dài, khác nhau mỗi lần', () => {
    const a = generatePassword();
    expect(a.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(generatePassword()).not.toBe(a);
  });
});
