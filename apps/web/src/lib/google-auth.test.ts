import { describe, expect, it } from 'vitest';

import type { GoogleSignupRequired, SessionResponse } from '@/lib/api/types';

import {
  domainsProblem,
  googleErrorMessage,
  isSignupRequired,
  parseSignupDomains,
} from './google-auth';

describe('isSignupRequired', () => {
  it('202 có signupToken là cần đăng ký; 200 có accessToken thì không', () => {
    const need: GoogleSignupRequired = {
      status: 'signup_required',
      signupToken: 't',
      email: 'a@b.vn',
      suggestedName: 'A',
    };
    const session = { accessToken: 'x', expiresIn: 900, user: {} } as unknown as SessionResponse;
    expect(isSignupRequired(need)).toBe(true);
    expect(isSignupRequired(session)).toBe(false);
  });
});

describe('parseSignupDomains', () => {
  it('chuẩn hóa chữ thường, bỏ @, bỏ trùng, tách theo dòng/dấu phẩy/dấu cách', () => {
    expect(parseSignupDomains('CongTy.vn\n@congty.vn, abc.com.vn ; abc.com.vn').domains).toEqual([
      'congty.vn',
      'abc.com.vn',
    ]);
  });
  it('tách các mục sai dạng', () => {
    const r = parseSignupDomains('congty.vn\nlocalhost\n-x.com\na b');
    expect(r.domains).toEqual(['congty.vn']);
    expect(r.invalid).toEqual(['localhost', '-x.com', 'a', 'b']);
  });
  it('rỗng', () => {
    expect(parseSignupDomains('  \n ')).toEqual({ domains: [], invalid: [] });
  });
});

describe('domainsProblem', () => {
  it('bật mà không có tên miền là lỗi; tắt thì được rỗng', () => {
    expect(domainsProblem(true, { domains: [], invalid: [] })).toMatch(/ít nhất/);
    expect(domainsProblem(false, { domains: [], invalid: [] })).toBeNull();
    expect(domainsProblem(true, { domains: ['a.vn'], invalid: [] })).toBeNull();
  });
  it('tên miền sai dạng là lỗi, liệt kê mục sai', () => {
    expect(domainsProblem(false, { domains: [], invalid: ['x'] })).toMatch(/x/);
  });
});

describe('googleErrorMessage', () => {
  it('có thông báo riêng cho mã đã biết, giữ thông báo gốc cho mã lạ', () => {
    expect(googleErrorMessage('SIGNUP_DISABLED', 'g')).toMatch(/Quản lý/);
    expect(googleErrorMessage('SIGNUP_TOKEN_INVALID', 'g')).toMatch(/hết hạn/);
    expect(googleErrorMessage('LA', 'goc')).toBe('goc');
    expect(googleErrorMessage(undefined, 'goc')).toBe('goc');
  });
});
