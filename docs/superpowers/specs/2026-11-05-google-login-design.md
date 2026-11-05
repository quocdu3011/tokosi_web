# Đăng nhập Google + màn chờ cấp quyền + cài đặt tự đăng ký (C+D) — thiết kế và kế hoạch

Ngày: 2026-11-05 · Phạm vi: `apps/web`. API đã có: `POST /auth/google`, `POST /auth/google/signup`, `GET/PATCH /settings/auth`, vai trò `pending` (docs/api/endpoints.md mục 1).

## Quyết định

- **Dùng `@supabase/supabase-js`** (không tự dựng PKCE vì tài liệu Supabase không công bố ổn định endpoint thô). Cấu hình: `flowType: 'pkce'`, `detectSessionInUrl: false`, `autoRefreshToken: false`, lưu verifier/phiên trong **`sessionStorage`**. Ngay sau khi lấy được `access_token` thì gọi `signOut({ scope: 'local' })` và xóa khóa Supabase trong `sessionStorage`: phiên Supabase không dùng nữa, phiên của hệ thống là access token trong bộ nhớ + cookie refresh do API cấp.
- **Cấu hình bằng biến môi trường công khai** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (khóa `anon` là khóa công khai). Thiếu một trong hai thì **ẩn nút Google**; đăng nhập tên + mật khẩu vẫn chạy. Ghi vào `apps/web/.env.example`.
- **Luồng:** `/login` → nút "Đăng nhập bằng Google" (lưu `next` vào `sessionStorage`) → `signInWithOAuth({ provider: 'google', redirectTo: <origin>/auth/callback })` → trang `/auth/callback` đổi `?code` lấy phiên (đúng một lần, chống chạy đôi của React Strict Mode) → `POST /auth/google { accessToken }`:
  - `200` → như đăng nhập thường (`mustChangePassword` → `/change-password`; `pending` → màn chờ cấp quyền).
  - `202 signup_required` → form hoàn tất đăng ký (họ tên điền sẵn `suggestedName`, email chỉ đọc, tên đăng nhập, mật khẩu, SĐT) → `POST /auth/google/signup`.
  - `403 SIGNUP_DISABLED`, `401`, `503 GOOGLE_NOT_CONFIGURED`, lỗi `?error_description=` từ Supabase → thông báo tiếng Việt kèm nút "Về trang đăng nhập".
  - Lỗi của form đăng ký gắn vào ô theo `details[].field`; `DUPLICATE_USERNAME` vào ô tên đăng nhập; `SIGNUP_TOKEN_INVALID` (token 15 phút hết hạn) → về `/login` kèm thông báo "Phiên đăng ký hết hạn, hãy đăng nhập Google lại"; `GOOGLE_ALREADY_REGISTERED`, `SIGNUP_LIMIT` → thông báo.
- **Vai trò `pending`:** AuthGate hiện màn "Tài khoản đang chờ Quản lý cấp quyền" (nút "Kiểm tra lại" gọi `reloadMe`, nút "Đăng xuất"); không dựng menu và không gọi API nghiệp vụ.
- **`/settings/auth`** (quyền `user.manage`, mục menu "Đăng nhập Google" trong nhóm Hệ thống): công tắc bật/tắt tự đăng ký và danh sách tên miền email (mỗi dòng một tên miền). Bật mà không có tên miền → báo lỗi ở form (API cũng trả 400). Tên miền chuẩn hóa chữ thường, kiểm tra dạng `a.b`.
- **Màn Người dùng:** bộ lọc vai trò thêm "Chờ cấp quyền" (`role=pending`); `RoleBadge` hiện nhãn "Chờ cấp quyền". Không gán được `pending` khi tạo/sửa (đã đúng vì chọn vai trò dùng `ROLES`).
- Mật khẩu/token không bao giờ ghi vào log hay URL; `signupToken` chỉ giữ trong state của trang callback.

## Thành phần

- `lib/google-auth.ts` (thuần, có test): `parseSignupDomains(text) → { domains, invalid }`, `domainsProblem(enabled, domains)`, `signupFieldProblems` (tên đăng nhập, mật khẩu theo `passwordProblem`, SĐT) dùng lại quy tắc của form người dùng.
- `lib/auth/supabase.ts` (client): `isGoogleConfigured()`, `startGoogleLogin(next)`, `finishGoogleLogin(code) → accessToken`.
- `lib/auth/google-session.ts`: `googleLogin(accessToken)`, `googleSignup(input)`, áp dụng phiên như `login`.
- `lib/queries/auth-settings.ts`: `useAuthSettings`, `useUpdateAuthSettings`.
- UI: `login-form.tsx` (nút Google), `app/(auth)/auth/callback/{page,callback-screen,signup-form}.tsx`, `components/common/pending-screen.tsx` + `auth-gate.tsx`, `app/(app)/settings/auth/{page,auth-settings-screen}.tsx`, `lib/navigation.ts`, `users-screen.tsx`, `role-badge.tsx`.

## Kiểm thử

Vitest cho `lib/google-auth.ts` và logic chọn nhánh phản hồi `/auth/google`; typecheck, lint, test, build. Chạy thử trình duyệt với API giả (nhánh 200, 202, 403, `pending`, `/settings/auth`). **Không thử được với Supabase/Google thật** (cần cấu hình dự án Supabase của công ty) — ghi rõ khi báo cáo.

## Ngoài phạm vi

Quên mật khẩu, đăng nhập Google cho tài khoản chưa đăng ký khi tắt tự đăng ký (chỉ hiện thông báo), liên kết thêm Google vào tài khoản có sẵn (API chưa có).
