# Danh sách endpoint

> Bản thảo hợp đồng — xem quy ước chung (xác thực, tiền là chuỗi, phân trang, lỗi, idempotency) tại [`README.md`](README.md). Tất cả đường dẫn dưới đây có tiền tố `/api/v1`.
> Cột **Mốc** = tuần backend dự kiến xong (W1 = tuần bắt đầu 09/11/2026, theo mục 13 tài liệu thiết kế). Cột **Quyền** là quyền tối thiểu để gọi.

## Mục lục

1. [Hệ thống & xác thực](#1-hệ-thống--xác-thực)
2. [Hàng hóa](#2-hàng-hóa)
3. [Mua hàng](#3-mua-hàng)
4. [Khách hàng](#4-khách-hàng)
5. [Đơn hàng](#5-đơn-hàng)
6. [Sổ quỹ](#6-sổ-quỹ)
7. [Tổng quan](#7-tổng-quan)
8. [Báo cáo](#8-báo-cáo)
9. [Nhập dữ liệu từ Excel](#9-nhập-dữ-liệu-từ-excel)

Ký hiệu: `?` = tùy chọn · `[]` = mảng · tiền/giá/số lượng là **chuỗi** (xem README mục 3).

---

## 1. Hệ thống & xác thực

> **Trạng thái: đã triển khai** (có trong Swagger `/api/docs` và `openapi.json`) — `/health`, `/auth/*`, `/branches`, `/users…`, `/roles…`, `/permissions/catalog`.

| Method | Đường dẫn                   | Mô tả                                                                            | Quyền                         | Mốc |
| ------ | --------------------------- | -------------------------------------------------------------------------------- | ----------------------------- | --- |
| GET    | `/health`                   | Kiểm tra sống                                                                    | công khai                     | ✔   |
| POST   | `/auth/login`               | Đăng nhập                                                                        | công khai                     | ✔   |
| POST   | `/auth/refresh`             | Lấy access token mới (dùng cookie `refresh_token`)                               | công khai (cần cookie)        | ✔   |
| POST   | `/auth/logout`              | Đăng xuất: thu hồi phiên hiện tại, xóa cookie                                    | công khai (dùng cookie)       | ✔   |
| GET    | `/auth/me`                  | Thông tin người dùng + quyền + chi nhánh hiện tại                                | đã đăng nhập                  | ✔   |
| POST   | `/auth/change-password`     | Đổi mật khẩu (thu hồi mọi phiên cũ, cấp phiên mới)                               | đã đăng nhập                  | ✔   |
| POST   | `/auth/google`              | Đăng nhập bằng Google (token Supabase): 200 phiên, hoặc 202 cần hoàn tất đăng ký | công khai                     | ✔   |
| POST   | `/auth/google/signup`       | Hoàn tất tự đăng ký từ Google (tên đăng nhập, mật khẩu, họ tên, SĐT)             | công khai (cần `signupToken`) | ✔   |
| GET    | `/settings/auth`            | Cài đặt tự đăng ký bằng Google                                                   | `user.manage`                 | ✔   |
| PATCH  | `/settings/auth`            | Bật/tắt tự đăng ký, đặt tên miền email được phép                                 | `user.manage`                 | ✔   |
| GET    | `/branches`                 | Chi nhánh người dùng được phép làm việc (Quản lý: tất cả)                        | đã đăng nhập                  | ✔   |
| GET    | `/users`                    | Danh sách người dùng (`q`, `role`, `isActive`, `page`, `limit`)                  | `user.manage`                 | ✔   |
| GET    | `/users/:id`                | Chi tiết một người dùng                                                          | `user.manage`                 | ✔   |
| POST   | `/users`                    | Tạo người dùng                                                                   | `user.manage`                 | ✔   |
| PATCH  | `/users/:id`                | Sửa thông tin / vai trò / khóa-mở tài khoản                                      | `user.manage`                 | ✔   |
| POST   | `/users/:id/reset-password` | Đặt lại mật khẩu (bắt đổi ở lần đăng nhập kế tiếp)                               | `user.manage`                 | ✔   |
| PUT    | `/users/:id/branches`       | Gán chi nhánh `{ branchIds, defaultBranchId? }` (thay thế toàn bộ)               | `user.manage`                 | ✔   |
| GET    | `/me/table-prefs`           | Tùy chỉnh bảng (cột ẩn, thứ tự, độ rộng, số dòng/trang) của chính người dùng      | đã đăng nhập                  | ✔   |
| PUT    | `/me/table-prefs/:tableKey` | Lưu tùy chỉnh một bảng (thay thế toàn bộ bản ghi của bảng đó)                    | đã đăng nhập                  | ✔   |
| DELETE | `/me/table-prefs/:tableKey` | Xóa tùy chỉnh một bảng (về mặc định)                                             | đã đăng nhập                  | ✔   |

**Tùy chỉnh bảng theo tài khoản — `/me/table-prefs`**

Chỉ tác động lên **chính người dùng đăng nhập** (không nhận `userId`); không cần quyền nghiệp vụ (mọi vai trò, kể cả `pending`, dùng được), không ghi nhật ký thao tác (chỉ là tùy chọn giao diện). Người dùng đang bị bắt đổi mật khẩu vẫn nhận `403 PASSWORD_CHANGE_REQUIRED` như mọi endpoint khác (trừ `/auth/me`, `/auth/change-password`). `tableKey` khớp `^[a-z0-9][a-z0-9:_-]{0,63}$` (vd. `products`, `purchase-orders`), sai → `400 VALIDATION_ERROR`.

```jsonc
// GET /me/table-prefs → 200  (bảng chưa lưu thì không có khóa)
{ "data": { "products": { "hidden": ["description"], "order": ["code","name","onHand"], "widths": { "name": 360 }, "pageSize": 50 } } }

// PUT /me/table-prefs/products  — thay thế toàn bộ; mọi trường tùy chọn; trường lạ → 400
{ "hidden": ["description"], "order": ["code","name","onHand"], "widths": { "name": 360 }, "pageSize": 50 }
// 200 → trả lại đối tượng đã lưu (cùng dạng body)

// DELETE /me/table-prefs/products → 204 (không có bản ghi cũng 204)
```

Giới hạn: `hidden`/`order` tối đa 100 phần tử, mỗi id 1–64 ký tự; `widths` tối đa 100 khóa (id 1–64 ký tự), giá trị là số nguyên 40..1000; trường có mặt thì không được `null` (muốn bỏ trường thì không gửi); `pageSize` ∈ `{15, 50, 100}` (`PAGE_SIZE_OPTIONS` trong `@kiot/shared`). Danh sách phân trang (`?limit=`) vẫn nhận 1..100 như cũ.

**POST `/auth/login`**

```jsonc
// request  (tên đăng nhập không phân biệt hoa thường; khoảng trắng hai đầu được bỏ)
{ "username": "ketoan01", "password": "••••••••" }

// 200 response  — kèm  Set-Cookie: refresh_token=…; HttpOnly; SameSite=Lax; Path=/api/v1/auth; Expires=…
{
  "accessToken": "eyJhbGciOi…",            // JWT, gửi trong header  Authorization: Bearer …
  "expiresIn": 900,                        // giây (15 phút)
  "user": {
    "id": "0192…", "code": "NV0001", "username": "ketoan01", "fullName": "Nguyễn Văn A",
    "role": "accountant",
    "mustChangePassword": false,           // true → chỉ gọi được /auth/me, /auth/change-password, /auth/logout
    "permissions": [                       // theo cấu hình hiện tại của vai trò (Quản lý chỉnh được)
      { "code": "invoice.view",   "scope": "own" },   // "own" = chỉ dữ liệu của mình
      { "code": "invoice.create", "scope": "own" },
      { "code": "product.view",   "scope": "all" }
    ],
    "defaultBranchId": "0192…",            // null nếu chưa có chi nhánh mặc định → người dùng phải chọn
    "branches": [                          // chi nhánh người dùng được làm việc (Quản lý: tất cả)
      { "id": "0192…", "code": "SG", "name": "Chi nhánh Sài Gòn" },
      { "id": "0193…", "code": "HN", "name": "Chi nhánh Hà Nội" }
    ]
  }
}
```

| HTTP | `code`             | Khi nào                                                                                                    |
| ---- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| 401  | `UNAUTHENTICATED`  | Sai tên đăng nhập, sai mật khẩu hoặc tài khoản bị khóa — **luôn cùng một thông báo**, không nói rõ cái nào |
| 429  | `RATE_LIMITED`     | Sai quá 5 lần trong 15 phút (theo IP + tên đăng nhập); `details.retryAfterSeconds` = số giây phải chờ      |
| 400  | `VALIDATION_ERROR` | Thiếu `username` / `password` hoặc sai kiểu                                                                |

**POST `/auth/refresh`** — không có body; trình duyệt tự gửi cookie (frontend gọi với `credentials: 'include'`).

```jsonc
// 200  — kèm Set-Cookie: refresh_token=… (cookie MỚI; cái cũ đã bị thu hồi)
{ "accessToken": "eyJhbGciOi…", "expiresIn": 900 }
// 401 UNAUTHENTICATED: thiếu cookie / hết hạn / đã thu hồi / tài khoản bị khóa → về trang đăng nhập (cookie bị xóa)
```

- **Xoay vòng:** mỗi lần làm mới sinh refresh token mới. **Không gọi refresh song song** từ nhiều tab/nơi cùng lúc; hãy gom thành một lời gọi duy nhất (dùng chung một Promise) rồi thử lại các yêu cầu đang chờ.
- Dùng lại một refresh token đã bị thu hồi từ lâu (dấu hiệu bị đánh cắp) → **mọi phiên của người dùng đó bị đăng xuất**.

**POST `/auth/logout`** → `204`. Thu hồi phiên hiện tại và xóa cookie; gọi lặp lại hoặc khi không có cookie vẫn trả `204`. Access token đang cầm vẫn còn hiệu lực tới khi hết hạn (tối đa 15 phút) nên frontend phải **xóa nó khỏi bộ nhớ**.

**GET `/auth/me`** → đối tượng `user` như trên (quyền và chi nhánh luôn là giá trị **hiện tại**). Gọi lại khi tải trang, khi nhận `403 FORBIDDEN`, hoặc sau khi Quản lý đổi phân quyền.

**POST `/auth/change-password`**

```jsonc
// request
{ "currentPassword": "••••••••", "newPassword": "••••••••••••" }

// 200 — cùng cấu trúc như login (access token MỚI + cookie MỚI); mustChangePassword = false
{ "accessToken": "…", "expiresIn": 900, "user": { /* như trên */ } }
```

- Mật khẩu mới: **10–128 ký tự**, khác mật khẩu hiện tại, **không chứa tên đăng nhập**. Sai → `400 VALIDATION_ERROR` kèm `details: [{ field, message }]` để gắn vào từng ô.
- Mật khẩu hiện tại sai → `400 VALIDATION_ERROR`, `details[0].field = "currentPassword"`.
- Thu hồi **mọi phiên cũ ở mọi thiết bị**; thiết bị đang đổi mật khẩu nhận phiên mới ngay.

**Tài khoản bị bắt đổi mật khẩu (`mustChangePassword = true`)** — gặp ở tài khoản Quản lý khởi tạo và tài khoản vừa được đặt lại mật khẩu. Mọi endpoint khác ngoài `/auth/me`, `/auth/change-password`, `/auth/logout` trả `403 PASSWORD_CHANGE_REQUIRED`. Frontend: sau khi đăng nhập, nếu `user.mustChangePassword` là true thì chuyển thẳng sang màn hình đổi mật khẩu.

**Đăng nhập bằng Google (Supabase)**

Luồng: web gọi `supabase.auth.signInWithOAuth({ provider: 'google' })` (PKCE) → lấy `session.access_token` của Supabase → gửi cho API. Google/Supabase chỉ chứng minh danh tính; **vai trò và quyền vẫn do hệ thống quyết định**.

**POST `/auth/google`** body `{ "accessToken": "<token Supabase>" }`

- Đã có tài khoản gắn với Google này → `200` giống `/auth/login` (`accessToken`, `expiresIn`, `user`; cookie refresh). Tài khoản bị khóa → `401 UNAUTHENTICATED`.
- Chưa có tài khoản: nếu Quản lý đang **bật** tự đăng ký và tên miền email nằm trong danh sách → `202 { "status": "signup_required", "signupToken": "…", "email": "…", "suggestedName": "…" }`. **Chưa tạo gì.** Frontend hiện form hồ sơ (điền sẵn `suggestedName`).
- Ngược lại (tắt, hoặc tên miền không được phép) → `403 SIGNUP_DISABLED` ("liên hệ Quản lý").
- Token Supabase sai/hết hạn/không phải Google/email chưa xác minh → `401 UNAUTHENTICATED`. Chưa cấu hình `SUPABASE_URL` → `503 GOOGLE_NOT_CONFIGURED`.

**POST `/auth/google/signup`** body `{ signupToken, username, password, fullName, phone }`

- `signupToken` sống **15 phút**, chỉ dùng cho endpoint này (không phải access token). Hết hạn/sai → `401 SIGNUP_TOKEN_INVALID` → cho người dùng đăng nhập Google lại.
- Quy tắc như tạo người dùng: tên đăng nhập `[a-z0-9._-]{3,32}`; mật khẩu 10–128 ký tự, không chứa tên đăng nhập; SĐT Việt Nam hợp lệ. Sai → `400 VALIDATION_ERROR` (`details[].field`), token **vẫn dùng lại được**.
- Thành công → `201` + phiên đăng nhập như `/auth/login`. Tài khoản mới có **`role: "pending"`**, `permissions: []`, `branches: []`.
- Lỗi: `409 DUPLICATE_USERNAME`, `409 GOOGLE_ALREADY_REGISTERED` (Google này đã đăng ký, hãy đăng nhập), `403 SIGNUP_DISABLED` (công tắc vừa bị tắt), `429 SIGNUP_LIMIT` (đang có quá nhiều tài khoản chờ cấp quyền, tối đa 50).
- Tài khoản này vẫn đăng nhập bằng tên đăng nhập + mật khẩu được.

**Vai trò `pending` ("Chờ cấp quyền")**: không có quyền nào; mọi endpoint nghiệp vụ trả `403 FORBIDDEN`; chỉ dùng được `/auth/me`, `/auth/change-password`, `/auth/logout`. Frontend: nếu `user.role === "pending"` thì chỉ hiện màn "Tài khoản đang chờ Quản lý cấp quyền". Quản lý gán chi nhánh (`PUT /users/:id/branches`) rồi đổi vai trò (`PATCH /users/:id`) — có hiệu lực ngay. `GET /users?role=pending` liệt kê người đang chờ. `pending` không có trong `/roles…` (không cấu hình được) và không gán được khi tạo/sửa người dùng.

**GET/PATCH `/settings/auth`** (chỉ Quản lý) — `{ "googleSignupEnabled": false, "googleSignupDomains": ["congty.vn"] }`. Mặc định **tắt**. Bật mà `googleSignupDomains` rỗng → `400`. Tên miền được chuẩn hóa chữ thường. Mọi thay đổi ghi nhật ký (`settings.auth_update`).

**GET `/branches`** → `[ { "id": "…", "code": "SG", "name": "Chi nhánh Sài Gòn", "isDefault": true } ]` — chỉ các chi nhánh người dùng được phép (đã sắp theo mã).

**Quản lý người dùng (`/users…`, chỉ Quản lý — quyền `user.manage` không cấp được cho vai trò khác)**

```jsonc
// User  (GET /users/:id, phần tử của GET /users, kết quả POST/PATCH/PUT)
{
  "id": "0192…", "code": "NV0002", "username": "ketoan01", "fullName": "Nguyễn Văn A",
  "role": "accountant",                  // manager | assistant | accountant | warehouse | driver | sales | marketing
  "phone": "0901234567",                 // null nếu chưa có
  "isActive": true,
  "mustChangePassword": true,
  "lastLoginAt": "2026-11-04T07:00:00.000Z",   // null nếu chưa từng đăng nhập
  "defaultBranchId": "0193…",            // null nếu chưa đặt
  "branchIds": ["0192…", "0193…"],       // chi nhánh được gán (Quản lý làm việc được ở mọi chi nhánh bất kể danh sách này)
  "createdAt": "2026-11-04T07:00:00.000Z"
}

// GET /users?q=nguyen&role=sales&isActive=true&page=1&limit=20   →   { "data": [User], "meta": { page, limit, total, totalPages } }
// q tìm không dấu theo mã / tên đăng nhập / họ tên / SĐT; limit tối đa 100

// POST /users
{ "username": "ketoan01", "fullName": "Nguyễn Văn A", "role": "accountant", "phone": "0901234567",
  "branchIds": ["0192…"], "defaultBranchId": "0192…", "password": "tùy chọn" }
// 201 → User + "temporaryPassword" (chỉ khi KHÔNG gửi "password"; hiện đúng một lần, header Cache-Control: no-store)

// PATCH /users/:id        (mọi field đều tùy chọn)
{ "fullName": "…", "phone": null, "role": "sales", "isActive": false, "defaultBranchId": "0192…" }

// POST /users/:id/reset-password
{ "newPassword": "tùy chọn" }           // 200 → { "temporaryPassword": "…" } khi không gửi newPassword; ngược lại {}

// PUT /users/:id/branches
{ "branchIds": ["0192…"], "defaultBranchId": "0192…" }   // thay thế toàn bộ; 200 → User
```

- **Số điện thoại:** 10–11 chữ số bắt đầu bằng `0` hoặc `+84` (cho phép khoảng trắng, `.`, `-`, ngoặc); server **chuẩn hóa** về `0xxxxxxxxx` khi lưu (`+84 901 234 567` → `0901234567`); sai định dạng → `400 VALIDATION_ERROR`, `details[0].field = "phone"`; `null` hoặc rỗng = xóa. Cùng quy tắc sẽ dùng cho khách hàng và nhà cung cấp.
- **Tên đăng nhập:** chữ thường không dấu, số, `.` `_` `-`, 3–32 ký tự; gửi chữ hoa thì server đưa về chữ thường; **không đổi được** sau khi tạo; trùng (không phân biệt hoa thường) → `409 DUPLICATE_USERNAME`. Hiếm: bộ đếm mã nhân viên bị lệch so với dữ liệu → `409 DUPLICATE_CODE` (báo quản trị hệ thống).
- **Mật khẩu:** cùng chính sách với đổi mật khẩu (10–128 ký tự, không chứa tên đăng nhập). Không gửi thì hệ thống sinh mật khẩu tạm — **hiển thị cho Quản lý một lần rồi chuyển cho người dùng** (không xem lại được). Tài khoản mới và tài khoản vừa đặt lại luôn bị bắt đổi mật khẩu ở lần đăng nhập đầu (`mustChangePassword = true`).
- **Chi nhánh:** mọi vai trò trừ Quản lý phải có ít nhất 1 chi nhánh (`400 VALIDATION_ERROR`, `details[0].field = "branchIds"`); `defaultBranchId` phải nằm trong danh sách gán. Gán lại danh sách mà chi nhánh mặc định không còn trong đó thì mặc định bị bỏ (`null`).
- **Khóa tài khoản** (`isActive = false`): thu hồi mọi phiên ngay — access token đang cầm bị từ chối ở yêu cầu kế tiếp (`401`), không làm mới được nữa. **Không có xóa người dùng.**
- **Đặt lại mật khẩu:** thu hồi mọi phiên của người đó; **không áp dụng cho chính mình** (dùng `POST /auth/change-password`).
- **Ràng buộc an toàn** (`400 INVALID_STATE`): không tự khóa mình; không đổi vai trò của chính mình; không khóa hoặc hạ vai trò Quản lý hoạt động cuối cùng.
- Mọi thay đổi ghi vào nhật ký thao tác (`audit_logs`, `entityType = "user"`), **không bao giờ ghi mật khẩu**.

---

## 2. Hàng hóa

> **Trạng thái: đã triển khai** mục 2.1–2.2 (Swagger `/api/docs`, `openapi.json`). **Không có giá bán trong hệ thống** (quyết định 05/11/2026): giá bán được quy ước chung ở phần mô tả sản phẩm; không có bảng giá, lưới giá hay báo giá.
> **Quy ước chung của mục này:** mọi endpoint cần đăng nhập và quyền nêu ở cột "Quyền". Số lượng là chuỗi thập phân tối đa 3 chữ số (`"515.000"`); giá vốn là chuỗi 4 chữ số thập phân (`"21800.5000"`).

### 2.1 Nhóm hàng đã được loại bỏ

Từ 06/11/2026, không có API `/categories`, bảng `categories` hay trường nhóm trên hàng hóa.

### 2.2 Danh sách hàng hóa

| Method | Đường dẫn                          | Mô tả                                                                      | Quyền                                      |
| ------ | ---------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| GET    | `/products`                        | Danh sách, lọc, phân trang; `?format=xlsx` tải Excel                       | `product.view` (+ `X-Branch-Id`)           |
| GET    | `/products/lookup?q=`              | Tìm nhanh cho ô chọn hàng (tối đa 20 dòng, chỉ hàng đang bán)              | `product.view` (+ `X-Branch-Id`)           |
| GET    | `/products/:id`                    | Chi tiết                                                                   | `product.view` (+ `X-Branch-Id`)           |
| POST   | `/products`                        | Tạo                                                                        | `product.edit` (+ `X-Branch-Id`)           |
| PATCH  | `/products/:id`                    | Sửa (gồm ngưng bán `isActive=false`)                                       | `product.edit` hoặc `product.content.edit` |
| GET    | `/products/:id/images`             | Danh sách ảnh theo thứ tự hiển thị                                         | `product.view`                             |
| POST   | `/products/:id/images`             | **Tải NHIỀU ảnh lên cùng lúc** (`multipart/form-data`, field `files`)      | `product.edit` hoặc `product.content.edit` |
| PUT    | `/products/:id/images/order`       | Sắp lại thứ tự ảnh `{ imageIds: [...] }` (ảnh đầu là ảnh đại diện)         | `product.edit` hoặc `product.content.edit` |
| DELETE | `/products/:id/images/:imageId`    | Xóa một ảnh → `204`                                                        | `product.edit` hoặc `product.content.edit` |
| GET    | `/products/:id/stock-card?from&to` | **Thẻ kho**: lịch sử nhập–xuất tại chi nhánh làm việc                      | `product.view` (+ `X-Branch-Id`)           |
| GET    | `/products/:id/branches`           | Chi tiết theo từng chi nhánh người dùng được phép: giá 7 bảng, tồn, vị trí | `product.view`                             |

Bộ lọc `GET /products`: `q` (tìm không dấu theo mã và tên), `isActive`, `liquidationStatus`, `productType` (`goods` | `combo`), `inStock` (`true` = còn tồn **tại chi nhánh làm việc**; với combo là số combo ghép được), `sort` (`code`, `name`, `onHand`, `createdAt`; thêm `-` để giảm dần; cột lạ bị bỏ qua), `page`, `limit` (tối đa 100).

```json
// Đối tượng Product
{
  "id": "0192…",
  "code": "QKBSP",
  "name": "Quạt kẹp bàn Super MST-A1",
  "productType": "goods", // "goods" = Hàng hóa (mặc định) | "combo"
  "liquidationStatus": "normal", // normal=Thường (mặc định) | clearance=Thanh Lý | disabled=Tắt Mã | high_stock=Tồn Cao | priority_stock=Tồn Ưu Tiên
  "components": "", // combo: hàng thành phần dạng "MSP/SL,MSP/SL" (vd "DAO01/2,KEO03/1"); hàng hóa: ""
  "componentItems": [], // combo: [{ "productId": "…", "code": "DAO01", "name": "…", "qty": 2 }]
  "branchId": "…", // chi nhánh mà các trường giá/tồn/vị trí dưới đây tính cho (= X-Branch-Id)
  "costPrice": "21800.5000", // giá vốn bình quân CỦA chi nhánh này; VẮNG MẶT nếu thiếu quyền product.cost.view
  "lastPurchasePrice": "21500.0000", // giá nhập cuối của chi nhánh này; như trên
  "onHand": "515.000",
  "reserved": "40.000", // đang giữ cho các đơn đặt hàng chưa chốt (phiếu tạm) tại chi nhánh này
  "available": "475.000", // onHand − reserved
  "onOrder": "0.000", // đang đặt nhà cung cấp = phần còn phải nhập của các phiếu đặt hàng nhập đang mở tại chi nhánh làm việc
  "description": null,
  "images": [{ "id": "…", "url": "https://files…/products/<id>/<uuid>.jpg", "sortOrder": 0 }],
  "isActive": true,
  "createdAt": "2026-11-03T01:30:11.087Z",
  "updatedAt": "…"
}
```

```json
// POST /products  (body)
{
  "code": "QKBSP",
  "name": "…",
  "productType": "goods", // mặc định "goods"; "combo" thì bắt buộc có components
  "liquidationStatus": "normal", // tùy chọn, mặc định "normal"
  "components": "DAO01/2,KEO03/1", // chỉ với combo
  "description": null
}
// Body chỉ chứa thông tin DÙNG CHUNG cho cả hai chi nhánh. Vị trí kho sẽ có bảng riêng (một mã hàng có thể nằm ở nhiều vị trí), chưa làm.
// Lỗi: 409 DUPLICATE_CODE (field code)
```

**Phân biệt dữ liệu dùng chung và theo chi nhánh:** mã, tên, nhóm, loại hàng, hàng thành phần, ảnh, mô tả dùng chung; **tồn kho, giá vốn, giá nhập cuối, tồn tối thiểu/tối đa, vị trí kho riêng từng chi nhánh**. Các trường theo chi nhánh trong response của `GET /products…` luôn tính cho chi nhánh làm việc (`X-Branch-Id`; người có nhiều chi nhánh mà không gửi → `400 BRANCH_REQUIRED`); muốn xem cả hai chi nhánh dùng `GET /products/:id/branches`.

**Mã hàng:** chữ, số, `-`, `_`, `.`; 1–30 ký tự; không dấu cách; **không trùng kể cả khác hoa thường** (`409 DUPLICATE_CODE`). Chỉ đổi được khi hàng **chưa có giao dịch nào** (không có dòng tồn kho, đơn, hóa đơn, phiếu nhập/trả, chuyển kho) → ngược lại `400 INVALID_STATE`.

**Người chỉ có `product.content.edit`** (vd Marketing) chỉ sửa được `description` và ảnh. Gửi trường khác → `403 FORBIDDEN` với `details.fields` liệt kê các trường bị từ chối. Frontend nên khóa các ô khác khi người dùng không có `product.edit`.

#### Loại hàng: Hàng hóa và Combo

- `productType`: **`goods`** (Hàng hóa, mặc định) hoặc **`combo`**. Combo là gói nhiều hàng hóa thành phần, **chỉ để chọn nhanh** khi lập đơn (đơn mua, sau này cả đơn bán): chọn combo thì giao diện tự thêm từng hàng thành phần × số lượng vào đơn (dùng `components` / `componentItems` từ `GET /products/lookup`). Chứng từ, tồn kho, sổ cái, báo cáo **chỉ có hàng thành phần, không bao giờ có dòng combo**.
- **Hàng thành phần** gửi/nhận dạng chuỗi **`MSP/SL,MSP/SL`** (vd `DAO01/2,KEO03/1`): mã hàng (không phân biệt hoa thường; trả về đúng mã trong CSDL), số lượng **nguyên dương** trong MỘT combo. Quy tắc: combo phải có **ít nhất 1** thành phần; thành phần phải là **hàng hóa** (không lồng combo); mã không lặp; hàng hóa **không** được có `components`. Lỗi → `400 VALIDATION_ERROR` (`field = components`). `PATCH` với `components` **thay toàn bộ** thành phần; không gửi thì giữ nguyên.
- **Số liệu của combo luôn tính từ thành phần tại chi nhánh làm việc** (combo không có dòng tồn riêng):
  - `onHand` = số combo ghép được = min(⌊tồn thành phần ÷ SL trong combo⌋); `available` tính tương tự trên tồn khả dụng (đã trừ phần giữ cho đơn nháp), không âm; `reserved` luôn `"0.000"`.
  - `costPrice` (giá gốc) = **tổng (giá vốn thành phần × SL)**; `lastPurchasePrice` = tổng giá nhập cuối thành phần (null nếu có thành phần chưa có giá nhập). Cả hai vắng mặt nếu thiếu `product.cost.view`.
  - `GET /products/:id/stock-card` với combo → `400 INVALID_STATE` (đặt/xem ở hàng thành phần).
  - Combo không có giá bán riêng trong hệ thống (giá quy ước ở mô tả).
- **Đổi `productType`** chỉ khi hàng **chưa có giao dịch** và (khi đổi sang combo) **chưa là thành phần của combo nào** → ngược lại `400 INVALID_STATE`. Đổi sang combo bắt buộc gửi kèm `components`; đổi về hàng hóa thì thành phần bị bỏ.
- Mọi thay đổi tồn kho đều từ chối combo (`400 INVALID_STATE`): không thể nhập/xuất/chuyển kho trực tiếp cho combo.
- Thống kê, báo cáo, tồn kho **chỉ tính hàng thành phần**; combo không được cộng thêm vào bất cứ tổng nào.

#### Thêm hàng hóa kèm ảnh trên web (2 bước)

1. `POST /products` → nhận `id`.
2. `POST /products/:id/images` gửi cả lô ảnh một lần (không nhập đường dẫn ảnh).

Màn hình chỉ cần một nút Lưu và gọi lần lượt hai API này. Nếu bước 2 lỗi thì hàng đã được tạo; người dùng chỉ việc tải lại ảnh (vào sửa hàng).

#### Ảnh

- Mỗi ảnh lưu trên **kho file riêng** (chuẩn S3) và có **URL riêng**; dùng thẳng URL trong thẻ `<img>`. Ảnh nhập từ Excel giữ nguyên URL gốc.
- `POST /products/:id/images`: `multipart/form-data`, field **`files`** (lặp lại nhiều lần), **tối đa 10 ảnh mỗi lần, mỗi ảnh ≤ 5 MB, JPEG/PNG/WebP**. Định dạng kiểm tra theo **nội dung file** (không theo đuôi hay Content-Type). Mỗi hàng tối đa 10 ảnh. Trả `201` với **toàn bộ ảnh của hàng** sau khi thêm.
- **Tất cả hoặc không gì cả:** một ảnh lỗi thì không lưu ảnh nào. Lỗi trả `details: [{ field: "files[1]", message }]` (số trong ngoặc là vị trí file trong lô).
- Lỗi: `413 PAYLOAD_TOO_LARGE` (ảnh > 5 MB), `400 VALIDATION_ERROR`, `502 STORAGE_ERROR` (kho file lỗi, thử lại), `503 STORAGE_NOT_CONFIGURED` (máy chủ chưa cấu hình kho file).
- `PUT .../images/order`: gửi **đủ tất cả** id ảnh của hàng theo thứ tự mới, thiếu/thừa/trùng → `400`.

```json
// GET /products/:id/branches   (chỉ các chi nhánh người dùng được phép)
[
  {
    "branchId": "…",
    "branchCode": "HN",
    "branchName": "Chi nhánh Hà Nội",
    "onHand": "40.000",
    "reserved": "0.000",
    "available": "40.000",
    "costPrice": "22000.0000",
    "lastPurchasePrice": null, // vắng mặt nếu thiếu product.cost.view
    "minStock": null,
    "maxStock": null,
    "location": null
  }
]

```

```json
// GET /products/lookup?q=quat  →  mảng gọn (chi nhánh làm việc)
[
  {
    "id": "…",
    "code": "QKBSP",
    "name": "Quạt kẹp bàn Super MST-A1",
    "productType": "goods",
    "components": "", // combo: "DAO01/2,KEO03/1" → thêm từng thành phần × SL vào đơn
    "available": "475.000",
    "imageUrl": "https://…/a.jpg"
  }
]
```

```json
// GET /products/:id/stock-card?from=2026-11-01&to=2026-11-30   (chi nhánh làm việc)
{
  "branchId": "…",
  "openingQty": "400.000",
  "movements": [
    {
      "occurredAt": "…",
      "refType": "goods_receipt",
      "refId": "…",
      "refCode": "PN000948",
      "qtyDelta": "600.000",
      "balance": "1000.000",
      "unitCost": "1179.9700"
    },
    {
      "occurredAt": "…",
      "refType": "invoice",
      "refId": "…",
      "refCode": "HD016890",
      "qtyDelta": "-515.000",
      "balance": "485.000"
    }
  ],
  "closingQty": "485.000"
}
```

- `from`/`to` dạng `YYYY-MM-DD` theo **giờ Việt Nam**, tính cả hai ngày; bỏ trống = không giới hạn. `openingQty` là tồn trước `from`.
- `unitCost` chỉ có khi người gọi có quyền `product.cost.view`.
- `refType`: `opening`, `goods_receipt`, `invoice`, `sales_return`, `purchase_return`, `adjustment`, `transfer_out`, `transfer_in`, `transfer_cancel`.

**Xuất Excel:** `GET /products?format=xlsx` (kèm các bộ lọc, bỏ qua `page/limit`, tối đa 10.000 dòng). Tiêu đề cột trùng file KiotViet nên nhập lại được; cột `Giá vốn`, `Giá nhập cuối` chỉ có khi có quyền xem giá vốn.

Thêm `columns=code,name,onHand` để chỉ xuất các cột được chọn. Các mã hợp lệ (theo thứ tự trong file): `code`, `name`, `productType`, `components`, `liquidationStatus`, `costPrice`, `lastPurchasePrice`, `onHand`, `reserved`, `description`, `isActive`, `images`. Bỏ qua `columns` để xuất đủ cột như trước; chuỗi rỗng, mã lạ hoặc lựa chọn không có cột được phép xuất trả `400`. Cột giá vốn vẫn bị loại khi thiếu `product.cost.view`. Hộp thoại trên web có checkbox, “Chọn tất cả”, “Mặc định” và bộ đếm, không có ô tìm kiếm; “Mặc định” khôi phục toàn bộ cột được phép của file hiện tại. File tùy chọn chỉ nhập lại được khi vẫn giữ đủ các cột bắt buộc của chức năng nhập.

### 2.3 Giá bán

**Đã bỏ** (05/11/2026): hệ thống không lưu giá bán, không có bảng giá (Chung/Lớn/Vừa/VIP/VAT), lưới giá, tăng/giảm hàng loạt, sao chép giá giữa chi nhánh hay báo giá. Giá bán được quy ước chung ở phần mô tả sản phẩm. Các endpoint `/price-books/*`, `/pricing/quote` và quyền `price.edit` không còn. Giá trên dòng đơn hàng/hóa đơn (đơn giá, giảm giá, thành tiền) vẫn được lưu để làm sổ sách và tính lãi gộp, nhưng do **người lập đơn nhập**.

---

## 3. Mua hàng

### 3.1 Nhà cung cấp

> **Trạng thái:** đã triển khai `GET/POST /suppliers`, `GET/PATCH /suppliers/:id`, `GET /suppliers/:id/branches`, `GET /suppliers/:id/ledger`. Thuộc tính theo file `DanhSachNhaCungCap` của KiotViet sau khi lược bỏ cột không dùng (06/11/2026): **không còn** điện thoại, địa chỉ, mã số thuế, ghi chú, loại (`kind`).
> **Mọi số tiền của nhà cung cấp (nợ, tổng mua, tổng mua trừ trả hàng) là RIÊNG TỪNG CHI NHÁNH, không bao giờ cộng gộp.** Các endpoint trả số tiền cần `X-Branch-Id` (người có nhiều chi nhánh không gửi → `400 BRANCH_REQUIRED`); muốn xem cả hai chi nhánh dùng `GET /suppliers/:id/branches`.

| Method | Đường dẫn                       | Mô tả                                                                 | Quyền                          |
| ------ | ------------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| GET    | `/suppliers`                    | Danh sách (`q`, `groupName`, `hasDebt`, `isActive`, `sort`: `code`, `name`, `createdAt`; `?format=xlsx`); tiền theo chi nhánh làm việc | `purchase.view` + `X-Branch-Id` (`hasDebt` cần `debt.view`) |
| GET    | `/suppliers/:id`                | Chi tiết; tiền theo chi nhánh làm việc                                 | `purchase.view` + `X-Branch-Id` |
| GET    | `/suppliers/:id/branches`       | Tiền của nhà cung cấp tại TỪNG chi nhánh người dùng được phép          | `purchase.view`                |
| POST   | `/suppliers`                    | Tạo `{ name, groupName?, code? }` (bỏ `code` = tự cấp `NCC000056`…)    | `purchase.edit` + `X-Branch-Id` |
| PATCH  | `/suppliers/:id`                | Sửa `{ name?, groupName?, isActive? }`; mã không đổi được             | `purchase.edit` + `X-Branch-Id` |
| GET    | `/suppliers/:id/ledger?from&to` | **Sổ công nợ** NCC tại chi nhánh làm việc                              | `purchase.view` + `debt.view` + `X-Branch-Id` |

```json
// Supplier
{
  "id": "…",
  "code": "NCC000002",
  "name": "Công ty TNHH ABC",
  "groupName": null, // nhóm nhà cung cấp: chuỗi tự do, có thể null; chỉ để phân loại/lọc, không có nghiệp vụ riêng (kể cả "Lái xe")
  "isActive": true,
  "createdByName": "Nguyễn Văn A", // họ tên người tạo
  "createdAt": "…",
  "branchId": "…", // chi nhánh mà 3 số tiền dưới đây tính cho (= X-Branch-Id)
  "totalPurchase": "1250000000", // Tổng mua TẠI chi nhánh này = số lịch sử của chi nhánh (chuyển từ KiotViet) + phiếu nhập hoàn tất
  "netPurchase": "1200000000", // Tổng mua trừ trả hàng TẠI chi nhánh này = số lịch sử + phiếu nhập − phiếu trả hàng nhập
  "balance": "240000000" // Nợ cần trả hiện tại TẠI chi nhánh này (+ = còn nợ, có thể âm); VẮNG MẶT nếu thiếu debt.view
}

// GET /suppliers/:id/branches  (chỉ các chi nhánh người dùng được phép; mỗi chi nhánh một bộ số riêng)
[
  { "branchId": "…", "branchCode": "HN", "branchName": "Chi nhánh Hà Nội", "totalPurchase": "…", "netPurchase": "…", "balance": "…" },
  { "branchId": "…", "branchCode": "SG", "branchName": "Chi nhánh Sài Gòn", "totalPurchase": "…", "netPurchase": "…", "balance": "…" }
]
```

Lưu ý:
- `hasDebt` xét nợ **tại chi nhánh làm việc** (nợ âm hoặc 0 là "không nợ"). Một nhà cung cấp có thể đang nợ ở chi nhánh này nhưng không nợ ở chi nhánh kia.
- Danh sách và chi tiết **không gồm** nhà cung cấp hệ thống đại diện chi nhánh (chuyển kho nội bộ); id của chúng trả `404`.
- **Nợ không phải cột của nhà cung cấp:** là tổng sổ cái công nợ của chi nhánh. Nợ đầu kỳ lúc chuyển từ KiotViet là một dòng sổ cái loại `opening` GẮN VÀO MỘT CHI NHÁNH; số lịch sử "tổng mua", "tổng mua trừ trả hàng" lưu theo từng chi nhánh ở bảng `supplier_branch_history` (giao diện không sửa được; do công cụ chuyển dữ liệu ghi).
- Mã trùng (kể cả khác hoa thường) → `409 DUPLICATE_CODE`. Gửi trường đã bỏ (`phone`, `kind`…) → `400`.
- Xuất Excel `?format=xlsx` (theo chi nhánh làm việc) có cột: Mã, Tên, Nhóm, Nợ cần trả hiện tại (chỉ khi có `debt.view`), Tổng mua, Tổng mua trừ trả hàng, Trạng thái, Người tạo, Ngày tạo. `Ngày tạo` hiển thị **giờ Việt Nam** dạng `dd/MM/yyyy HH:mm`; `Trạng thái` là `1`/`0` (giữ như file KiotViet để sau này nhập lại được).
- **Mã tự cấp bỏ qua mã đã có:** nếu số kế tiếp (vd `NCC000057`) đã bị mã nhập tay hoặc dữ liệu chuyển từ hệ thống cũ chiếm thì hệ thống tự lấy số tiếp theo, không báo lỗi trùng.

**Sổ công nợ** (`GET /suppliers/:id/ledger?from=2026-11-01&to=2026-11-30`; cùng cấu trúc sẽ dùng cho khách hàng):

```json
{
  "branchId": "…", // sổ của chi nhánh làm việc (X-Branch-Id); mỗi chi nhánh một sổ riêng
  "openingBalance": "0", // số dư TRƯỚC ngày `from` (0 nếu không có `from`)
  "entries": [
    {
      "occurredAt": "…",
      "entryType": "invoice", // opening | invoice | payment | return | adjustment | transfer
      "refType": "goods_receipt",
      "refId": "…",
      "refCode": "PN000948",
      "amount": "33735000",
      "balance": "33735000", // số dư sau dòng này (cộng dồn từ openingBalance)
      "note": null
    },
    {
      "occurredAt": "…",
      "entryType": "payment",
      "refType": null,
      "refId": null,
      "refCode": "CTM019327",
      "amount": "-12390000",
      "balance": "21345000",
      "note": null
    }
  ],
  "closingBalance": "21345000"
}
```

`amount` dương = tăng nợ (mình nợ thêm), âm = giảm nợ. `from`/`to` dạng `YYYY-MM-DD` (phải là ngày có thật, vd `2026-02-31` → `400`), tính theo giờ Việt Nam, **cả hai đầu đều gồm cả ngày**; bỏ trống `from` = từ đầu, bỏ trống `to` = đến hiện tại. Ngày sai dạng hoặc `to` < `from` → `400`. Cần cả `purchase.view` và `debt.view`. Dòng sắp theo thời gian phát sinh; nợ đầu kỳ chuyển từ KiotViet là dòng `opening`.

### 3.2 Nhập hàng

> **Trạng thái:** đã triển khai (trừ in PDF). Thuộc tính theo file `DanhSachChiTietNhapHang` của KiotViet sau khi lược bỏ cột không dùng. Mọi endpoint cần `X-Branch-Id`: phiếu thuộc **chi nhánh làm việc**; phiếu của chi nhánh khác trả `404`.
> **Tiền trả nhà cung cấp KHÔNG nằm trên phiếu nhập** (không có `paid`, `payment`, `discount`, số hóa đơn đầu vào): phiếu nhập chỉ ghi **nợ** nhà cung cấp; trả tiền làm bằng phiếu chi ở Sổ quỹ.

| Method | Đường dẫn                    | Mô tả                                                                                     | Quyền             |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------- | ----------------- |
| GET    | `/goods-receipts`            | Danh sách (`q`, `supplierId`, `purchaseOrderId`, `status`, `from`, `to`, `sort`: `receivedAt` \| `code` \| `total`; `?format=xlsx`) | `purchase.view`   |
| GET    | `/goods-receipts/:id`        | Chi tiết (kèm dòng hàng và số đã trả lại)                                                | `purchase.view`   |
| POST   | `/goods-receipts`            | Tạo phiếu nhập (**Idempotency-Key**)                                                      | `purchase.edit`   |
| PATCH  | `/goods-receipts/:id`        | Chỉ sửa ghi chú `{ note }`; muốn đổi hàng/giá thì hủy rồi tạo lại                        | `purchase.edit`   |
| POST   | `/goods-receipts/:id/cancel` | Hủy phiếu `{ reason? }`                                                                   | `purchase.cancel` |

```json
// POST /goods-receipts
{
  "supplierId": "…",
  "purchaseOrderId": null, // phiếu đặt hàng nhập (PDN…) nếu nhập theo đơn đặt
  "receivedAt": "2026-11-03T04:00:00.000Z", // tùy chọn, mặc định = bây giờ, không ở tương lai
  "receivedById": "…", // người nhập, tùy chọn, mặc định = người đang đăng nhập
  "note": "Lô hàng tháng 10",
  "items": [{ "productId": "…", "qty": "1095", "unitCost": "219967.9800" }]
}
```

Response (chi tiết; ở danh sách không có `items`):

```json
{
  "id": "…",
  "code": "PN000946",
  "status": "completed", // completed | cancelled
  "branchId": "…",
  "supplier": { "id": "…", "code": "NCC000001", "name": "Công ty TNHH ABC" },
  "purchaseOrder": { "id": "…", "code": "PDN000394" }, // null nếu nhập trực tiếp
  "receivedAt": "…",
  "receivedBy": { "id": "…", "fullName": "…" },
  "total": "240000000", // cần trả NCC = Σ thành tiền (server tính, không gửi lên)
  "totalQty": "1095.000", // tính khi đọc
  "itemCount": 1,
  "items": [
    {
      "productId": "…",
      "code": "LUMI5T",
      "name": "…",
      "qty": "1095.000",
      "unitCost": "219967.9800", // giá nhập
      "lineTotal": "240000000", // làm tròn về đồng
      "returnedQty": "0.000" // đã trả lại NCC (phiếu trả hoàn tất)
    }
  ],
  "note": "…",
  "createdBy": { "id": "…", "fullName": "…" },
  "createdAt": "…",
  "updatedAt": "…",
  "cancelledAt": null,
  "cancelReason": null
}
```

**Khi tạo** (một transaction): cộng tồn của chi nhánh làm việc, tính lại **giá vốn bình quân** của chi nhánh đó (không dùng tồn/giá vốn chi nhánh khác), ghi giá nhập cuối, ghi **nợ** nhà cung cấp tại chi nhánh đó (dòng `invoice` trong sổ công nợ). Quy tắc: nhà cung cấp phải đang hoạt động và không phải NCC nội bộ; hàng không phải combo (tách combo thành hàng thành phần) và còn kinh doanh; mỗi hàng một dòng; số lượng > 0 (tối đa 3 số thập phân); giá nhập ≥ 0 (tối đa 4 số thập phân). Client gửi `total`/`lineTotal`/`discount`/`paid`… → `400`.

**Giá vốn bình quân:** `(tồn × giá vốn + SL nhập × giá nhập) / (tồn + SL nhập)`, lưu 4 chữ số thập phân. Ví dụ tồn 1000 @5000, nhập 500 @5500 → **5166,6667**.

**Nhập theo phiếu đặt:** có `purchaseOrderId` thì phiếu đặt phải thuộc chi nhánh làm việc (khác chi nhánh → `404`), cùng nhà cung cấp (khác → `400 VALIDATION_ERROR`, `field = purchaseOrderId`) và còn mở `draft`/`confirmed` (đã hoàn thành/hủy → `422 INVALID_STATE`). Một phiếu đặt nhập được **nhiều lần**; phiếu nhập được phép có dòng khác/nhiều hơn phiếu đặt. Nhập đủ mọi dòng thì phiếu đặt tự `completed`.

**Hủy** (`purchase.cancel`): trừ lại tồn (giá vốn **tính ngược**: `(tồn × giá vốn − SL × giá nhập) / (tồn − SL)`; tồn về 0 thì giữ giá vốn cũ; có thể âm nếu giá nhập của phiếu cao hơn giá vốn hiện tại) và ghi bút toán đảo công nợ (dòng `adjustment`). Lỗi: `422 STOCK_NOT_ENOUGH` nếu hàng đã bán/chuyển hết; `409 INVALID_STATE` nếu còn phiếu trả hàng nhập hoàn tất gắn vào phiếu này (hủy phiếu trả trước); `422 INVALID_STATE` nếu đã hủy. Phiếu đặt liên quan được tính lại (mở lại `confirmed` nếu thiếu hàng). Vì giá vốn lưu 4 chữ số nên sau khi hủy có thể lệch ±0,0001 so với trước khi nhập.

**Excel** (`?format=xlsx`): theo đúng bộ lọc, mỗi dòng hàng một dòng Excel, tiêu đề như file "Chi tiết nhập hàng" của KiotViet (`Mã nhập hàng`, `Mã đặt hàng nhập`, `Cần trả NCC`, `Giá nhập`, …); thời gian giờ Việt Nam `dd/MM/yyyy HH:mm`.

### 3.3 Trả hàng nhập

> **Trạng thái:** đã triển khai. Cần `X-Branch-Id`; phiếu thuộc chi nhánh làm việc.
> Trả hàng nhập **luôn trừ vào công nợ** nhà cung cấp; phiếu không có hình thức thanh toán. Tiền hoàn lại (nếu có) ghi bằng phiếu thu ở Sổ quỹ; gửi `settlement`/`refund` → `400`.

| Method | Đường dẫn                      | Mô tả                                                                    | Quyền             |
| ------ | ------------------------------ | ------------------------------------------------------------------------ | ----------------- |
| GET    | `/purchase-returns`            | Danh sách (`q`, `supplierId`, `goodsReceiptId`, `status`, `from`, `to`, `sort`: `returnedAt` \| `code` \| `total`; `?format=xlsx`) | `purchase.view`   |
| GET    | `/purchase-returns/:id`        | Chi tiết                                                                 | `purchase.view`   |
| POST   | `/purchase-returns`            | Tạo (**Idempotency-Key**)                                                | `purchase.edit`   |
| PATCH  | `/purchase-returns/:id`        | Chỉ sửa ghi chú `{ note }`                                               | `purchase.edit`   |
| POST   | `/purchase-returns/:id/cancel` | Hủy `{ reason? }`                                                        | `purchase.cancel` |

```json
// POST /purchase-returns
{
  "supplierId": "…",
  "goodsReceiptId": "…", // tùy chọn: phiếu nhập gốc
  "returnedAt": "…", // tùy chọn
  "returnedById": "…", // người trả, tùy chọn, mặc định = người đăng nhập
  "note": "Hàng lỗi",
  "items": [{ "productId": "…", "qty": "10", "returnPrice": "8450.2200" }]
}
```

Response: `id`, `code` (`THN…`), `status`, `branchId`, `supplier`, `goodsReceipt { id, code } | null`, `returnedAt`, `returnedBy`, `total` (NCC cần trả), `totalQty`, `itemCount`, `items[{ productId, code, name, qty, returnPrice, lineTotal }]`, `note`, `createdBy`, `createdAt`, `updatedAt`, `cancelledAt`, `cancelReason`.

- **Khi tạo:** trừ tồn của chi nhánh làm việc, tính lại giá vốn bình quân theo **giá trả**: `(tồn × giá vốn − SL trả × giá trả) / (tồn − SL trả)`; ghi **giảm** công nợ (dòng `return`). Ví dụ tồn 1500 @5166,6667, trả 100 × 5500 → giá vốn **5142,8572**. Tồn về 0 thì giữ giá vốn cũ; nếu giá trả cao hơn giá vốn nhiều thì giá vốn mới **có thể âm** và được giữ nguyên (không chặn).
- **Có `goodsReceiptId`:** phiếu nhập phải `completed`, cùng chi nhánh và nhà cung cấp; mỗi hàng phải có trong phiếu nhập và (đã trả + lần này) ≤ số đã nhập, vượt → `422 RETURN_QTY_EXCEEDED` (`details[].field = items.N.qty`). Không có `goodsReceiptId` thì trả tự do (vẫn cần đủ tồn: `422 STOCK_NOT_ENOUGH`).
- Nhà cung cấp phải đang hoạt động; hàng **ngưng kinh doanh vẫn trả được**; combo bị từ chối.
- **Hủy** (`purchase.cancel`): nhập lại hàng theo giá trả và ghi bút toán đảo tăng lại nợ.

### 3.4 Đặt hàng nhập

> **Trạng thái:** đã triển khai. Cần `X-Branch-Id`. Đặt hàng nhập **không đổi tồn kho và công nợ**; chỉ ảnh hưởng `onOrder` của hàng hóa. Thuộc tính theo file `DanhSachChiTietDatHangNhap` của KiotViet.

| Method | Đường dẫn                        | Mô tả                                                                                                   | Quyền             |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------- |
| GET    | `/purchase-orders`               | Danh sách (`q`, `supplierId`, `status`, `from`, `to`, `sort`: `orderedAt` \| `code` \| `total`; `?format=xlsx`) | `purchase.view`   |
| GET    | `/purchase-orders/:id`           | Chi tiết: dòng kèm `receivedQty`, `remainingQty`; `receipts[]` = các phiếu nhập hoàn tất               | `purchase.view`   |
| POST   | `/purchase-orders`               | Tạo `{ supplierId, orderedAt?, orderedById?, status?: "draft" \| "confirmed", note?, items[{ productId, qty, unitCost }] }` (**Idempotency-Key**) | `purchase.edit`   |
| PUT    | `/purchase-orders/:id`           | Sửa toàn bộ (thay hết dòng); chỉ khi còn mở và chưa có phiếu nhập hoàn tất (`409` nếu đã có)           | `purchase.edit`   |
| POST   | `/purchase-orders/:id/confirm`   | Phiếu tạm → đã xác nhận NCC                                                                             | `purchase.edit`   |
| POST   | `/purchase-orders/:id/complete`  | "Kết thúc": đóng khi NCC không giao nốt; cần đã có ít nhất một phiếu nhập                              | `purchase.edit`   |
| POST   | `/purchase-orders/:id/cancel`    | Hủy `{ reason? }`; chỉ khi chưa có phiếu nhập hoàn tất                                                  | `purchase.cancel` |

- `status`: `draft` (Phiếu tạm) → `confirmed` (Đã xác nhận NCC) → `completed` (Hoàn thành) hoặc `cancelled`. **"Nhập một phần" không phải trạng thái lưu**: dùng `receiveState` (`none` | `partial` | `full`, tính từ các phiếu nhập hoàn tất).
- Response: `id`, `code` (`PDN…`), `status`, `receiveState`, `branchId`, `supplier`, `orderedAt`, `orderedBy` (Người đặt), `createdBy` (Người tạo), `total` (cần trả NCC), `totalQty`, `itemCount`, `note`, `items[{ productId, code, name, qty, unitCost, lineTotal, receivedQty, remainingQty }]` (chỉ ở chi tiết), `receipts[]` (chỉ ở chi tiết), `createdAt`, `updatedAt`, `cancelledAt`, `cancelReason`.
- **Tự hoàn thành / mở lại:** nhập đủ mọi dòng → `completed`. Hủy một phiếu nhập làm thiếu hàng → phiếu đặt về `confirmed` (kể cả khi trước đó "Kết thúc" tay). Nhập từ phiếu tạm → tự sang `confirmed`.
- **`onOrder`** của `GET /products` (và chi tiết) = Σ phần còn phải nhập (`remainingQty`) của các phiếu đặt `draft`/`confirmed` **tại chi nhánh làm việc**.
- Excel (`?format=xlsx`): tiêu đề như file "Chi tiết đặt hàng nhập" của KiotViet (`Mã đặt hàng nhập`, `Người đặt`, `Cần trả NCC`, …).

---

## 4. Khách hàng

> **Trạng thái:** đã triển khai danh mục khách, công nợ và hạn mức theo chi nhánh, lịch tiếp khách, xuất/nhập Excel theo file TKS. **Chưa làm** (cùng Sổ quỹ và Đơn hàng): thu nợ nhanh, tuổi nợ, biên bản đối chiếu, lịch sử đơn/hóa đơn/trả hàng của khách; `totalSales`/`netSales`/`lastTransactionAt` hiện bằng `0`/`null` cho tới khi có hóa đơn.

| Method | Đường dẫn                                       | Mô tả                                                                                          | Quyền                                          |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| GET    | `/customers`                                    | Danh sách (lọc, tìm không dấu, phân trang; `?format=xlsx` tải Excel)                          | `customer.view`                                |
| GET    | `/customers/lookup?q=`                          | Tìm nhanh cho ô chọn khách: tối đa 20, chỉ khách đang hoạt động, kèm nợ/hạn mức còn lại        | `customer.view`                                |
| GET    | `/customers/:id`                                | Chi tiết (hồ sơ kho, số liệu từng chi nhánh, cảnh báo SĐT trùng)                               | `customer.view`                                |
| POST   | `/customers`                                    | Tạo                                                                                            | `customer.edit`                                |
| PATCH  | `/customers/:id`                                | Sửa / ngưng (`isActive`) / sửa hồ sơ kho (`profile`)                                           | `customer.edit`                                |
| PUT    | `/customers/:id/branches/:branchId/terms`       | Đặt hạn mức + kỳ hạn công nợ của khách **tại một chi nhánh** (cả hai `null` = xóa)             | `customer.edit` + `debt.view`                  |
| GET    | `/customers/:id/ledger?from&to`                 | Sổ công nợ tại chi nhánh làm việc (cấu trúc như sổ NCC, mục 3.1)                               | `customer.view` + `debt.view`                  |
| GET    | `/customers/:id/visits`                         | Lịch tiếp khách (mới nhất trước)                                                               | `customer.view`                                |
| POST   | `/customers/:id/visits`                         | Ghi một ngày tiếp khách `{ visitedOn, note? }`                                                 | `customer.visit.edit` (mặc định chỉ Quản lý)   |
| DELETE | `/customers/:id/visits/:visitId`                | Xóa một ngày tiếp khách (`204`, có nhật ký)                                                    | `customer.visit.edit`                          |

Dữ liệu theo file `TKS_Bao_cao_kinh_doanh_customers`. Các endpoint có số liệu theo chi nhánh cần header `X-Branch-Id` (như nhà cung cấp).

Bộ lọc `GET /customers`: `q` (mã, tên, SĐT), `priceLevel`, `salesOwnerId`, `acquisitionSource`, `newSinceFrom` / `newSinceTo` (`YYYY-MM`, gồm cả tháng), `hasDebt` (`true` = đang nợ **tại chi nhánh làm việc**; cần `debt.view`), `isActive`, `includeInternal` (gồm khách đại diện chi nhánh, mặc định ẩn); sort: `code` (mặc định), `name`, `createdAt`, `newSince` (thêm `-` để giảm dần). `?format=xlsx` xuất đúng bộ lọc với tiêu đề **như file TKS** (nhập lại được; không có cột công nợ).

```json
// Customer
{
  "id": "…",
  "code": "KH006974",
  "name": "HN - Cửa hàng Ví Dụ 1",
  "phone": "0900000001", // đã chuẩn hóa, KHÔNG duy nhất
  "address": "12 Đường Ví Dụ, Quận 1, TP.HCM",
  "salesOwner": { "id": "…", "fullName": "Trần Văn B" }, // nhân viên phụ trách (cột "Sale"), null nếu chưa gán
  "priceLevel": "medium", // Level giá: new (Mới) | medium (Vừa) | large (Lớn) | vip (Vip); chỉ để tham chiếu khi báo giá
  "newSince": "2026-10-01", // tháng trở thành khách mới (luôn ngày đầu tháng); null = khách cũ/không rõ
  "acquisitionSource": "Page", // nguồn khách mới; null nếu không có
  "note": null,
  "isActive": true,
  "isInternalBranch": false, // true = khách hệ thống đại diện chi nhánh (chuyển kho); ẩn khỏi danh sách, không sửa được
  "profile": {
    // hồ sơ kinh doanh; null nếu chưa có gì
    "warehouseLocation": "https://maps.example.com/…",
    "warehouseCount": 2,
    "warehouseArea": "600m2",
    "warehousePhotoUrl": "https://example.com/kho.jpg",
    "competitors": "Siêu thị A",
    "salesMethods": ["FB live", "Bán sàn"], // Bán cửa hàng | FB live | Kho buôn | Bán sàn | Sang tay | FB ads | Khác
    "scale": null // "Quy mô khách"; null = "Chưa có"
  },
  "lastVisitedOn": "2026-11-03", // ngày tiếp khách gần nhất
  "branches": [
    // số liệu TÁCH BIỆT từng chi nhánh, KHÔNG cộng gộp. Danh sách: chỉ chi nhánh làm việc. Chi tiết: mọi chi nhánh được phép
    {
      "branchId": "…", "branchCode": "SG", "branchName": "Chi nhánh Sài Gòn",
      "totalSales": "1200000000", "netSales": "1150000000", "lastTransactionAt": "…",
      "balance": "12500000", // công nợ phải thu; ÂM = khách dư/ứng trước. Chỉ có khi thấy được nợ (xem bên dưới)
      "creditLimit": "50000000", // null = không giới hạn; cùng điều kiện với balance
      "paymentTermDays": 15
    }
  ],
  "createdByName": "…",
  "createdAt": "…",
  "updatedAt": "…",
  "warnings": [
    // chỉ ở chi tiết / tạo / sửa
    { "code": "DUPLICATE_PHONE", "message": "…", "customers": [{ "id": "…", "code": "KH000010", "name": "…" }] }
  ]
}
```

**Phân quyền khách hàng**

- `customer.view` xem **mọi** khách, kể cả khách của nhân viên khác (không có phạm vi "chỉ của mình").
- `customer.edit` có thể là "chỉ của mình": chỉ sửa khách mình phụ trách (`403` nếu khác); **tạo khách thì luôn do chính mình phụ trách** (gửi `salesOwnerId` của người khác → `403`); không chuyển khách cho người khác.
- Tiền (`balance`, `creditLimit`, `paymentTermDays`, sổ công nợ, lọc `hasDebt`) cần `debt.view`; nếu quyền này là "chỉ của mình" thì chỉ thấy tiền của khách mình phụ trách (khách khác: trường vắng mặt, sổ công nợ `403`). Thiếu `debt.view` thì mọi trường tiền vắng mặt và `hasDebt` → `403`.
- Ngày tiếp khách chỉ ghi/xóa được bởi người có `customer.visit.edit` (mặc định chỉ Quản lý); Sale chỉ xem.

**Tạo / sửa**

```json
// POST /customers   (PATCH: mọi trường tùy chọn; mã không đổi được)
{
  "code": "KH006974?", // bỏ trống = tự cấp KH000056…; trùng (kể cả khác hoa thường) → 409 DUPLICATE_CODE
  "name": "HN - Cửa hàng Ví Dụ 1",
  "phone": "0900 000 001", // chuẩn hóa; sai định dạng → 400; trùng khách khác vẫn lưu, trả warnings DUPLICATE_PHONE
  "address": null,
  "salesOwnerId": "…?", // người dùng đang hoạt động; quyền "chỉ của mình" → luôn là chính mình
  "priceLevel": "medium",
  "newSince": "2026-10-01", // chỉ nhận ngày đầu tháng; null = khách cũ
  "acquisitionSource": "Page",
  "note": null,
  "isActive": true, // chỉ PATCH
  "profile": { "warehouseCount": 2, "salesMethods": ["FB live"] } // object: chỉ đổi các trường có mặt (null xóa trường đó); null: xóa cả hồ sơ
}
```

Server từ chối trường lạ (`400`), ví dụ gửi công nợ hay tổng bán.

**Hạn mức và công nợ**

```json
// PUT /customers/:id/branches/:branchId/terms     → 200 { "branchId": "…", "creditLimit": "50000000", "paymentTermDays": 15 }
{ "creditLimit": "50000000", "paymentTermDays": 15 } // số nguyên đồng ≥ 0 hoặc null; cả hai null = không giới hạn
```

`branchId` phải là chi nhánh người dùng được phép (`403 BRANCH_FORBIDDEN`). `GET /customers/lookup` trả thêm `balance`, `creditLimit` và `creditAvailable` (= hạn mức − công nợ, âm = đã vượt; `null` nếu không giới hạn) tại chi nhánh làm việc, cho màn hình đặt hàng. Hạn mức hiện chỉ để cảnh báo (hạn mức cứng làm sau go-live).

**Công nợ theo chi nhánh:** khách hàng là dữ liệu dùng chung nhưng **mỗi chi nhánh có sổ công nợ riêng**, không cấn trừ chéo (thu nợ ở Hà Nội không giảm nợ Sài Gòn). Công nợ đầu kỳ nhập qua Excel (mục 9).

```json
// POST /customers/:id/visits   → 201
{ "visitedOn": "2026-11-03", "note": "Đến kho khách" } // không được ở tương lai; trùng ngày → 409 DUPLICATE_VISIT
// GET /customers/:id/visits → [{ "id": "…", "visitedOn": "2026-11-03", "note": "…", "createdByName": "…", "createdAt": "…" }]
```

**Còn lại trong bản nháp (chưa triển khai):** `GET /customers/:id/orders|invoices|sales-returns|aging|statement` và `POST /customers/:id/receipts` (thu nợ nhanh, `Idempotency-Key`, cấn trừ hóa đơn cũ nhất; lỗi `422 ALLOCATION_EXCEEDS`) làm cùng Sổ quỹ và Đơn hàng.

---

## 5. Đơn hàng

### 5.1 Đặt hàng (phiếu tạm)

> **Trạng thái:** đã triển khai (xuất hóa đơn từ phiếu ở mục 5.2).

| Method | Đường dẫn             | Mô tả                                                                                            | Quyền            |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------ | ---------------- |
| GET    | `/orders`             | Danh sách (`q`, `status`, `customerId`, `sellerId`, `from`, `to`, `sort`; `?format=xlsx`)        | `order.view`     |
| GET    | `/orders/:id`         | Chi tiết (phiếu tạm kèm `available` từng dòng và `warnings`)                                      | `order.view`     |
| POST   | `/orders`             | Tạo phiếu tạm `draft` (**Idempotency-Key**)                                                       | `order.create`   |
| PATCH  | `/orders/:id`         | Sửa — **chỉ khi `draft`**, gửi lại toàn bộ (cùng body như tạo, thay hết dòng hàng)                | `order.create`   |
| POST   | `/orders/:id/cancel`  | Hủy phiếu tạm `{ reason? }` (nhả hàng đang giữ)                                                   | `order.create`   |
| POST   | `/orders/:id/invoice` | **Xuất hóa đơn từ phiếu** (**Idempotency-Key**) — mục 5.2                                         | `invoice.create` |

Mọi endpoint cần `X-Branch-Id`; phiếu thuộc chi nhánh làm việc (phiếu chi nhánh khác → `404`). Quyền "chỉ của mình" (`order.view`/`order.create` của Sale): chỉ thấy và sửa phiếu có **người bán là chính mình**, không lập hộ người khác (`403`). Phiếu tạm **không chạm kho, công nợ, quỹ**; chỉ "giữ hàng" (làm giảm số **có thể bán** = tồn − hàng giữ cho các phiếu tạm khác tại chi nhánh).

```json
// POST /orders   (cùng body cho PATCH)
{
  "customerId": "…", // khách đang hoạt động, không phải khách nội bộ chi nhánh (→ 404)
  "sellerId": "…?", // người bán (Người nhận đặt); mặc định = người đang đăng nhập
  "orderedAt": "…?", // mặc định bây giờ; không được ở tương lai
  "items": [
    // 1–500 dòng hàng hóa (combo → giao diện tách thành hàng thành phần; hàng ngưng kinh doanh → 422). Một mặt hàng có thể lặp nhiều dòng
    { "productId": "…", "qty": "2000", "price": "13100", "discountPerUnit": "500", "note": null }
  ],
  "discount": "0", // giảm giá cả phiếu (số nguyên đồng) ≤ tổng tiền hàng
  "ship": { "pickupAddress": null, "name": null, "phone": null, "address": null }, // địa chỉ lấy hàng, người nhận
  "note": "thêm hàng"
}
```

- `price` = **Đơn giá** (trước giảm), `discountPerUnit` = giảm giá **trên 1 đơn vị** (số tiền, ≤ đơn giá). Server tính **Giá bán** `unitPrice = price − discountPerUnit`, `lineTotal = qty × unitPrice` (làm tròn đồng), `subtotal = Σ lineTotal`, `total = subtotal − discount`. Mọi tiền là số nguyên đồng (gửi số lẻ → `400`); gửi `lineTotal`/`total` → `400`.
- Không có bảng giá: đơn giá do người lập phiếu nhập.

```json
// Order (response)
{
  "id": "…", "code": "DH022295", "status": "draft", // draft (Phiếu tạm) | completed (đã xuất hóa đơn) | cancelled
  "branchId": "…",
  "customer": { "id": "…", "code": "KH000002", "name": "Cửa hàng Ví Dụ 2", "phone": "…" },
  "seller": { "id": "…", "fullName": "…" },
  "orderedAt": "…",
  "subtotal": "207500", "discount": "1000", "total": "206500", "totalQty": "23.000", "itemCount": 3,
  "ship": { "pickupAddress": "Kho 3", "name": "Anh Nhận", "phone": "0909…", "address": "…" },
  "note": "…",
  "invoice": null, // { id, code } hóa đơn hoàn tất xuất từ phiếu
  "createdBy": { "id": "…", "fullName": "…" }, "createdAt": "…", "updatedAt": "…",
  "cancelledAt": null, "cancelReason": null,
  "items": [ // chỉ ở chi tiết
    {
      "lineNo": 1, "productId": "…", "code": "T888LL", "name": "…",
      "qty": "10.000", "price": "13100", "discountPerUnit": "500", "unitPrice": "12600", "lineTotal": "126000", "note": null,
      "available": "100.000" // chỉ phiếu tạm: có thể bán tại chi nhánh (không tự trừ chính phiếu này)
    }
  ],
  "warnings": [ // chi tiết/tạo/sửa phiếu tạm; CẢNH BÁO MỀM, không chặn
    { "code": "STOCK_RESERVED", "message": "B: cần 8.000, chỉ còn có thể bán 5.000", "productId": "…", "productCode": "B", "requested": "8.000", "available": "5.000" },
    { "code": "CREDIT_LIMIT_EXCEEDED", "message": "Vượt hạn mức công nợ …", "creditLimit": "100000", "balanceAfter": "206500" }
  ]
}
```

- `STOCK_RESERVED`: tổng số lượng một mặt hàng (cộng các dòng trùng) vượt số có thể bán. `CREDIT_LIMIT_EXCEEDED`: nợ hiện tại của khách **tại chi nhánh** + `total` vượt hạn mức (khách không có hạn mức thì không cảnh báo). Chỉ khi người gọi được xem nợ khách đó (`debt.view`; "chỉ của mình" = khách do mình phụ trách) cảnh báo mới kèm `creditLimit`, `balanceAfter` và số tiền trong `message`; còn lại chỉ có `code` và câu "Vượt hạn mức công nợ…" không số. Thiếu tồn thực tế chỉ bị chặn khi **xuất hóa đơn** (`422 STOCK_NOT_ENOUGH`).
- Sửa/hủy phiếu không còn là phiếu tạm → `422 INVALID_STATE`.
- `?format=xlsx`: mỗi dòng hàng một dòng, tiêu đề như file `DanhSachChiTietDatHang` của KiotViet.

### 5.2 Hóa đơn

> **Trạng thái:** đã triển khai (in PDF A4 làm sau; thu nợ về sau và cấn trừ hóa đơn làm cùng Sổ quỹ).

| Method | Đường dẫn               | Mô tả                                                                                      | Quyền            |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------ | ---------------- |
| GET    | `/invoices`             | Danh sách (`q`, `status`, `customerId`, `sellerId`, `orderId`, `hasDebt`, `from`, `to`, `sort`; `?format=xlsx`) | `invoice.view`   |
| GET    | `/invoices/:id`         | Chi tiết (dòng hàng, các khoản thu lúc xuất, `paid`/`debt`)                                 | `invoice.view`   |
| POST   | `/orders/:id/invoice`   | **Xuất hóa đơn từ phiếu tạm** (**Idempotency-Key**)                                          | `invoice.create` |
| POST   | `/invoices`             | Tạo hóa đơn trực tiếp, không qua phiếu (**Idempotency-Key**)                                 | `invoice.create` |
| PATCH  | `/invoices/:id`         | Chỉ sửa ghi chú `{ note }`                                                                  | `invoice.create` |
| POST   | `/invoices/:id/cancel`  | Hủy hóa đơn `{ reason }` (**bắt buộc lý do**)                                                | `invoice.cancel` |

Mọi endpoint cần `X-Branch-Id`; hóa đơn thuộc chi nhánh làm việc (chi nhánh khác → `404`). Quyền "chỉ của mình": Sale chỉ thấy/sửa hóa đơn có **người bán là chính mình**, không lập hộ người khác (`403`) và chỉ xuất hóa đơn cho phiếu do mình bán.

```json
// POST /invoices   (hóa đơn trực tiếp)
{
  "customerId": "…",
  "sellerId": "…?", // mặc định = người đang đăng nhập
  "invoicedAt": "…?", // mặc định bây giờ; không ở tương lai
  "items": [{ "productId": "…", "qty": "515", "price": "33500", "discountPerUnit": "500", "note": null }], // như đặt hàng (mục 5.1)
  "discount": "0",
  "note": null,
  "payments": [ // thanh toán LÚC XUẤT, tùy chọn; bỏ trống = ghi nợ toàn bộ
    { "method": "bank", "accountId": "…", "amount": "10000000" },
    { "method": "cash", "accountId": "…", "amount": "2000000" }
  ]
}

// POST /orders/:id/invoice   (từ phiếu tạm: lấy đúng dòng hàng, giảm giá, người bán của phiếu)
{ "payments": [ … ], "invoicedAt": "…?", "note": "…?" }
```

**Điều gì xảy ra khi tạo** (một transaction, nguyên tử; khóa nợ khách+chi nhánh trước, rồi phiếu, rồi dòng tồn):
1. **Kho:** trừ tồn từng dòng; giá vốn tại lúc bán lưu vào dòng (`unitCost`). Thiếu tồn thực tế → `422 STOCK_NOT_ENOUGH` và **không ghi gì**.
2. **Công nợ khách tại chi nhánh:** `+total` (hóa đơn), rồi `−` từng khoản thu.
3. **Thu tiền:** mỗi khoản `payments[]` tạo phiếu thu ở Sổ quỹ (mã `TT…`, danh mục "Tiền khách trả", đối tượng là khách). Quỹ phải thuộc chi nhánh làm việc, đang hoạt động và đúng loại với `method` (`cash`/`bank`), nếu không `400`. Tổng thu không vượt `total` (khách trả dư làm ở Sổ quỹ).
4. Phần chưa thu = `debt` tự nằm trong công nợ khách. Phiếu đặt hàng gốc → `completed`.
5. `warnings[]` (mềm, không chặn, chỉ trong phản hồi tạo): `STOCK_RESERVED` (vượt có thể bán vì hàng đang giữ cho phiếu tạm khác), `CREDIT_LIMIT_EXCEEDED` (nợ tại chi nhánh sau hóa đơn vượt hạn mức).

```json
// Invoice (response)
{
  "id": "…", "code": "HD016890", "status": "completed", // completed | cancelled
  "branchId": "…",
  "order": { "id": "…", "code": "DH022215" }, // null nếu hóa đơn trực tiếp
  "customer": { "id": "…", "code": "KH000003", "name": "…", "phone": "…" },
  "seller": { "id": "…", "fullName": "…" },
  "invoicedAt": "2026-11-03T07:11:16.170Z",
  "subtotal": "33735000", "discount": "0", "total": "33735000",
  "paid": "10000000", "debt": "23735000", // debt = total − paid (paid gồm cả khoản cấn trừ thu nợ về sau)
  "totalQty": "515.000", "itemCount": 1,
  "note": "…",
  "createdBy": { "id": "…", "fullName": "…" }, "createdAt": "…", "updatedAt": "…",
  "cancelledAt": null, "cancelReason": null,
  "items": [ // chỉ ở chi tiết
    {
      "lineNo": 1, "productId": "…", "code": "QKBSP", "name": "Quạt kẹp bàn Super MST-A1",
      "qty": "515.000", "price": "33500", "discountPerUnit": "500", "unitPrice": "33000", "lineTotal": "16995000", "note": null,
      "unitCost": "21800.5000" // CHỈ khi có quyền product.cost.view
    }
  ],
  "payments": [ // chỉ ở chi tiết
    { "method": "bank", "accountId": "…", "accountName": "Ngân hàng Sài Gòn", "amount": "10000000", "paidAt": "…", "cashCode": "TT019330" }
  ],
  "grossProfit": "…", // lãi gộp = total − Σ(qty × unitCost); CHỈ ở chi tiết và khi có product.cost.view
  "warnings": []
}
```

**Hủy hóa đơn** (`invoice.cancel`, không có phạm vi riêng): bút toán đảo, không xóa gì.
- Cộng lại tồn đúng giá vốn đã xuất; đảo công nợ (`−total`, rồi `+` từng khoản đã thu); các phiếu thu lúc xuất chuyển `cancelled` ở Sổ quỹ.
- Phiếu đặt hàng gốc **quay về phiếu tạm** để sửa và xuất lại hóa đơn.
- `422 INVALID_STATE` nếu đã hủy. `409 INVALID_STATE` nếu còn **phiếu trả hàng hoàn tất** gắn hóa đơn (hủy phiếu trả trước) hoặc đã được **cấn trừ thu nợ** (hủy các phiếu thu liên quan trước).
- Hóa đơn hoàn tất **không sửa** (chỉ ghi chú): hủy rồi lập lại.
- `?format=xlsx`: mỗi dòng hàng một dòng, tiêu đề như file `DanhSachChiTietHoaDon` của KiotViet (có `Tiền mặt`, `Chuyển khoản` đã thu lúc xuất).

### 5.3 Trả hàng bán

> **Trạng thái:** đã triển khai.

| Method | Đường dẫn                   | Mô tả                                                                                          | Quyền           |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------- | --------------- |
| GET    | `/sales-returns`            | Danh sách (`q`, `status`, `customerId`, `sellerId`, `invoiceId`, `from`, `to`, `sort`; `?format=xlsx`) | `invoice.view`  |
| GET    | `/sales-returns/:id`        | Chi tiết                                                                                        | `invoice.view`  |
| POST   | `/sales-returns`            | Tạo phiếu trả (**Idempotency-Key**)                                                              | `return.create` |
| PATCH  | `/sales-returns/:id`        | Chỉ sửa ghi chú `{ note }`                                                                       | `return.create` |
| POST   | `/sales-returns/:id/cancel` | Hủy phiếu trả `{ reason? }` (bút toán đảo)                                                       | `return.cancel` |

Mọi endpoint cần `X-Branch-Id`; phiếu về chi nhánh của hóa đơn gốc (chi nhánh khác → `404`). Quyền "chỉ của mình": `return.create` chỉ trả cho **hóa đơn do mình bán** (bắt buộc có `invoiceId`; trả không hóa đơn hoặc hóa đơn người khác → `403`); `invoice.view` chỉ thấy phiếu trả của hóa đơn mình bán.

```json
// POST /sales-returns
{
  "customerId": "…",
  "invoiceId": "…?", // hóa đơn gốc (hoàn tất, cùng chi nhánh và khách); bỏ trống = trả không tham chiếu hóa đơn
  "returnedAt": "…?", // mặc định bây giờ; không ở tương lai
  "receivedById": "…?", // người nhận trả; mặc định = người đang đăng nhập
  "note": null,
  "items": [ // 1–500 dòng hàng hóa; trả hàng vẫn cho phép với hàng đã ngưng kinh doanh
    {
      "productId": "…",
      "qty": "36",
      "returnPrice": "130000", // giá trả (Giá bán) trên 1 đơn vị, số nguyên đồng
      "restockPrice": "120000", // Giá nhập lại, tùy chọn (mặc định = returnPrice)
      "restock": true, // true (mặc định) = nhập lại kho; false = không nhập kho
      "note": "lô mới nhỏ hơn khách ko lấy"
    }
  ]
}
```

- **Tiền:** `lineTotal = qty × returnPrice` (làm tròn đồng), `total = Σ lineTotal`. Gửi `lineTotal`/`total` → `400`.
- **Công nợ:** tiền trả khách **luôn ghi giảm công nợ khách** tại chi nhánh (`−total`). Phiếu không có hoàn tiền/`settlement`; trả tiền mặt lại cho khách làm bằng phiếu chi ở Sổ quỹ.
- **Kho:** dòng `restock` cộng lại tồn **nhưng KHÔNG đổi giá vốn bình quân** (cộng theo giá vốn hiện tại). Chênh lệch `(returnPrice − restockPrice) × qty` của các dòng nhập kho được tính vào lợi nhuận; chi tiết trả `priceDifference` (chỉ khi có `product.cost.view`). Dòng `restock = false` không đổi tồn (`restockPrice` = `null`).
- **Có `invoiceId`:** mỗi mặt hàng, tổng trả (các phiếu trả hoàn tất + phiếu này) không vượt tổng đã bán trên hóa đơn (cộng các dòng cùng mặt hàng); vượt hoặc hàng không có trong hóa đơn → `422 RETURN_QTY_EXCEEDED` (`details[].field = items.N.qty`). **Giá trả (`returnPrice`) không được vượt giá bán thực của dòng trong hóa đơn** = (thành tiền dòng − phần giảm giá phiếu chia theo tỷ lệ tiền dòng) ÷ số lượng, làm tròn lên đồng (mặt hàng lặp nhiều dòng lấy giá cao nhất); vượt → `422 RETURN_PRICE_EXCEEDED` (`details[].field = items.N.returnPrice`), để trả hàng không làm nợ khách giảm nhiều hơn số khách thực phải trả. Hóa đơn đã hủy → `422 INVALID_STATE`; khác khách → `400`.
- Phiếu đã hủy thì phần đã trả không còn được tính (trả lại được).

**Hủy phiếu trả** (`return.cancel`, mặc định Kế toán): trừ lại tồn của các dòng đã nhập lại kho (không đủ tồn vì đã bán đi → `422 STOCK_NOT_ENOUGH`, không hủy được) và cộng lại công nợ khách; hủy hai lần → `422 INVALID_STATE`. Hóa đơn gốc chỉ hủy được sau khi các phiếu trả của nó đã hủy (mục 5.2).

```json
// SalesReturn (response)
{
  "id": "…", "code": "TH001076", "status": "completed", // completed | cancelled
  "branchId": "…",
  "customer": { "id": "…", "code": "KH000002", "name": "…", "phone": "…" },
  "invoice": { "id": "…", "code": "HD016890" }, // null nếu trả không hóa đơn
  "seller": { "id": "…", "fullName": "…" }, // người bán của hóa đơn gốc
  "returnedAt": "…", "receivedBy": { "id": "…", "fullName": "…" },
  "total": "82000", "totalQty": "8.000", "itemCount": 2,
  "note": null,
  "createdBy": { … }, "createdAt": "…", "updatedAt": "…", "cancelledAt": null, "cancelReason": null,
  "items": [ // chỉ ở chi tiết
    { "productId": "…", "code": "A", "name": "…", "qty": "6.000", "returnPrice": "13000", "restockPrice": "12000", "restock": true, "lineTotal": "78000", "note": null }
  ],
  "priceDifference": "6000" // chỉ ở chi tiết và khi có product.cost.view
}
```

`?format=xlsx`: mỗi dòng hàng một dòng, tiêu đề như file `DanhSachChiTietTraHang` của KiotViet (`Tiền mặt`/`Chuyển khoản` luôn 0, `Giá nhập lại` là giá nhập lại của dòng).

---

## 6. Sổ quỹ

| Method     | Đường dẫn                                  | Mô tả                                      | Quyền         | Mốc |
| ---------- | ------------------------------------------ | ------------------------------------------ | ------------- | --- |
| GET        | `/cash-accounts`                           | Quỹ tiền mặt / tài khoản ngân hàng + số dư | `cash.view`   | W6  |
| POST/PATCH | `/cash-accounts`, `/cash-accounts/:id`     | Tạo / sửa quỹ                              | `cash.manage` | W6  |
| GET        | `/cash-categories`                         | Danh mục thu chi (`direction`)             | `cash.view`   | W6  |
| POST/PATCH | `/cash-categories`, `/cash-categories/:id` | Tạo / sửa danh mục                         | `cash.manage` | W6  |
| GET        | `/cash-transactions`                       | Danh sách phiếu thu/chi + tổng hợp kỳ      | `cash.view`   | W6  |
| GET        | `/cash-transactions/:id`                   | Chi tiết                                   | `cash.view`   | W6  |
| POST       | `/cash-transactions`                       | Tạo phiếu thu/chi (**Idempotency-Key**)    | `cash.create` | W6  |
| POST       | `/cash-transactions/:id/cancel`            | Hủy phiếu `{ reason }`                     | `cash.cancel` | W6  |

Bộ lọc `GET /cash-transactions`: `from`, `to`, `direction`, `categoryId`, `accountId`, `partyType`, `partyId`, `q`.

```json
// GET /cash-transactions?from=2026-11-01&to=2026-11-03
{
  "summary": {
    "openingBalance": "300000000",
    "totalIn": "100000000",
    "totalOut": "150000000",
    "closingBalance": "250000000"
  },
  "data": [
    {
      "id": "…",
      "code": "CTM002305",
      "direction": "out",
      "amount": "2800000",
      "category": { "id": "…", "name": "SỬA CHỮA KHO" },
      "account": { "id": "…", "name": "Tiền mặt", "type": "cash" },
      "party": null,
      "partyName": null,
      "vehicleRef": null,
      "occurredAt": "…",
      "note": null,
      "status": "completed"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 32, "totalPages": 2 }
}
```

`amount` luôn **dương**; chiều thu/chi do `direction`. `summary` tính cho toàn bộ bộ lọc (không chỉ trang hiện tại).

```json
// POST /cash-transactions
{
  "direction": "out",
  "amount": "4300000",
  "categoryId": "…",
  "accountId": "…",
  "occurredAt": "…?",
  "party": { "type": "supplier", "id": "…" }, // tùy chọn; hoặc dùng partyName (chữ) khi không có trong hệ thống
  "partyName": null,
  "vehicleRef": null, // biển số/xe cho chi phí vận chuyển, xăng xe
  "allocations": [{ "invoiceId": "…", "amount": "4300000" }], // chỉ khi thu nợ khách (direction=in, party.type=customer)
  "note": null
}
```

- **Thu nợ khách** nên dùng `POST /customers/:id/receipts` (tiện hơn); `cash-transactions` dùng cho thu/chi khác và trả nợ NCC (`party.type = "supplier"`, danh mục "Công nợ").
- Phiếu đã tạo **không sửa**, chỉ hủy.

---

## 7. Tổng quan

| Method | Đường dẫn    | Mô tả             | Quyền            | Mốc |
| ------ | ------------ | ----------------- | ---------------- | --- |
| GET    | `/dashboard` | Số liệu trang chủ | `dashboard.view` | W8  |

```json
{
  "asOf": "2026-11-03T08:00:00.000Z",
  "revenue": { "today": "128000000", "thisMonth": "1500000000", "lastMonth": "2800000000" },
  "invoiceCount": { "today": 65, "thisMonth": 129, "lastMonth": 1900 },
  "receivable": "5000000000", // tổng khách đang nợ (chỉ cộng số dư dương)
  "payable": "240000000",
  "cashBalance": "250000000",
  "topProducts": [
    { "productId": "…", "code": "QKBSP", "name": "…", "qty": "515", "revenue": "16995000" }
  ], // 10 dòng, tháng này
  "topCustomers": [{ "customerId": "…", "code": "KH000003", "name": "…", "revenue": "33735000" }], // 10 dòng, tháng này
  "dailyRevenue": [{ "date": "2026-10-05", "revenue": "…", "invoiceCount": 12 }] // 30 ngày gần nhất, đủ ngày (ngày không bán = 0)
}
```

---

## 8. Báo cáo

Tất cả nhận `?format=json` (mặc định) \| `xlsx` \| `pdf`. Quyền theo từng báo cáo: `/reports/inventory` → `report.inventory`; `/reports/sales` → `report.sales` (phạm vi `own` thì chỉ tính đơn của mình; cột lãi gộp chỉ có khi có `product.cost.view`); `/reports/customer-debt`, `/reports/supplier-debt` → `report.debt`; `/reports/cash-book` → `report.cash`.

| Method | Đường dẫn                | Mô tả                             | Tham số chính                                                                                       | Mốc |
| ------ | ------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------- | --- |
| GET    | `/reports/inventory`     | Tồn kho: SL, giá vốn, giá trị tồn | `asOf`, `q`, `onlyInStock`, `noMovementDays`                                          | W4  |
| GET    | `/reports/sales`         | Doanh số + lãi gộp                | `from`, `to`, `groupBy=day\|month\|customer\|product\|seller`, `customerId` | W5  |
| GET    | `/reports/customer-debt` | Công nợ khách theo tuổi nợ        | `asOf`, `salesOwnerId`, `overdueOnly`, `q`                                                          | W6  |
| GET    | `/reports/cash-book`     | Sổ quỹ theo kỳ/loại               | `from`, `to`, `accountId`, `groupBy=category\|day`                                                  | W6  |
| GET    | `/reports/supplier-debt` | Công nợ NCC                       | `asOf`, `q`                                                                                         | W7  |

Cấu trúc chung cho dạng JSON: `{ "params": {…}, "columns": [{ "key": "…", "title": "…", "type": "text|money|qty|date" }], "rows": [ {…} ], "totals": {…} }` — frontend dựng bảng **theo `columns`** nên thêm cột không phải sửa giao diện.

```json
// GET /reports/sales?from=2026-11-01&to=2026-11-30&groupBy=customer
{
  "params": { "from": "2026-11-01", "to": "2026-11-30", "groupBy": "customer" },
  "columns": [
    { "key": "name", "title": "Khách hàng", "type": "text" },
    { "key": "invoiceCount", "title": "Số hóa đơn", "type": "qty" },
    { "key": "revenue", "title": "Doanh thu", "type": "money" },
    { "key": "grossProfit", "title": "Lãi gộp", "type": "money" } // bị bỏ nếu thiếu quyền xem giá vốn
  ],
  "rows": [
    {
      "key": "…",
      "name": "Cửa hàng Ví Dụ 3",
      "invoiceCount": "3",
      "revenue": "33735000",
      "grossProfit": "6200000"
    }
  ],
  "totals": { "invoiceCount": "129", "revenue": "1500000000", "grossProfit": "…" }
}
```

---

## 9. Nhập dữ liệu từ Excel

> **Trạng thái:** đã triển khai cho `products` và `customers`; `suppliers` trả `400 IMPORT_TYPE_NOT_SUPPORTED` (sẽ làm cùng đợt chuyển dữ liệu NCC). Chỉ người có quyền `import.run` (mặc định chỉ Quản lý).

Dùng cho import hàng loạt (chuyển dữ liệu từ KiotViet và nhập tay bằng file). **Xử lý ngay trong yêu cầu** (vài nghìn dòng), kết quả có sẵn trong phản hồi; vẫn xem lại được bằng `GET /imports/:id`.

| Method | Đường dẫn                 | Mô tả                                                                                          | Quyền        |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------------- | ------------ |
| POST   | `/imports/:type`          | Tải file lên (`multipart/form-data`, field `file`, ≤ 10 MB). `type`: `products`, `customers` | `import.run` |
| GET    | `/imports/:id`            | Kết quả và lỗi từng dòng của một lần nhập                                                      | `import.run` |
| GET    | `/imports/:type/template` | Tải file Excel mẫu                                                                             | `import.run` |

Tham số query của `POST`: `allowDuplicate` (xem "Chống nạp lại"), `dryRun` (**mặc định `true`**: chỉ kiểm tra, không ghi gì; gửi `dryRun=false` mới ghi thật), `branchId` (chi nhánh làm việc; **bắt buộc khi `mode=add`** vì cộng/trừ tồn kho của chi nhánh đó, ở chế độ đè có thể bỏ trống), `mode` (`overwrite` mặc định = **Import đè**; `add` = **Import thêm**, xem mục "Hai chế độ nhập"). Giá trị `mode` khác → `400 VALIDATION_ERROR`. Phản hồi có thêm field `mode`.

```json
// POST /imports/products?dryRun=false&branchId=…   → 202
{
  "id": "…",
  "type": "products",
  "status": "completed", // completed | failed   (queued/running chỉ dành cho bản chạy nền sau này)
  "dryRun": false,
  "fileName": "SanPham.xlsx",
  "total": 2787, // số dòng dữ liệu trong file
  "created": 2700, // sẽ tạo / đã tạo
  "updated": 87, // chỉ tính bản ghi CÓ THAY ĐỔI THẬT → chạy lại cùng file cho 0
  "failed": 0, // số dòng có lỗi
  "errors": [], // [{ "row": 15, "field": "Mã hàng", "message": "Mã hàng trùng với dòng 12 trong file" }]
  "warnings": [], // cảnh báo không chặn việc ghi (cùng dạng errors), vd SĐT khách trùng; chỉ khách hàng dùng
  "createdAt": "…",
  "finishedAt": "…"
}
```

**Hai chế độ nhập (`mode`)** — file phải đúng định dạng file mẫu (`GET /imports/products/template`):

**Chống nạp lại (chỉ `mode=add`):** cộng tồn không idempotent nên mỗi file (so theo **nội dung**, SHA-256) chỉ được Import thêm THẬT một lần cho mỗi chi nhánh. Gửi lại đúng file đó — kể cả với `dryRun=true` — trả `409 IMPORT_DUPLICATE_FILE` kèm `details: { importId, fileName, importedAt }` của lần nhập trước. File lỗi hoặc lần chạy thử không tính là đã nhập; chi nhánh khác hoặc file khác nội dung thì không bị chặn. Muốn cố ý nhập lại: thêm `allowDuplicate=true` (lần đó được ghi nhật ký `allowDuplicate`). Chế độ `overwrite` không bị chặn.

| | `overwrite` — Import đè (mặc định) | `add` — Import thêm |
| --- | --- | --- |
| Khóa so khớp | `Mã hàng`, không phân biệt hoa thường | như bên trái |
| Mã đã có | Thông tin trong file **đè** lên bản cũ (ô trống giữ nguyên). Mã không có trong file thì không đổi | **Chỉ CỘNG/TRỪ tồn** theo cột `Tồn kho` của chi nhánh `branchId`; mọi thông tin khác (tên, nhóm, mô tả, trạng thái, trạng thái thanh lý, ảnh, thành phần) **giữ nguyên bản cũ** |
| Mã mới | Tạo mới | Tạo mới đầy đủ (cần `Tên hàng`) rồi cộng tồn |
| Cột `Tồn kho`, `Giá vốn` | Bị bỏ qua | Dùng như bên dưới |
| Chạy lại cùng file | Không đổi gì (idempotent) | Bị **chặn** `409 IMPORT_DUPLICATE_FILE` nếu file đã nhập thật vào chi nhánh này (xem "Chống nạp lại"); luôn chạy `dryRun=true` trước |

Chi tiết `add`: bắt buộc `branchId` và cột `Tồn kho`. `Tồn kho` là số lượng **cộng thêm** (tối đa 3 chữ số thập phân); **số âm = trừ tồn** (không cho tồn xuống dưới 0: dòng đó báo lỗi, `STOCK_NOT_ENOUGH` ở mức dòng); ô trống hoặc `0` = không đổi tồn. `Giá vốn` (không âm, tối đa 4 chữ số thập phân, tùy chọn) là giá nhập của lô cộng thêm → giá vốn bình quân gia quyền của chi nhánh được tính lại; thiếu thì giữ giá vốn hiện tại; khi trừ tồn thì luôn theo giá vốn hiện tại (bỏ qua `Giá vốn` trong file). Combo không có tồn riêng nên dòng combo có `Tồn kho` là lỗi. Tồn đổi qua `InventoryService`, ghi sổ cái loại `adjustment` với chứng từ gốc `IMP-XXXXXXXX` (`refId` = id lần nhập) — hiện ở thẻ kho. Chỉ dòng làm đổi tồn hoặc tạo mới mới được tính vào `updated`/`created`.

**Quy tắc chung**

- **Tất cả hoặc không gì cả:** có **bất kỳ dòng lỗi nào** thì `status = "failed"`, `created = updated = 0` và **không ghi gì** (kể cả các dòng tốt). Sửa file rồi nhập lại. `errors[].row` là số dòng trong file Excel (dòng 1 là tiêu đề; lỗi thiếu cột báo ở dòng 1), tối đa 500 lỗi đầu.
- `dryRun=true` chạy toàn bộ rồi hoàn tác nên báo cáo chính xác (kể cả lỗi trùng/ràng buộc CSDL) nhưng không lưu.
- Chế độ `overwrite`: cập nhật theo **mã hàng, không phân biệt hoa thường**, chạy lại nhiều lần không tạo trùng. (Chế độ `add` cộng tồn nên không idempotent, xem trên.)
- Ô trống = **giữ nguyên** giá trị cũ (không xóa).
- Lỗi hệ thống bất ngờ → `status = "failed"` với một lỗi `row = 0`, không ghi gì.
- Sai định dạng file (không phải `.xlsx`) → `400 VALIDATION_ERROR`; thiếu file → `400`; file > 10 MB → `413 PAYLOAD_TOO_LARGE`.

**`products`** — nhận tiêu đề cột của file KiotViet (không phân biệt hoa thường/dấu):

| Cột                                      | Ghi chú                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Mã hàng`, `Tên hàng`                    | **Bắt buộc**. Mã theo quy tắc ở mục 2.2; không trùng trong file                                                                                     |
| `Trạng thái thanh lý`                    | `Thường` (mặc định), `Thanh Lý`, `Tắt Mã`, `Tồn Cao`, `Tồn Ưu Tiên` (nhận cả mã `normal`…). Ô trống = giữ nguyên |
| `Tồn nhỏ nhất`, `Tồn lớn nhất`, `Vị trí`, `Giá bán` | **Bị bỏ qua** (hệ thống không còn tồn tối thiểu/tối đa, vị trí kho nằm ở bảng riêng sau này, không có giá bán) |
| `Loại hàng`                              | `Hàng hóa` (mặc định) hoặc `Combo` (KiotViet ghi `Combo - Đóng gói` cũng nhận). Trống mà có `Hàng thành phần` → coi là combo. Không đổi được loại của hàng đã có qua Excel |
| `Hàng thành phần`                        | Của combo, dạng `MSP/SL,MSP/SL`. Thành phần là hàng hóa trong file (dù đứng sau) hoặc đã có trong hệ thống; chạy lại cùng file không đổi gì, đổi số lượng thì cập nhật |
| `Nhóm hàng(3 Cấp)` (file cũ) | Bỏ qua; không tạo hoặc lưu nhóm hàng |
| `Tồn kho`, `Giá vốn` | **Chỉ dùng ở `mode=add`** (cộng/trừ tồn, giá nhập của lô cộng); ở `overwrite` bị bỏ qua (số dư đầu kỳ do công cụ chuyển dữ liệu riêng xử lý) |
| `Giá bán` và cột khác | **Bị bỏ qua**: hệ thống không có giá bán |
| `Đang kinh doanh`                        | `1`/`0`                                                                                                                                             |
| `Mô tả`                                  |                                                                                                                                                     |
| `Hình ảnh (url1,url2...)`                | Nhiều địa chỉ `http(s)` cách nhau dấu phẩy → **giữ nguyên URL gốc** (không tải về kho file); thêm ảnh chưa có, không xóa ảnh hiện có; tối đa 10 ảnh |


**`customers`** — nhập theo file `TKS_Bao_cao_kinh_doanh_customers` (`GET /imports/customers/template`). Cần `import.run` **và** `customer.edit` ở phạm vi **tất cả** (nhập hàng loạt sửa khách của mọi nhân viên → `403` nếu không đủ). Chỉ có chế độ cập nhật (`mode=add` → `400`); không cần `branchId`.

- **Ghép dòng với khách có sẵn:** theo `Mã Khách hàng` (không phân biệt hoa thường) nếu có, ngược lại theo `Tên khách` (bỏ dấu, không phân biệt hoa thường). Không ghép được → tạo mới (mã tự cấp `KH…` nếu ô mã trống). Tên trùng nhiều khách hoặc trùng giữa các dòng trong file mà không có mã → lỗi dòng (hãy ghi mã). Mã trùng khách hệ thống/đã xóa → lỗi.
- **Ô trống** = giữ nguyên (khi cập nhật) hoặc mặc định (khi tạo). Chạy lại cùng file không tạo trùng (`updated = 0` nếu không có gì đổi).
- **Các lần nhập khách chạy lần lượt** (khóa tư vấn trong CSDL): hai lần nhập cùng lúc (bấm đúp, hai người cùng nhập) không bao giờ nhân đôi khách hay công nợ đầu kỳ; lần đến sau thấy khách đã có và báo lỗi như chạy lại cùng file.

| Cột | Ghi chú |
| --- | --- |
| `Tên khách` | **Bắt buộc** |
| `Mã Khách hàng` | Chữ, số, `-` `_` `.`, ≤ 30 ký tự |
| `Sale` | Ghép với **họ tên** (hoặc mã `NV…`) người dùng đang hoạt động, bỏ dấu và hoa thường; không thấy hoặc trùng nhiều người → lỗi dòng. Cần tạo tài khoản nhân viên trước |
| `Level giá` | `Mới`, `Vừa`, `Lớn`, `Vip`; trống = `Mới` khi tạo |
| `Khách mới` | `T6/26` (tháng 6/2026), `T6/26-Page` (thêm nguồn `Page`), `Cũ` (khách cũ: bỏ tháng khách mới) |
| `Điện thoại` | Chuẩn hóa. Ô nhiều số (ngăn bằng `/ , ;`, có nhãn tên, hoặc 20/30 chữ số liền) → số đầu là SĐT, các số còn lại nối vào Ghi chú (`SĐT khác: …`). Số không hợp lệ → **cảnh báo** và giữ nguyên văn trong Ghi chú (`SĐT gốc: …`), không chặn. Trùng khách khác/trùng dòng khác → cảnh báo |
| `Địa chỉ`, `Ghi chú` | |
| `Trạng thái` | `1`/`0` hoặc "Đang hoạt động"/"Ngưng"; trống = đang hoạt động |
| `Định vị kho`, `Số lượng kho`, `Diện tích`, `Đối thủ`, `Quy mô khách` | Hồ sơ kho. `Chưa có` ở Quy mô = xóa quy mô |
| `Hình thức bán hàng` | Nhiều giá trị cách nhau dấu phẩy, thuộc: Bán cửa hàng, FB live, Kho buôn, Bán sàn, Sang tay, FB ads, Khác |
| `Ảnh kho` | Đường link `http(s)`; giá trị khác → cảnh báo và bỏ qua |
| `Tiếp khách lần cuối`, `Các ngày tiếp khách` | Ngày `dd/mm/yyyy`, nhiều ngày ngăn bằng dấu phẩy; không được ở tương lai. Thêm vào lịch tiếp khách, ngày đã có thì bỏ qua |
| `Công nợ Hà Nội`, `Công nợ Sài Gòn` | **Công nợ đầu kỳ** của từng chi nhánh (số nguyên đồng, được âm = khách dư). Ghi bút toán `opening` vào sổ công nợ chi nhánh đó. **Chỉ cho khách tạo mới** (khách đã có mà ô nợ khác 0 → lỗi, tránh ghi đầu kỳ hai lần) và chỉ chi nhánh người nhập được phép; cần quyền riêng **`customer.debt.opening`** (mặc định chỉ Quản lý) |

Nhập thật có thể chạy bằng dòng lệnh: `pnpm --filter @kiot/api kiotviet:import -- --type customers --file <file.xlsx> [--apply]` (mặc định chỉ chạy thử).

- Nên cho người dùng chạy `dryRun=true` trước, xem lỗi rồi mới chạy thật (`dryRun=false`).
- Import số dư đầu kỳ (tồn, nợ, quỹ) **không** mở cho giao diện; backend chạy bằng công cụ riêng khi chuyển đổi.

---

## 10. Phân quyền (dành cho Quản lý)

Quyền của từng vai trò là **dữ liệu trong CSDL**, do Quản lý chỉnh trên màn hình _Phân quyền_; không còn cố định trong mã. Mọi endpoint dưới đây cần quyền `role.manage` (chỉ vai trò Quản lý có, không thể cấp cho vai trò khác). Quy tắc và giải thích: [`README.md`](README.md) mục 8.

| Method | Đường dẫn                        | Mô tả                                             | Mốc |
| ------ | -------------------------------- | ------------------------------------------------- | --- |
| GET    | `/permissions/catalog`           | Danh mục quyền gom theo phân hệ (để dựng ma trận) | W1  |
| GET    | `/roles`                         | 7 vai trò kèm số quyền, số người dùng             | W1  |
| GET    | `/roles/:role/permissions`       | Quyền hiện tại của một vai trò                    | W1  |
| PUT    | `/roles/:role/permissions`       | Đặt lại **toàn bộ** quyền của vai trò             | W1  |
| POST   | `/roles/:role/permissions/reset` | Khôi phục cấu hình mặc định của vai trò           | W1  |

`:role` là một trong `manager`, `assistant`, `accountant`, `warehouse`, `driver`, `sales`, `marketing`.

```jsonc
// GET /permissions/catalog
{
  "modules": [
    {
      "key": "sales", "label": "Đơn hàng",
      "permissions": [
        { "code": "invoice.view", "label": "Xem hóa đơn", "description": null,
          "scopable": true,                       // có thể chọn "chỉ của mình"
          "requires": ["customer.view"],          // tự được thêm khi bật quyền này
          "lockedToAdmin": false },
        { "code": "invoice.cancel", "label": "Hủy hóa đơn", "scopable": false,
          "requires": ["invoice.view"], "lockedToAdmin": false }
      ]
    }
  ]
}

// GET /roles
[
  { "role": "manager", "label": "Quản lý", "locked": true,  "permissionCount": 31, "userCount": 1 },
  { "role": "sales",   "label": "Sale",    "locked": false, "permissionCount": 11, "userCount": 8 }
]

// GET /roles/sales/permissions
{ "role": "sales", "label": "Sale", "locked": false,
  "permissions": [
    { "code": "product.view",  "scope": "all" },
    { "code": "invoice.view",  "scope": "own" }
  ] }
```

```jsonc
// PUT /roles/sales/permissions   — gửi bộ quyền MỚI (thay thế toàn bộ bộ cũ)
{ "permissions": [
    { "code": "product.view",   "scope": "all" },
    { "code": "invoice.create", "scope": "own" }
] }

// 200 — bộ quyền cuối cùng sau khi server chuẩn hóa
{ "role": "sales", "label": "Sale", "locked": false,
  "permissions": [
    { "code": "product.view",   "scope": "all" },
    { "code": "customer.view",  "scope": "own" },
    { "code": "order.view",     "scope": "own" },
    { "code": "invoice.view",   "scope": "own" },
    { "code": "invoice.create", "scope": "own" }
  ],
  "autoAdded": ["customer.view", "order.view", "invoice.view"] }   // hiện cho người dùng: "đã tự bật thêm…"
```

Lỗi thường gặp:

| HTTP | `code`              | Khi nào                                                                        |
| ---- | ------------------- | ------------------------------------------------------------------------------ |
| 400  | `VALIDATION_ERROR`  | Mã quyền không có trong danh mục (`details.unknown`), phạm vi sai, thiếu field |
| 400  | `PERMISSION_LOCKED` | Cố cấp `user.manage` / `role.manage` cho vai trò khác (`details.locked`)       |
| 404  | `NOT_FOUND`         | `:role` không phải vai trò hợp lệ                                              |
| 409  | `ROLE_LOCKED`       | Cố sửa/khôi phục vai trò `manager` (luôn đủ quyền)                             |

**Lưu ý cho frontend khi dựng màn hình:**

- Dựng ma trận từ `/permissions/catalog` (hàng = quyền, gom theo `modules`; cột = vai trò). Ô của quyền `scopable` có thêm lựa chọn **Tất cả / Chỉ của mình**; quyền `lockedToAdmin` hiển thị khóa.
- Bật một quyền có `requires` thì **hiển thị trước** các quyền đi kèm sẽ tự bật (frontend có thể tự bật theo `requires`); kết quả cuối cùng luôn lấy theo response của PUT.
- Cột `manager` chỉ để xem (khóa). Nút "Khôi phục mặc định" gọi `POST …/reset` và cần hộp thoại xác nhận.
- Có hiệu lực **ngay** cho mọi người dùng thuộc vai trò đó, không cần đăng nhập lại. Frontend nên gọi lại `GET /auth/me` khi nhận `403 FORBIDDEN` hoặc khi tải lại trang để cập nhật menu/nút.
- Nên cảnh báo khi Quản lý bỏ quyền làm vai trò đó mất khả năng làm việc (vd bỏ `product.view` của Sale) — server vẫn cho phép.
- Mọi thay đổi được ghi vào nhật ký thao tác (ai đổi, trước/sau).

---

## 11. Chi nhánh và chuyển kho

Công ty có **2 chi nhánh dùng chung một hệ thống** (Hà Nội, Sài Gòn). Quy tắc chung cho mọi endpoint: [`README.md`](README.md) mục "Nhiều chi nhánh".

### 11.1 Chuyển kho giữa hai chi nhánh

Quy trình **hai bước**: chi nhánh gửi lập phiếu (trừ tồn bên gửi, hàng "đang đi đường") → chi nhánh nhận xác nhận (cộng tồn bên nhận, tính giá vốn, ghi công nợ đối ứng). Mã phiếu `CH000001`.

| Method | Đường dẫn                      | Mô tả                                                        | Quyền              | Mốc |
| ------ | ------------------------------ | ------------------------------------------------------------ | ------------------ | --- |
| GET    | `/stock-transfers`             | Danh sách (`status`, `direction=out\|in`, `from`, `to`, `q`) | `transfer.view`    | W5  |
| GET    | `/stock-transfers/:id`         | Chi tiết                                                     | `transfer.view`    | W5  |
| POST   | `/stock-transfers`             | **Bước 1 — gửi hàng** (**Idempotency-Key**)                  | `transfer.create`  | W5  |
| POST   | `/stock-transfers/:id/receive` | **Bước 2 — nhận hàng** (**Idempotency-Key**)                 | `transfer.receive` | W5  |
| POST   | `/stock-transfers/:id/cancel`  | Hủy khi còn đang đi đường `{ reason }` (bắt buộc lý do)      | `transfer.create`  | W5  |
| GET    | `/stock-transfers/:id/print`   | PDF phiếu chuyển kho                                         | `transfer.view`    | W5  |

Người dùng thấy phiếu mà chi nhánh **gửi hoặc nhận** nằm trong chi nhánh họ được phép. Chỉ người thuộc **chi nhánh gửi** mới tạo/hủy phiếu; chỉ người thuộc **chi nhánh nhận** mới xác nhận nhận (Quản lý làm được cả hai).

```jsonc
// POST /stock-transfers   — chi nhánh gửi = chi nhánh làm việc (X-Branch-Id)
{
  "toBranchId": "…",
  "items": [
    { "productId": "…", "qty": "40" },
    { "productId": "…", "qty": "10" }
  ],
  "shippingFee": "1000",             // phí vận chuyển, số nguyên đồng; mặc định "0"
  "shippingPaidBy": "sender",        // "sender" (mặc định) | "receiver": bên ứng tiền trả xe
  "note": "Xe tải 51D-xxxxx"
}

// 201
{
  "id": "…", "code": "CH000001", "status": "in_transit",       // in_transit | received | cancelled
  "fromBranch": { "id": "…", "code": "SG", "name": "Chi nhánh Sài Gòn" },
  "toBranch":   { "id": "…", "code": "HN", "name": "Chi nhánh Hà Nội" },
  "sentAt": "…", "receivedAt": null,
  "goodsValue": "60000",             // theo giá vốn bên gửi — vắng mặt nếu thiếu quyền product.cost.view
  "shippingFee": "1000", "shippingPaidBy": "sender",
  "debtAmount": null,                // có giá trị sau khi nhận: tiền hàng (+ phí nếu bên gửi ứng)
  "items": [
    { "productId": "…", "code": "QKBSP", "name": "…", "qty": "40",
      "unitCostSent": "1000.0000",       // giá vốn — chỉ có khi có product.cost.view
      "shippingShare": "667",            // phần phí phân bổ cho dòng này, theo tỷ lệ giá trị hàng
      "unitCostReceived": null }         // = unitCostSent + shippingShare / qty, có sau khi nhận
  ],
  "note": "…", "createdBy": { "id": "…", "fullName": "…" }, "createdAt": "…"
}
```

**Quy tắc nghiệp vụ**

- Giá nhập kho bên nhận = **giá vốn bên gửi + phí vận chuyển phân bổ** (theo tỷ lệ giá trị từng dòng); giá vốn bình quân của bên nhận được tính lại. Phí vẫn được lưu riêng ở `shippingFee`.
- Nhận hàng **phải đủ** số lượng ghi trên phiếu (chưa hỗ trợ nhận thiếu). Sai lệch thì hủy phiếu khi còn đi đường rồi lập lại.
- Công nợ đối ứng ghi **khi nhận**: chi nhánh gửi thấy chi nhánh nhận là **khách hàng nội bộ** (phải thu), chi nhánh nhận thấy chi nhánh gửi là **nhà cung cấp nội bộ** (phải trả). Thanh toán công nợ này bằng phiếu thu/chi thường ở Sổ quỹ.
- Phiếu chuyển kho **không phải hóa đơn bán**: không tính vào doanh thu, lãi gộp hay Dashboard; báo cáo gộp hai chi nhánh phải loại các đối tác nội bộ.
- Hàng đang đi đường đã trừ tồn bên gửi và chưa cộng bên nhận; hiển thị ở màn hình phiếu (trạng thái `in_transit`), không nằm trong tồn của chi nhánh nào.

| HTTP | `code`             | Khi nào                                                                                    |
| ---- | ------------------ | ------------------------------------------------------------------------------------------ |
| 422  | `STOCK_NOT_ENOUGH` | Bên gửi không đủ tồn (`details.available`)                                                 |
| 400  | `INVALID_STATE`    | Nhận/hủy phiếu không còn đang đi đường (đã nhận hoặc đã hủy)                               |
| 400  | `VALIDATION_ERROR` | Gửi và nhận cùng chi nhánh; danh sách rỗng; trùng mặt hàng; số lượng sai; phí không hợp lệ |
| 403  | `BRANCH_FORBIDDEN` | Không thuộc chi nhánh gửi (khi tạo/hủy) hoặc chi nhánh nhận (khi nhận)                     |
