# Hệ thống Quản lý Bán hàng (tương tự KiotViet) – Tài liệu Thiết kế & Công nghệ

> Phiên bản: **0.2** – Ngày: 2026-11-04 (0.1: 2026-11-03)
> Mục đích: Làm nền tảng thống nhất phạm vi, kiến trúc, công nghệ và lộ trình. **Là nguồn sự thật cho người và AI agent** cùng với `CLAUDE.md` (quy tắc bắt buộc), `docs/api/` (hợp đồng API) và `docs/db/` (lược đồ CSDL).
> Khi tài liệu này mâu thuẫn với `CLAUDE.md` hoặc `docs/api/`, **ưu tiên hai nơi đó** rồi sửa lại tài liệu này.
>
> **Thay đổi ở 0.2:** thống nhất với các quyết định đã chốt (7 vai trò, 2 chi nhánh mặc định Hà Nội, chuyển kho đã làm, không dùng Redis/Zod/SDK tự sinh, cấu trúc repo thực tế, quy trình git hiện tại); trả lời mục 1.3 và 5.8; số liệu quy mô thực tế; danh sách bảng khớp lược đồ (39 bảng); ghi trạng thái triển khai.

---

## 1. Tổng quan

### 1.1 Mục tiêu
Xây dựng phần mềm quản lý bán hàng cho công ty, gồm: bán hàng tại quầy (POS), quản lý kho, sản phẩm, khách hàng, nhà cung cấp, công nợ, sổ quỹ, báo cáo, phân quyền nhân viên, nhiều chi nhánh.

### 1.2 Đối tượng sử dụng

Hệ thống có **7 vai trò**; quyền của từng vai trò do **Quản lý cấu hình** (bảng `role_permissions`), không viết cứng trong mã. Bảng dưới chỉ là nhu cầu chính; cấu hình quyền mặc định chỉ là đề xuất.

| Vai trò | Mã | Nhu cầu chính |
|---|---|---|
| Quản lý | `manager` | Luôn đủ quyền; xem cả hai chi nhánh; cấu hình phân quyền, người dùng, báo cáo, kiểm soát kho & quỹ |
| Trợ lý | `assistant` | *(Chưa xác nhận công việc cụ thể)* hỗ trợ quản lý |
| Kế toán | `accountant` | Công nợ, sổ quỹ, đối soát, báo cáo tài chính |
| Kho | `warehouse` | Nhập/xuất/chuyển kho, tồn kho |
| Lái xe | `driver` | *(Chưa xác nhận có đăng nhập hệ thống không)* |
| Sale | `sales` | Khách hàng của mình, đặt hàng, hóa đơn (phạm vi "chỉ của mình") |
| Marketing | `marketing` | *(Chưa xác nhận có xem số điện thoại khách không)* |

Mỗi nhân viên được **gán chi nhánh** (Hà Nội, Sài Gòn); Quản lý thấy cả hai.

### 1.3 Các câu hỏi đã chốt / còn mở

| # | Câu hỏi | Trạng thái |
|---|---|---|
| 1 | Nội bộ hay SaaS? | ✅ **Dùng nội bộ một công ty.** Không multi-tenant (không có `tenant_id`), giữ **đa chi nhánh**. Thêm `tenant_id` về sau rất tốn kém nên nếu có ý định bán SaaS phải cân nhắc từ bây giờ |
| 2 | Ngành hàng | ✅ **Bán sỉ hàng gia dụng tổng hợp** (mục 2.4). Không cần FnB; không có hàng cần lô/HSD hay serial |
| 3 | POS chạy offline? | ✅ **Không làm trong phạm vi hiện tại** (bán sỉ, đơn tạo ở văn phòng/kho có mạng); hạ xuống Phase 3 nếu sau này có quầy bán nhanh (ADR-06) |
| 4 | Hóa đơn điện tử / VAT | ⏳ Chưa chốt (mục 5.8 câu 5). Hiện có 3 bảng giá VAT; hóa đơn điện tử để Phase 2 nếu cần |
| 5 | Kênh bán online (Shopee, Lazada, TikTok…) | ✅ **Không làm** (ngoài phạm vi) |
| 6 | Phần cứng in/quét | ✅ In **A4/A5** qua trình duyệt/PDF; máy in nhiệt, ngăn kéo tiền, in tem chỉ làm nếu sau này có POS |
| 7 | Quy mô | ✅ **2 chi nhánh, ~2.800 SKU, ~1.700 khách, ~65 hóa đơn/ngày** (từ dữ liệu mẫu) → PostgreSQL một máy là đủ |
| 8 | Thời gian, đội | ✅ **2 tháng** (09/11/2026 → 08/01/2027), 2 người + AI agent (mục 13) |

Các câu hỏi nghiệp vụ còn mở nằm ở mục 5.8 và trong `MEMORY.md` (cục bộ).

---

## 2. Phạm vi chức năng (tham chiếu KiotViet)

### 2.1 Phân hệ & module

| # | Phân hệ | Chức năng chính |
|---|---|---|
| 1 | **Tổng quan (Dashboard)** | Doanh thu hôm nay, số đơn, top hàng bán chạy, hàng sắp hết, biểu đồ theo thời gian |
| 2 | **Hàng hóa** | Danh mục, sản phẩm, biến thể (size/màu), đơn vị tính quy đổi, combo/đóng gói, mã vạch, giá vốn, bảng giá, thiết lập giá, in tem mã, kiểm kho, nhập/xuất file Excel |
| 3 | **Giao dịch** | Đặt hàng, hóa đơn bán, trả hàng, đặt hàng nhập, nhập hàng, trả hàng nhập, xuất hủy, chuyển hàng |
| 4 | **Đối tác** | Khách hàng (NV phụ trách, hạng giá, công nợ), nhà cung cấp (gồm lái xe) |
| 5 | **Nhân viên** | Danh sách, chấm công/lịch làm việc (giai đoạn sau), hoa hồng, phân quyền |
| 6 | **Sổ quỹ** | Phiếu thu/chi, quỹ tiền mặt/ngân hàng, công nợ khách & NCC |
| 7 | **Báo cáo** | Bán hàng, hàng hóa, khách hàng, NCC, nhân viên, tài chính, lãi lỗ |
| 8 | **Bán hàng (POS)** | Giao diện thu ngân nhanh, nhiều tab hóa đơn, quét mã, chiết khấu, thanh toán nhiều phương thức, in bill, offline |
| 9 | **Khuyến mãi** *(Phase 3, dữ liệu thực chưa dùng)* | Giảm giá theo SP/hóa đơn, mua X tặng Y, voucher |
| 10 | **Thiết lập** | Cửa hàng, chi nhánh, mẫu in, kênh bán, phương thức thanh toán, thuế, phân quyền, nhật ký hoạt động |
| 11 | **Tích hợp** | Hóa đơn điện tử, cổng thanh toán (VietQR/Momo/VNPay), đơn vị vận chuyển (GHN, GHTK, ViettelPost), sàn TMĐT |

### 2.2 Phạm vi chức năng đã chốt (7 phân hệ)

Theo yêu cầu của công ty, hệ thống gồm **7 phân hệ**: Hàng hóa, Mua hàng, Đơn hàng, Khách hàng, Sổ quỹ, Tổng quan, Báo cáo. Bảng 2.1 ở trên là danh sách tham chiếu KiotViet; **chỉ các mục dưới đây được xây**.

| Phân hệ | Chức năng | Nội dung chính |
|---|---|---|
| **1. Hàng hóa** | Danh sách hàng hóa | Thêm/sửa/ngưng bán sản phẩm, nhóm hàng (cây), ảnh, vị trí kho; xem tồn kho, giá vốn, giá bán chung; **thẻ kho** (lịch sử nhập–xuất của từng mã); tìm không dấu; lọc; nhập/xuất Excel |
| | Thiết lập giá | 7 bảng giá (Lớn/Vừa/VIP/Chung + 3 bản VAT); lưới sửa giá nhiều mã × nhiều bảng; nhập/xuất Excel; tăng/giảm giá hàng loạt theo % hoặc số tiền; bảng nào thiếu giá thì lùi về bảng chung |
| **2. Mua hàng** | Nhà cung cấp | Danh sách NCC (hàng hóa / lái xe / khác), thông tin liên hệ, **công nợ NCC** và lịch sử giao dịch |
| | Nhập hàng | Phiếu nhập trực tiếp (giá nhập, giảm giá, thanh toán một phần/công nợ, số hóa đơn đầu vào, ghi chú, mã phiếu đặt nhập tham chiếu dạng chữ), cộng tồn, **tính lại giá vốn bình quân**, in phiếu |
| | Trả hàng nhập | Phiếu trả theo NCC: trừ tồn, giảm công nợ NCC hoặc nhận tiền hoàn |
| **3. Đơn hàng** | Đặt hàng | Phiếu tạm → chốt; đặt cọc; giữ hàng; chọn khách thì tự áp bảng giá; **màn hình tạo đơn sỉ** nhập nhanh bằng bàn phím, thấy ngay giá/tồn/công nợ khách; chuyển thành hóa đơn |
| | Hóa đơn | Tạo từ đơn (hoặc trực tiếp), thanh toán tiền mặt/CK/ghi nợ, trừ kho, in A4 + phiếu giao hàng, hủy hóa đơn (có nhật ký) |
| | Trả hàng | Phiếu trả theo hóa đơn (hoặc không tham chiếu); chọn nhập lại kho; **bù trừ công nợ** khách hoặc hoàn tiền |
| **4. Sổ quỹ** | Sổ quỹ | Phiếu thu/chi; danh mục thu chi chuẩn; **thu nợ khách** (cấn trừ vào hóa đơn cũ nhất, chọn tay được) và **trả nợ NCC**; tài khoản quỹ (tiền mặt/ngân hàng); quỹ đầu kỳ, tồn quỹ cuối kỳ; lọc theo ngày/loại; xuất Excel |
| **5. Khách hàng** | Danh sách khách hàng | Cá nhân/công ty; mã KH, SĐT (chuẩn hóa, không trùng), địa chỉ, **nhân viên phụ trách**, **hạng giá mặc định** (tự áp bảng giá khi đặt hàng), hạn mức & kỳ hạn công nợ (cảnh báo khi vượt), hồ sơ xuất hóa đơn (MST, tên công ty…), ghi chú, ngừng giao dịch; tìm không dấu theo tên/SĐT/mã; lọc theo nhân viên phụ trách, hạng giá, có nợ; nhập/xuất Excel |
| | Chi tiết khách hàng | Tab **lịch sử** (đặt hàng, hóa đơn, trả hàng), tab **công nợ** (sổ cái từng bút toán, số dư có thể âm, tuổi nợ), **thu nợ nhanh** (tạo phiếu thu ngay từ trang khách, cấn trừ hóa đơn cũ nhất), in biên bản đối chiếu công nợ (Excel/PDF) |
| **6. Tổng quan** | Dashboard | Trang đầu sau đăng nhập: doanh thu hôm nay / tháng này / so với tháng trước, số hóa đơn, **công nợ phải thu & phải trả**, tồn quỹ, top 10 hàng bán chạy, top 10 khách mua nhiều, biểu đồ doanh thu theo ngày (30 ngày) |
| **7. Báo cáo** | 5 báo cáo chuẩn | (1) **Công nợ khách** (tuổi nợ 0–30/31–60/61–90/>90 ngày, theo nhân viên phụ trách); (2) **Công nợ nhà cung cấp**; (3) **Doanh số** (theo ngày/tháng, khách, hàng hóa, nhóm hàng, người bán; có cột **lãi gộp** nhờ lưu giá vốn trên từng dòng bán); (4) **Tồn kho** (số lượng, tồn × giá vốn, theo nhóm hàng, hàng không phát sinh); (5) **Sổ quỹ** (thu/chi theo loại, theo kỳ, quỹ đầu–cuối). Bộ lọc theo kỳ, xuất Excel/PDF |

**Phần nền bắt buộc** (không phải phân hệ, nhưng thiếu thì không chạy): đăng nhập, 7 vai trò (Quản lý, Trợ lý, Kế toán, Kho, Lái xe, Sale, Marketing) với **quyền do Quản lý cấu hình** (bảng `role_permissions`, phạm vi "chỉ của mình" cho Sale), nhật ký thao tác, công cụ import từ KiotViet, mã chứng từ tự tăng, backup.

**Ngoài phạm vi (chưa xây):** Kiểm kho, Đặt hàng nhập (chỉ lưu mã tham chiếu), quản lý nhân viên/phân quyền chi tiết, POS, khuyến mãi, tích hợp (HĐĐT, vận chuyển, TMĐT), báo cáo tùy biến/nâng cao (so sánh kỳ, hàng chậm bán, hoa hồng).

### 2.3 Phân giai đoạn (MVP → mở rộng)

| Giai đoạn | Nội dung | Ước tính* |
|---|---|---|
| **MVP (Phase 1)** *(danh sách đầy đủ; bản 2 tháng rút gọn theo mục 13.1: kiểm kho, bản sửa hóa đơn, phân quyền riêng từng người, import lịch sử được hoãn)* | Đăng nhập & phân quyền, hàng hóa (phẳng, 1 đơn vị/SKU, ảnh, vị trí kho), **7 bảng giá theo hạng khách (Lớn/Vừa/VIP/Chung + bản VAT)**, khách hàng (có NV phụ trách, hạng giá)/NCC, đặt hàng nhập → nhập hàng, tồn kho + giữ hàng, **đặt hàng (phiếu tạm) → hóa đơn**, trả hàng bán/nhập, **công nợ KH/NCC (cho phép số dư âm, thu theo khách, cấn trừ hóa đơn cũ nhất, đối chiếu)**, sổ quỹ có danh mục thu chi chuẩn, **kiểm kho**, báo cáo công nợ/doanh số/tồn kho, in A4, nhập/xuất Excel, **công cụ chuyển dữ liệu từ KiotViet** (mục 5.7) | **2 tháng** (09/11/2026 → bản dùng được 08/01/2027, phạm vi MVP-lite mục 13.1; cắt chuyển khuyến nghị 01/03/2027). Phạm vi đầy đủ: ~5 tháng (mục 13B) |
| **Phase 2** | Kiểm kho, nhận thiếu/sai lệch khi chuyển kho, quy đổi đơn vị tính, báo giá riêng, giao hàng từng phần/quản lý tài xế-xe, phân bổ chi phí nhập hàng (container), NVKD & hoa hồng, hạn mức công nợ cứng, hóa đơn VAT/điện tử (nếu cần), POS quầy giản lược | Sau go-live; gồm cả các mục hoãn ở 13.1 |
| **Phase 3** | Cổng đặt hàng B2B cho đại lý, app mobile cho NVKD/tài xế, POS offline (nếu cần), cổng thanh toán/VietQR, tích hợp vận chuyển & sàn TMĐT | Sau Phase 2 |

\* Ước tính cho **đội 2 người + AI agent** (mục 11.1). AI rút ngắn đáng kể thời gian viết code, nhưng **không rút ngắn** việc làm rõ nghiệp vụ, kiểm thử đối chiếu số liệu và chuyển dữ liệu; đó mới là phần quyết định tiến độ. Con số chỉ là ước lượng ban đầu, cần chỉnh lại tại cổng G1 (mục 13).

### 2.4 Đặc thù BÁN SỈ (điều chỉnh so với KiotViet bán lẻ)

Bán sỉ khác bán lẻ ở chỗ: **ít đơn, giá trị lớn, khách quen, mua chịu, giao hàng, giá theo khách/số lượng**. Do đó trọng tâm chuyển từ POS quầy sang **quy trình đơn hàng + công nợ + bảng giá**.

| Nhóm | Tính năng cần có | Ưu tiên |
|---|---|---|
| **Bảng giá** | *(Theo dữ liệu thực)* 7 bảng giá theo hạng khách: Lớn/Vừa/VIP/Chung + 3 bản VAT; mỗi khách có bảng giá mặc định, mỗi hóa đơn 1 bảng giá; giảm giá theo số tiền/đơn vị. Giá bậc thang theo số lượng và hiệu lực theo thời gian: **tùy chọn**, chưa có bằng chứng sử dụng | Cao (MVP) |
| **Đơn vị tính** | Dữ liệu thực: **1 SKU = 1 quy cách** (đơn vị nằm trong tên). Quy đổi thùng/lốc/cái để Phase 2 | Thấp (Phase 2) |
| **Quy trình đơn** | *(Theo dữ liệu thực)* Đặt hàng (phiếu tạm, có thể đặt cọc) → Hóa đơn (1 đơn – 1 hóa đơn) → Thu tiền sau. Sửa/đổi trả sau chốt tạo bản `.nn`. Báo giá riêng và giao từng phần: Phase 2 | Cao (MVP) |
| **Công nợ khách hàng** | Mua chịu, **hạn mức công nợ**, **kỳ hạn thanh toán** (7/15/30 ngày), cảnh báo quá hạn/vượt hạn mức, chặn bán khi vượt (cấu hình), thu tiền cấn trừ theo hóa đơn, **biên bản đối chiếu công nợ**, tuổi nợ (aging) | Cao (MVP) |
| **Công nợ NCC** | Tương tự: đặt hàng nhập, nhận hàng từng phần, thanh toán công nợ | Cao (MVP) |
| **Chiết khấu** | Chiết khấu theo dòng, theo hóa đơn, theo nhóm khách, **chiết khấu doanh số cuối kỳ/quý**, hàng tặng kèm, hoa hồng/thưởng | Trung bình (Phase 2) |
| **Giao hàng** | Phiếu giao hàng, gán tài xế/xe/tuyến, trạng thái giao, thu hộ COD, phí vận chuyển, phiếu xuất kho kiêm vận chuyển | Trung bình (Phase 2) |
| **Kho** | Nhiều kho, **hàng tồn theo lô/hạn sử dụng** (nếu ngành thực phẩm/dược/mỹ phẩm), cảnh báo hết hạn, tồn tối thiểu & **gợi ý đặt hàng nhập**, giữ hàng (reserve) cho đơn chưa giao, số serial (nếu điện máy) | Cao (MVP: reserve; lô/HSD: tùy ngành) |
| **Nhân viên kinh doanh** | Gán KH cho NVKD, đơn do NVKD tạo, **doanh số & hoa hồng theo NVKD**, KPI | Trung bình |
| **Khách hàng (CRM nhẹ)** | Nhiều địa chỉ giao, nhiều người liên hệ, mã số thuế, lịch sử mua, nhắc đặt hàng định kỳ, ghi chú chăm sóc | Trung bình |
| **Hóa đơn / chứng từ** | In **A4/A5** (hóa đơn, phiếu xuất kho, phiếu giao hàng, báo giá, biên bản đối chiếu); **hóa đơn điện tử + VAT** gần như bắt buộc với khách doanh nghiệp | Cao (HĐĐT: Phase 2) |
| **Đặt hàng online cho đại lý** | Cổng B2B: đại lý tự đăng nhập, xem giá riêng/tồn kho, đặt hàng, xem công nợ & lịch sử | Phase 3 (giá trị cao) |
| **Báo cáo** | Công nợ theo khách/tuổi nợ, doanh số theo khách/NVKD/mặt hàng, lãi gộp theo khách/đơn, tồn kho & vòng quay, hàng chậm bán, dòng tiền | Cao (MVP) |
| **POS quầy** | Vẫn có (bán nhanh cho khách vãng lai) nhưng **giản lược**; giao diện chính là màn hình **tạo đơn sỉ** (nhập nhanh bằng bàn phím, tìm mã, dán danh sách) | Trung bình |
| **Nhập/xuất Excel** | Rất quan trọng: nhập đơn hàng/khách/giá hàng loạt, xuất đối chiếu công nợ | Cao (MVP) |

**Hệ quả thiết kế:**
- **POS offline hạ ưu tiên** (đơn sỉ ít, thường tạo ở văn phòng/kho có mạng) → chuyển sang Phase 3, tiết kiệm đáng kể chi phí. Nếu có quầy bán nhanh mới cần.
- **Màn hình trọng tâm** là "Tạo đơn/Hóa đơn sỉ" dạng bảng nhiều dòng, nhập liệu bằng bàn phím nhanh, thấy ngay giá theo khách, tồn kho, công nợ hiện tại của khách.
- **Công nợ là phân hệ lõi**, không phải phụ: thiết kế sổ công nợ (`debt_ledger`) chặt chẽ ngay từ MVP, hỗ trợ cấn trừ thanh toán với từng hóa đơn.
- **Bảng giá có logic phức tạp** (khách → nhóm → bậc thang → đơn vị → hiệu lực): cần engine tính giá riêng, có test kỹ, ưu tiên rõ: *giá riêng khách > bảng giá nhóm > giá chung*.
- **Đơn hàng có vòng đời nhiều bước** → dùng state machine (trạng thái + chuyển trạng thái hợp lệ + log).
- Bắt buộc **in khổ A4** và xuất PDF đẹp; in nhiệt K80 chỉ phụ.

### 2.5 Hai chi nhánh (Hà Nội, Sài Gòn)

Công ty có 2 chi nhánh **dùng chung một hệ thống**: cùng hàng hóa, khách hàng, nhà cung cấp, nhưng khác giá, tồn kho, giá vốn, công nợ, quỹ và đơn hàng. Các quyết định đã chốt (chi tiết kỹ thuật: `docs/db/README.md`, hợp đồng API: `docs/api/README.md` mục "Nhiều chi nhánh"):

| Vấn đề | Quyết định |
| --- | --- |
| Giá | Khác cả **giá bán** lẫn **giá nhập / giá vốn**. Giá bán: 7 hạng giá dùng chung, số tiền từng ô riêng chi nhánh. Giá vốn bình quân tính riêng từ phiếu nhập của từng chi nhánh |
| Hạng giá của khách | Giống nhau ở hai chi nhánh (chỉ khác số tiền) |
| Công nợ | Tách biệt hoàn toàn theo chi nhánh; hạn mức và kỳ hạn công nợ cũng riêng |
| Tồn kho và quỹ | Riêng từng chi nhánh (4 quỹ: tiền mặt + ngân hàng × 2) |
| Chuyển kho | Có, **hai bước** (gửi → nhận). Hai chi nhánh coi nhau là khách hàng / nhà cung cấp nội bộ. Giá nhập kho bên nhận = giá gốc bên gửi **cộng phí vận chuyển**; phí vẫn được ghi riêng |
| Người dùng | Nhân viên được gán chi nhánh; Quản lý xem cả hai |
| Trả hàng | Về chi nhánh của hóa đơn gốc |
| Mã chứng từ | Một dãy số chung cho cả hai chi nhánh (giả định, **chưa xác nhận** — mục 5.8) |
| Dữ liệu cũ | Chi nhánh còn lại cũng ở KiotViet, nhập sau; **chi nhánh mặc định là Hà Nội** (chủ dự án chốt 04/11/2026) |

**Ảnh hưởng lịch 2 tháng:** thêm khoảng 5–7 ngày (giá/tồn/nợ/quỹ theo chi nhánh 3–4 ngày, chuyển kho 2–3 ngày; chuyển kho vốn thuộc Phase 2 nhưng đã được đưa vào MVP). Phần lược đồ, seed, tồn kho theo chi nhánh, nghiệp vụ chuyển kho (`StockTransfersService`) và quyền truy cập chi nhánh **đã làm xong ở backend** (tuần 1); còn lại là các endpoint/màn hình và gắn `branch_id` vào từng phân hệ khi xây. Nếu trễ: cắt Trả hàng nhập và biểu đồ Dashboard trước.

---

## 3. Kiến trúc hệ thống

### 3.1 Lựa chọn kiến trúc: **Modular Monolith** (khuyến nghị)
- Giai đoạn đầu **không** dùng microservices: tăng độ phức tạp vận hành, khó debug, tốn nhân lực.
- Chia code theo **module nghiệp vụ** có ranh giới rõ (catalog, inventory, sales, partners, cashbook, reports...). Sau này module nào nặng có thể tách thành service riêng.
- Giao tiếp giữa module qua **service interface + domain event** (không truy cập chéo bảng trực tiếp).

### 3.2 Sơ đồ tổng thể

```
┌──────────────── Client ────────────────┐
│  Web quản trị (Next.js, responsive)     │   (POS PWA / mobile: Phase 3)
└───────────────┬────────────────────────┘
                │ HTTPS (REST/JSON, cookie refresh httpOnly)
        ┌───────▼────────────────┐
        │ Reverse proxy (Nginx / │   TLS, nén, giới hạn kích thước
        │ Caddy)                 │
        └───────┬────────────────┘
        ┌───────▼─────────────────────────────────┐
        │ Backend – NestJS (Modular Monolith)      │
        │ auth │ authorization │ branches │ catalog│
        │ inventory │ stock-transfers │ sales │ … │
        │ (job nền chạy trong cùng tiến trình)     │
        └──┬──────────────────────┬───────────────┘
           │                      │
   ┌───────▼──────┐      ┌────────▼────────┐
   │ PostgreSQL   │      │ Kho file (ảnh,  │
   │ (duy nhất;   │      │ file import/    │
   │ cả hàng đợi  │      │ export): đĩa    │
   │ job pg-boss) │      │ hoặc S3/MinIO   │
   └──────────────┘      └─────────────────┘
```

Không có Redis, không có tiến trình worker riêng, không có WebSocket ở giai đoạn này (mục 4.1); thêm khi có nhu cầu thật.

### 3.3 Nguyên tắc thiết kế
1. **Đa chi nhánh/đa kho (hiện 2 chi nhánh), đơn công ty (single-tenant)**: không có `tenant_id`; tồn kho, giá bán, công nợ, quỹ và chứng từ có `branch_id`. Phân quyền theo chi nhánh xử lý ở tầng ứng dụng (`BranchAccessService`). Triển khai một instance cho công ty (có thể on-premise hoặc VPS riêng).
2. **Tồn kho theo sổ cái (ledger)**: không sửa số tồn trực tiếp; mọi biến động ghi vào `stock_movements` (append-only), tồn hiện tại = tổng hợp/được cập nhật trong cùng transaction. Đảm bảo truy vết & đối soát.
3. **Giao dịch nguyên tử**: tạo hóa đơn = trừ kho + ghi sổ quỹ + cập nhật công nợ trong **một transaction**.
4. **Idempotency**: API tạo chứng từ nhận header `Idempotency-Key` (bảng `idempotency_keys`) để gửi lại khi mạng chập chờn mà không bị trùng.
5. **Soft delete + audit log**: không xóa cứng dữ liệu nghiệp vụ; ghi lại ai làm gì, khi nào.
6. **Tiền tệ**: tiền chứng từ `NUMERIC(18,0)` (đồng); **đơn giá, giá nhập, giá vốn `NUMERIC(18,4)`** (dữ liệu thực có giá lẻ như 219.967,98); **tuyệt đối không dùng float**.
7. **Múi giờ**: lưu UTC, hiển thị `Asia/Ho_Chi_Minh`.
8. **Giá vốn**: dùng phương pháp **bình quân gia quyền di động** (giống KiotViet); thiết kế để có thể mở rộng FIFO sau.

### 3.4 POS Offline-first (Phase 3, không nằm trong phạm vi hiện tại)
- POS là **PWA** (Service Worker + IndexedDB/Dexie) lưu cache danh mục sản phẩm, giá, khách hàng.
- Khi mất mạng: tạo hóa đơn lưu hàng đợi cục bộ (kèm `client_request_id`, mã hóa đơn tạm theo thiết bị).
- Khi có mạng: đồng bộ tuần tự lên server; server kiểm tra idempotency, xử lý xung đột tồn kho (cho phép âm kho hoặc cảnh báo tùy cấu hình).
- Cần quyết định sớm vì ảnh hưởng đến thiết kế API & ID (nên dùng UUIDv7 sinh ở client).

---

## 4. Công nghệ đề xuất

### 4.1 Tổng hợp stack

| Lớp | Công nghệ | Lý do chọn |
|---|---|---|
| Ngôn ngữ | **TypeScript** toàn bộ | Dùng chung type FE/BE, giảm lỗi, dễ tuyển dev |
| Frontend (Admin) | **Next.js 16 (React) + TypeScript** | Hệ sinh thái lớn, SSR/CSR linh hoạt. *(POS/PWA: Phase 3)* |
| UI | **Tailwind CSS + shadcn/ui** (Radix) | Nhanh, tùy biến cao, accessible |
| Bảng dữ liệu | **TanStack Table** + **TanStack Query** | Bảng lớn, lọc/sắp xếp, cache & đồng bộ server state |
| State/Form | **Zustand**, **React Hook Form** | Nhẹ. Frontend tự chọn thư viện validate; **nguồn sự thật về dữ liệu là `docs/api/openapi.json`** |
| Biểu đồ | **Recharts** hoặc **ECharts** | Dashboard & báo cáo |
| Offline POS | *(Phase 3, chưa chọn)* | Không nằm trong phạm vi hiện tại |
| Backend | **NestJS 12 (Node.js, TypeScript, ESM)** | Kiến trúc module sẵn có, DI, phù hợp modular monolith. Test Vitest, lint Oxlint |
| ORM | **Drizzle ORM** (`drizzle-orm` 0.45 + `drizzle-kit` 0.31, node-postgres) | **Đã chốt.** SQL gần như thuần, kiểu dữ liệu chặt, migration là file SQL đọc/duyệt được; AI agent viết và rà soát ổn định. Không dùng Prisma 8 (RC) |
| CSDL chính | **PostgreSQL 17** (Docker khi dev) | ACID, JSONB, index mạnh (GIN `pg_trgm`), báo cáo tốt. Test dùng PGlite (PostgreSQL thật trong bộ nhớ) |
| Cache / Queue | **Bắt đầu KHÔNG cần Redis**: job nền dùng hàng đợi trong PostgreSQL (`pg-boss`); thêm Redis + BullMQ khi thực sự cần | Đội 2 người: ít thành phần vận hành hơn. Quy mô ~65 HĐ/ngày chưa cần cache riêng |
| Realtime | *Chưa dùng.* Nếu cần: SSE trước, WebSocket sau | ~65 hóa đơn/ngày: tải lại trang là đủ |
| Tìm kiếm | PostgreSQL `pg_trgm` + unaccent (đủ cho ~2.800 SKU / ~1.700 khách) | **Không cần Meilisearch** ở quy mô này |
| File | Đĩa cục bộ hoặc **S3-compatible** (MinIO / Cloudflare R2) | Ảnh sản phẩm (tải về từ KiotViet), file import/export |
| Xác thực | **Đã triển khai:** JWT HS256 (`jose`, 15 phút, chỉ chứa id) + refresh token ngẫu nhiên trong cookie httpOnly (14 ngày, lưu băm, xoay vòng, phát hiện dùng lại), argon2id | Chuẩn, an toàn; vai trò/quyền đọc từ CSDL mỗi yêu cầu |
| Phân quyền | **RBAC cấu hình được** (bảng `role_permissions`, 34 quyền, phạm vi `all`/`own`) + giới hạn theo chi nhánh | Quản lý tự phân quyền, không hard-code |
| API | **REST + OpenAPI (Swagger)** tại `/api/docs`; `docs/api/openapi.json` là hợp đồng cho frontend | Frontend có thể tự sinh client từ OpenAPI nếu muốn (không bắt buộc) |
| Xuất Excel/PDF | **ExcelJS**, **Puppeteer/Playwright** hoặc **pdfmake** | Báo cáo, hóa đơn A4 |
| In nhiệt | **ESC/POS** qua WebUSB/WebSerial hoặc dịch vụ in cục bộ (agent) ; hoặc in qua trình duyệt (CSS `@media print`) | Hóa đơn K80/K58, tem mã |
| Monorepo | **pnpm workspaces + Turborepo** | `apps/api`, `apps/web`, `packages/shared` |
| Test | **Vitest** (đơn vị + HTTP tích hợp trên PGlite), **Supertest**; Playwright cho E2E giao diện (khi có) | Đơn vị, tích hợp, E2E |
| CI/CD | **GitHub Actions** (đã chạy: lint → typecheck → test → build) | Deploy: sẽ bổ sung |
| Container | **Docker + docker compose** | Dev/prod đồng nhất |
| Hạ tầng | VPS/Cloud (Hetzner, DigitalOcean, AWS, hoặc nhà cung cấp VN: Viettel IDC, VNG Cloud) + Nginx/Caddy | Chi phí hợp lý, dữ liệu ở VN nếu cần |
| Giám sát | **Sentry** (lỗi), **Prometheus + Grafana** hoặc **Grafana Cloud**, log **Loki/ELK** | Quan sát hệ thống |
| Backup | `pg_dump` + WAL archiving (pgBackRest), lưu off-site, kiểm thử restore định kỳ | Bắt buộc với dữ liệu bán hàng |

### 4.2 Phương án thay thế (nếu đội ngũ quen công nghệ khác)
| Phương án | Khi nào nên chọn |
|---|---|
| **Laravel (PHP) + Inertia/Vue** | Đội đã quen PHP, cần ra sản phẩm nhanh |
| **Java Spring Boot + React** | Công ty có đội Java, yêu cầu doanh nghiệp lớn |
| **.NET 8 + React/Blazor** | Hệ sinh thái Microsoft sẵn có |
| **Django/FastAPI + React** | Đội mạnh Python, nhiều xử lý dữ liệu/ML |

> **Khuyến nghị**: chọn stack mà **đội của bạn đang mạnh nhất**. Stack TypeScript ở trên được đề xuất vì thống nhất ngôn ngữ và dễ chia sẻ code giữa web/POS/backend.

### 4.3 Ghi chú sử dụng thư viện
Khi bắt đầu code, tra cứu tài liệu phiên bản mới nhất của từng thư viện (Next.js, NestJS, Drizzle, TanStack...) để tránh dùng API cũ. Phiên bản đã dùng ghi ở `CLAUDE.md` mục "Ghi chú về phiên bản".

---

## 5. Thiết kế dữ liệu

> Mục này được viết lại dựa trên **10 file Excel xuất từ KiotViet** (thư mục `E:\Web\Data`, xuất ngày 03/11/2026). Mọi số liệu dưới đây là thống kê tổng hợp từ file; không đưa tên/số điện thoại thật vào tài liệu.
> **Giới hạn của mẫu:** hóa đơn/đặt hàng/nhập hàng chỉ phủ khoảng 2 ngày (02–03/11/2026) nên tỉ lệ phần trăm về hành vi giao dịch chỉ mang tính tham khảo; danh mục (sản phẩm, khách hàng) thì đầy đủ.

### 5.1 Kết quả phân tích dữ liệu mẫu

| File | Thực thể | Quy mô | Ghi chú |
|---|---|---|---|
| DanhSachSanPham | Sản phẩm | 2.787 SKU | Toàn bộ "Hàng hóa", đang kinh doanh |
| BangGia | Bảng giá | 2.787 dòng | Trùng danh sách sản phẩm; **chỉ xuất bảng "Bảng giá chung"** |
| DanhSachKhachHang | Khách hàng | 1.665 | 1.656 cá nhân, 9 công ty |
| DanhSachNhaCungCap | Nhà cung cấp | 35 | |
| DanhSachChiTietDatHang | Đặt hàng (bán) | 188 đơn / 747 dòng | |
| DanhSachChiTietHoaDon | Hóa đơn bán | 129 HĐ / 721 dòng | |
| DanhSachChiTietTraHang | Trả hàng bán | 17 dòng | |
| DanhSachChiTietNhapHang | Nhập hàng | 5 phiếu / 155 dòng | |
| DanhSachChiTietTraHangNhap | Trả hàng nhập | 2 dòng | |
| SoQuy | Sổ quỹ | 32 phiếu + 4 dòng tổng kết | |

Các file chứng từ đều là dạng **phẳng**: thông tin phiếu lặp lại trên mọi dòng hàng → khi import phải gom nhóm theo mã phiếu.

#### Phát hiện ảnh hưởng đến thiết kế

**A. Hàng hóa**
- Cấu trúc **phẳng**: không có biến thể, mã vạch, thương hiệu, combo ("Hàng thành phần" rỗng), lô/hạn dùng, trọng lượng (rỗng). Cột **ĐVT rỗng 100%**; đơn vị/quy cách nằm trong tên (1.013/2.787 tên có dạng "… (Chiếc)", "… (50 tờ)") → mỗi quy cách là **một SKU riêng**.
  → **Bỏ khỏi MVP:** `product_variants`, `lô/HSD`, `barcodes` riêng, quy đổi đơn vị. **Cập nhật 05/11/2026:** bỏ luôn các cột `unit`, `weight_g`, `is_sellable` của sản phẩm; **thêm loại hàng Combo** (`product_type` = `goods`/`combo`, bảng `product_components`): combo chỉ để chọn nhanh khi lập đơn, tồn/giá vốn tính từ hàng thành phần, chứng từ và báo cáo chỉ có hàng thành phần.
- Mã hàng: chữ-số không dấu, không khoảng trắng, tối đa 13 ký tự, không trùng → dùng làm **khóa nghiệp vụ duy nhất**, độ dài cột 30.
- Nhóm hàng dạng cây phân tách bằng `>>` (khi xuất từ file Bảng giá có khoảng trắng quanh `>>`, file sản phẩm thì không → **chuẩn hóa khi import**). 91 nhóm, tối đa 2 cấp hiện tại (KiotViet cho 3 cấp) → bảng `categories` có `parent_id`.
- Có dùng: giá bán chung (chỉ 45% SP có giá > 0), giá vốn (96%), tồn kho, `Đặt NCC` (SL đang đặt nhà cung cấp), `KH đặt` (SL khách đã đặt), tồn lớn nhất (95% có giá trị; "tồn nhỏ nhất" rỗng), **vị trí kho** (59%, giá trị dạng số "11", "26"), mô tả (91%), ảnh (98%).
- **Ảnh nằm trên CDN của KiotViet** → phải tải về lưu vào kho file của mình **trước khi ngừng KiotViet**.
- `Đặt NCC` và `KH đặt` là số **dẫn xuất** (từ đơn đặt nhập chưa nhận / đơn bán chưa giao), không lưu thành cột gốc.
- **Giá vốn và giá nhập có phần thập phân** (669/2.686 giá vốn lẻ; giá nhập như 219.967,98). → đơn giá/giá vốn lưu `NUMERIC(18,4)`, **không** lưu số nguyên như nguyên tắc cũ (đã sửa ở mục 3.3). Số lượng hiện là số nguyên (có đơn tới 10.000 cái/dòng) nhưng nên dùng `NUMERIC(14,3)` cho linh hoạt.

**B. Bảng giá (điểm mấu chốt của bán sỉ)**
- Hóa đơn dùng **7 bảng giá**: `Lớn`, `Vừa`, `VIP`, `Bảng giá chung` và 3 bản VAT (`Lớn VAT`, `Vừa VAT`, `Vip VAT`). **Mỗi hóa đơn đúng 1 bảng giá** (129/129). Bảng giá = *hạng khách*, có biến thể "đã gồm VAT".
- File BangGia chỉ có bảng chung → **thiếu giá của 6 bảng còn lại**, cần xuất bổ sung từ KiotViet.
- Công thức dòng hàng: `Đơn giá` (giá niêm yết theo bảng giá) − `Giảm giá` (**số tiền trên 1 đơn vị**, không dùng %: cột % luôn 0) = `Giá bán`; `Thành tiền = SL × Giá bán`. Kiểm tra: tổng thành tiền các dòng = `Tổng tiền hàng` ở cả 129/129 HĐ.
- **Không có bằng chứng về giá bậc thang theo số lượng** → hạ xuống "tùy chọn", không làm ở MVP.
- Có dòng giá bằng 0 (32 dòng đơn đặt hàng, 1 dòng hóa đơn) → hàng tặng/chưa định giá; cần cờ `is_gift` hoặc cho phép giá 0.
- File khách hàng **không có cột bảng giá mặc định**. Tuy nhiên cột **Email của khách chứa giá trị giả dạng `Vừa@gmail.com`, `Lớn@gmail.com`, `Mới@gmail.com`** (1.318 / 114 / 92 khách) — từng nghi là cách công ty *ghi hạng giá* vào ô email. **Đã xác nhận 04/11/2026 (mục 5.8 câu 1): đó chỉ là email thử, không mang thông tin hạng giá** → bỏ qua khi import, không suy ra `default_price_book_id`, tuyệt đối không import làm email thật.

**C. Khách hàng**
- Điện thoại **không trùng** giữa 1.665 khách (có thể đặt unique), nhưng 4 định dạng (`0xxxxxxxxx`, thiếu số 0 đầu, `xxxx.xxx.xxx`, `+84…`) → chuẩn hóa trước khi lưu.
- **"Nhóm khách hàng" (59 giá trị) thực chất là *tên nhân viên phụ trách***, không phải nhóm khách. → Không tạo `customer_groups`; dùng `customers.sales_owner_id`. Hạng giá là trường riêng (`default_price_book_id`).
- Tên khách có tiền tố ("SG" 905, "MN" 537, "KH" 170, "NN" 27, "HN" 21…) — có vẻ là **khu vực/loại** nhưng chưa xác nhận → tạm giữ trong tên, hỏi lại để tách thành trường `region`.
- Địa chỉ là chuỗi tự do (96% có); tỉnh/phường gần như rỗng → 1 cột `address`, không ép cấu trúc hành chính.
- Thông tin xuất hóa đơn (MST, tên công ty…) gần như rỗng (MST chỉ 1 khách) → tách bảng `customer_invoice_profiles` (nullable) để dùng cho HĐ VAT/HĐĐT.
- **Công nợ:** 85 khách nợ dương (tổng ≈ 6,61 tỷ) và **111 khách có số dư âm** (≈ −254 triệu, khách trả dư/ứng trước) → sổ công nợ phải cho phép số dư âm. 409 khách chưa từng giao dịch.

**D. Quy trình bán hàng**
- **Đặt hàng → Hóa đơn**: 129/129 hóa đơn đều sinh từ một đơn đặt hàng, quan hệ **1 đơn – 1 hóa đơn** (không có giao từng phần); 74/188 đơn đã có hóa đơn, đơn "Hoàn thành" luôn có hóa đơn; còn lại là "Phiếu tạm". 17 đơn có đặt cọc.
  → Trạng thái đơn: `draft (phiếu tạm) → completed` (+ `cancelled`). **Giao từng phần** và **báo giá riêng** (không có trong dữ liệu) hạ xuống Phase 2; "phiếu tạm" đóng vai trò báo giá/giữ hàng.
- **Mã hóa đơn có hậu tố** (`HD016829.01`, 21 dòng): hóa đơn phát sinh khi sửa/đổi trả sau khi đã chốt (cơ chế của KiotViet). Trả hàng tham chiếu cả mã có hậu tố → lưu `revision_no` + `root_invoice_id`.
- **Mua chịu là chuẩn:** 116/129 HĐ chưa thu đủ, **98 HĐ chưa thu đồng nào**, chỉ 13 HĐ thu đủ. Phương thức thanh toán chỉ **tiền mặt và chuyển khoản** (thẻ, ví, điểm = 0). Thanh toán ghi tổng theo hóa đơn (không có ngày từng lần thu); khoản thu nợ về sau nằm ở sổ quỹ ("Phiếu thu Tiền khách trả") **gắn theo khách, không gắn từng hóa đơn** → thu theo khách, cấn trừ vào hóa đơn cũ nhất mặc định (cho phép chọn tay).
- **Người bán ≠ người tạo:** 43 giá trị "người bán" khác nhau nhưng chỉ 4 "người tạo" → *người bán* là NVKD đứng tên (tính hoa hồng/doanh số), *người tạo* là nhân viên nhập liệu. Lưu riêng `seller_id` và `created_by`.
- Giảm giá cấp hóa đơn dùng ít (4/129 HĐ); `Khách cần trả = Tổng tiền hàng − Giảm giá hóa đơn` đúng ở 129/129.
- **Không dùng trong dữ liệu:** kênh bán (100% "Bán trực tiếp"), đối tác giao hàng/mã vận đơn (rỗng), thẻ/ví/điểm, khuyến mãi, giảm giá %. → bỏ `sales_channels`, `delivery_partners`, `loyalty`, `promotions` khỏi MVP.
- Giao hàng thực tế: ~18% đơn có người nhận/địa chỉ nhận/trọng lượng/kích thước riêng → giữ khối thông tin giao hàng tối thiểu trên đơn. Chi phí vận chuyển đi qua sổ quỹ (xem E).
- **Trả hàng bán:** 15/17 dòng có tham chiếu hóa đơn gốc → cho phép trả không tham chiếu. **"Đã trả khách" = 0** → trả hàng được **bù trừ vào công nợ** thay vì hoàn tiền. Có `Giá nhập lại` (giá vốn khi nhập kho lại) và ghi chú lý do theo dòng (94%) → `reason`, `restock`.

**E. Mua hàng, nhà cung cấp, sổ quỹ**
- **Đặt hàng nhập (`PDN…`) → Nhập hàng (`PN…`)**: 153/155 dòng nhập gắn phiếu đặt nhập. "Số hóa đơn đầu vào" và "Tiền đã trả NCC" đều rỗng/0 → thanh toán NCC đi qua sổ quỹ ("Phiếu chi CÔNG NỢ").
- Có nhập **nguyên container** (1 mã hàng ~1.095 cái, ~240 triệu): giá nhập lẻ thập phân là kết quả phân bổ chi phí tính ngoài hệ thống → Phase 2 bổ sung **phân bổ chi phí nhập hàng (landed cost)**.
- **35 nhà cung cấp, nhưng nhiều "NCC" không phải nhà cung cấp hàng:**
  - 13 NCC thuộc nhóm "**Lái xe**" (theo dõi nợ/tạm ứng của tài xế);
  - 1 NCC ảo "**KIỂM KÊ …**" dùng để **điều chỉnh tồn kho** bằng phiếu nhập/trả hàng nhập (ghi chú "cân thực tế", "kk sai cân…"); cả 2 phiếu trả hàng nhập đều thuộc NCC này;
  - 1 NCC là nhân viên nghỉ việc ("tạm giữ lương");
  - Số điện thoại của cả 35 NCC không phải số điện thoại thật (mã số, chữ).
  → Thiết kế đúng: `suppliers.kind` (`goods` / `driver` / `other`), **module Kiểm kho riêng** thay cho NCC ảo, và công nợ dùng `party_type` (`customer` / `supplier` / `employee`) để theo dõi cả tạm ứng/tạm giữ lương. Khi import, NCC ảo kiểm kê **không** import làm NCC.
- **Sổ quỹ:** 15 phiếu thu (mã `TT…`), 17 phiếu chi (`CTM…`, `CTMTH…`). "Loại thu chi" là **chuỗi tự do**, thậm chí chứa cả biển số xe và tên tài xế ("Phiếu chi Xăng xe <biển số> (<tên>)") → cần `cash_categories` chuẩn (Tiền khách trả, Công nợ NCC, Cước vận chuyển, Phí thu hộ, Cước hàng hoàn, Bến bãi/Palet, Thuê xe ngoài, Xăng xe, Sửa chữa kho, Xử lý hàng lỗi…) và trường tham chiếu `vehicle`/ghi chú. Giá trị có dấu (+thu, −chi) → lưu số dương + `direction`. File không có tài khoản quỹ/phương thức/chi nhánh → mặc định "Tiền mặt – Chi nhánh trung tâm".
- 4 dòng không có mã cuối file là **dòng tổng kết** (quỹ đầu kỳ 369.310.338; tổng thu 364.836.707; tổng chi −541.385.251; tồn quỹ cuối 192.761.794 — các con số khớp nhau: 369,31 + 364,84 − 541,39 = 192,76 triệu) → **bỏ khi import**, dùng để đối chiếu.

**F. Khác**
- KiotViet hiện chỉ có **1 chi nhánh** ("Chi nhánh trung tâm") nhưng công ty thực tế có **2** (Hà Nội, Sài Gòn); chi nhánh còn lại cũng quản lý ở KiotViet và sẽ nhập sau. Xem mục 2.5.
- Nhân viên xuất hiện dạng chuỗi "Họ tên - số 10 chữ số"; **không có file nhân viên** → tạo `users` từ danh sách giá trị distinct, cần xác nhận số đi kèm là gì (mã nhân viên? điện thoại?).
- Nhóm hàng chính: Nhà cửa đời sống, Mẹ bé, Điện gia dụng, Nhà bếp… (hàng gia dụng tổng hợp). Không có hàng cần lô/HSD hay serial → **đã chốt: không làm lô/HSD**.

### 5.2 Mã chứng từ hiện có (giữ nguyên để liên tục khi chuyển đổi)

| Chứng từ | Tiền tố | Ví dụ | Ghi chú |
|---|---|---|---|
| Khách hàng | `KH` | KH006974 | 6 chữ số |
| Nhà cung cấp | `NCC` | NCC000055 | 6 chữ số |
| Đặt hàng (bán) | `DH` | DH022295 | |
| Hóa đơn | `HD` | HD016890, HD016829.01 | hậu tố `.nn` = bản sửa/đổi |
| Trả hàng (bán) | `TH` | TH001076 | |
| Đặt hàng nhập | `PDN` | PDN000394 | |
| Nhập hàng | `PN` | PN000948 | |
| Trả hàng nhập | `THN` | THN000192 | |
| Phiếu thu | `TT` | TT019327 | |
| Phiếu chi | `CTM`, `CTMTH` | CTM002305 | `CTMTH` chưa rõ ý nghĩa (nghi là chi liên quan hàng hoàn) |

Bộ đếm (`code_sequences`) được khởi tạo bằng **số lớn nhất hiện có + 1** của từng tiền tố. Mã cũ lưu nguyên, chỉ thêm cột `legacy_code` nếu cần đối chiếu.

### 5.3 Danh sách bảng (39 bảng đã có trong lược đồ)

Lược đồ chính thức: `apps/api/src/db/schema/` (Drizzle) và `docs/db/` (DBML, từ điển dữ liệu, `schema.sql`, sinh tự động bằng `pnpm db:docs`).

```
Hệ thống  : company_profile, branches, users, role_permissions, user_branches, refresh_tokens,
            audit_logs, code_sequences, idempotency_keys, import_jobs
Hàng hóa  : categories (cây), products, product_components (combo), product_images
Tồn kho   : stocks (chi nhánh + sản phẩm: tồn, giá vốn bình quân, giá nhập cuối, tối thiểu/tối đa, vị trí),
            stock_movements (sổ cái, chỉ thêm),
            stock_transfers, stock_transfer_items      -- chuyển kho 2 bước giữa HN và SG
Đối tác   : customers, customer_invoice_profiles, customer_branch_terms (hạn mức/kỳ hạn theo chi nhánh),
            suppliers (có group_name: nhóm NCC, có thể để trống)
Bán hàng  : orders, order_items, invoices, invoice_items, invoice_payments,
            sales_returns, sales_return_items
Mua hàng  : goods_receipts, goods_receipt_items, purchase_returns, purchase_return_items
Tiền/nợ   : cash_accounts, cash_categories, cash_transactions, debt_ledger, payment_allocations
Chưa làm  (Phase 2): stock_takes/stock_take_items (kiểm kho, thay NCC ảo), purchase_orders (đặt hàng nhập),
            product_unit_conversions, quotations, deliveries, landed_costs, commission_rules, customer_price_rules
Bỏ/hoãn   : product_variants, product_combos, batches/lô-HSD, customer_groups, sales_channels,
            delivery_partners, loyalty, promotions
```

Ghi chú: quyền nằm ở `role_permissions` (vai trò là danh sách cố định 7 giá trị trong mã, không có bảng `roles`/`permissions`/`user_roles`); nhóm khách của KiotViet thực chất là nhân viên phụ trách nên không có bảng `customer_groups` (ADR-13).

### 5.4 Cột chính của các bảng cốt lõi

Quy ước: `NUMERIC(18,0)` = tiền chứng từ (đồng); `NUMERIC(18,4)` = đơn giá/giá vốn; `NUMERIC(14,3)` = số lượng. Tất cả bảng có `id` (UUID v7), `created_at`, `updated_at`, `created_by`, `deleted_at`.

| Bảng | Cột chính |
|---|---|
| `products` | **Chỉ thông tin dùng chung:** `code` (unique, ≤30), `name`, `category_id`, `product_type` (`goods` mặc định / `combo`), `description`, `is_active`. Combo có thành phần ở `product_components` (`combo_id`, `component_id`, `qty` nguyên dương), không có dòng `stocks` riêng. Giá bán ở `price_book_items`; tồn, giá vốn, giá nhập cuối, tồn min/max, vị trí kho ở `stocks` (theo chi nhánh) |
| `customers` | `code`, `name`, `type` (`individual`/`company`), `phone` (unique, đã chuẩn hóa), `address`, `facebook`, `sales_owner_id` → `users` (nhân viên phụ trách), `default_price_book_id`, `note`, `is_active` |
| `customer_invoice_profiles` | `customer_id`, `buyer_name`, `company_name`, `tax_code`, `address`, `email`, `phone`, `bank_name`, `bank_account` |
| `suppliers` | `code`, `name`, `group_name` (nhóm, có thể trống), `linked_branch_id`, `is_active`. **Từ 06/11/2026 bỏ** `kind`, `phone`, `address`, `tax_code`, `note` (file KiotViet đã lược cột không dùng). **Tiền riêng từng chi nhánh**: nợ = sổ cái `debt_ledger` (có `branch_id`); số lịch sử tổng mua / trừ trả hàng ở `supplier_branch_history` (nhà cung cấp × chi nhánh) |
| `orders` | `code`, `branch_id`, `customer_id`, `status` (`draft`/`completed`/`cancelled`), `order_date`, `seller_id`, `price_book_id`, `subtotal`, `discount`, `total`, `deposit_paid`, `note`; giao hàng: `ship_to_name`, `ship_to_phone`, `ship_to_address`, `package_count`, `weight_g` |
| `order_items` | `order_id`, `product_id`, `qty`, `list_price`, `discount_per_unit` (tiền, không %), `unit_price`, `line_total`, `is_gift`, `note` |
| `invoices` | `code`, `root_invoice_id`, `revision_no`, `branch_id`, `order_id` (unique), `customer_id`, `price_book_id`, `seller_id`, `invoice_date`, `subtotal`, `discount`, `total`, `paid_total` (dẫn xuất từ `invoice_payments`), `status`, `note`. **Giữ nguyên bản sao giá/tên SP tại thời điểm bán** |
| `invoice_items` | như `order_items`, thêm `unit_cost` (giá vốn tại thời điểm bán, để tính lãi gộp) |
| `invoice_payments` | `invoice_id`, `method` (`cash`/`bank`), `amount`, `paid_at` |
| `sales_returns` | `code`, `invoice_id` (nullable), `customer_id`, `status`, `total`, `settlement` (`offset_debt`/`refund`), `received_by`, `note` |
| `sales_return_items` | `product_id`, `qty`, `return_price`, `restock_cost`, `restock` (bool), `reason` |
| `purchase_orders` / `goods_receipts` | `code`, `supplier_id`, `purchase_order_id` (nhập), `status`, `total`, `discount`, `supplier_invoice_no`, `received_by`, `note`; dòng: `product_id`, `qty`, `unit_cost` `NUMERIC(18,4)`, `line_total` |
| `purchase_returns` | như phiếu nhập, thêm `reason` |
| `stock_movements` | `branch_id`, `product_id`, `qty_delta`, `unit_cost`, `ref_type` (`invoice`/`receipt`/`sales_return`/`purchase_return`/`stock_take`/`opening`), `ref_id`, `occurred_at` |
| `stock_takes` + items | `code`, `branch_id`, `status`, dòng: `product_id`, `system_qty`, `counted_qty`, `diff` — cân bằng sinh `stock_movements` |
| `cash_accounts` | `name`, `type` (`cash`/`bank`), `branch_id` |
| `cash_categories` | `name`, `direction` (`in`/`out`), `is_system` |
| `cash_transactions` | `code`, `direction`, `amount` (> 0), `category_id`, `account_id`, `occurred_at`, `party_type`, `party_id` (nullable), `party_name_text` (khi không link được), `vehicle_ref` (nullable), `ref_type`/`ref_id`, `note` |
| `debt_ledger` | **`branch_id`**, `party_type` (`customer`/`supplier`/`employee`), `party_id`, `entry_type` (`opening`/`invoice`/`payment`/`return`/`adjustment`/`transfer`), `ref_type`/`ref_id`, `amount` **có dấu** (+ tăng nợ, − giảm nợ), `occurred_at`. Số dư = tổng **theo từng chi nhánh**; được phép âm |
| `payment_allocations` | `cash_transaction_id`, `invoice_id`, `amount` — phục vụ tuổi nợ/đối chiếu theo hóa đơn; mặc định tự phân bổ vào hóa đơn cũ nhất |

### 5.5 Quy tắc chung
- Khóa chính UUID v7; **khóa nghiệp vụ** (mã SP, mã KH, mã chứng từ) có unique index và được giữ nguyên từ KiotViet.
- Tiền chứng từ làm tròn tới đồng; đơn giá/giá vốn giữ 4 chữ số thập phân; quy tắc làm tròn `line_total` thống nhất và có test.
- Index trigram + `unaccent` cho tên SP/KH (tìm không dấu); index `(branch_id, …)` cho bảng theo chi nhánh; index `(customer_id, invoice_date)` cho công nợ.
- Dữ liệu chứng từ **không xóa cứng**; hủy = đổi `status` + audit log. Mọi thay đổi tồn/quỹ/nợ đi qua sổ cái.
- Tồn kho hiện tại, `Đặt NCC`, `KH đặt`, dự kiến hết hàng là **dữ liệu dẫn xuất** (tính từ sổ cái/đơn), có thể cache.
- Phân vùng bảng lớn (`stock_movements`, `invoice_items`) theo năm khi cần; với quy mô hiện tại (~2.800 SKU, ~65 HĐ/ngày) **chưa cần**.

### 5.6 Luồng nghiệp vụ trọng yếu (đã điều chỉnh theo dữ liệu)

**Đặt hàng → Hóa đơn (luồng chính):**
```
Tạo đơn (draft): chọn khách → tự gán bảng giá của khách → thêm dòng (giá lấy từ bảng giá,
                 có thể giảm giá/đơn vị) → hiển thị tồn, công nợ hiện tại, cảnh báo hạn mức
 → [Chốt đơn / Xuất hóa đơn]  (1 đơn → 1 hóa đơn)  — Idempotency-Key
   BEGIN TRANSACTION
     → khóa & kiểm tra tồn (SELECT … FOR UPDATE theo product, branch)
     → ghi invoices + invoice_items (lưu unit_cost)
     → ghi stock_movements (xuất bán), cập nhật stocks
     → ghi invoice_payments (phần thu ngay: tiền mặt/CK) + cash_transactions
     → ghi debt_ledger: + phần còn lại (mua chịu); − tiền cọc đã thu từ đơn
     → audit_log
   COMMIT
 → sự kiện invoice.created (in A4, báo cáo, HĐĐT sau này)
Sửa/đổi trả sau khi chốt → tạo bản mới HDxxxxxx.nn (revision), không sửa đè.
```

**Thu nợ khách:** phiếu thu (`TT…`) gắn khách → `debt_ledger` (− số tiền) → tự phân bổ vào hóa đơn cũ nhất còn nợ (`payment_allocations`), có thể chỉnh tay. Thu dư → số dư âm (khách ứng trước).

**Nhập hàng:** đặt hàng nhập (`PDN`) → nhận hàng (`PN`) → cộng tồn → **tính lại giá vốn bình quân gia quyền** (`NUMERIC(18,4)`) → `debt_ledger` NCC (+). Trả NCC qua phiếu chi (`CTM`, loại "Công nợ").

**Trả hàng bán:** (có/không tham chiếu hóa đơn) → mỗi dòng chọn `restock` → nếu nhập lại: cộng tồn theo `restock_cost`; mặc định bù trừ vào công nợ khách (`settlement = offset_debt`).

**Kiểm kho:** tạo phiếu kiểm → nhập số đếm thực tế → cân bằng → sinh `stock_movements` điều chỉnh (thay cho thủ thuật "NCC kiểm kê" đang dùng).

**Sổ quỹ:** mọi thu/chi chọn `cash_category`; thu/chi liên quan đối tác thì link `party`; chi phí vận chuyển gắn xe/tài xế qua `vehicle_ref`.

### 5.7 Kế hoạch chuyển dữ liệu từ KiotViet

Thứ tự import (mỗi bước idempotent theo mã nghiệp vụ, chạy thử trên staging, có báo cáo lỗi từng dòng):

| # | Nguồn | Đích | Xử lý |
|---|---|---|---|
| 1 | SanPham | `categories`, `products` | Tách cây nhóm theo `>>` (trim khoảng trắng); giữ nguyên tên (không còn cột đơn vị tính); cột `Loại hàng`/`Hàng thành phần` (dạng `MSP/SL,MSP/SL`) → `product_type` và `product_components` |
| 2 | SanPham (ảnh) | `product_images` | **Tải ảnh từ CDN KiotViet về kho file riêng**, ghi lại URL mới; chạy sớm vì phụ thuộc KiotViet còn hoạt động |
| 3 | BangGia (+ 6 bảng cần xuất thêm) | `price_books`, `price_book_items` | Seed 7 bảng giá; thiếu giá → dùng bảng chung |
| 4 | Danh sách nhân viên (cần xuất thêm) / giá trị distinct từ chứng từ | `users` | Tạo tài khoản, gán vai trò thủ công |
| 5 | KhachHang | `customers`, `customer_invoice_profiles` | Chuẩn hóa SĐT; "Nhóm khách hàng" → `sales_owner_id`; **bỏ email giả**; suy `default_price_book_id` (sau khi xác nhận giả thuyết) |
| 6 | NhaCungCap | `suppliers` | Nhóm "Lái xe" → `kind=driver`; bỏ NCC kiểm kê ảo; nhân viên "tạm giữ lương" → `party_type=employee` |
| 7 | Tồn kho (cột Tồn kho, Giá vốn) | `stock_movements` (`opening`) | Một bút toán tồn đầu kỳ cho mỗi SP, kèm giá vốn |
| 8 | Nợ KH / Nợ NCC | `debt_ledger` (`opening`) | Một bút toán số dư đầu kỳ mỗi đối tác; cho phép âm. Đối chiếu tổng với file (≈ 6,61 tỷ phải thu; −254 triệu số dư âm) |
| 9 | SoQuy | `cash_transactions` | Bỏ 4 dòng tổng kết; map loại thu chi sang `cash_categories`; quỹ đầu kỳ làm số dư mở của `cash_accounts` |
| 10 | DatHang, HoaDon, TraHang, NhapHang, TraHangNhap | chứng từ lịch sử | **Chỉ import nếu cần tra cứu**; khuyến nghị giữ lịch sử bằng file lưu trữ + import chứng từ chưa hoàn tất (đơn "Phiếu tạm") và X tháng gần nhất. Khi import lịch sử **không** tạo lại bút toán kho/nợ (đã nằm trong số dư đầu kỳ) |

Sau import: đối chiếu số lượng bản ghi, tổng tồn × giá vốn, tổng công nợ, tồn quỹ với file gốc; ký biên bản đối chiếu trước khi chạy thật.

**Dữ liệu còn thiếu cần xuất thêm từ KiotViet:** (1) giá của 6 bảng giá còn lại; (2) danh sách nhân viên + phân quyền; (3) bảng giá áp dụng cho từng khách (nếu có ngoài email giả); (4) hạn mức/kỳ hạn công nợ (nếu có ghi nhận); (5) lịch sử hóa đơn dài hơn 2 ngày để kiểm tra các giả định về hành vi mua; (6) danh mục tài khoản quỹ (tiền mặt, ngân hàng).

### 5.8 Câu hỏi cần xác nhận từ dữ liệu
> Trả lời của chủ dự án ngày 04/11/2026. Câu 3, 4, 5 tạm hoãn.

1. ✅ **Email `Vừa@gmail.com`/`Lớn@gmail.com`/`Mới@gmail.com` là email thử (test), KHÔNG phải hạng giá.** Khi import: **bỏ qua** các giá trị này (không nhập làm email thật, không suy ra bảng giá). Dữ liệu cũ **không cho biết** khách nào dùng bảng giá nào → khách import về mặc định dùng Bảng giá chung của chi nhánh; bảng giá riêng gán sau trong hệ thống mới.
2. ✅ Tiền tố tên khách: **SG** = Sài Gòn, **MN** = Miền Nam, **KH** = khách hàng, **HN** = Hà Nội; **NN** chưa xác nhận được. Đây chỉ là cách gõ tên, không tạo trường mới; khi import giữ nguyên tên khách.
3. ⏳ Số 10 chữ số đi sau tên nhân viên là gì (mã nhân viên, điện thoại, ID KiotViet)? — _trả lời sau_
4. ⏳ `CTMTH…` là loại phiếu chi gì? — _trả lời sau_
5. ⏳ Có cần hóa đơn VAT/HĐĐT không? (có 3 bảng giá VAT và 9 khách công ty nhưng cột trạng thái HĐĐT rỗng và chỉ 1 khách có MST). — _trả lời sau_
6. ✅ **Không cần xử lý nghiệp vụ riêng cho nhóm nhà cung cấp** (Lái xe, "tạm giữ lương"): không theo dõi nợ/ứng của tài xế, nhân viên thành đối tượng riêng. Nhưng **vẫn có cột `suppliers.group_name`** (chuỗi tự do, **có thể để trống**) để lưu nhóm NCC từ KiotViet. Khi import: giữ nguyên các NCC này như NCC thường kèm giá trị nhóm; chỉ bỏ NCC kiểm kê ảo.
7. ✅ **Giữ lịch sử chứng từ, thời gian tạm thời là không giới hạn** (không xóa/đưa vào kho lưu trữ theo hạn). Phù hợp quy tắc không xóa cứng chứng từ.

---

## 6. Thiết kế API

> **Hợp đồng chính thức: `docs/api/README.md` + `docs/api/endpoints.md` + `docs/api/openapi.json`.** Mục này chỉ tóm tắt nguyên tắc.

- Tiền tố & phiên bản: `/api/v1/...`; JSON camelCase; tiền/giá/số lượng là **chuỗi thập phân**; thời gian ISO 8601 UTC.
- Quy ước REST: `GET /products`, `POST /products`, `GET /products/:id`, `PATCH /products/:id`; **không xóa cứng** (ngưng/hủy bằng đổi trạng thái).
- Phân trang `?page=1&limit=20`, lọc/sắp xếp qua query (`sort=-created_at`, `q=` tìm không dấu, `branchId=`). Phản hồi danh sách: `data` + `meta`.
- **Mọi lỗi** có dạng `{ code, message, details, requestId }` (bộ lọc lỗi toàn cục đã triển khai); `details` của lỗi nhập liệu là `[{ field, message }]`.
- Header: `Authorization: Bearer`, `X-Branch-Id` (chi nhánh đang làm việc), `Idempotency-Key`, `X-Request-Id`.
- Mặc định mọi endpoint **cần đăng nhập** (`@Public()` mới công khai) và gắn `@RequirePermission`.
- Tài liệu hóa bằng **OpenAPI/Swagger**; validate đầu vào bằng **class-validator** (DTO) ở backend.
- Giới hạn tốc độ: đăng nhập đã có giới hạn riêng (trong bộ nhớ); giới hạn toàn cục sẽ bổ sung, **không dùng Redis** ở giai đoạn này. CORS theo `WEB_ORIGIN`.
- Webhook ra ngoài: chưa làm (Phase 3).

**Ví dụ endpoint chính:**
```
POST   /auth/login | /auth/refresh | /auth/logout
GET    /products?q=&categoryId=&branchId=
POST   /invoices                 (tạo hóa đơn – Idempotency-Key)
POST   /invoices/:id/return      (trả hàng)
POST   /goods-receipts           (nhập hàng)
POST   /stock-transfers          (chuyển kho)
POST   /stock-takes/:id/balance  (cân bằng kho)
GET    /customers/:id/debts
POST   /cash-transactions        (phiếu thu/chi)
GET    /reports/sales?from=&to=&groupBy=day
POST   /imports/products         (upload Excel → job nền)
```

---

## 7. Thiết kế giao diện (UI/UX)

### 7.1 Nguyên tắc
- **POS tối ưu tốc độ**: thao tác bằng bàn phím & máy quét, phím tắt (F2 tìm hàng, F4 khách hàng, F9 thanh toán…), nhiều tab hóa đơn chờ, nút lớn, ít cuộn trang.
- **Trang quản trị**: bố cục sidebar + topbar, bảng dữ liệu có lọc/cột tùy chọn/xuất Excel, thao tác hàng loạt.
- **Responsive**: Admin dùng được trên tablet/điện thoại; POS tối ưu cho màn hình cảm ứng 10–15".
- Ngôn ngữ **tiếng Việt** mặc định (chuẩn bị i18n để thêm tiếng Anh), định dạng tiền `1.234.567 ₫`, ngày `dd/MM/yyyy`.
- Chế độ sáng/tối, accessible (tương phản, focus rõ).

### 7.2 Sơ đồ điều hướng

```
Đăng nhập → chọn chi nhánh làm việc (mặc định: Hà Nội; Quản lý chuyển được giữa HN/SG)
 ├─ Tổng quan
 ├─ Hàng hóa ─ Danh sách hàng hóa │ Thiết lập giá
 ├─ Mua hàng ─ Nhà cung cấp │ Nhập hàng │ Trả hàng nhập
 ├─ Đơn hàng ─ Đặt hàng │ Hóa đơn │ Trả hàng
 ├─ Khách hàng
 ├─ Sổ quỹ
 └─ Báo cáo ─ Công nợ khách │ Công nợ NCC │ Doanh số │ Tồn kho │ Sổ quỹ
```
*(Phạm vi đã chốt, mục 2.2. Nhân viên, Khuyến mãi, POS thuộc giai đoạn sau.)*

### 7.3 Màn hình POS (bố cục gợi ý — Phase 3, không thuộc phạm vi hiện tại)
```
┌──────────────────────────────────────────────────────────────┐
│ [Tab HĐ 1][Tab HĐ 2][+]            Thu ngân: A │ Chi nhánh X │
├───────────────────────────────┬──────────────────────────────┤
│ 🔍 Tìm hàng / quét mã         │ Khách hàng: [Chọn/Thêm]      │
│ ┌─────────────────────────┐   │ ──────────────────────────── │
│ │ Danh sách dòng hàng     │   │ Tạm tính            1.200.000│
│ │ SP | SL | Đơn giá | TT  │   │ Giảm giá                -50.000│
│ │ ...                     │   │ VAT                      0    │
│ └─────────────────────────┘   │ KHÁCH PHẢI TRẢ     1.150.000 │
│ [Lưới sản phẩm/nhóm hàng]     │ Phương thức: TM|CK|Thẻ|Ví    │
│                               │ [      THANH TOÁN (F9)     ] │
└───────────────────────────────┴──────────────────────────────┘
```

Gợi ý: dựng **design system** riêng (token màu, spacing, component) trước khi làm màn hình; thiết kế wireframe/prototype bằng Figma.

---

## 8. Phân quyền & bảo mật

### 8.1 Phân quyền (RBAC)
- Quyền chi tiết theo `module.hành_động` (VD: `invoice.create`, `invoice.cancel`, `product.cost.view`); danh mục 34 quyền ở `packages/shared/src/permissions.ts`. Quyền có thể có **phạm vi** `all` hoặc `own` (chỉ dữ liệu của mình).
- **7 vai trò cố định**: Quản lý, Trợ lý, Kế toán, Kho, Lái xe, Sale, Marketing. Quản lý luôn đủ quyền và **cấu hình quyền cho các vai trò còn lại** qua `/roles/...` (bảng `role_permissions`); chưa hỗ trợ tạo vai trò mới hay ngoại lệ riêng từng người.
- Giới hạn theo **chi nhánh** (nhân viên chỉ thấy/thao tác chi nhánh được gán; Quản lý thấy cả hai).
- Quyền nhạy cảm cần xác nhận: sửa giá, giảm giá vượt ngưỡng, hủy hóa đơn, xem giá vốn (có thể yêu cầu PIN quản lý).

### 8.2 Bảo mật
- Mật khẩu băm **argon2id**; chính sách mật khẩu (10–128 ký tự, không chứa tên đăng nhập); bắt đổi mật khẩu lần đầu; khóa tạm khi đăng nhập sai quá 5 lần/15 phút; 2FA (TOTP) *chưa làm*.
- HTTPS bắt buộc ở production, HSTS; cookie refresh `httpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`; access token chỉ giữ trong bộ nhớ của trình duyệt.
- Chống OWASP Top 10: SQL injection (ORM/parameterized), XSS (escape, CSP), IDOR (kiểm tra quyền chi nhánh `branch_id` ở mọi truy vấn), SSRF, upload file an toàn.
- Mã hóa dữ liệu nhạy cảm (secret tích hợp) – dùng KMS/secret manager, không commit `.env`.
- **Audit log** bất biến cho thao tác quan trọng.
- Sao lưu hằng ngày + kiểm thử khôi phục; kế hoạch DR (RPO/RTO).
- Tuân thủ **Nghị định 13/2023/NĐ-CP** về bảo vệ dữ liệu cá nhân (khách hàng, nhân viên).

---

## 9. Phi chức năng (NFR)

| Hạng mục | Mục tiêu đề xuất |
|---|---|
| Hiệu năng tìm kiếm | Tìm hàng/khách (không dấu) < 200ms |
| Hiệu năng API | p95 < 500ms cho thao tác thường; tạo hóa đơn < 1s (p95) |
| Khả dụng | ≥ 99.5% giờ làm việc (không có POS offline) |
| Quy mô thiết kế | **2 chi nhánh, ~2.800 SKU, ~1.700 khách, ~65 hóa đơn/ngày** (~24.000/năm); dư địa gấp 10 lần không cần đổi kiến trúc |
| Báo cáo | Báo cáo nặng chạy nền hoặc dùng bảng tổng hợp (materialized view/aggregate) |
| Khả năng bảo trì | Coverage test ≥ 70% phần nghiệp vụ lõi; lint/format bắt buộc |
| Trình duyệt hỗ trợ | Chrome/Edge/Safari/Firefox bản mới (2 năm gần nhất) |

---

## 10. Cấu trúc dự án (monorepo)

```
kiot/
├─ apps/
│  ├─ api/            # NestJS – backend (modular monolith)
│  └─ web/            # Next.js – giao diện quản trị
├─ packages/
│  └─ shared/         # kiểu, hằng số, danh mục quyền, mã chứng từ dùng chung (build ra dist/)
├─ docs/              # tài liệu thiết kế, hợp đồng API (docs/api), lược đồ CSDL (docs/db)
├─ infra/             # docker-compose (PostgreSQL)
├─ .github/workflows/ # CI
└─ package.json / pnpm-workspace.yaml / turbo.json
```

Sẽ bổ sung khi cần: tiến trình worker riêng (hiện job nền chạy chung `api`), `packages/ui`, cấu hình triển khai.

Cấu trúc một module backend (thực tế, ví dụ `auth`): `apps/api/src/modules/auth/` gồm `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.dto.ts`, `*.guard.ts`, `*.spec.ts` (test đặt cạnh mã). Module không truy cập bảng của module khác trực tiếp; dùng service của module đó.

---

## 11. Quy trình phát triển & triển khai

- **Git**: Hiện chỉ **một người** viết backend nên đang commit thẳng vào `main` (CI chạy sau mỗi lần đẩy). **Từ phân hệ Hàng hóa/Giá trở đi** (và mọi thay đổi chạm tiền/kho/nợ): làm trên nhánh `feature/*` rồi Pull Request, **người thứ hai duyệt** trước khi merge (quy tắc số 9 của `CLAUDE.md`). Không cần nhánh `develop`. Conventional Commits.
- **Môi trường**: local (docker compose) → staging → production.
- **CI** (GitHub Actions, đã chạy): lint → typecheck → test → build. Bổ sung sau: kiểm tra `openapi.json` và `docs/db` đã sinh lại, E2E giao diện. **CD**: tự động deploy staging, duyệt tay lên production (chưa làm).
- **Migration CSDL** chạy tự động, có kế hoạch rollback; không sửa tay trên production.
- **Feature flag** cho tính năng chưa hoàn thiện.
- **Dữ liệu seed & dữ liệu demo** để test; công cụ **di chuyển dữ liệu từ KiotViet** (import Excel hàng hóa/khách hàng/tồn đầu kỳ) – rất quan trọng khi công ty chuyển đổi.

### 11.1 Làm việc với đội 2 người + AI agent

**Phân vai gợi ý**
| Người | Trách nhiệm chính |
|---|---|
| Dev A (nghiệp vụ + backend) | Mô hình dữ liệu, nghiệp vụ lõi (giá, kho, công nợ, sổ quỹ), migration dữ liệu, review mọi thay đổi chạm tiền/kho/nợ |
| Dev B (frontend + hạ tầng) | Màn hình (tạo đơn, bảng dữ liệu, in A4), CI/CD, triển khai, backup, giám sát |
| AI agent | Sinh code theo spec, viết test, import/đối chiếu dữ liệu, tài liệu, refactor — **luôn qua PR có người duyệt** |

**Nguyên tắc để AI làm việc hiệu quả và an toàn**
1. **Đặt tài liệu này, `docs/api/`, `docs/db/` làm nguồn sự thật trong repo**, kèm `CLAUDE.md` (đã có) ghi quy ước: cấu trúc module, đặt tên, cách chạy test, các điều **không được làm** (không dùng float cho tiền, không sửa tồn trực tiếp, không bỏ qua transaction).
2. **Thiết kế theo spec nhỏ, từng lát dọc** (vertical slice): mỗi tính năng = 1 spec ngắn (đầu vào, quy tắc, ví dụ số) → AI viết code + test → người duyệt. Tránh giao "làm cả module".
3. **Test là hàng rào chính**: viết test nghiệp vụ trước/đồng thời cho phần nhạy cảm — tính giá theo bảng giá, giá vốn bình quân, cân bằng kho, cấn trừ công nợ, số dư sổ quỹ. Dùng **chính dữ liệu KiotViet làm bộ test đối chiếu** (ví dụ: tổng công nợ, tồn × giá vốn, tồn quỹ phải khớp file gốc).
4. **Kiểu dữ liệu chặt**: TypeScript strict + DTO `class-validator` + OpenAPI sinh từ mã → AI sai kiểu sẽ lỗi ngay khi biên dịch/CI.
5. **Mọi thay đổi qua PR + CI xanh**; phần chạm tiền/kho/nợ bắt buộc có người đọc kỹ. AI không có quyền ghi trực tiếp vào production hoặc chạy migration production.
6. **Không đưa dữ liệu thật (tên, SĐT, địa chỉ khách) vào prompt, repo hay log**: dùng dữ liệu đã ẩn danh/giả lập cho dev và test; file Excel gốc để ngoài repo (thêm vào `.gitignore`).
7. **Giữ stack nhỏ và quen thuộc** để AI sinh code chính xác và hai người vận hành nổi: một ngôn ngữ (TypeScript), một CSDL (PostgreSQL), ít dịch vụ phụ.
8. **Ghi lại quyết định (ADR)** ngắn mỗi khi chốt điều gì khó đảo ngược, để AI và người mới có ngữ cảnh.

**Việc AI làm tốt / cần người quyết**
- Tốt: CRUD, màn hình bảng/lọc, import Excel, test, migration, tài liệu, báo cáo SQL, chuyển đổi dữ liệu.
- Cần người: quy tắc nghiệp vụ (giá, nợ, làm tròn), xác nhận số liệu với kế toán, thiết kế UX tạo đơn nhanh, vận hành production, bảo mật.

---

## 12. Rủi ro & biện pháp

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Phạm vi quá lớn, trễ tiến độ (đội chỉ 2 người) | Cao | Làm theo lịch 9 tuần và cổng G0–G3 (mục 13), cắt phạm vi theo 13.4, giữ ngày 08/01 |
| AI sinh code sai nghiệp vụ mà không ai nhận ra | Cao | Test đối chiếu bằng dữ liệu KiotViet, người duyệt bắt buộc ở phần tiền/kho/nợ, spec ngắn có ví dụ số |
| Phụ thuộc vào 1–2 người (nghỉ việc/ốm) | Trung bình | Tài liệu + ADR trong repo, CI/CD tự động, backup & hướng dẫn khôi phục viết sẵn |
| Lộ dữ liệu khách hàng qua công cụ AI | Trung bình | Chỉ dùng dữ liệu ẩn danh trong dev/test, không commit file Excel gốc |
| Sai lệch tồn kho / giá vốn | Cao | Ledger append-only, transaction, test kỹ nghiệp vụ, công cụ đối soát |
| Quyết định nghiệp vụ còn mở (mục 5.8: VAT, vai trò, mã chứng từ…) làm trễ cổng G0 | Cao | Họp chốt với kế toán/chủ trong tuần 1; ghi giả định tạm vào `MEMORY.md`; không mở lại sau tuần 2 |
| Làm một mình ở backend, không có người duyệt phần chạm tiền/kho/nợ | Trung bình | Từ phân hệ Hàng hóa: nhánh + PR có người thứ hai duyệt; test đối chiếu số liệu KiotViet |
| Hiệu năng báo cáo khi dữ liệu lớn | Trung bình | Index, bảng tổng hợp, job nền, partition |
| Tích hợp bên thứ ba thay đổi API | Trung bình | Lớp adapter, retry/queue, theo dõi lỗi |
| Mất dữ liệu | Cao | Backup tự động + test restore, replica |
| Thiếu hiểu biết nghiệp vụ kế toán/thuế | Trung bình | Làm việc sớm với kế toán công ty, rà soát HĐĐT |

---

## 13. Lộ trình: xây dựng trong 2 tháng

**Yêu cầu: xây dựng trong 2 tháng.** Đội 2 người + AI agent, bắt đầu **thứ Hai 09/11/2026**, **bản dùng được (MVP-lite) vào thứ Sáu 08/01/2027** (9 tuần).

> **Nói thẳng về mức khả thi:** ước lượng đầy đủ trước đó là ~5 tháng (xem 13B). Nén còn 2 tháng **làm được nếu cắt phạm vi mạnh tay, cả hai làm toàn thời gian cho dự án, và chốt nghiệp vụ ngay tuần đầu**. Lịch 2 tháng **gần như không có đệm**: chỉ cần chậm quyết định nghiệp vụ hoặc đối chiếu số liệu lệch là trượt. Những gì **không nén được** là việc đối chiếu số liệu và chạy song song với KiotViet (dữ liệu tiền, kho, công nợ thật) → 2 tháng là thời gian **xây dựng xong**, còn **cắt chuyển hẳn nên diễn ra sau Tết** (mục 13.5).

### 13.1 Phạm vi MVP-lite (2 tháng)

Phạm vi theo đúng 7 phân hệ ở mục 2.2:

| Phân hệ | Làm trong 2 tháng |
|---|---|
| Nền | **Đã xong ở backend (tuần 1):** đăng nhập JWT, 7 vai trò với **quyền do Quản lý cấu hình được** (34 quyền, phạm vi tất cả/chỉ của mình), **2 chi nhánh** (giá/tồn/nợ/quỹ riêng, chuyển kho 2 bước), tìm không dấu, bộ lọc lỗi toàn cục, seed. **Còn lại:** quản lý người dùng, nhật ký thao tác (ghi `requestId`/chi nhánh), backup |
| Chuyển dữ liệu | Import sản phẩm, bảng giá, khách, NCC (giữ nhóm NCC vào `group_name`), **tồn đầu kỳ, nợ đầu kỳ, quỹ đầu kỳ** — có tham số **chi nhánh đích**; bỏ email thử của khách và NCC kiểm kê ảo; tải ảnh về kho file |
| Hàng hóa | Danh sách hàng hóa (+ thẻ kho, tồn theo chi nhánh, nhập/xuất Excel), Thiết lập giá (7 bảng giá × 2 chi nhánh, lưới sửa giá, hàng loạt, sao chép giữa chi nhánh) |
| Mua hàng | Nhà cung cấp (+ công nợ), Nhập hàng (giá vốn bình quân), Trả hàng nhập |
| Đơn hàng | **Engine tính giá**, Đặt hàng (màn hình tạo đơn sỉ, đặt cọc, giữ hàng), Hóa đơn (in A4), Trả hàng bán |
| Sổ quỹ | Phiếu thu/chi, danh mục thu chi, thu nợ khách + cấn trừ, trả nợ NCC, quỹ tiền mặt/ngân hàng |
| Khách hàng | Danh sách khách (nhân viên phụ trách, hạng giá, hạn mức, hồ sơ xuất hóa đơn), chi tiết khách (lịch sử, công nợ, thu nợ nhanh), nhập/xuất Excel |
| Tổng quan | Dashboard: doanh thu, số hóa đơn, công nợ phải thu/phải trả, tồn quỹ, top hàng/khách, biểu đồ 30 ngày |
| Báo cáo | 5 báo cáo chuẩn (công nợ khách, công nợ NCC, doanh số + lãi gộp, tồn kho, sổ quỹ), lọc theo kỳ, xuất Excel |

**Hoãn sang sau (Phase 2):**
| Hoãn | Tạm thay bằng |
|---|---|
| Báo cáo nâng cao (so sánh kỳ, hàng chậm bán, hoa hồng NVKD, báo cáo tùy biến) | Xuất Excel ở mọi danh sách rồi phân tích thêm |
| Kiểm kho (phiếu kiểm, cân bằng) | Chỉ điều chỉnh tồn qua import/script có người duyệt |
| Đặt hàng nhập (PDN) | Nhập hàng trực tiếp, lưu mã PDN dạng chữ để đối chiếu |
| Bản sửa hóa đơn `.nn` | Hủy hóa đơn + tạo lại (có nhật ký) |
| Phân quyền riêng cho từng người (ngoại lệ ngoài vai trò) | Gán quyền theo vai trò |
| Import lịch sử chứng từ cũ | File Excel lưu trữ + KiotViet chỉ-đọc; chỉ import số dư đầu kỳ và đơn "phiếu tạm" còn mở |
| Hoa hồng NVKD, hạn mức công nợ cứng, giao hàng/xe, quy đổi đơn vị, chi phí container, HĐ VAT/điện tử | Làm sau go-live (mục 13B.4) |

*Về thời gian:* Dashboard và Báo cáo **dùng lại phần đệm** vừa có được khi bỏ Kiểm kho và Đặt hàng nhập, nên lịch **không còn đệm đáng kể** (còn ~1–2 ngày). Cách giữ lịch: (1) làm từng báo cáo **ngay khi dữ liệu của nó xong** thay vì dồn cuối; (2) mọi báo cáo dùng chung một khung (bộ lọc kỳ, bảng, xuất Excel) nên sau báo cáo đầu tiên các báo cáo sau rất nhanh; (3) Dashboard chỉ dùng các truy vấn của báo cáo, không có truy vấn riêng. Lưu ý: Trả hàng nhập thực tế rất ít dùng (dữ liệu mẫu 2 dòng, đều là điều chỉnh kiểm kê) nên là mục cắt đầu tiên nếu trễ (13.4).

**Cách tăng tốc (đã tính vào lịch):**
1. Dùng mẫu giao diện admin có sẵn (shadcn/ui + TanStack Table), **không thiết kế riêng**; chỉ đầu tư đặc biệt vào màn hình tạo đơn sỉ.
2. Sinh CRUD/migration/import bằng AI theo spec; người dành thời gian cho nghiệp vụ lõi và duyệt.
3. **Chốt nghiệp vụ trong 2 ngày đầu** (mục 5.8: còn câu 3, 4, 5 và vài giả định); không mở lại sau tuần 2 trừ lỗi nghiêm trọng.
4. Một môi trường staging dùng chung, deploy tự động mỗi lần merge.
5. Test tự động chỉ tập trung phần tiền/kho/nợ (giá, giá vốn, cấn trừ, sổ quỹ); phần giao diện kiểm tay.

### 13.2 Lịch 9 tuần

```
Tuần  W1   W2   W3   W4   W5   W6   W7   W8   W9
Ngày  9/11 16/11 23/11 30/11 7/12 14/12 21/12 28/12 4/1 → 8/1
Nền   ████ ██
Hàng hóa + Giá   ████ ████
Import                ████ ██                  ░░ (chạy lại cuối)
Đặt hàng                   ████ ████
Hóa đơn + in                    ████ ██
Trả hàng + Sổ quỹ                    ████ ██
Mua hàng                                  ████ ██
Khách hàng        ██            ▪▪
Báo cáo (làm dần)                  ▪    ▪    ▪   ██
Dashboard                                         ████
UAT                                                 ████ ████
Cổng       G0▲       G1▲        G2▲                  G3▲(8/1)
```

| Tuần | Dev A (nghiệp vụ + backend) | Dev B (giao diện + hạ tầng) | Đầu ra / cổng |
|---|---|---|---|
| **W1** (9/11) | Chốt nghiệp vụ với kế toán (mục 5.8). *Backend nền đã xong sớm (từ 04/11): lược đồ 39 bảng, auth JWT, phân quyền, 2 chi nhánh, chuyển kho, seed, CI.* | Xuất dữ liệu bổ sung từ KiotViet (6 bảng giá, nhân viên, quỹ); repo + CI + staging + `CLAUDE.md`; wireframe màn hình tạo đơn và dashboard | **G0**: nghiệp vụ chốt, staging chạy, ERD duyệt |
| **W2** (16/11) | Sản phẩm, nhóm hàng, 7 bảng giá, khách, NCC (API + migration) | Khung giao diện, bảng dữ liệu chung; màn hình **Danh sách hàng hóa** | Danh sách hàng hóa thao tác được |
| **W3** (23/11) | **Công cụ import** (SP, bảng giá, khách, NCC, nhân viên) + tải ảnh; **engine tính giá** + test | **Thiết lập giá** (lưới, hàng loạt, Excel), Nhà cung cấp, **Khách hàng** (danh sách, form, hồ sơ xuất hóa đơn); **khung báo cáo dùng chung** (bộ lọc kỳ, bảng, xuất Excel) | **G1**: import khớp 2.787 SP / 1.665 KH |
| **W4** (30/11) | Sổ cái tồn kho + tồn đầu kỳ; sổ cái công nợ + nợ đầu kỳ; thẻ kho; **báo cáo Tồn kho** | **Đặt hàng**: màn hình tạo đơn sỉ (bàn phím, giá/tồn/công nợ tức thì); giao diện báo cáo Tồn kho | Tạo được phiếu tạm; báo cáo Tồn kho đúng |
| **W5** (7/12) | Đơn → hóa đơn (transaction nguyên tử, idempotency), thanh toán, đặt cọc, hủy; **báo cáo Doanh số + lãi gộp** | **Hóa đơn**: danh sách, chi tiết, **in A4**; giao diện báo cáo Doanh số | Xuất hóa đơn thật trên staging |
| **W6** (14/12) | Trả hàng bán; **Sổ quỹ** (phiếu thu/chi, thu nợ + cấn trừ, quỹ đầu kỳ); API lịch sử/công nợ theo khách; **báo cáo Công nợ khách + Sổ quỹ** | Màn hình Trả hàng, Sổ quỹ; **chi tiết Khách hàng** (lịch sử, công nợ, thu nợ nhanh, biên bản đối chiếu); giao diện báo cáo Công nợ khách, Sổ quỹ | **G2** (18/12): đối chiếu tổng nợ/tồn/quỹ/doanh số khớp file gốc; 20 hóa đơn mẫu cùng tổng tiền |
| **W7** (21/12) | Nhập hàng + **giá vốn bình quân**, công nợ NCC, **Trả hàng nhập**, trả nợ NCC; **báo cáo Công nợ NCC** | Màn hình Nhập hàng, Trả hàng nhập, in phiếu nhập; giao diện báo cáo Công nợ NCC | Nhập/trả hàng chạy đúng giá vốn |
| **W8** (28/12) | Màn hình Phân quyền, nhật ký thao tác, xuất Excel mọi danh sách, backup tự động, bảo mật cơ bản; truy vấn **Dashboard** | **Dashboard** (thẻ số liệu, top 10, biểu đồ 30 ngày), phím tắt, hướng dẫn sử dụng, Sentry | Đủ chức năng MVP-lite (đệm ~1–2 ngày) |
| **W9** (4/1) | UAT & sửa lỗi; **chạy thử import cuối** (dry-run); thử khôi phục backup; triển khai production | UAT & sửa lỗi giao diện; giám sát; tài liệu người dùng | **G3** (8/1): sẵn sàng chạy song song |

Lưu ý lịch: W6–W9 trùng mùa cao điểm trước Tết → **UAT chỉ nhờ 1–2 người** (kế toán + 1 nhân viên nhập liệu) và mỗi người ≤ 1–2 giờ/ngày.

### 13.3 Cổng kiểm tra
| Cổng | Khi nào | Điều kiện đạt |
|---|---|---|
| G0 | 13/11 (cuối W1) | Nghiệp vụ chốt bằng văn bản; staging chạy; ERD duyệt |
| G1 | 27/11 (cuối W3) | Import khớp số SP/KH/NCC; ảnh đã tải; engine giá qua test với ví dụ thật |
| **G2** | **18/12 (cuối W6)** | Tổng công nợ, tồn × giá vốn, tồn quỹ **khớp file KiotViet**; 20 hóa đơn mẫu cùng tổng tiền. *Nếu không đạt: cắt thêm mục ở 13.4 ngay lập tức* |
| G3 | 08/01/2027 (cuối W9) | Quy trình hằng ngày (đặt hàng → hóa đơn → thu tiền → trả hàng → nhập hàng → sổ quỹ) chạy không cần dev hỗ trợ; **dashboard và 5 báo cáo khớp số liệu KiotViet**; xuất Excel đúng; backup khôi phục thành công |

### 13.4 Nếu trễ: thứ tự cắt thêm (giữ ngày 08/01)
1. **Trả hàng nhập** (dùng rất ít; tạm điều chỉnh bằng phiếu chi/thu + sửa tay có duyệt).
2. **Biểu đồ Dashboard** (giữ thẻ số liệu và top 10).
3. Tăng/giảm giá hàng loạt trong Thiết lập giá (chỉ giữ sửa bằng lưới và Excel).
4. Xuất PDF của báo cáo (chỉ giữ Excel); giao diện thẻ kho; tải ảnh trong ứng dụng.
5. **Không cắt:** engine giá, sổ cái kho/nợ/quỹ, import số dư đầu kỳ, đối chiếu, backup, báo cáo Công nợ khách và Sổ quỹ (kế toán dùng hằng ngày để đối chiếu).

### 13.5 Sau 08/01/2027: chạy song song và cắt chuyển
| Thời gian | Việc | Ghi chú |
|---|---|---|
| 11/01 – 29/01 | **Chạy song song nhẹ:** 1 nhân viên nhập đơn thật vào hệ thống mới song song KiotViet; đối chiếu tồn/nợ/quỹ cuối mỗi ngày. Dev sửa lỗi phát sinh | Cao điểm trước Tết nên giữ tải thấp |
| ≈ 04 – 14/02 | Nghỉ Tết | |
| 15/02 – 26/02 | Bổ sung phần hoãn quan trọng nhất (kiểm kho, bản sửa hóa đơn, báo cáo nâng cao); chạy song song tiếp | |
| 26/02 | **Go/No-Go**: chênh lệch đối chiếu = 0 (hoặc giải thích được) ≥ 5 ngày liền | |
| 27/02 – 28/02 | Đóng băng, import số dư đầu kỳ lần cuối (tồn quỹ cuối 28/02), ký biên bản đối chiếu | |
| **01/03/2027** | **Cắt chuyển (khuyến nghị):** nhập liệu 100% ở hệ thống mới, KiotViet chỉ-đọc ≥ 3 tháng | Đầu tháng để chốt công nợ gọn |

**Lựa chọn khác:** cắt chuyển sớm vào **01/02/2027** nếu G3 đạt và chạy song song sạch. **Không khuyến nghị**: sát Tết là lúc khối lượng đơn và công nợ lớn nhất, sai số rất tốn kém, và dev cũng không có thời gian trực hỗ trợ trong kỳ nghỉ.

**Điều kiện quay lại KiotViet (rollback):** chênh lệch tiền/kho không giải thích được trong 3 ngày đầu sau cắt chuyển → tạm dùng KiotViet, nhập bù sau.

### 13.6 Điều kiện để lịch 2 tháng thành công
1. Cả hai dev **toàn thời gian** cho dự án suốt 9 tuần (không kèm việc khác).
2. Một **người ra quyết định nghiệp vụ** (kế toán/chủ) trả lời trong ≤ 1 ngày làm việc.
3. Đã xuất đủ dữ liệu bổ sung từ KiotViet trong **tuần 1** (mục 5.7).
4. Không thêm yêu cầu mới vào MVP-lite sau tuần 2; mọi đề xuất mới vào danh sách Phase 2.
5. Mọi thay đổi chạm tiền/kho/nợ phải qua PR có người duyệt, dù AI sinh code.

> Lưu ý trung thực: đây là **ước lượng ban đầu**, chưa kiểm chứng bằng tốc độ thực tế của đội. Nên đo tại G1 (cuối W3): nếu import + engine giá chưa xong, cần cắt thêm ngay thay vì hy vọng bù ở cuối.

---

## 13B. Phương án đầy đủ (~5 tháng, để tham khảo)

> **Chỉ để tham khảo, không cập nhật theo các thay đổi sau bản 0.1** (có thể còn nhắc 1 chi nhánh, chuyển kho ở Phase 2, vai trò cũ…). Lịch đang thực hiện là mục 13.
>
> Giữ lại để so sánh: phạm vi đầy đủ hơn (kiểm kho, trả hàng nhập, bản sửa hóa đơn, báo cáo đủ, import lịch sử), có đệm và chạy song song dài hơn. Dùng khi 2 tháng không khả thi.

Lộ trình thiết kế cho **đội 2 người + AI agent**, bắt đầu **thứ Hai 09/11/2026**, mục tiêu **go-live 01/04/2027** (đầu tháng/đầu quý để chốt công nợ và tồn quỹ đầu kỳ sạch). Phương án dự phòng: **01/05/2027**, quyết định tại cổng G2.

### 13B.1 Nguyên tắc xếp lịch
1. **Làm rủi ro cao trước:** import dữ liệu + engine giá + sổ cái kho/nợ/quỹ đi trước màn hình đẹp. Đây là phần sai là mất tiền.
2. **Tránh mùa cao điểm:** bán sỉ thường tăng mạnh trước Tết (dự kiến mùng 1 ≈ 06/02/2027). Từ tháng 12 đến cuối tháng 1 **không nhờ nhân viên/kế toán test nhiều**; kỳ nghỉ Tết (≈ 04–14/02) dùng làm đệm kỹ thuật.
3. **Mỗi mốc có thể chứng minh bằng số liệu** (đối chiếu với file KiotViet), không chỉ "xong màn hình".
4. **Chạy song song với KiotViet ≥ 3 tuần** trước khi cắt, có kế hoạch quay lại KiotViet (rollback).
5. **Đã tính đệm** (tuần hardening + kỳ Tết). Nếu trễ, **cắt phạm vi** theo mục 13B.5, không kéo dài ngày go-live trừ khi thiếu phần không được cắt.

### 13B.2 Tổng quan theo thời gian

```
Tuần  W1-2 | W3-6  | W7-11      | W12     | W13-14 | W15-17  | W17-19   | W18-21        | 01/04
Ngày  9/11 | 23/11 | 21/12      | 25/1    | 1/2    | 15/2    | 1/3      | 8/3           |
M0    ████                                                                               Chuẩn bị
M1         ████████                                                                      Nền tảng + danh mục + import
M2                 ██████████                                                            Lõi bán hàng, nợ, quỹ
G2                            ▲ (22/01: quyết định giữ 01/04 hay dời 01/05)
Hard.                          ████                                                      Hardening + hạ tầng + backup
Tết                                     ░░░░                                             Nghỉ/đệm (≈ 04–14/02)
M3                                           ██████                                      Mua hàng, trả hàng, kiểm kho
M4                                                    ██████                             Báo cáo, phân quyền, UAT
M5                                                         ████████                      Chạy song song 3 tuần + đóng băng
Go-live                                                                          ▲       01/04/2027
```

### 13B.3 Chi tiết từng mốc

#### M0 – Chuẩn bị (W1–W2: 09/11 – 20/11/2026)
| Việc | Phụ trách | Đầu ra |
|---|---|---|
| Trả lời câu hỏi mục 5.8 với kế toán/chủ (còn lại câu 3, 4, 5; giả thuyết email = hạng giá đã bác bỏ) | Dev A | Biên bản chốt nghiệp vụ |
| Xuất bổ sung từ KiotViet: 6 bảng giá còn lại, nhân viên, tài khoản quỹ, **hóa đơn 3–6 tháng gần nhất** | Dev B | Bộ dữ liệu mở rộng (cất ngoài repo) |
| ERD chi tiết từ mục 5.3–5.4 (AI dự thảo, người duyệt), chốt quy tắc làm tròn, tính giá, giá vốn | Dev A + AI | `docs/erd`, `docs/rules.md` |
| Wireframe 5–6 màn hình: **tạo đơn sỉ**, danh sách hóa đơn, công nợ khách, nhập hàng, sổ quỹ, hàng hóa | Dev B | Wireframe được kế toán duyệt |
| Dựng repo monorepo, CI (lint/type/test), Docker dev, staging, `CLAUDE.md`, quy ước PR | Dev B + AI | Pipeline xanh, deploy staging được |
| Tạo **bộ dữ liệu ẩn danh** để dev/test (thay tên/SĐT/địa chỉ) | AI + Dev A | Dataset dev không chứa dữ liệu cá nhân |

**Cổng G0:** nghiệp vụ chốt bằng văn bản; staging chạy được; ERD được duyệt.

#### M1 – Nền tảng & danh mục (W3–W6: 23/11 – 18/12/2026)
| Việc | Phụ trách |
|---|---|
| Auth (JWT + refresh), người dùng, vai trò/quyền, nhật ký thao tác, 2 chi nhánh (Hà Nội, Sài Gòn) và gán người dùng theo chi nhánh | Dev A + AI |
| Khung giao diện: layout, bảng dữ liệu dùng chung (lọc/sắp xếp/chọn cột/xuất Excel), form, phím tắt | Dev B + AI |
| Nhóm hàng (cây), sản phẩm, ảnh, vị trí kho; 7 bảng giá + `price_book_items` | Dev A + Dev B |
| Khách hàng, nhà cung cấp, hồ sơ xuất hóa đơn | Dev B + AI |
| **Công cụ import** (mục 5.7 bước 1–6): sản phẩm, **tải ảnh về kho file**, bảng giá, nhân viên, khách, NCC; báo lỗi từng dòng, chạy lại được (idempotent) | Dev A + AI |
| Mã chứng từ (`code_sequences`) khởi tạo từ số lớn nhất hiện có | Dev A |

**Cổng G1:** import dữ liệu thật vào staging và **khớp** số SP (2.787), số KH (1.665), số NCC hợp lệ; ảnh đã tải về; tìm hàng/khách không dấu < 200 ms. Hiệu chỉnh lại ước lượng thời gian tại đây.

#### M2 – Lõi bán hàng, công nợ, sổ quỹ (W7–W11: 21/12/2026 – 22/01/2027)
Mốc khó nhất; **ưu tiên đúng nghiệp vụ hơn đẹp giao diện**.

| Tuần | Việc | Phụ trách |
|---|---|---|
| W7 | **Engine tính giá** (khách → bảng giá → lùi về bảng chung; giảm giá/đơn vị; làm tròn) + bộ test bằng ví dụ thật | Dev A + AI |
| W7–W8 | Sổ cái tồn kho (`stock_movements`) + tồn đầu kỳ; sổ cái công nợ (`debt_ledger`, cho phép âm) + số dư đầu kỳ; sổ quỹ + danh mục thu chi | Dev A + AI |
| W8–W10 | **Màn hình tạo đơn sỉ** (nhập nhanh bằng bàn phím, thấy giá/tồn/công nợ khách ngay), đặt hàng phiếu tạm + đặt cọc | Dev B + AI |
| W9–W10 | Đơn → hóa đơn (transaction nguyên tử, idempotency), bản sửa `.nn`, thanh toán tiền mặt/CK | Dev A + AI |
| W10 | Thu nợ theo khách + cấn trừ hóa đơn cũ nhất; trả hàng bán (bù trừ công nợ) | Dev A + Dev B |
| W11 | In A4 (hóa đơn, phiếu giao hàng), import chứng từ lịch sử phục vụ test, **script đối chiếu tự động** với file KiotViet | Dev B + AI |

**Cổng G2 (cuối W11 – 22/01/2027):**
- Đối chiếu khớp: tổng công nợ khách, tồn × giá vốn, tồn quỹ với file gốc.
- Tạo lại 20 hóa đơn thật bất kỳ → **cùng tổng tiền** với KiotViet.
- **Quyết định:** đạt → giữ 01/04; trễ > 2 tuần → chuyển phương án 01/05 và cắt phạm vi (13B.5).

#### Hardening + Tết (W12–W14: 25/01 – 14/02/2027)
| Tuần | Việc |
|---|---|
| W12 | Sửa lỗi từ G2, bổ sung test nghiệp vụ, hiệu năng tạo hóa đơn, hạ tầng production (VPS, HTTPS, **backup tự động + thử khôi phục**), giám sát/Sentry |
| W13–W14 | **Nghỉ Tết** (≈ 04–14/02). Chỉ việc nhẹ, không phụ thuộc người dùng: tài liệu, dọn nợ kỹ thuật, nâng cấp thư viện |

#### M3 – Mua hàng, trả hàng, kiểm kho (W15–W17: 15/02 – 05/03/2027)
| Việc | Phụ trách |
|---|---|
| Đặt hàng nhập → nhập hàng, **giá vốn bình quân gia quyền** (`NUMERIC(18,4)`), công nợ NCC, thanh toán NCC qua sổ quỹ | Dev A + AI |
| Trả hàng nhập; NCC loại `driver`; công nợ nhân viên | Dev A + Dev B |
| **Kiểm kho** (thay NCC "kiểm kê" ảo) + cân bằng kho | Dev B + AI |
| Import chứng từ chưa hoàn tất + lịch sử cần tra cứu; chạy thử lần 2 tồn đầu kỳ/nợ đầu kỳ | Dev A + AI |

**Cổng G3:** giá vốn sau nhập khớp tính tay ở 10 mã mẫu; kiểm kho cân bằng đúng; mọi bút toán kho/nợ/quỹ truy vết được về chứng từ.

#### M4 – Báo cáo, phân quyền, UAT (W17–W19: 01/03 – 19/03/2027, gối với M3)
| Việc | Phụ trách |
|---|---|
| Báo cáo: công nợ khách/NCC (tuổi nợ), doanh số theo khách/NVKD/mặt hàng, lãi gộp, tồn kho & hàng chậm bán, sổ quỹ; xuất Excel | Dev B + AI |
| Áp dụng phân quyền cấu hình được lên mọi endpoint (`@RequirePermission`), kiểm thử theo từng vai trò; quyền xem giá vốn | Dev A |
| Hướng dẫn sử dụng ngắn + video; bảng phím tắt | Dev B + AI |
| **UAT** với 2–3 người dùng chủ chốt trên dữ liệu thật tại staging; gom lỗi và sửa | Cả hai |

**Cổng G4:** người dùng chủ chốt hoàn thành quy trình hằng ngày (tạo đơn → hóa đơn → thu tiền → nhập hàng → báo cáo) không cần dev hỗ trợ.

#### M5 – Chạy song song & cắt chuyển (W18–W21: 08/03 – 01/04/2027)
| Thời gian | Việc |
|---|---|
| 08/03 – 28/03 | **Chạy song song ~3 tuần:** nhập liệu ở hệ thống mới và đối chiếu cuối mỗi ngày với KiotViet (hoặc nhập cả hai). Báo cáo chênh lệch hằng ngày: tồn, công nợ, quỹ, doanh số |
| 29/03 – 31/03 | **Đóng băng:** xuất dữ liệu cuối từ KiotViet (tồn, công nợ khách/NCC, tồn quỹ cuối 31/03), chạy import số dư đầu kỳ lần cuối, ký biên bản đối chiếu |
| **01/04** | **Go-live:** nhập liệu 100% ở hệ thống mới; KiotViet chuyển sang chỉ-đọc, **giữ ≥ 3 tháng** để tra cứu/rollback |
| 01/04 – 15/04 | Hỗ trợ sát (dev trực), sửa lỗi nóng, theo dõi đối chiếu hằng ngày |

**Cổng G5 (Go/No-Go, 26/03):** chênh lệch đối chiếu = 0 (hoặc giải thích được từng khoản) trong ≥ 5 ngày liên tiếp; backup khôi phục thử thành công; kế toán đồng ý.
**Điều kiện quay lại KiotViet (rollback):** chênh lệch tiền/kho không giải thích được trong 3 ngày đầu → tạm dùng KiotViet, nhập bù sau.

### 13B.4 Sau go-live (không cam kết ngày, xếp theo giá trị)
| Ưu tiên | Tính năng | Lý do |
|---|---|---|
| 1 | NVKD & hoa hồng, hạn mức công nợ cứng/cảnh báo quá hạn, biên bản đối chiếu công nợ gửi khách | Tác động trực tiếp tới dòng tiền |
| 2 | Quy đổi đơn vị tính, phân bổ chi phí nhập hàng (container) | Giá vốn chính xác hơn |
| 3 | Quản lý giao hàng/xe-tài xế, giao hàng từng phần, báo giá riêng | Vận hành kho vận |
| 4 | Hóa đơn VAT/điện tử (nếu xác nhận cần) | Tuân thủ |
| 5 | Cổng đặt hàng cho đại lý (B2B), app mobile cho NVKD, POS quầy/offline | Mở rộng kênh |

### 13B.5 Nếu bị trễ: thứ tự cắt phạm vi
1. Báo cáo nâng cao (chỉ giữ công nợ, doanh số, tồn kho, sổ quỹ); báo cáo khác xuất Excel thủ công.
2. Trả hàng nhập và kiểm kho tinh vi (tạm dùng phiếu điều chỉnh tồn đơn giản).
3. Phân quyền chi tiết (tạm chỉnh quyền bằng Swagger, chưa có màn hình).
4. Chuyển lịch sử chứng từ cũ (giữ file lưu trữ, chỉ import số dư đầu kỳ).
5. **Không cắt:** engine giá, sổ cái kho/nợ/quỹ, đối chiếu dữ liệu, backup. Thiếu các phần này thì **dời go-live sang 01/05**.

### 13B.6 Hai tuần làm việc đầu tiên
1. Dev A: họp chốt câu hỏi mục 5.8 với kế toán; chốt quy tắc giá/làm tròn.
2. Dev B: xuất bổ sung dữ liệu từ KiotViet (mục 5.7), lưu **ngoài repo**; dựng repo + CI.
3. Cả hai: duyệt ERD do AI dự thảo từ mục 5.3–5.4; viết `CLAUDE.md`.
4. Cả hai: duyệt wireframe màn hình tạo đơn sỉ với người dùng thực tế (màn hình quyết định mức độ chấp nhận).
5. Cuối W2: họp cổng G0 → bắt đầu M1.

> Lưu ý: lịch này là **ước lượng ban đầu**, chưa kiểm chứng bằng tốc độ làm việc thực tế của đội. Hiệu chỉnh tại cổng G1 và G2 dựa trên khối lượng việc thực sự hoàn thành, rồi cập nhật lại tài liệu.

---

## 14. Phụ lục

### 14.1 Thuật ngữ
- **SKU**: mã quản lý một biến thể hàng hóa cụ thể.
- **Biến thể (variant)**: phiên bản của sản phẩm (size, màu...). *Không dùng ở MVP vì dữ liệu thực mỗi quy cách là một SKU riêng.*
- **Giá vốn bình quân gia quyền**: giá vốn tính lại sau mỗi lần nhập hàng.
- **Ledger**: sổ cái ghi nhận mọi biến động, chỉ thêm không sửa.
- **Idempotency**: gửi lại cùng một yêu cầu nhiều lần chỉ có hiệu lực một lần.
- **HĐĐT**: hóa đơn điện tử.
- **PWA**: ứng dụng web có thể cài đặt và chạy offline.

### 14.2 Quyết định kiến trúc đã chốt (ADR tóm tắt)
| # | Quyết định | Lý do |
|---|---|---|
| ADR-01 | Modular monolith, chưa dùng microservices | Đơn giản vận hành, đủ tốt cho quy mô công ty |
| ADR-02 | TypeScript full-stack (Next.js + NestJS) | Chia sẻ type/validator, thống nhất đội ngũ |
| ADR-03 | PostgreSQL làm CSDL duy nhất cho dữ liệu nghiệp vụ (kể cả hàng đợi job); chưa dùng Redis | ACID, báo cáo, ít thành phần vận hành |
| ADR-04 | Tồn kho dạng ledger append-only | Truy vết, đối soát, an toàn dữ liệu |
| ADR-05 | Single-tenant (nội bộ công ty), multi-branch/kho từ đầu (nay là 2 chi nhánh: Hà Nội, Sài Gòn) | Đơn giản hơn; đa chi nhánh khó bổ sung về sau |
| ADR-06 | ~~POS offline ở Phase 2~~ → hạ xuống Phase 3; ưu tiên quy trình đơn sỉ + công nợ | Chốt bán sỉ: ít đơn/giá trị lớn, thường có mạng |
| ADR-07 | ⛔ **Đã bỏ 05/11/2026 (ADR-23):** Engine giá riêng: giá riêng khách > bảng giá của khách > Bảng giá chung **cùng chi nhánh**; giảm giá là số tiền/đơn vị. Bậc thang/đơn vị: sau | Bán sỉ phụ thuộc bảng giá phức tạp |
| ADR-08 | Đơn hàng dùng state machine, hỗ trợ giao từng phần | Vòng đời đơn sỉ nhiều bước |
| ADR-09 | Công nợ theo sổ cái, cho phép số dư âm, thu theo khách rồi cấn trừ hóa đơn | 90% hóa đơn mua chịu; 111 khách có số dư âm; thu nợ không gắn hóa đơn |
| ADR-10 | Sản phẩm phẳng (không biến thể/lô/HSD), 1 SKU = 1 quy cách. Combo (từ 05/11/2026) chỉ là gói chọn nhanh, không có tồn/giá vốn riêng | Dữ liệu thực không dùng biến thể/lô; combo thêm theo yêu cầu để lập đơn mua nhanh |
| ADR-11 | Đơn giá/giá vốn `NUMERIC(18,4)` | Giá nhập thực tế có phần thập phân |
| ADR-12 | Kiểm kho là module riêng; không dùng "NCC ảo" | Hiện đang điều chỉnh kho bằng phiếu nhập/trả NCC "kiểm kê" |
| ADR-13 | "Nhóm khách hàng" của KiotViet → `sales_owner_id`; hạng giá là trường riêng | Dữ liệu cho thấy nhóm = tên nhân viên phụ trách |
| ADR-14 | Tải ảnh sản phẩm về kho file riêng trước khi ngừng KiotViet | Ảnh đang nằm trên CDN KiotViet |
| ADR-15 | ORM là Drizzle (bản ổn định 0.45), không dùng Prisma | Đội dùng AI agent: SQL-first, migration đọc được; Prisma `latest` hiện là 8.0 RC |
| ADR-16 | Hai chi nhánh dùng chung dữ liệu gốc; giá bán, tồn kho, giá vốn, công nợ, quỹ và chứng từ tách theo `branch_id` | Giá và tồn khác nhau; công nợ tách biệt hoàn toàn |
| ADR-17 | Giá vốn bình quân gia quyền lưu ở `stocks` (theo chi nhánh), không ở `products` | Mỗi chi nhánh nhập và giữ hàng riêng |
| ADR-18 | Chuyển kho là chứng từ riêng (không phải hóa đơn/phiếu nhập), 2 bước; chi nhánh là khách/nhà cung cấp nội bộ; phí vận chuyển cộng vào giá nhập bên nhận | Không làm sai doanh thu; theo dõi được công nợ và phí giữa 2 chi nhánh |
| ADR-19 | Xác thực: access JWT 15 phút chỉ chứa id; refresh token ngẫu nhiên (không phải JWT) trong cookie httpOnly, lưu băm, xoay vòng + phát hiện dùng lại; vai trò/trạng thái đọc từ CSDL mỗi yêu cầu | Khóa tài khoản/đổi quyền có hiệu lực ngay; token bị đánh cắp bị phát hiện |
| ADR-20 | Mọi lỗi API theo `{ code, message, details, requestId }` qua bộ lọc lỗi toàn cục | Frontend xử lý lỗi thống nhất; không lộ chi tiết nội bộ |
| ADR-21 | Chi nhánh mặc định là Hà Nội (04/11/2026) | Chủ dự án quyết định |
| ADR-22 | Nhóm nhà cung cấp chỉ là cột dữ liệu `suppliers.group_name` (có thể trống), không có nghiệp vụ riêng | Công ty không cần theo dõi nợ/ứng riêng cho tài xế, nhân viên |
| ADR-23 | **Bỏ toàn bộ giá bán** (05/11/2026): xóa bảng giá, lưới giá, báo giá, quyền `price.edit`, `price_id` trên khách/đơn/hóa đơn. Giá bán quy ước chung ở mô tả sản phẩm; đơn giá trên dòng đơn/hóa đơn do người lập đơn nhập (vẫn lưu để làm sổ sách, lãi gộp). Thay thế ADR-07 và các mục "bảng giá" cũ trong tài liệu này | Quyết định của chủ hệ thống |

> Các quyết định trên có thể thay đổi khi các câu hỏi còn mở ở mục 5.8 được trả lời.
