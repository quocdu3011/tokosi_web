import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Đăng nhập Google qua Supabase (PKCE). Supabase chỉ chứng minh danh tính: sau khi lấy được
 * `access_token` của Supabase ta gửi cho API (`POST /auth/google`), phiên của hệ thống do API cấp
 * (access token trong bộ nhớ + cookie refresh). Phiên Supabase bị xóa ngay, không giữ lại.
 *
 * Verifier PKCE phải sống qua lần chuyển trang sang Google rồi quay lại, nên lưu trong
 * `sessionStorage` (chỉ trong tab này, mất khi đóng tab).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const STORAGE_KEY = 'tks-google-oauth';
const NEXT_KEY = 'tks.googleNext';

/** Thiếu cấu hình thì ẩn nút Google; đăng nhập bằng tên + mật khẩu vẫn dùng bình thường. */
export function isGoogleConfigured(): boolean {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Chưa cấu hình đăng nhập Google.');
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: window.sessionStorage,
      storageKey: STORAGE_KEY,
    },
  });
  return client;
}

/** Chuyển sang Google. `next` là trang muốn về sau khi đăng nhập xong (đường dẫn nội bộ). */
export async function startGoogleLogin(next: string): Promise<void> {
  try {
    window.sessionStorage.setItem(NEXT_KEY, next);
  } catch {
    // Trình duyệt chặn lưu trữ: sau khi đăng nhập sẽ về trang chủ.
  }
  const { error } = await getClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) throw error;
}

/** Trang muốn về sau khi đăng nhập; đọc một lần rồi xóa. */
export function takeGoogleNext(): string | null {
  try {
    const next = window.sessionStorage.getItem(NEXT_KEY);
    window.sessionStorage.removeItem(NEXT_KEY);
    return next;
  } catch {
    return null;
  }
}

/** Đổi `code` (dùng được đúng một lần) lấy `access_token` Supabase rồi xóa phiên Supabase. */
export async function finishGoogleLogin(code: string): Promise<string> {
  const supabase = getClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    throw new Error(error?.message ?? 'Không lấy được phiên đăng nhập từ Google.');
  }
  const token = data.session.access_token;
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Không quan trọng: chỉ để dọn phiên Supabase.
  }
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(STORAGE_KEY)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // bỏ qua
  }
  return token;
}
