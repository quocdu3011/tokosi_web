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

### 2.1 Nhóm hàng

| Method | Đường dẫn         | Mô tả                                            | Quyền          |
| ------ | ----------------- | ------------------------------------------------ | -------------- |
| GET    | `/categories`     | Cây nhóm hàng (không phân trang)                 | `product.view` |
| POST   | `/categories`     | Tạo nhóm `{ name, parentId? }`                   | `product.edit` |
| PATCH  | `/categories/:id` | Đổi tên / chuyển nhóm cha `{ name?, parentId? }` | `product.edit` |
| DELETE | `/categories/:id` | Xóa mềm → `204`                                  | `product.edit` |

```json
// GET /categories
[
  {
    "id": "…",
    "name": "NHÀ BẾP",
    "parentId": null,
    "productCount": 310,
    "children": [
      { "id": "…", "name": "Nồi chảo", "parentId": "…", "productCount": 54, "children": [] }
    ]
  }
]
```

- `productCount` của nhóm cha **đã cộng dồn** hàng của mọi nhóm con (không đếm hàng đã xóa).
- Tối đa **3 cấp**. Tên **không trùng trong cùng nhóm cha** (không phân biệt hoa thường và dấu) → `409 DUPLICATE_NAME`.
- `PATCH` với `parentId: null` chuyển nhóm ra gốc. Không được chuyển nhóm vào chính nó hoặc nhóm con của nó (`400 INVALID_STATE`); vượt 3 cấp → `400 VALIDATION_ERROR` (`field = parentId`).
- `DELETE` chỉ khi không còn nhóm con và không còn hàng hóa → ngược lại `400 INVALID_STATE` (`details.productCount` nếu còn hàng).

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

Bộ lọc `GET /products`: `q` (tìm không dấu theo mã và tên), `categoryId` (**gồm cả nhóm con**), `isActive`, `liquidationStatus`, `productType` (`goods` | `combo`), `inStock` (`true` = còn tồn **tại chi nhánh làm việc**; với combo là số combo ghép được), `sort` (`code`, `name`, `onHand`, `createdAt`; thêm `-` để giảm dần; cột lạ bị bỏ qua), `page`, `limit` (tối đa 100).

```json
// Đối tượng Product
{
  "id": "0192…",
  "code": "QKBSP",
  "name": "Quạt kẹp bàn Super MST-A1",
  "categoryId": "…",
  "categoryPath": "ĐIỆN GIA DỤNG > Quạt điện",
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
  "onOrder": "0", // đang đặt nhà cung cấp; CHƯA có phân hệ Đặt hàng nhập nên luôn "0"
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
  "categoryId": "…",
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

### 2.3 Giá bán

**Đã bỏ** (05/11/2026): hệ thống không lưu giá bán, không có bảng giá (Chung/Lớn/Vừa/VIP/VAT), lưới giá, tăng/giảm hàng loạt, sao chép giá giữa chi nhánh hay báo giá. Giá bán được quy ước chung ở phần mô tả sản phẩm. Các endpoint `/price-books/*`, `/pricing/quote` và quyền `price.edit` không còn. Giá trên dòng đơn hàng/hóa đơn (đơn giá, giảm giá, thành tiền) vẫn được lưu để làm sổ sách và tính lãi gộp, nhưng do **người lập đơn nhập**.

---

## 3. Mua hàng

### 3.1 Nhà cung cấp

| Method | Đường dẫn                       | Mô tả                                                       | Quyền           | Mốc |
| ------ | ------------------------------- | ----------------------------------------------------------- | --------------- | --- |
| GET    | `/suppliers`                    | Danh sách (`q`, `kind`, `groupName`, `hasDebt`, `isActive`) | `purchase.view` | W3  |
| GET    | `/suppliers/:id`                | Chi tiết + `balance`                                        | `purchase.view` | W3  |
| POST   | `/suppliers`                    | Tạo                                                         | `purchase.edit` | W3  |
| PATCH  | `/suppliers/:id`                | Sửa / ngưng                                                 | `purchase.edit` | W3  |
| GET    | `/suppliers/:id/ledger?from&to` | Sổ công nợ NCC                                              | `purchase.view` | W7  |

```json
// Supplier
{
  "id": "…",
  "code": "NCC000002",
  "name": "Công ty TNHH ABC",
  "kind": "goods",
  "groupName": null, // nhóm nhà cung cấp: chuỗi tự do, có thể null (để trống); chỉ để phân loại/lọc, không ảnh hưởng nghiệp vụ
  "phone": "0901234567",
  "address": null,
  "taxCode": null,
  "note": null,
  "isInternalBranch": false, // true = nhà cung cấp hệ thống đại diện một chi nhánh (chuyển kho nội bộ)
  "balances": [
    // công nợ TÁCH BIỆT theo chi nhánh (chỉ các chi nhánh người dùng được phép); + = mình còn nợ NCC; có thể âm
    { "branchId": "…", "branchCode": "SG", "balance": "240000000" },
    { "branchId": "…", "branchCode": "HN", "balance": "0" }
  ],
  "isActive": true,
  "createdAt": "…"
}
```

Lưu ý: `phone` không kiểm tra định dạng (dữ liệu cũ có nhiều giá trị không phải số điện thoại).

**Sổ công nợ** (dùng chung cấu trúc cho khách và NCC):

```json
{
  "openingBalance": "0",
  "entries": [
    {
      "occurredAt": "…",
      "entryType": "invoice",
      "refCode": "HD016890",
      "refId": "…",
      "amount": "33735000",
      "balance": "33735000",
      "note": null
    },
    {
      "occurredAt": "…",
      "entryType": "payment",
      "refCode": "TT019327",
      "amount": "-12390000",
      "balance": "21345000"
    }
  ],
  "closingBalance": "21345000"
}
```

`amount` dương = tăng nợ, âm = giảm nợ.

### 3.2 Nhập hàng

| Method | Đường dẫn                    | Mô tả                                                 | Quyền             | Mốc |
| ------ | ---------------------------- | ----------------------------------------------------- | ----------------- | --- |
| GET    | `/goods-receipts`            | Danh sách (`q`, `supplierId`, `status`, `from`, `to`) | `purchase.view`   | W7  |
| GET    | `/goods-receipts/:id`        | Chi tiết                                              | `purchase.view`   | W7  |
| POST   | `/goods-receipts`            | Tạo phiếu nhập (**Idempotency-Key**)                  | `purchase.edit`   | W7  |
| POST   | `/goods-receipts/:id/cancel` | Hủy phiếu `{ reason }`                                | `purchase.cancel` | W7  |
| GET    | `/goods-receipts/:id/print`  | PDF A4                                                | `purchase.view`   | W7  |

```json
// POST /goods-receipts
{
  "supplierId": "…",
  "receivedAt": "2026-11-03T04:00:00.000Z", // tùy chọn, mặc định = bây giờ
  "supplierInvoiceNo": null, // số hóa đơn đầu vào
  "poRef": "PDN000394", // mã phiếu đặt nhập (chỉ để đối chiếu, dạng chữ)
  "discount": "0",
  "note": "Lô hàng tháng 10",
  "items": [{ "productId": "…", "qty": "1095", "unitCost": "219967.9800", "note": null }],
  "payment": { "accountId": "…", "amount": "0" } // tùy chọn: trả ngay một phần
}
```

Response (chi tiết):

```json
{
  "id": "…",
  "code": "PN000946",
  "status": "completed",
  "supplier": { "id": "…", "code": "NCC000001", "name": "Công ty TNHH ABC" },
  "receivedAt": "…",
  "supplierInvoiceNo": null,
  "poRef": "PDN000394",
  "subtotal": "240000000",
  "discount": "0",
  "total": "240000000",
  "paid": "0",
  "debt": "240000000",
  "items": [
    {
      "productId": "…",
      "code": "LUMI5T",
      "name": "…",
      "qty": "1095",
      "unitCost": "219967.9800",
      "lineTotal": "240000000"
    }
  ],
  "note": "…",
  "createdBy": { "id": "…", "fullName": "…" },
  "createdAt": "…"
}
```

Sau khi lưu server cộng tồn, tính lại **giá vốn bình quân** và ghi công nợ NCC.

### 3.3 Trả hàng nhập

| Method | Đường dẫn                      | Mô tả                                       | Quyền             | Mốc |
| ------ | ------------------------------ | ------------------------------------------- | ----------------- | --- |
| GET    | `/purchase-returns`            | Danh sách (`q`, `supplierId`, `from`, `to`) | `purchase.view`   | W7  |
| GET    | `/purchase-returns/:id`        | Chi tiết                                    | `purchase.view`   | W7  |
| POST   | `/purchase-returns`            | Tạo (**Idempotency-Key**)                   | `purchase.edit`   | W7  |
| POST   | `/purchase-returns/:id/cancel` | Hủy                                         | `purchase.cancel` | W7  |

```json
{
  "supplierId": "…",
  "goodsReceiptId": "…?",
  "reason": "Hàng lỗi",
  "items": [{ "productId": "…", "qty": "10", "returnPrice": "8450.2200" }],
  "settlement": "offset_debt", // hoặc "refund" (kèm refund.accountId)
  "refund": { "accountId": "…" } // chỉ khi settlement = "refund"
}
```

---

## 4. Khách hàng

| Method | Đường dẫn                                           | Mô tả                                              | Quyền           | Mốc |
| ------ | --------------------------------------------------- | -------------------------------------------------- | --------------- | --- |
| GET    | `/customers`                                        | Danh sách                                          | `customer.view` | W3  |
| GET    | `/customers/lookup?q=`                              | Tìm nhanh (tên/SĐT/mã) cho ô chọn khách, tối đa 20 | `customer.view` | W3  |
| GET    | `/customers/:id`                                    | Chi tiết + `balance`                               | `customer.view` | W3  |
| POST   | `/customers`                                        | Tạo                                                | `customer.edit` | W3  |
| PATCH  | `/customers/:id`                                    | Sửa / ngưng                                        | `customer.edit` | W3  |
| GET    | `/customers/:id/ledger?from&to`                     | Sổ công nợ (cấu trúc như mục 3.1)                  | `customer.view` | W6  |
| GET    | `/customers/:id/orders`                             | Lịch sử đặt hàng (phân trang)                      | `customer.view` | W6  |
| GET    | `/customers/:id/invoices`                           | Lịch sử hóa đơn (kèm `paid`, `debt`)               | `customer.view` | W6  |
| GET    | `/customers/:id/sales-returns`                      | Lịch sử trả hàng                                   | `customer.view` | W6  |
| GET    | `/customers/:id/aging`                              | Tuổi nợ                                            | `customer.view` | W6  |
| POST   | `/customers/:id/receipts`                           | **Thu nợ nhanh** (**Idempotency-Key**)             | `cash.create`   | W6  |
| GET    | `/customers/:id/statement?from&to&format=xlsx\|pdf` | Biên bản đối chiếu công nợ                         | `customer.view` | W6  |

Bộ lọc `GET /customers`: `q`, `type`, `salesOwnerId`, `hasDebt` (`true` = đang nợ), `isActive`; sort: `code`, `name`, `balance`, `lastTransactionAt`.

```json
// Customer
{
  "id": "…",
  "code": "KH000001",
  "name": "Cửa hàng Ví Dụ 1",
  "type": "individual",
  "phone": "0900000001",
  "address": "12 Đường Ví Dụ, Quận 1, TP.HCM",
  "facebook": null,
  "salesOwner": { "id": "…", "fullName": "Trần Văn B" }, // nhân viên phụ trách
  "isInternalBranch": false, // true = khách hàng hệ thống đại diện một chi nhánh (chuyển kho nội bộ)
  "terms": [
    // hạn mức & kỳ hạn công nợ RIÊNG từng chi nhánh; không có dòng = không giới hạn
    { "branchId": "…", "branchCode": "SG", "creditLimit": "50000000", "paymentTermDays": 15 },
    { "branchId": "…", "branchCode": "HN", "creditLimit": null, "paymentTermDays": null }
  ],
  "balances": [
    // công nợ TÁCH BIỆT theo chi nhánh; phải thu; ÂM = khách đang dư/ứng trước
    { "branchId": "…", "branchCode": "SG", "balance": "12500000" },
    { "branchId": "…", "branchCode": "HN", "balance": "0" }
  ],
  "lastTransactionAt": "…",
  "totalSales": "1200000000",
  "note": null,
  "isActive": true,
  "invoiceProfile": {
    "buyerName": null,
    "companyName": null,
    "taxCode": null,
    "address": null,
    "email": null,
    "phone": null,
    "bankName": null,
    "bankAccount": null
  },
  "createdAt": "…",
  "updatedAt": "…"
}
```

**Công nợ theo chi nhánh:** khách hàng và nhà cung cấp là dữ liệu dùng chung, nhưng **mỗi chi nhánh có sổ công nợ riêng**, không cấn trừ chéo (thu nợ ở Hà Nội không giảm nợ Sài Gòn). `balances` và `GET …/ledger`, `…/aging`, `…/statement` nhận `branchId` (mặc định = chi nhánh làm việc). Danh sách khách/nhà cung cấp mặc định **không gồm** các đối tác nội bộ (`isInternalBranch = true`); thêm `?includeInternal=true` nếu cần. `hasDebt` tính theo chi nhánh làm việc.

Quy ước: `phone` được chuẩn hóa về dạng `0xxxxxxxxx` và **không trùng** (lỗi `409 DUPLICATE_PHONE`, `details` kèm khách đã có). `balance` chỉ đọc.

```json
// GET /customers/:id/aging
{
  "asOf": "2026-11-03",
  "total": "12500000",
  "buckets": {
    "current": "5000000",
    "d1_30": "4000000",
    "d31_60": "2500000",
    "d61_90": "1000000",
    "over90": "0"
  }
}
```

```json
// POST /customers/:id/receipts   — thu nợ nhanh
{
  "amount": "10000000",
  "method": "bank",
  "accountId": "…",
  "occurredAt": "…?",
  "note": "CK ngày 3/11",
  "allocations": [{ "invoiceId": "…", "amount": "6000000" }] // tùy chọn; bỏ qua = tự cấn hóa đơn cũ nhất
}
// 201: { "cashTransaction": { "id": "…", "code": "TT019330", … },
//        "allocations": [{ "invoiceId": "…", "invoiceCode": "HD016500", "amount": "6000000" }, …],
//        "balanceAfter": "2500000" }
// Lỗi: 422 ALLOCATION_EXCEEDS
```

---

## 5. Đơn hàng

### 5.1 Đặt hàng (phiếu tạm)

| Method | Đường dẫn             | Mô tả                                                             | Quyền            | Mốc |
| ------ | --------------------- | ----------------------------------------------------------------- | ---------------- | --- |
| GET    | `/orders`             | Danh sách (`q`, `status`, `customerId`, `sellerId`, `from`, `to`) | `order.view`     | W4  |
| GET    | `/orders/:id`         | Chi tiết                                                          | `order.view`     | W4  |
| POST   | `/orders`             | Tạo phiếu tạm (`draft`)                                           | `order.create`   | W4  |
| PATCH  | `/orders/:id`         | Sửa — **chỉ khi `draft`** (thay toàn bộ `items`)                  | `order.create`   | W4  |
| POST   | `/orders/:id/cancel`  | Hủy đơn `{ reason? }` (chỉ `draft`)                               | `order.create`   | W4  |
| POST   | `/orders/:id/invoice` | **Xuất hóa đơn từ đơn** (**Idempotency-Key**)                     | `invoice.create` | W5  |

```json
// POST /orders   (cùng body cho PATCH)
{
  "customerId": "…",
  "sellerId": "…?", // người bán (NVKD); mặc định = người đang đăng nhập
  "items": [
    { "productId": "…", "qty": "2000", "unitPrice": "12600", "discountPerUnit": "0", "isGift": false, "note": null }
  ],
  "discount": "0", // giảm giá cả đơn (số tiền)
  "deposit": { "accountId": "…", "method": "bank", "amount": "5000000" }, // đặt cọc, tùy chọn
  "ship": { "name": null, "phone": null, "address": null, "packageCount": null, "weightG": null },
  "note": "thêm hàng"
}
```

Đơn giá (`unitPrice`) do người lập đơn nhập (số nguyên đồng, không có bảng giá nên server không tự điền); không gửi `lineTotal`: server tự tính. Dòng chỉ chứa **hàng hóa** — nếu chọn Combo thì giao diện tách thành từng hàng thành phần × số lượng trước khi gửi.

```json
// Order (response)
{
  "id": "…", "code": "DH022295", "status": "draft",
  "branch": { "id": "…", "code": "SG", "name": "Chi nhánh Sài Gòn" }, // chi nhánh của đơn = X-Branch-Id lúc tạo; không đổi được
  "customer": { "id": "…", "code": "KH000002", "name": "Cửa hàng Ví Dụ 2", "phone": "…" },
  "seller": { "id": "…", "fullName": "…" },
  "orderedAt": "…",
  "items": [{
    "id": "…", "productId": "…", "code": "T888LL", "name": "Lược lăn tinh dầu dưỡng tóc T888",
    "qty": "2000", "discountPerUnit": "0", "unitPrice": "12600",
    "lineTotal": "25200000", "isGift": false, "note": null,
    "available": "3000"
  }],
  "subtotal": "44200000", "discount": "0", "total": "44200000",
  "deposit": "5000000", "invoiceId": null, "invoiceCode": null,
  "ship": { … }, "note": "thêm hàng",
  "warnings": [{ "code": "CREDIT_LIMIT_EXCEEDED", "message": "Vượt hạn mức công nợ 6.000.000 ₫" }],
  "createdBy": { "id": "…", "fullName": "…" }, "createdAt": "…", "updatedAt": "…"
}
```

- `warnings` là **cảnh báo mềm** (vượt hạn mức, thiếu tồn…); không chặn lưu đơn `draft`. Hiển thị cho người dùng.
- Đơn `draft` **giữ hàng** (`reserved`). Hủy đơn thì nhả hàng.

### 5.2 Hóa đơn

| Method | Đường dẫn                                    | Mô tả                                                                        | Quyền            | Mốc |
| ------ | -------------------------------------------- | ---------------------------------------------------------------------------- | ---------------- | --- |
| GET    | `/invoices`                                  | Danh sách (`q`, `status`, `customerId`, `sellerId`, `hasDebt`, `from`, `to`) | `invoice.view`   | W5  |
| GET    | `/invoices/:id`                              | Chi tiết                                                                     | `invoice.view`   | W5  |
| POST   | `/orders/:id/invoice`                        | Xuất hóa đơn từ đơn (mục 5.1)                                                | `invoice.create` | W5  |
| POST   | `/invoices`                                  | Tạo hóa đơn trực tiếp, không qua đơn (**Idempotency-Key**)                   | `invoice.create` | W5  |
| POST   | `/invoices/:id/cancel`                       | Hủy hóa đơn `{ reason }` (bắt buộc lý do)                                    | `invoice.cancel` | W5  |
| GET    | `/invoices/:id/print?type=invoice\|delivery` | PDF A4: hóa đơn hoặc phiếu giao hàng                                         | `invoice.view`   | W5  |

```json
// POST /orders/:id/invoice
{
  "payments": [
    { "method": "bank", "accountId": "…", "amount": "10000000" },
    { "method": "cash", "accountId": "…", "amount": "2000000" }
  ],
  "note": null
}
// Phần chưa thanh toán tự ghi vào công nợ khách. Bỏ trống payments = ghi nợ toàn bộ.
```

`POST /invoices` nhận cùng body như tạo đơn (`customerId`, `items`, `discount`, `ship`, `note`) cộng `payments[]`.

```json
// Invoice (response)
{
  "id": "…",
  "code": "HD016890",
  "status": "completed",
  "branch": { "id": "…", "code": "SG", "name": "Chi nhánh Sài Gòn" }, // = chi nhánh của đơn gốc
  "orderId": "…",
  "orderCode": "DH022215",
  "customer": {
    "id": "…",
    "code": "KH000003",
    "name": "Cửa hàng Ví Dụ 3",
    "phone": "…",
    "address": "…"
  },
  "seller": { "id": "…", "fullName": "…" },
  "invoicedAt": "2026-11-03T07:11:16.170Z",
  "items": [
    {
      "productId": "…",
      "code": "QKBSP",
      "name": "Quạt kẹp bàn Super MST-A1",
      "qty": "515",
      "discountPerUnit": "500",
      "unitPrice": "33000",
      "lineTotal": "16995000",
      "isGift": false,
      "unitCost": "21800.5000"
    }
  ], // vắng mặt nếu thiếu quyền xem giá vốn
  "subtotal": "33735000",
  "discount": "0",
  "total": "33735000",
  "payments": [{ "method": "bank", "amount": "10000000", "paidAt": "…" }],
  "paid": "10000000",
  "debt": "23735000",
  "note": "…",
  "cancelledAt": null,
  "cancelReason": null,
  "createdBy": { "id": "…", "fullName": "…" },
  "createdAt": "…"
}
```

- `debt = total − paid − (các khoản thu nợ đã cấn về sau)`. Hiển thị theo `debt` hiện tại.
- Hóa đơn `completed` **không sửa**; hủy rồi tạo lại. Hủy sẽ hoàn kho và đảo công nợ/quỹ; lỗi `INVALID_STATE` nếu hóa đơn đã bị trả hàng hoặc đã hủy.
- Lỗi khi xuất: `422 STOCK_NOT_ENOUGH` (kèm `details[]` từng mặt hàng thiếu).

### 5.3 Trả hàng bán

| Method | Đường dẫn            | Mô tả                                                    | Quyền           | Mốc |
| ------ | -------------------- | -------------------------------------------------------- | --------------- | --- |
| GET    | `/sales-returns`     | Danh sách (`q`, `customerId`, `invoiceId`, `from`, `to`) | `invoice.view`  | W6  |
| GET    | `/sales-returns/:id` | Chi tiết                                                 | `invoice.view`  | W6  |
| POST   | `/sales-returns`     | Tạo phiếu trả (**Idempotency-Key**)                      | `return.create` | W6  |

```json
// POST /sales-returns
{
  "customerId": "…",
  "invoiceId": "…?", // có thể trả không tham chiếu hóa đơn
  "items": [
    {
      "productId": "…",
      "qty": "36",
      "returnPrice": "130000",
      "restock": true, // true = nhập lại kho
      "reason": "lô mới nhỏ hơn khách ko lấy"
    }
  ],
  "settlement": "offset_debt", // hoặc "refund" + refund.accountId
  "refund": { "accountId": "…" },
  "note": null
}
```

Response có `code` (`TH001076`), `total`, `settlement`, `items[]` (kèm `restockCost` nếu có quyền xem giá vốn).

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
| GET    | `/reports/inventory`     | Tồn kho: SL, giá vốn, giá trị tồn | `asOf`, `categoryId`, `q`, `onlyInStock`, `noMovementDays`                                          | W4  |
| GET    | `/reports/sales`         | Doanh số + lãi gộp                | `from`, `to`, `groupBy=day\|month\|customer\|product\|category\|seller`, `customerId`, `categoryId` | W5  |
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

> **Trạng thái:** đã triển khai cho `products`; `customers`, `suppliers` trả `400 IMPORT_TYPE_NOT_SUPPORTED` (sẽ làm cùng phân hệ của chúng). Chỉ người có quyền `import.run` (mặc định chỉ Quản lý).

Dùng cho import hàng loạt (chuyển dữ liệu từ KiotViet và nhập tay bằng file). **Xử lý ngay trong yêu cầu** (vài nghìn dòng), kết quả có sẵn trong phản hồi; vẫn xem lại được bằng `GET /imports/:id`.

| Method | Đường dẫn                 | Mô tả                                                                                          | Quyền        |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------------- | ------------ |
| POST   | `/imports/:type`          | Tải file lên (`multipart/form-data`, field `file`, ≤ 10 MB). `type`: `products` | `import.run` |
| GET    | `/imports/:id`            | Kết quả và lỗi từng dòng của một lần nhập                                                      | `import.run` |
| GET    | `/imports/:type/template` | Tải file Excel mẫu                                                                             | `import.run` |

Tham số query của `POST`: `dryRun` (**mặc định `true`**: chỉ kiểm tra, không ghi gì; gửi `dryRun=false` mới ghi thật), `branchId` (chi nhánh làm việc; **bắt buộc khi `mode=add`** vì cộng/trừ tồn kho của chi nhánh đó, ở chế độ đè có thể bỏ trống), `mode` (`overwrite` mặc định = **Import đè**; `add` = **Import thêm**, xem mục "Hai chế độ nhập"). Giá trị `mode` khác → `400 VALIDATION_ERROR`. Phản hồi có thêm field `mode`.

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
  "createdAt": "…",
  "finishedAt": "…"
}
```

**Hai chế độ nhập (`mode`)** — file phải đúng định dạng file mẫu (`GET /imports/products/template`):

| | `overwrite` — Import đè (mặc định) | `add` — Import thêm |
| --- | --- | --- |
| Khóa so khớp | `Mã hàng`, không phân biệt hoa thường | như bên trái |
| Mã đã có | Thông tin trong file **đè** lên bản cũ (ô trống giữ nguyên). Mã không có trong file thì không đổi | **Chỉ CỘNG/TRỪ tồn** theo cột `Tồn kho` của chi nhánh `branchId`; mọi thông tin khác (tên, nhóm, mô tả, trạng thái, trạng thái thanh lý, ảnh, thành phần) **giữ nguyên bản cũ** |
| Mã mới | Tạo mới | Tạo mới đầy đủ (cần `Tên hàng`) rồi cộng tồn |
| Cột `Tồn kho`, `Giá vốn` | Bị bỏ qua | Dùng như bên dưới |
| Chạy lại cùng file | Không đổi gì (idempotent) | **Cộng thêm lần nữa** (không idempotent): luôn chạy `dryRun=true` trước |

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
| `Nhóm hàng(3 Cấp)`                       | Dạng `NHÀ BẾP>>Dao kéo`, tối đa 3 cấp; **tự tạo nhóm còn thiếu**                                                                                    |
| `Tồn kho`, `Giá vốn` | **Chỉ dùng ở `mode=add`** (cộng/trừ tồn, giá nhập của lô cộng); ở `overwrite` bị bỏ qua (số dư đầu kỳ do công cụ chuyển dữ liệu riêng xử lý) |
| `Giá bán` và cột khác | **Bị bỏ qua**: hệ thống không có giá bán |
| `Đang kinh doanh`                        | `1`/`0`                                                                                                                                             |
| `Mô tả`                                  |                                                                                                                                                     |
| `Hình ảnh (url1,url2...)`                | Nhiều địa chỉ `http(s)` cách nhau dấu phẩy → **giữ nguyên URL gốc** (không tải về kho file); thêm ảnh chưa có, không xóa ảnh hiện có; tối đa 10 ảnh |


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
