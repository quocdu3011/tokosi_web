# Nối API mua hàng vào frontend

Phạm vi được yêu cầu: nhà cung cấp, sổ công nợ, đặt hàng nhập, nhập hàng và trả hàng nhập đã có trong OpenAPI. Giữ design system TKS và các thành phần bảng, dialog, phân quyền hiện hành. Không đổi BE.

- [x] Tạo kiểu alias từ schema đã sinh; query theo chi nhánh, mutation chống trùng, làm mới tồn kho/công nợ sau ghi.
- [x] Nhà cung cấp: lọc, phân trang, Excel, thêm/sửa/ngưng giao dịch, số liệu từng chi nhánh, sổ công nợ theo ngày và quyền.
- [x] Mua hàng: menu đặt hàng nhập; danh sách/lọc/Excel; chi tiết, form dòng hàng, xác nhận/kết thúc/hủy theo trạng thái; nhập từ phiếu đặt, trả từ phiếu nhập và lập trực tiếp.
- [x] Mọi số lượng/giá giữ dạng chuỗi; combo tách thành phần chính xác; tổng tiền hiển thị từ server. Tạo chứng từ giữ Idempotency-Key khi thử lại cùng nội dung.
- [x] Kiểm tra helper nghiệp vụ, lời gọi API, lint, typecheck, toàn bộ test FE, build và giao diện trình duyệt nếu môi trường cho phép.

Kiểm tra chính: không gửi trường đã bỏ, không lẫn chi nhánh khi đổi chi nhánh, không cho sửa dòng phiếu nhập/trả đã lập; không hủy/kết thúc phiếu đặt trái trạng thái. Mọi lỗi API hiển thị tiếng Việt; loading/empty/error có thao tác thử lại.

Theo yêu cầu tiếp theo, dùng ui-ux-pro-max và thành phần của tab Hàng hóa: PageHeader, TableSearch, Radix Select, ColumnPicker, cột kéo độ rộng/lưu lựa chọn, sắp xếp server, badge trạng thái, Sheet bên phải và tab Thông tin/Sổ công nợ. Giữ bảng cuộn ngang trong ngăn chi tiết trên màn nhỏ.

Kiểm chứng 06/11/2026: lint và typecheck đạt, 18 tệp / 97 test FE đạt, production build đạt. Test gọi qua API client thật với fetch giả kiểm tra chi nhánh chốt, Idempotency-Key, thời gian Việt Nam sang UTC, tiền/số lượng dạng chuỗi và lỗi RETURN_QTY_EXCEEDED. Đã xem nhà cung cấp, đặt hàng nhập và ngăn tạo phiếu trên Chrome ở cửa sổ hẹp và rộng. Danh sách nhà cung cấp môi trường hiện tại rỗng; chưa nghiệm thu tạo/hủy chứng từ với dữ liệu thật. Không thay đổi BE hoặc CSDL.
